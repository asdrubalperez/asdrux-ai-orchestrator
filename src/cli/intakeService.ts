import { randomUUID } from "node:crypto";
import {
  createRunPendingStart,
  ensurePipelineDefinition,
  finalizeRun,
  forceUserEscalation,
  getIntakeFieldDefinitions,
  getPipelineDefinitionById,
  getProjectByIdForUser,
  getProjectForUser,
  getRunDetailForUser,
  listRunsForUser,
  promoteRunToRunning,
  recordRunConfigVersions,
  recordRunEvent,
  resolveAgentConfig,
  type RunRow,
} from "../db/repository.js";
import { cloneRunRepository, headSha, removeRunClone, RunRepoCloneError } from "../isolation/worktree.js";
import {
  createGitProcessAuth,
  GitConnectionInvalidError,
  GitConnectionRequiredError,
} from "../auth/gitConnectionService.js";
import {
  ensureBranchForRun,
  validateForCaseConfirmation,
  validateForRunStart,
  type BranchValidationStatus,
} from "../auth/branchValidationService.js";
import { FULL_PIPELINE, PIPELINES } from "../pipelines/definitions.js";
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

  // FEATURE-017, hallazgo de la prueba end-to-end del owner (2026-07-25): el default anterior,
  // SINGLE_PHASE_ARCHITECT, solo tiene la fase Architect — los runs creados desde la UI
  // terminaban "completed" tras esa única fase, sin Functional/Planning/Developer/QA. Default
  // correcto: el pipeline real de 5 fases + loop Developer↔QA.
  const pipelineName = params.pipelineName ?? FULL_PIPELINE.name;
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

export type ConfirmIntakeForProjectResult =
  | { kind: "confirmed"; run: RunRow; branchWarning: string | null }
  | { kind: "not_found" }
  | { kind: "project_not_configured" }
  | { kind: "branch_validation_failed"; status: BranchValidationStatus; message: string };

/**
 * FEATURE-042, sección B.8/B.9/D.4: entrada de creación de casos del flujo de proyecto. A
 * diferencia de `confirmIntake` (endpoint legacy `POST /runs`, sin cambios): exige `projectId`
 * explícito (sin fallback), exige que el proyecto tenga repositorio configurado, descarta
 * cualquier `repositorio` que venga en `businessCase` (nunca se persiste, sección B.9), y corre el
 * gate Git preventivo (D.4) antes de persistir el run.
 */
export async function confirmIntakeForProject(params: {
  userId: string;
  projectId: string;
  businessCase: BusinessCaseValues;
  pipelineName?: string;
}): Promise<ConfirmIntakeForProjectResult> {
  const project = await getProjectByIdForUser(params.projectId, params.userId);
  if (!project) return { kind: "not_found" };
  if (!project.repository_full_name || !project.repository_clone_url) {
    return { kind: "project_not_configured" };
  }

  const ramaBase = params.businessCase.rama_base_trabajo?.trim() || "main";
  const validation = await validateForCaseConfirmation({
    userId: params.userId,
    repositoryFullName: project.repository_full_name,
    repositoryCloneUrl: project.repository_clone_url,
    branchName: ramaBase,
  });
  if (validation.status !== "existing" && validation.status !== "creatable") {
    return { kind: "branch_validation_failed", status: validation.status, message: validation.message };
  }

  const pipelineName = params.pipelineName ?? FULL_PIPELINE.name;
  const pipelineSpec = PIPELINES[pipelineName];
  if (!pipelineSpec) {
    throw new Error(`Pipeline desconocido: "${pipelineName}".`);
  }
  const pipelineDefinition = await ensurePipelineDefinition(pipelineSpec);
  const runId = randomUUID();

  // Sección B.9: repositorio nunca se persiste para casos nuevos, se descarta explícitamente aunque
  // el cliente lo mande.
  const { repositorio: _ignoredRepositorio, ...businessCaseWithoutRepo } = params.businessCase;
  const businessCase: BusinessCaseValues = { ...businessCaseWithoutRepo, rama_base_trabajo: ramaBase };

  const run = await createRunPendingStart({
    id: runId,
    pipelineDefinitionId: pipelineDefinition.id,
    ownerId: params.userId,
    projectId: project.id,
    businessCase,
  });

  await recordRunEvent(run.id, "intake_confirmed", { businessCase, projectId: project.id });
  return {
    kind: "confirmed",
    run,
    branchWarning: validation.status === "creatable" ? validation.warning : null,
  };
}

export type StartPendingRunResult =
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "repo_clone_failed"; message: string }
  | { kind: "git_connection_required"; message: string }
  | { kind: "branch_validation_failed"; status: BranchValidationStatus; message: string }
  | { kind: "started"; run: RunRow; execute: () => Promise<void> };

function isBusinessCaseValues(value: unknown): value is BusinessCaseValues {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((v) => v === null || typeof v === "string");
}

/** Corte técnico explícito antes de invocar al Architect — nunca se le pasa a un agente un
 * problema de infraestructura para que lo note él (decisión del owner, 2026-07-25). */
async function failPendingRunTechnically(
  runId: string,
  message: string
): Promise<{ kind: "repo_clone_failed"; message: string }> {
  await finalizeRun(runId, {
    status: "failed",
    outputArtifact: null,
    summary: `Corte técnico antes de invocar al Architect: ${message}`,
    escalationReason: null,
  });
  await recordRunEvent(runId, "repo_clone_failed", { message });
  return { kind: "repo_clone_failed", message };
}

/**
 * FEATURE-042 (cableado con FEATURE-026): mismo corte técnico que `failPendingRunTechnically`,
 * pero con un `kind`/evento distinto para que el frontend pueda distinguir "no pudimos clonar tu
 * repo" de "conectá tu cuenta de GitHub" -- nunca un 500 genérico indistinguible de un bug.
 */
async function failGitConnectionRequired(
  runId: string,
  message: string
): Promise<{ kind: "git_connection_required"; message: string }> {
  await finalizeRun(runId, {
    status: "failed",
    outputArtifact: null,
    summary: `Corte técnico antes de invocar al Architect: ${message}`,
    escalationReason: null,
  });
  await recordRunEvent(runId, "git_connection_required", { message });
  return { kind: "git_connection_required", message };
}

/**
 * FEATURE-042, sección D.6/D.7: gate Git autoritativo. Se corta acá, no se le pasa nunca al
 * Architect un problema de rama/permisos para que lo note él -- mismo criterio que las otras
 * funciones de corte técnico de este archivo.
 */
async function failBranchValidation(
  runId: string,
  status: BranchValidationStatus,
  message: string
): Promise<{ kind: "branch_validation_failed"; status: BranchValidationStatus; message: string }> {
  await finalizeRun(runId, {
    status: "failed",
    outputArtifact: null,
    summary: `Corte técnico antes de invocar al Architect: ${message}`,
    escalationReason: null,
  });
  await recordRunEvent(runId, "branch_validation_failed", { status, message });
  return { kind: "branch_validation_failed", status, message };
}

/**
 * FEATURE-017, Regla 7: Iniciar transiciona `sin_iniciar -> running` y dispara exactamente el
 * mismo flujo que hoy ejecuta runStart.ts (primera invocación al Architect con el caso mapeado
 * como initialContext).
 *
 * Hallazgo de la prueba end-to-end del owner (2026-07-25): el Repositorio/Rama Base del caso de
 * negocio no eran el repo de trabajo real — el pipeline seguía usando el repo ya clonado del
 * proyecto (`project.repo_path`), ignorando por completo lo que el usuario escribió en el intake.
 * Ahora `business_case.repositorio`/`rama_base_trabajo` SON el repo de trabajo real: cada caso
 * clona su propia copia aislada (`cloneRunRepository`, sin compartir working tree entre casos,
 * incluso si dos casos apuntan al mismo repo/rama). Si el clonado o el checkout de rama fallan, el
 * run se corta técnicamente (`failPendingRunTechnically`) antes de invocar al Architect.
 */
export async function startPendingRun(params: { runId: string; userId: string }): Promise<StartPendingRunResult> {
  const detail = await getRunDetailForUser(params.runId, params.userId);
  if (!detail) return { kind: "not_found" };

  const run = detail.run;
  if (run.status !== "sin_iniciar") return { kind: "conflict" };

  const pipelineDefinition = await getPipelineDefinitionById(run.pipeline_definition_id);
  if (!pipelineDefinition) {
    throw new Error(`No existe pipeline_definition_id ${run.pipeline_definition_id} para el run ${run.id}.`);
  }
  const pipelineSpec = parsePipelineDefinitionRow(pipelineDefinition);
  const firstPhase = pipelineSpec.definition.phases[0].agentRole;

  const businessCase = isBusinessCaseValues(run.business_case) ? run.business_case : {};
  // FEATURE-017, Regla 4: Rama Base de Trabajo tiene default "main" si el usuario no indica nada.
  const ramaBase = businessCase.rama_base_trabajo?.trim() || "main";

  if (!run.project_id) {
    throw new Error(`El run ${run.id} no tiene project_id persistido.`);
  }
  const projectId = run.project_id;

  // FEATURE-042, sección B.9: el repositorio se obtiene siempre desde el proyecto cuando está
  // configurado -- business_case.repositorio queda como fallback exclusivo de runs legacy
  // (creados antes de que el proyecto tuviera un repositorio canónico propio), nunca como fuente
  // preferida para casos nuevos.
  const project = await getProjectByIdForUser(projectId, params.userId);
  const repositorio = project?.repository_clone_url ?? businessCase.repositorio?.trim();

  if (!repositorio) {
    return failPendingRunTechnically(run.id, "El caso de negocio no tiene Repositorio persistido.");
  }

  // FEATURE-042 (cableado con FEATURE-026), Regla 9 de FEATURE-026 ("sin fallback silencioso"):
  // todo run web resuelve su credencial contra la conexión GitHub del owner -- nunca contra la
  // clave SSH legacy del host. Sin conexión válida, el run se corta técnicamente acá, antes de
  // invocar al Architect, con un estado distinguible (no un 500 genérico).
  let gitAuth;
  try {
    gitAuth = await createGitProcessAuth(params.userId);
  } catch (err) {
    if (err instanceof GitConnectionRequiredError || err instanceof GitConnectionInvalidError) {
      return failGitConnectionRequired(run.id, err.message);
    }
    throw err;
  }

  // FEATURE-042, sección D.6/D.7: gate Git autoritativo -- solo para runs de proyecto configurado
  // (repository_full_name presente). Runs legacy sin proyecto con repo canónico (fallback a
  // business_case.repositorio, ver arriba) no tienen forma de validar/crear rama por API contra
  // un repo que ni siquiera está registrado como tal -- conservan el comportamiento previo
  // (cloneRunRepository falla con RunRepoCloneError si la rama no existe).
  if (project?.repository_full_name) {
    const validation = await validateForRunStart({
      userId: params.userId,
      repositoryFullName: project.repository_full_name,
      repositoryCloneUrl: repositorio,
      branchName: ramaBase,
    });
    if (validation.status !== "existing" && validation.status !== "creatable") {
      await gitAuth.dispose();
      return failBranchValidation(run.id, validation.status, validation.message);
    }
    if (validation.status === "creatable") {
      const ensured = await ensureBranchForRun({
        userId: params.userId,
        repositoryFullName: project.repository_full_name,
        repositoryCloneUrl: repositorio,
        branchName: ramaBase,
      });
      if (ensured.status !== "existing" && ensured.status !== "created") {
        await gitAuth.dispose();
        return failBranchValidation(run.id, ensured.status, ensured.message);
      }
    }
  }

  let worktree;
  try {
    worktree = await cloneRunRepository({ runId: run.id, repoUrl: repositorio, baseRef: ramaBase, gitAuth });
  } catch (err) {
    if (err instanceof RunRepoCloneError) {
      return failPendingRunTechnically(run.id, err.message);
    }
    throw err;
  } finally {
    await gitAuth.dispose();
  }

  const promoted = await promoteRunToRunning({
    runId: run.id,
    firstPhase,
    branchName: worktree.branchName,
    worktreePath: worktree.worktreePath,
  });

  if (!promoted) {
    // Carrera: el run dejó de estar en sin_iniciar entre el chequeo de arriba y la promoción
    // (ej. otra pestaña ya lo inició). El clon recién creado no debe quedar huérfano.
    await removeRunClone(worktree);
    return { kind: "conflict" };
  }

  const agentSelection = await resolveAgentConfig(params.userId, firstPhase);
  const baseCommitSha = await headSha(worktree);
  await recordRunConfigVersions(run.id);
  await recordRunEvent(run.id, "run_started", {
    branchName: worktree.branchName,
    worktreePath: worktree.worktreePath,
    provider: agentSelection.executorProvider,
    authMode: agentSelection.authMode,
    model: null,
    pipeline: `${pipelineSpec.name}@${pipelineSpec.version}`,
    projectId: run.project_id,
    repoPath: repositorio,
    baseRef: ramaBase,
    baseCommitSha,
  });

  return {
    kind: "started",
    run: promoted,
    execute: () =>
      executePipelineRun({
        runId: run.id,
        projectId,
        worktree,
        pipelineSpec,
        initialContext: run.business_case,
        userId: params.userId,
        cliAgentOverride: null,
        cleanupStrategy: "standalone-clone",
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
