import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createRunPendingStart,
  ensurePipelineDefinition,
  forceUserEscalation,
  getIntakeFieldDefinitions,
  getPipelineDefinitionById,
  getProjectForUser,
  getRunDetailForUser,
  listRunsForUser,
  promoteRunToRunning,
  recordRunConfigVersions,
  recordRunEvent,
  resolveAgentConfig,
  type RunRow,
} from "../db/repository.js";
import { createRunWorktree, removeRunWorktree } from "../isolation/worktree.js";
import { PIPELINES, SINGLE_PHASE_ARCHITECT } from "../pipelines/definitions.js";
import { parsePipelineDefinitionRow } from "./escalation.js";
import { executePipelineRun } from "./commands/runStart.js";
import { mapBusinessCase, type BusinessCaseValues } from "../intake/mapBusinessCase.js";
import { respondToEscalation } from "./respondService.js";

export async function getIntakeFields() {
  return getIntakeFieldDefinitions();
}

export async function mapIntakeText(params: { inputText: string; previousValues?: BusinessCaseValues }) {
  const fields = await getIntakeFieldDefinitions();
  const values = await mapBusinessCase({
    inputText: params.inputText,
    fields,
    previousValues: params.previousValues,
  });
  return { fields, values };
}

export class IntakeProjectNotFoundError extends Error {}

/**
 * FEATURE-017, Regla 6 / sección 7.2: confirmar el mapeo persiste el run en `sin_iniciar`, con
 * `pipeline_definition_id` ya resuelto en este momento (no en el arranque) — decisión DAIA
 * verificada contra el repo real. Sin worktree, sin branch, sin invocación al Architect todavía.
 */
export async function confirmIntake(params: {
  userId: string;
  projectId?: string;
  pipelineName?: string;
  businessCase: BusinessCaseValues;
}): Promise<RunRow> {
  const project = await getProjectForUser(params.userId, params.projectId);
  if (!project) {
    throw new IntakeProjectNotFoundError("No existe un proyecto disponible para el usuario actual.");
  }

  const pipelineName = params.pipelineName ?? SINGLE_PHASE_ARCHITECT.name;
  const pipelineSpec = PIPELINES[pipelineName];
  if (!pipelineSpec) {
    throw new Error(`Pipeline desconocido: "${pipelineName}".`);
  }

  const pipelineDefinition = await ensurePipelineDefinition(pipelineSpec);
  const runId = randomUUID();

  const run = await createRunPendingStart({
    id: runId,
    pipelineDefinitionId: pipelineDefinition.id,
    ownerId: params.userId,
    projectId: project.id,
    businessCase: params.businessCase,
  });

  await recordRunEvent(run.id, "intake_confirmed", { businessCase: params.businessCase, projectId: project.id });
  return run;
}

export async function listMyCases(userId: string): Promise<RunRow[]> {
  return listRunsForUser(userId);
}

export type StartPendingRunResult =
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "started"; run: RunRow; execute: () => Promise<void> };

/**
 * FEATURE-017, Regla 7: Iniciar transiciona `sin_iniciar -> running` y dispara exactamente el
 * mismo flujo que hoy ejecuta runStart.ts (worktree/branch reales, primera invocación al
 * Architect con el caso mapeado como initialContext).
 */
export async function startPendingRun(params: { runId: string; userId: string }): Promise<StartPendingRunResult> {
  const detail = await getRunDetailForUser(params.runId, params.userId);
  if (!detail) return { kind: "not_found" };

  const run = detail.run;
  if (run.status !== "sin_iniciar") return { kind: "conflict" };
  if (!run.project_id) throw new Error(`Run ${run.id} no tiene project_id persistido.`);

  const project = await getProjectForUser(params.userId, run.project_id);
  if (!project) throw new Error(`Proyecto inaccesible para el run ${run.id}.`);

  const pipelineDefinition = await getPipelineDefinitionById(run.pipeline_definition_id);
  if (!pipelineDefinition) {
    throw new Error(`No existe pipeline_definition_id ${run.pipeline_definition_id} para el run ${run.id}.`);
  }
  const pipelineSpec = parsePipelineDefinitionRow(pipelineDefinition);

  const projectRepoRoot = path.resolve(project.repo_path);
  const worktree = await createRunWorktree(projectRepoRoot, run.id);

  const firstPhase = pipelineSpec.definition.phases[0].agentRole;
  const promoted = await promoteRunToRunning({
    runId: run.id,
    firstPhase,
    branchName: worktree.branchName,
    worktreePath: worktree.worktreePath,
  });

  if (!promoted) {
    // Carrera: el run dejó de estar en sin_iniciar entre el chequeo de arriba y la promoción
    // (ej. otra pestaña ya lo inició). El worktree recién creado no debe quedar huérfano.
    await removeRunWorktree(projectRepoRoot, worktree);
    return { kind: "conflict" };
  }

  const agentSelection = await resolveAgentConfig(params.userId, firstPhase);
  await recordRunConfigVersions(run.id);
  await recordRunEvent(run.id, "run_started", {
    branchName: worktree.branchName,
    worktreePath: worktree.worktreePath,
    provider: agentSelection.executorProvider,
    authMode: agentSelection.authMode,
    model: null,
    pipeline: `${pipelineSpec.name}@${pipelineSpec.version}`,
    projectId: project.id,
    repoPath: projectRepoRoot,
  });

  return {
    kind: "started",
    run: promoted,
    execute: () =>
      executePipelineRun({
        projectRepoRoot,
        runId: run.id,
        worktree,
        pipelineSpec,
        initialContext: run.business_case,
        userId: params.userId,
        cliAgentOverride: null,
      }),
  };
}

export type CancelRunResult = { kind: "not_found" } | { kind: "conflict" } | { kind: "aborted" };

/**
 * FEATURE-017, Regla 8 / sección 7.4: reusa el mecanismo de escalamiento de FEATURE-013C. Fuerza
 * `running -> escalated` (forceUserEscalation, transición nueva) y de inmediato invoca
 * respondToEscalation({ abort: true }) — cero código nuevo para esa segunda mitad. La cancelación
 * se aplica recién en el próximo punto de corte natural del pipeline (ver runStart.ts,
 * haltIfCancelledExternally), no interrumpe una invocación de Executor realmente en curso.
 */
export async function cancelRun(params: { runId: string; userId: string }): Promise<CancelRunResult> {
  const detail = await getRunDetailForUser(params.runId, params.userId);
  if (!detail) return { kind: "not_found" };
  if (detail.run.status !== "running") return { kind: "conflict" };

  const escalated = await forceUserEscalation(params.runId, params.userId);
  if (!escalated) return { kind: "conflict" };

  await recordRunEvent(params.runId, "escalation_forced_by_user", {
    reason: "user_cancel_requested",
    agentRole: escalated.current_phase,
  });

  const result = await respondToEscalation({
    parentRunId: params.runId,
    userId: params.userId,
    action: { abort: true },
  });

  if (result.kind === "conflict") return { kind: "conflict" };
  return { kind: "aborted" };
}
