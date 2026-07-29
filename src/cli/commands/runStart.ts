import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readValidSession } from "../../auth/session.js";
import { ClaudeCodeExecutor } from "../../executor/claudeCodeExecutor.js";
import { CodexExecutor } from "../../executor/codexExecutor.js";
import {
  commitAllChanges,
  createRunWorktree,
  assertFeatureDocsUnchanged,
  fileAtCommit,
  gitReadinessSnapshot,
  headSha,
  mergeFeatureBranchIntoBase,
  pushRunBranch,
  remoteBranchSha,
  removeRunClone,
  removeRunWorktree,
  type RunWorktree,
} from "../../isolation/worktree.js";
import {
  createRun,
  ensurePipelineDefinition,
  finalizeRun,
  findUserById,
  getBusinessCaseForRun,
  getCurrentProjectConfig,
  getProjectForUser,
  getRunStatus,
  recordArtifact,
  recordRunConfigVersions,
  recordRunEvent,
  resolveAgentConfig,
  setProjectConfig,
  updateRunCurrentPhase,
  updateRunStatus,
  type AgentConfig,
  type ArtifactRow,
  type AuthMode,
  type RunRow,
} from "../../db/repository.js";
import { pool } from "../../db/pool.js";
import type { AgentRole, PhaseInvocation, PhaseResult } from "../../contracts/executor.js";
import { PIPELINES, PLANNING_TO_QA, SINGLE_PHASE_ARCHITECT } from "../../pipelines/definitions.js";
import type { PipelineSpec } from "../../pipelines/definitions.js";
import { extractTestCommand } from "../../pipelines/extractTestCommand.js";
import { TestExecutor, parseTestCommand } from "../../testing/testExecutor.js";
import { BuildExecutor } from "../../testing/buildExecutor.js";
import {
  activeReleaseFromRoadmap,
  artifactsAreEquivalent,
  buildEscalationContext,
  extractReleasePlanDeclaration,
  isNotApplicableOutput,
  isReentryContext,
  type MergeApprovalPayload,
} from "../escalation.js";
import {
  parseDeveloperImplementation,
  parseDeveloperReadiness,
  parseFeaturesPayload,
  parseFeatureUpdatePayload,
  parseQaResult,
} from "../../features/contracts.js";
import {
  materializeActiveFeatureDocument,
  getApprovalModeForRun,
  getActiveFeatureForRun,
  FeatureLifecycleEscalationError,
  persistActiveFeatureContribution,
  persistFunctionalFeatureBatch,
  persistPlanningFeatureSelection,
  recordFeatureCommit,
  recordFeaturePush,
} from "../../features/lifecycle.js";
import { sha256 } from "../../features/document.js";
import {
  defaultRunbookProvider,
  FEATURE_TEMPLATE_ASSET,
  type RunbookProvider,
} from "../../runbook/runbookProvider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const orchestratorRoot = path.resolve(__dirname, "..", "..", "..");
export type ExecutorProvider = "claude" | "codex";
type RunExecutor = ClaudeCodeExecutor | CodexExecutor;
const MAX_ESCALATION_ATTEMPTS = 3;

/**
 * Hallazgo de una corrida real (2026-07-25): Developer, trabajando sobre un repo real (build de
 * TypeScript + tests reales), superó los 300s hardcodeados y terminó en
 * "Executor timeout tras 300000ms" con el run marcado failed. Timeouts finales fijados por el
 * owner (2026-07-25), una variable propia por rol (no compartida) — ver
 * docs/features/FEATURE-017-*.md, sección 7 (tabla de timeouts) para la justificación completa,
 * incluida la anticipación de FEATURE-018 (Architect diseñando release roadmaps, Functional
 * generando varias features por release).
 */
function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const ARCHITECT_TIMEOUT_MS = parsePositiveIntEnv("ARCHITECT_TIMEOUT_MS", 600_000);
const FUNCTIONAL_TIMEOUT_MS = parsePositiveIntEnv("FUNCTIONAL_TIMEOUT_MS", 600_000);
const PLANNING_TIMEOUT_MS = parsePositiveIntEnv("PLANNING_TIMEOUT_MS", 600_000);
const DEVELOPER_TIMEOUT_MS = parsePositiveIntEnv("DEVELOPER_TIMEOUT_MS", 900_000);
const QA_TIMEOUT_MS = parsePositiveIntEnv("QA_TIMEOUT_MS", 900_000);

const LINEAR_PHASE_TIMEOUT_MS: Partial<Record<AgentRole, number>> = {
  architect: ARCHITECT_TIMEOUT_MS,
  functional: FUNCTIONAL_TIMEOUT_MS,
  planning: PLANNING_TIMEOUT_MS,
};

function timeoutForLinearPhase(agentRole: AgentRole): number {
  const timeout = LINEAR_PHASE_TIMEOUT_MS[agentRole];
  if (timeout === undefined) {
    throw new Error(`No hay timeout configurado para la fase lineal "${agentRole}".`);
  }
  return timeout;
}

/**
 * FEATURE-017, sección 7.4: señal interna para cortar el pipeline en el próximo punto de corte
 * natural cuando un run fue forzado a `escalated`/`aborted` desde afuera (Cancelar por usuario) —
 * distinta de un PhaseResult, porque acá no hay ningún resultado de fase que reportar: el run ya
 * fue finalizado por forceUserEscalation + respondToEscalation antes de que este chequeo corra.
 */
class RunCancelledExternallyError extends Error {}

/**
 * FEATURE-017: el manejo de escalamiento por AGENTE (handleLinearEscalation, más abajo) es
 * reactivo — reacciona al PhaseResult que la propia invocación devuelve al terminar, no consulta
 * `runs.status`. No existía ningún guard previo a arrancar una fase; este es código nuevo,
 * llamado antes de cada fase en el while de executePipelineRun y en cada iteración de
 * runDeveloperQaLoop.
 */
async function haltIfCancelledExternally(runId: string): Promise<void> {
  const status = await getRunStatus(runId);
  if (status === "escalated" || status === "aborted") {
    await recordRunEvent(runId, "run_halted_external_cancel", { status });
    throw new RunCancelledExternallyError(
      `Run ${runId} cancelado externamente (status=${status}) — pipeline detenido antes de la siguiente fase.`
    );
  }
}

export async function runStart(args: string[]): Promise<void> {
  const casePath = getFlag(args, "--case");
  if (getFlag(args, "--owner")) {
    throw new Error("--owner ya no está soportado. Corré 'npm run cli -- login' y usá la sesión local.");
  }

  const session = await readValidSession();
  const user = await findUserById(session.userId);
  if (!user) {
    throw new Error("Sesión expirada o inexistente. Corré 'npm run cli -- login'.");
  }

  const project = await getProjectForUser(user.id, getFlag(args, "--project"));
  if (!project) {
    throw new Error("No existe un proyecto disponible para la sesión actual.");
  }

  const pipelineName = getFlag(args, "--pipeline") ?? SINGLE_PHASE_ARCHITECT.name;
  const model = getFlag(args, "--model");
  // FEATURE-016, Regla 2: si hay CUALQUIER flag de CLI (--executor y/o --auth-mode), ese flag
  // decide agente Y authMode juntos para toda la invocación — nunca se mezcla con la DB, y nunca
  // se consulta la DB en absoluto para esta corrida. Sin flags, cada fase resuelve su propia
  // preferencia vía resolveAgentConfig (override de rol -> global -> default), ver
  // executePipelineRun.
  const executorFlag = getFlag(args, "--executor");
  const authModeFlag = getFlag(args, "--auth-mode");
  const cliAgentOverride: AgentConfig | null =
    executorFlag !== undefined || authModeFlag !== undefined
      ? { executorProvider: parseExecutorProvider(executorFlag ?? "claude"), authMode: parseAuthMode(authModeFlag ?? "api_key") }
      : null;

  if (!casePath) {
    throw new Error(
      "Uso: npm run cli -- run:start --case <ruta-a-json> [--project <id>] [--pipeline <nombre>] [--model <alias>] " +
      "[--executor claude|codex] [--auth-mode api_key|cli_session]"
    );
  }

  const pipelineSpec = PIPELINES[pipelineName];
  if (!pipelineSpec) {
    throw new Error(`Pipeline desconocido: "${pipelineName}". Disponibles: ${Object.keys(PIPELINES).join(", ")}`);
  }

  const businessCase = JSON.parse(await readFile(casePath, "utf8"));
  const pipelineDefinition = await ensurePipelineDefinition(pipelineSpec);

  const runId = randomUUID();
  console.log(`[run:start] runId=${runId}`);
  console.log(
    `[run:start] pipeline=${pipelineSpec.name}@${pipelineSpec.version} (${pipelineSpec.definition.phases.length} fase/s lineales${pipelineSpec.definition.loop ? " + loop Developer↔QA" : ""})`
  );

  const projectRepoRoot = path.resolve(project.repo_path);
  const worktree = await createRunWorktree(projectRepoRoot, runId);
  console.log(`[run:start] worktree creado: ${worktree.worktreePath} (rama ${worktree.branchName})`);

  // Solo para el evento de auditoría run_started: refleja la selección de la primera fase. Cada
  // fase resuelve la suya propia dentro de executePipelineRun — puede diferir por rol si hay
  // overrides en user_agent_config (FEATURE-016).
  const firstPhaseSelection: AgentConfig =
    cliAgentOverride ?? (await resolveAgentConfig(user.id, pipelineSpec.definition.phases[0].agentRole));
  const baseCommitSha = await headSha(worktree);

  const client = await pool.connect();
  let run: RunRow;
  try {
    await client.query("begin");
    run = await createRun({
      id: runId,
      pipelineDefinitionId: pipelineDefinition.id,
      ownerId: user.id,
      projectId: project.id,
      firstPhase: pipelineSpec.definition.phases[0].agentRole,
      branchName: worktree.branchName,
      worktreePath: worktree.worktreePath,
      client,
    });
    await recordRunConfigVersions(run.id, client);
    await recordRunEvent(
      run.id,
      "run_started",
      {
        branchName: worktree.branchName,
        worktreePath: worktree.worktreePath,
        casePath,
        provider: firstPhaseSelection.executorProvider,
        authMode: firstPhaseSelection.authMode,
        model: model ?? null,
        pipeline: `${pipelineSpec.name}@${pipelineSpec.version}`,
        projectId: project.id,
        repoPath: projectRepoRoot,
        baseCommitSha,
      },
      client
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  await executePipelineRun({
    projectRepoRoot,
    runId: run.id,
    projectId: project.id,
    worktree,
    pipelineSpec,
    initialContext: businessCase,
    userId: user.id,
    cliAgentOverride,
    model,
  });
}

export async function executePipelineRun(params: {
  /**
   * Requerido solo cuando cleanupStrategy es "shared-worktree" (default) — es el repo compartido
   * del que `worktree` es un `git worktree add` linkeado, usado por `removeRunWorktree` al
   * finalizar. Los runs con `cleanupStrategy: "standalone-clone"` (FEATURE-017) no tienen ningún
   * repo compartido: `worktree.worktreePath` es un clon completo e independiente.
   */
  projectRepoRoot?: string;
  runId: string;
  /**
   * FEATURE-018: requerido para que la fase Planning reciba el release activo vigente
   * (project_config_versions, config_key = "release_roadmap") como parte de su contexto de
   * invocación — ver 7.3 del documento de la Feature.
   */
  projectId: string;
  worktree: RunWorktree;
  pipelineSpec: PipelineSpec;
  initialContext: unknown;
  userId: string;
  /**
   * FEATURE-016, Regla 2: si viene seteado (flag de CLI presente), decide agente y authMode para
   * TODAS las fases de esta corrida, sin consultar la DB. Si es null, cada fase resuelve la suya
   * propia vía resolveAgentConfig(userId, role) — override de rol -> global -> default.
   */
  cliAgentOverride: AgentConfig | null;
  model?: string;
  /**
   * FEATURE-017: "shared-worktree" (default, sin cambios) — `worktree` es un `git worktree add`
   * sobre `projectRepoRoot`, limpiado con `removeRunWorktree`. "standalone-clone" — `worktree` es
   * un clon aislado propio del run (repo/rama del caso de negocio), limpiado con `removeRunClone`,
   * sin ningún repoRoot compartido de por medio.
   */
  cleanupStrategy?: "shared-worktree" | "standalone-clone";
  /** Inyectable únicamente por composición confiable/tests; nunca desde input del run. */
  runbookProvider?: RunbookProvider;
}): Promise<void> {
  const {
    projectRepoRoot,
    runId,
    projectId,
    worktree,
    pipelineSpec,
    initialContext,
    userId,
    cliAgentOverride,
    model,
    cleanupStrategy = "shared-worktree",
    runbookProvider = defaultRunbookProvider,
  } = params;
  const resolveSelection = (role: AgentRole): Promise<AgentConfig> =>
    cliAgentOverride ? Promise.resolve(cliAgentOverride) : resolveAgentConfig(userId, role);
  const readRole = (agentRole: string) =>
    readFile(path.join(orchestratorRoot, "src", "executor", "roles", `${agentRole}.txt`), "utf8");

  // Hallazgo de una corrida real (2026-07-25): sin datos reales de cuánto tarda cada fase, calibrar
  // timeouts es pura estimación. Se registra la duración real (phase_started -> phase_finished, o
  // hasta el error si la fase revienta) para poder ajustar DEVELOPER_TIMEOUT_MS/QA_TIMEOUT_MS con
  // evidencia. `phaseTiming` vive fuera del try para que el catch de abajo también pueda leerlo si
  // la fase en curso al momento del error fue la que hizo timeout.
  const phaseTiming: { agentRole: AgentRole | null; startedAt: number | null } = {
    agentRole: null,
    startedAt: null,
  };

  try {
    let previousResult: PhaseResult | null = null;
    let phaseIndex = 0;
    // FEATURE-020, Corrección 1 (6.4): el contexto que recibe la próxima fase. Normalmente avanza
    // al `outputArtifact` de la fase que acaba de terminar (flujo lineal de siempre) — pero
    // mientras un rol responde `notApplicable` (no le corresponde una revisión de escalamiento en
    // curso), este contexto NO se pisa: la fase siguiente recibe el mismo contexto de reingreso
    // que recibió quien acaba de pasar, sin modificar.
    let contextForNextPhase: unknown = initialContext;
    let retrying = false;
    const escalationAttemptsByRole = new Map<AgentRole, number>();
    const previousEscalationArtifactByRole = new Map<AgentRole, ArtifactRow>();

    while (phaseIndex < pipelineSpec.definition.phases.length) {
      const phase = pipelineSpec.definition.phases[phaseIndex];
      await haltIfCancelledExternally(runId);
      await updateRunCurrentPhase(runId, phase.agentRole);
      const baseContext = contextForNextPhase;
      const context =
        phase.agentRole === "planning" ? await withRoleContext(projectId, baseContext) : baseContext;
      const roleInstructions = await readRole(phase.agentRole);
      const selection = await resolveSelection(phase.agentRole);
      const executor = buildExecutor(selection, worktree.worktreePath, runId, model);

      const invocation: PhaseInvocation = {
        agentRole: phase.agentRole,
        roleInstructions,
        context,
        permissions: phase.permissions,
      };

      phaseTiming.agentRole = invocation.agentRole;
      phaseTiming.startedAt = Date.now();
      await recordRunEvent(runId, "phase_started", { agentRole: invocation.agentRole });
      const result = await executor.runPhase(invocation, { timeoutMs: timeoutForLinearPhase(phase.agentRole) });
      const durationMs = Date.now() - phaseTiming.startedAt;
      // FEATURE-020: Planning nunca pasa; el marcador aplica a Architect/Functional acá.
      const isPass =
        phase.agentRole !== "planning" &&
        result.status === "completed" &&
        isNotApplicableOutput(result.outputArtifact);
      // FEATURE-023 Parte 2: el template se resuelve antes de completar Functional o abrir la
      // transacción. El repositorio gestionado nunca es fuente del Runbook.
      const functionalBatch =
        invocation.agentRole === "functional" && result.status === "completed" && !isPass
          ? {
              payload: parseFeaturesPayload(result.outputArtifact),
              templateAsset: await runbookProvider.readText(FEATURE_TEMPLATE_ASSET),
            }
          : null;
      const phaseFinishedEventId = await recordRunEvent(
        runId,
        "phase_finished",
        { agentRole: invocation.agentRole, result, durationMs }
      );
      const artifact = await recordArtifact({
        runId,
        phase: invocation.agentRole,
        kind: result.status === "escalated" ? "escalation" : isPass ? "pass" : "design",
        content: artifactContentForResult(result),
      });

      if (invocation.agentRole === "planning") {
        await persistReleasePlanIfDeclared({
          projectId,
          runId,
          result,
          fallbackRamaBaseTrabajo: ramaBaseTrabajoFromBusinessCase(initialContext),
          phaseFinishedEventId,
        });
      }

      if (functionalBatch) {
        const roadmap = await getCurrentProjectConfig(projectId, "release_roadmap");
        const activeRelease = activeReleaseFromRoadmap(roadmap?.value);
        if (!activeRelease) {
          throw new Error(`Run ${runId}: Functional completó sin release activo fijado.`);
        }
        await persistFunctionalFeatureBatch({
          projectId,
          runId,
          worktreePath: worktree.worktreePath,
          releaseKey: activeRelease.id,
          phaseFinishedEventId,
          payload: functionalBatch.payload,
          templateAsset: functionalBatch.templateAsset,
        });
      }

      previousResult = result;

      if (result.status === "completed") {
        if (retrying) {
          await updateRunStatus(runId, "running");
          retrying = false;
        }
        if (!isPass) {
          contextForNextPhase = result.outputArtifact;
        }
        phaseIndex += 1;
        continue;
      }

      if (result.status === "escalated") {
        const decision = await handleLinearEscalation({
          runId,
          worktree,
          agentRole: invocation.agentRole,
          result,
          artifact,
          escalationAttemptsByRole,
          previousEscalationArtifactByRole,
        });

        if (decision.retry) {
          retrying = true;
          contextForNextPhase = decision.context;
          previousResult = null;
          phaseIndex = 0;
          continue;
        }

        console.log(`[run:start] fase "${phase.agentRole}" terminó con status "${result.status}" — pipeline detenido.`);
        await finishRun(projectRepoRoot, runId, worktree, result, { pushAndClean: false, cleanupStrategy });
        return;
      }

      console.log(`[run:start] fase "${phase.agentRole}" terminó con status "${result.status}" — pipeline detenido.`);
      await finishRun(projectRepoRoot, runId, worktree, result, { pushAndClean: false, cleanupStrategy });
      return;
    }

    if (pipelineSpec.definition.loop) {
      const developerSelection = await resolveSelection("developer");
      const qaSelection = await resolveSelection("qa");
      const developerExecutor = buildExecutor(developerSelection, worktree.worktreePath, runId, model, { sandbox: "container" });
      const qaExecutor = buildExecutor(qaSelection, worktree.worktreePath, runId, model);
      const finalResult = await runDeveloperQaLoop({
        executor: qaExecutor,
        developerExecutor,
        readRole,
        runId,
        planningResult: previousResult as PhaseResult,
        maxAttempts: pipelineSpec.definition.loop.maxAttempts,
        phaseTiming,
        featureLifecycle: true,
      });

      if (finalResult.status === "completed") {
        // FEATURE-019: en vez de finishRun con push+cleanup inmediato, la Feature aprobada
        // continúa el release (merge a la rama base + run de continuación a Planning) — ver 6.2.
        await continueReleaseAfterFeatureApproved({
          projectId,
          runId,
          worktree,
          userId,
          cliAgentOverride,
          model,
          cleanupStrategy,
        });
        return;
      }

      await finishRun(projectRepoRoot, runId, worktree, finalResult, { pushAndClean: false, cleanupStrategy });
      return;
    }

    await finishRun(projectRepoRoot, runId, worktree, previousResult as PhaseResult, {
      pushAndClean: false,
      cleanupStrategy,
    });
  } catch (err) {
    if (err instanceof RunCancelledExternallyError) {
      // El run ya fue finalizado (aborted) por forceUserEscalation + respondToEscalation antes de
      // que este chequeo corriera — no llamar finishRun/finalizeRun acá, o se sobreescribiría ese
      // status ya correcto.
      console.log(`[run:start] ${err.message}`);
      return;
    }

    if (err instanceof FeatureLifecycleEscalationError) {
      const role = phaseTiming.agentRole ?? "planning";
      const escalation: PhaseResult = {
        status: "escalated",
        outputArtifact: null,
        summary: err.message,
        escalationReason: err.message,
      };
      const artifact = await recordArtifact({
        runId,
        phase: role,
        kind: "escalation",
        content: artifactContentForResult(escalation),
      });
      await recordRunEvent(runId, "escalation_opened", {
        agentRole: role,
        artifactId: artifact.id,
        reason: "feature_lifecycle_validation",
      });
      await finishRun(projectRepoRoot, runId, worktree, escalation, {
        pushAndClean: false,
        cleanupStrategy,
      });
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    const durationMs = phaseTiming.startedAt ? Date.now() - phaseTiming.startedAt : null;
    const failure: PhaseResult = {
      status: "failed",
      outputArtifact: null,
      summary: `Error inesperado durante la ejecución del run: ${message}`,
      escalationReason: null,
    };
    await recordRunEvent(runId, "run_error", { message, agentRole: phaseTiming.agentRole, durationMs });
    await finishRun(projectRepoRoot, runId, worktree, failure, { pushAndClean: false, cleanupStrategy });
    throw err;
  }
}

async function handleLinearEscalation(params: {
  runId: string;
  worktree: RunWorktree;
  agentRole: AgentRole;
  result: PhaseResult;
  artifact: ArtifactRow;
  escalationAttemptsByRole: Map<AgentRole, number>;
  previousEscalationArtifactByRole: Map<AgentRole, ArtifactRow>;
}): Promise<{ retry: true; context: unknown } | { retry: false }> {
  const attempt = (params.escalationAttemptsByRole.get(params.agentRole) ?? 0) + 1;
  params.escalationAttemptsByRole.set(params.agentRole, attempt);

  await recordRunEvent(params.runId, "escalation_opened", {
    agentRole: params.agentRole,
    artifactId: params.artifact.id,
    attempt,
  });

  const previousArtifact = params.previousEscalationArtifactByRole.get(params.agentRole);
  params.previousEscalationArtifactByRole.set(params.agentRole, params.artifact);

  if (previousArtifact && artifactsAreEquivalent(outputArtifactOf(previousArtifact), params.result.outputArtifact)) {
    await recordRunEvent(params.runId, "escalation_repeated_detected", {
      agentRole: params.agentRole,
      artifactId: params.artifact.id,
      previousArtifactId: previousArtifact.id,
    });
    await commitAllChanges(params.worktree, `chore: preserve escalated work (run ${params.runId})`);
    return { retry: false };
  }

  if (attempt >= MAX_ESCALATION_ATTEMPTS) {
    await recordRunEvent(params.runId, "escalation_exhausted", { agentRole: params.agentRole, attempts: attempt });
    await commitAllChanges(params.worktree, `chore: preserve escalated work (run ${params.runId})`);
    return { retry: false };
  }

  // FEATURE-020, Regla 2/9: se corrige acá el bug original de FEATURE-019 — el contexto de
  // reintento ahora incluye el `business_case` real (vía `root_run_id`), sin cambiar el resto del
  // mecanismo (sigue siendo un reinicio en el mismo run, gratis, sin worktree/rama nueva).
  const context = buildEscalationContext({
    businessCase: await getBusinessCaseForRun(params.runId),
    escalationReason: params.result.escalationReason,
    rejectedArtifact: params.result.outputArtifact,
    originAgentRole: params.agentRole,
    humanSolution: null,
  });
  await recordRunEvent(params.runId, "escalation_retry_context_prepared", {
    agentRole: params.agentRole,
    attempt,
    context,
  });
  await updateRunStatus(params.runId, "retrying");
  return {
    retry: true,
    context,
  };
}

function artifactContentForResult(result: PhaseResult): Record<string, unknown> {
  const content: Record<string, unknown> = {
    outputArtifact: result.outputArtifact,
    summary: result.summary,
  };
  if (result.status === "escalated") {
    content.escalationReason = result.escalationReason;
  }
  return content;
}

type PersistArtifact = (params: Parameters<typeof recordArtifact>[0]) => Promise<unknown>;

/**
 * Persiste el resultado sintético que cierra el loop Developer↔QA por agotamiento. A diferencia
 * de una escalación emitida directamente por un agente, este resultado nace en el Orquestador y
 * por eso no pasa por ninguno de los recordArtifact normales del loop.
 */
export async function persistLoopExhaustionArtifact(
  params: {
    runId: string;
    phase: "developer" | "qa";
    attempt: number;
    result: PhaseResult;
  },
  persistArtifact: PersistArtifact = recordArtifact
): Promise<void> {
  await persistArtifact({
    runId: params.runId,
    phase: params.phase,
    kind: "escalation",
    content: { attempt: params.attempt, ...artifactContentForResult(params.result) },
  });
}

/**
 * FEATURE-018, sección 7.3: Planning siempre opera dentro del release activo vigente al momento de
 * su invocación (Regla Funcional 5) — inyectado acá, no asumido por el propio rol. `activeRelease`
 * viaja `null` cuando no hay ningún roadmap aprobado todavía para el proyecto (caso defendido por
 * planning.txt: escala en vez de asumir un release implícito).
 *
 * FEATURE-020, sección 6.2/Corrección 2: además del Roadmap activo, toda invocación de Planning
 * recibe también el Release Plan vigente (`release_plan`), no solo en el uso interno del merge.
 * Si el contexto entrante es un contexto de reingreso (Regla 11/12 — Architect/Functional ya
 * pasaron, o Planning es el `targetAgentRole`), no se envuelve dentro de `functionalArtifact`: se
 * le agrega `activeRelease`/`releasePlan` al lado, preservando su forma (`escalationReason`,
 * `targetAgentRole`, etc.) intacta. El flujo normal (`functionalArtifact` real de Functional, o
 * `{ featureJustCompleted }` de una continuación de FEATURE-019) sigue envuelto como siempre.
 */
async function withRoleContext(projectId: string, incomingContext: unknown): Promise<unknown> {
  const roadmap = await getCurrentProjectConfig(projectId, "release_roadmap");
  const releasePlan = await getCurrentProjectConfig(projectId, "release_plan");
  const shared = {
    activeRelease: activeReleaseFromRoadmap(roadmap?.value ?? null),
    releasePlan: releasePlan?.value ?? null,
  };
  return isReentryContext(incomingContext)
    ? { ...incomingContext, ...shared }
    : { functionalArtifact: incomingContext, ...shared };
}

/**
 * FEATURE-019: `rama_base_trabajo` solo existe en el `business_case` crudo del run raíz
 * (FEATURE-017) — nunca en el contexto ya envuelto de invocaciones posteriores (ej.
 * `{ featureJustCompleted }`).
 *
 * FEATURE-020, bug encontrado en prueba real: con la Regla 6 del camino genérico de
 * `respondService.ts` (siempre `FULL_PIPELINE`), el `initialContext` de un run creado por ese
 * camino ya no es el `business_case` crudo — es un `ReentryContext`, con el `business_case`
 * anidado en `businessCase`, no al nivel superior. Sin este chequeo, la primera Feature de
 * cualquier release fallaba siempre que Planning se invocaba dentro de un run nacido del
 * mecanismo de reingreso (`"Planning declaró RELEASE_PLAN pero no hay ramaBaseTrabajo
 * disponible..."`, aunque el business_case real sí tuviera `rama_base_trabajo`). Recursión acotada
 * a 1 nivel (`businessCase` nunca anida otro `ReentryContext` — es siempre el caso de negocio
 * crudo o `null`).
 */
export function ramaBaseTrabajoFromBusinessCase(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as { rama_base_trabajo?: unknown; businessCase?: unknown };
  const direct = record.rama_base_trabajo;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return ramaBaseTrabajoFromBusinessCase(record.businessCase);
}

/**
 * FEATURE-019, sección 6.3: persiste el Release Plan que Planning declaró en `RELEASE_PLAN`
 * (estado completo, no un diff) — el runtime solo le agrega `ramaBaseTrabajo`, que Planning no
 * conoce. En la primera versión (todavía no hay `release_plan` persistido) se toma del
 * `business_case` del run raíz; en versiones siguientes se conserva la ya persistida. No requiere
 * aprobación humana — a diferencia de `release_roadmap`, esto es bookkeeping interno del ciclo de
 * Features, no una decisión de negocio (la única decisión gateada es el cierre del release, ver
 * `respondService.ts`).
 */
export async function persistReleasePlanIfDeclared(params: {
  projectId: string;
  runId: string;
  result: PhaseResult;
  fallbackRamaBaseTrabajo: string | undefined;
  phaseFinishedEventId: string | number;
}): Promise<void> {
  // Un resultado escalado todavía no es una decisión documental aceptada. Debe continuar por el
  // circuito existente de handleLinearEscalation sin persistir RELEASE_PLAN ni exigir
  // FEATURE_UPDATE.
  if (params.result.status !== "completed") return;

  const declaration = extractReleasePlanDeclaration(
    { phase: "planning" },
    { outputArtifact: params.result.outputArtifact }
  );
  if (!declaration) return;

  const existing = await getCurrentProjectConfig(params.projectId, "release_plan");
  const existingRamaBase = (existing?.value as { ramaBaseTrabajo?: unknown } | undefined)?.ramaBaseTrabajo;
  const ramaBaseTrabajo = typeof existingRamaBase === "string" ? existingRamaBase : params.fallbackRamaBaseTrabajo;
  if (!ramaBaseTrabajo) {
    throw new Error(
      `Run ${params.runId}: Planning declaró RELEASE_PLAN pero no hay ramaBaseTrabajo disponible (ni en la versión previa ni en el business_case del run raíz).`
    );
  }

  const releasePlan = { ...declaration, ramaBaseTrabajo };
  if (declaration.featureActualId === null) {
    await setProjectConfig({
      projectId: params.projectId,
      configKey: "release_plan",
      value: releasePlan,
      changedInRunId: params.runId,
    });
    return;
  }

  const roadmap = await getCurrentProjectConfig(params.projectId, "release_roadmap");
  const activeRelease = activeReleaseFromRoadmap(roadmap?.value);
  if (!activeRelease) throw new Error(`Run ${params.runId}: Planning completó sin release activo fijado.`);
  const update = parseFeatureUpdatePayload(params.result.outputArtifact);
  if (update.validationPlan.testCommand !== extractTestCommand(params.result.outputArtifact)) {
    throw new Error("FEATURE_UPDATE.validationPlan.testCommand no coincide con COMANDO_TEST.");
  }
  await persistPlanningFeatureSelection({
    projectId: params.projectId,
    runId: params.runId,
    releaseKey: activeRelease.id,
    phaseFinishedEventId: params.phaseFinishedEventId,
    releasePlan,
    featureActualId: declaration.featureActualId,
    update,
  });
}

/**
 * FEATURE-019, sección 6.2/6.2b: al aprobar QA, la Feature ya no termina el run — commitea y
 * pushea siempre su sub-rama (Regla Funcional 8), y según `approval_mode` (Regla 12, default
 * Manual): en Modo Manual escala para aprobación humana del merge (artifact sintético atribuido a
 * `phase: "developer"`, `mergeApproval: true`); en Modo Auto mergea directo a la rama base y crea
 * el run de continuación (`PLANNING_TO_QA`) sin pasar por escalamiento.
 */
async function continueReleaseAfterFeatureApproved(params: {
  projectId: string;
  runId: string;
  worktree: RunWorktree;
  userId: string;
  cliAgentOverride: AgentConfig | null;
  model?: string;
  cleanupStrategy: "shared-worktree" | "standalone-clone";
}): Promise<void> {
  const { projectId, runId, worktree, userId, cliAgentOverride, model, cleanupStrategy } = params;

  // FEATURE-019, hallazgo de cierre: no usamos `projectRepoRoot` (bug preexistente de FEATURE-018
  // — ver `respondService.ts`, ese valor es ambiguo entre las dos cleanupStrategy de FEATURE-017:
  // para runs "standalone-clone" es la URL de git del caso, no una ruta de filesystem). El propio
  // `worktree.worktreePath` de este run SÍ es siempre una ruta local válida de un repo git completo
  // (clon standalone, o worktree linkeado de un repo compartido) — git worktree add/merge
  // funcionan igual desde cualquiera de los dos, sin necesitar el repo "raíz" compartido.
  const repoRoot = worktree.worktreePath;

  const baseCommitSha = await baseCommitShaForRun(runId);
  let feature = await getActiveFeatureForRun(runId);
  if (!feature) throw new Error(`Run ${runId} sin Feature activa.`);
  let documentHash = feature.document_hash;
  let commitSha = feature.final_commit_sha;
  let committed = false;

  if (!documentHash) {
    await assertFeatureDocsUnchanged(worktree, baseCommitSha);
    const materialized = await materializeActiveFeatureDocument({
      runId,
      worktreePath: worktree.worktreePath,
    });
    feature = materialized.feature;
    documentHash = materialized.hash;
  }

  if (!commitSha) {
    const currentHead = await headSha(worktree);
    let reconciled = false;
    try {
      const candidate = await fileAtCommit(worktree, currentHead, feature.final_document_path);
      reconciled = sha256(candidate) === documentHash;
    } catch {
      reconciled = false;
    }
    if (reconciled) {
      commitSha = currentHead;
    } else {
      const materialized = await materializeActiveFeatureDocument({
        runId,
        worktreePath: worktree.worktreePath,
      });
      documentHash = materialized.hash;
      await assertFeatureDocsUnchanged(worktree, baseCommitSha, feature.final_document_path);
      committed = await commitAllChanges(worktree, `feat: implementación lista (run ${runId})`);
      commitSha = await headSha(worktree);
    }
    const committedDocument = await fileAtCommit(worktree, commitSha, feature.final_document_path);
    if (sha256(committedDocument) !== documentHash) {
      throw new Error("El documento commiteado no coincide con el hash materializado.");
    }
    await assertFeatureDocsUnchanged(worktree, baseCommitSha, feature.final_document_path);
    await recordFeatureCommit({ featureId: feature.id, commitSha, documentHash });
    await recordRunEvent(runId, "run_committed", {
      committed,
      reconciled: !committed,
      commitSha,
      featureId: feature.id,
      documentPath: feature.final_document_path,
      documentHash,
    });
  }

  let remoteSha: string | null = null;
  try {
    remoteSha = await remoteBranchSha(worktree);
  } catch {
    remoteSha = null;
  }
  if (remoteSha !== commitSha) {
    await pushRunBranch(worktree);
    remoteSha = await remoteBranchSha(worktree);
  }
  if (remoteSha !== commitSha) {
    throw new Error(`SHA remoto inesperado: esperado ${commitSha}, recibido ${remoteSha}.`);
  }
  if (!feature.pushed_at) {
    await recordFeaturePush({ featureId: feature.id, branch: worktree.branchName, commitSha });
    await recordRunEvent(runId, "run_pushed", {
      branchName: worktree.branchName,
      commitSha,
      remoteSha,
      featureId: feature.id,
    });
  }
  console.log(`[run:start] push real de la sub-rama "${worktree.branchName}" a origin.`);

  const releasePlanConfig = await getCurrentProjectConfig(projectId, "release_plan");
  const releasePlanValue = releasePlanConfig?.value as
    | { ramaBaseTrabajo?: unknown; featureActualId?: unknown }
    | undefined;
  const baseBranch = typeof releasePlanValue?.ramaBaseTrabajo === "string" ? releasePlanValue.ramaBaseTrabajo : undefined;
  if (!baseBranch) {
    throw new Error(`Run ${runId}: no hay release_plan persistido con ramaBaseTrabajo — no se puede continuar el release.`);
  }
  const featureActualId = typeof releasePlanValue?.featureActualId === "string" ? releasePlanValue.featureActualId : null;

  const mode = await getApprovalModeForRun(runId);

  if (mode === "manual") {
    const mergeApprovalPayload: MergeApprovalPayload = {
      mergeApproval: true,
      baseBranch,
      featureBranch: worktree.branchName,
      featureActualId,
    };
    const summary =
      "Feature con tests pasados y readiness de Developer — pendiente de autorización humana para el merge.";
    const escalationReason =
      "Modo Manual: el merge de la sub-rama a la rama base requiere aprobación humana explícita.";
    const artifact = await recordArtifact({
      runId,
      phase: "developer",
      kind: "escalation",
      content: { outputArtifact: mergeApprovalPayload, summary, escalationReason },
    });
    await finalizeRun(runId, {
      status: "escalated",
      outputArtifact: mergeApprovalPayload,
      summary,
      escalationReason,
    });
    await recordRunEvent(runId, "escalation_opened", { agentRole: "developer", artifactId: artifact.id, attempt: 1 });
    console.log(`[run:start] Modo Manual: escalado para aprobación de merge de "${worktree.branchName}" a "${baseBranch}".`);
    return;
  }

  // Modo auto: el run sólo queda completed después del merge y push reales.
  await mergeFeatureBranchIntoBase({ repoRoot, baseBranch, featureBranch: worktree.branchName });
  await recordRunEvent(runId, "feature_merged_to_base", {
    baseBranch,
    featureBranch: worktree.branchName,
    mode: "auto",
  });
  await finalizeRun(runId, {
    status: "completed",
    outputArtifact: null,
    summary: `Feature lista, mergeada a "${baseBranch}" en modo auto.`,
    escalationReason: null,
  });
  console.log(`[run:start] Modo Auto: sub-rama "${worktree.branchName}" mergeada y pusheada a "${baseBranch}".`);

  const { childRunId, childWorktree } = await createPlanningToQaChildRun({
    repoRoot,
    parentRunId: runId,
    projectId,
    baseBranch,
    userId,
    cliAgentOverride,
    model,
  });
  console.log(`[run:start] run de continuación creado: ${childRunId} (Planning).`);
  await executePipelineRun({
    projectRepoRoot: childWorktree.worktreePath,
    runId: childRunId,
    projectId,
    worktree: childWorktree,
    pipelineSpec: PLANNING_TO_QA,
    initialContext: { featureJustCompleted: featureActualId },
    userId,
    cliAgentOverride,
    model,
    cleanupStrategy,
  });
}

/**
 * FEATURE-019: crea el run hijo `PLANNING_TO_QA` que continúa el release tras una Feature
 * aprobada — separado de la ejecución (`executePipelineRun`) para que `respondService.ts` pueda
 * reusarlo en el camino de aprobación de merge en Modo Manual (crea el run y solo ENTONCES ejecuta,
 * dentro de un `execute()` diferido, mismo patrón que ya usa `respondToEscalation`).
 *
 * `repoRoot`: cualquier ruta local válida de un repo git completo que ya tenga `baseBranch`
 * disponible como ref local — el `worktree.worktreePath` de la Feature que se acaba de mergear
 * (clon standalone o worktree linkeado, da igual), nunca `project.repo_path`/`business_case.repositorio`
 * directamente (ver hallazgo de cierre de FEATURE-019 sobre el bug preexistente sobre esto en
 * `respondService.ts`).
 */
export async function createPlanningToQaChildRun(params: {
  repoRoot: string;
  parentRunId: string;
  projectId: string;
  baseBranch: string;
  userId: string;
  cliAgentOverride: AgentConfig | null;
  model?: string;
}): Promise<{ childRunId: string; childWorktree: RunWorktree }> {
  const childRunId = randomUUID();
  const pipelineDefinition = await ensurePipelineDefinition(PLANNING_TO_QA);
  const childWorktree = await createRunWorktree(params.repoRoot, childRunId, params.baseBranch);
  const baseCommitSha = await headSha(childWorktree);
  const firstPhaseSelection: AgentConfig =
    params.cliAgentOverride ?? (await resolveAgentConfig(params.userId, "planning"));

  const client = await pool.connect();
  try {
    await client.query("begin");
    await createRun({
      id: childRunId,
      pipelineDefinitionId: pipelineDefinition.id,
      ownerId: params.userId,
      projectId: params.projectId,
      firstPhase: "planning",
      branchName: childWorktree.branchName,
      worktreePath: childWorktree.worktreePath,
      originatedFromRunId: params.parentRunId,
      client,
    });
    await recordRunConfigVersions(childRunId, client);
    await recordRunEvent(
      childRunId,
      "run_started",
      {
        branchName: childWorktree.branchName,
        worktreePath: childWorktree.worktreePath,
        provider: firstPhaseSelection.executorProvider,
        authMode: firstPhaseSelection.authMode,
        model: params.model ?? null,
        pipeline: `${PLANNING_TO_QA.name}@${PLANNING_TO_QA.version}`,
        projectId: params.projectId,
        repoPath: childWorktree.worktreePath,
        originatedFromRunId: params.parentRunId,
        baseCommitSha,
      },
      client
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  return { childRunId, childWorktree };
}

function outputArtifactOf(artifact: ArtifactRow): unknown {
  if (artifact.content !== null && typeof artifact.content === "object" && "outputArtifact" in artifact.content) {
    return (artifact.content as { outputArtifact: unknown }).outputArtifact;
  }
  return null;
}

export async function runDeveloperQaLoop(params: {
  executor: RunExecutor;
  developerExecutor: RunExecutor;
  readRole: (agentRole: string) => Promise<string>;
  runId: string;
  planningResult: PhaseResult;
  maxAttempts: number;
  featureLifecycle?: boolean;
  /** Compartido con executePipelineRun — ver el comentario en su declaración. */
  phaseTiming: { agentRole: AgentRole | null; startedAt: number | null };
  /** Seam acotado para probar el control del loop sin Postgres ni contenedores reales. */
  services?: {
    haltIfCancelledExternally?: typeof haltIfCancelledExternally;
    updateRunCurrentPhase?: typeof updateRunCurrentPhase;
    recordRunEvent?: (runId: string, eventType: string, payload: unknown) => Promise<string | number | void>;
    persistArtifact?: PersistArtifact;
    buildExecutor?: Pick<BuildExecutor, "runIfNeeded">;
    testExecutor?: Pick<TestExecutor, "run">;
    persistFeatureContribution?: typeof persistActiveFeatureContribution;
    gitReadinessSnapshot?: typeof gitReadinessSnapshot;
  };
}): Promise<PhaseResult> {
  const { executor, developerExecutor, readRole, runId, planningResult, maxAttempts, phaseTiming } = params;
  const services = {
    haltIfCancelledExternally,
    updateRunCurrentPhase,
    recordRunEvent,
    persistArtifact: recordArtifact as PersistArtifact,
    buildExecutor: new BuildExecutor() as Pick<BuildExecutor, "runIfNeeded">,
    testExecutor: new TestExecutor() as Pick<TestExecutor, "run">,
    persistFeatureContribution: persistActiveFeatureContribution,
    gitReadinessSnapshot,
    ...params.services,
  };
  const testCommand = extractTestCommand(planningResult.outputArtifact);
  console.log(`[run:start] COMANDO_TEST declarado por Planning: ${testCommand}`);

  const developerRoleInstructions = await readRole("developer");
  const qaRoleInstructions = await readRole("qa");

  let lastDeveloperResult: PhaseResult | null = null;
  let lastQaResult: PhaseResult | null = null;
  // FEATURE-021: motivo del reintento cuando el build falla entre el turno de Developer y el de
  // QA — mutuamente excluyente con qaRejectionReason (ver developerContext más abajo): si el
  // motivo inmediato del reintento es un build roto, ese es el único motivo que ve Developer, no
  // se le mezcla un qaRejectionReason viejo de un intento anterior donde QA sí llegó a correr.
  let lastBuildFailureSummary: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await services.haltIfCancelledExternally(runId);
    await services.updateRunCurrentPhase(runId, "developer");

    const developerContext =
      attempt === 1
        ? { plan: planningResult.outputArtifact }
        : {
            plan: planningResult.outputArtifact,
            previousAttemptSummary: lastDeveloperResult?.summary,
            ...(lastBuildFailureSummary
              ? { buildFailureReason: lastBuildFailureSummary }
              : lastQaResult
                ? { qaRejectionReason: lastQaResult.summary }
                : {}),
          };

    const developerInvocation: PhaseInvocation = {
      agentRole: "developer",
      roleInstructions: developerRoleInstructions,
      context: developerContext,
      permissions: { filesystem: "workspace-write", writableRoots: [developerExecutor.options.workingDirectory] },
    };

    phaseTiming.agentRole = "developer";
    phaseTiming.startedAt = Date.now();
    await services.recordRunEvent(runId, "phase_started", { agentRole: "developer", attempt });
    const developerResult = await developerExecutor.runPhase(developerInvocation, { timeoutMs: DEVELOPER_TIMEOUT_MS });
    const developerDurationMs = Date.now() - phaseTiming.startedAt;
    const developerPhaseFinishedEventId = await services.recordRunEvent(runId, "phase_finished", {
      agentRole: "developer",
      attempt,
      result: developerResult,
      durationMs: developerDurationMs,
    });
    await services.persistArtifact({
      runId,
      phase: "developer",
      kind: developerResult.status === "escalated" ? "escalation" : "code",
      content: { attempt, ...artifactContentForResult(developerResult) },
    });

    lastDeveloperResult = developerResult;

    if (developerResult.status !== "completed") {
      console.log(`[run:start] Developer (intento ${attempt}) terminó con status "${developerResult.status}" — loop detenido.`);
      return developerResult;
    }

    if (params.featureLifecycle) {
      await services.persistFeatureContribution({
        runId,
        phaseFinishedEventId: String(developerPhaseFinishedEventId),
        role: "developer",
        attempt,
        contribution: {
          purpose: "developer-implementation",
          sectionKey: "developer_implementation",
          operation: "append_entry",
          content: parseDeveloperImplementation(developerResult.outputArtifact),
        },
      });
    }

    await services.haltIfCancelledExternally(runId);

    // FEATURE-021: build determinístico garantizado por el Orquestador, entre el turno de
    // Developer y el de QA — nunca por decisión de ningún agente. QA es intencionalmente
    // read-only (Regla 10, Ownership de Artefactos) y no puede recompilar; este paso corre en un
    // contenedor efímero propio, separado, con permiso de escritura, antes de que TestExecutor
    // monte el worktree en modo :ro para correr el test.
    const buildResult = await services.buildExecutor.runIfNeeded(executor.options.workingDirectory, 120_000);
    if (buildResult.ran) {
      await services.recordRunEvent(runId, "build_executed", { attempt, buildResult });
    }
    if (buildResult.ran && buildResult.exitCode !== 0) {
      lastBuildFailureSummary = buildResult.timedOut
        ? `Build superó el timeout (120000ms) sin terminar.`
        : `Build falló (exitCode ${buildResult.exitCode}): ${buildResult.stderr.slice(0, 2000)}`;
      console.log(`[run:start] Build (intento ${attempt}) falló — Developer recibe el error en el próximo intento.`);

      if (attempt === maxAttempts) {
        const exhausted: PhaseResult = {
          status: "escalated",
          outputArtifact: null,
          summary: `Se agotaron los ${maxAttempts} intentos sin lograr un build exitoso. Último error: ${lastBuildFailureSummary}`,
          escalationReason: `Límite de reintentos (${maxAttempts}) alcanzado — build roto en todos los intentos, QA nunca llegó a validar.`,
        };
        await persistLoopExhaustionArtifact(
          { runId, phase: "developer", attempt, result: exhausted },
          services.persistArtifact
        );
        await services.recordRunEvent(runId, "loop_exhausted", { maxAttempts, reason: "build", lastBuildResult: buildResult });
        console.log(`[run:start] Límite de ${maxAttempts} intentos alcanzado sin build exitoso — run escalado.`);
        return exhausted;
      }

      // No se invoca a QA este intento — continúa al siguiente attempt del mismo for,
      // consumiendo el mismo contador maxAttempts que ya existe (sin inventar uno nuevo).
      continue;
    }
    lastBuildFailureSummary = null; // se limpia apenas un build corre bien (o es no-op) en este intento

    await services.updateRunCurrentPhase(runId, "qa");

    // FEATURE-006 (resuelve H14): el TestExecutor —no el agente QA— corre el comando de test,
    // como executable + args estructurados, dentro de un contenedor sin red. QA nunca recibe Bash.
    const { executable, args: testArgs } = parseTestCommand(testCommand);
    const testResult = await services.testExecutor.run({
      executable,
      args: testArgs,
      workingDirectory: executor.options.workingDirectory,
      timeoutMs: 60_000,
    });
    await services.recordRunEvent(runId, "test_executed", { attempt, testCommand, testResult });

    const qaInvocation: PhaseInvocation = {
      agentRole: "qa",
      roleInstructions: qaRoleInstructions,
      context: { plan: planningResult.outputArtifact, testCommand, testResult, developerSummary: developerResult.summary },
      permissions: { filesystem: "read-only" },
    };

    phaseTiming.agentRole = "qa";
    phaseTiming.startedAt = Date.now();
    await services.recordRunEvent(runId, "phase_started", { agentRole: "qa", attempt });
    const qaResult = await executor.runPhase(qaInvocation, { timeoutMs: QA_TIMEOUT_MS });
    const qaDurationMs = Date.now() - phaseTiming.startedAt;
    const qaPhaseFinishedEventId = await services.recordRunEvent(
      runId,
      "phase_finished",
      { agentRole: "qa", attempt, result: qaResult, durationMs: qaDurationMs }
    );
    await services.persistArtifact({
      runId,
      phase: "qa",
      kind:
        qaResult.status === "completed"
          ? "qa_result_passed"
          : qaResult.status === "rejected"
            ? "qa_result_failed"
            : "escalation",
      content: { attempt, ...artifactContentForResult(qaResult) },
    });

    lastQaResult = qaResult;

    if (params.featureLifecycle && (qaResult.status === "completed" || qaResult.status === "rejected")) {
      const qaPayload = parseQaResult(qaResult.outputArtifact);
      const expectedTestStatus = testResult.exitCode === 0 && !testResult.timedOut ? "passed" : "failed";
      if (qaPayload.testStatus !== expectedTestStatus) {
        throw new Error(
          `QA_RESULT.testStatus=${qaPayload.testStatus} contradice TestExecutor=${expectedTestStatus}.`
        );
      }
        await services.persistFeatureContribution({
        runId,
        phaseFinishedEventId: String(qaPhaseFinishedEventId),
        role: "qa",
        attempt,
        contribution: {
          purpose: "qa-result",
          sectionKey: "qa_result",
          operation: "record_qa_result",
          content: qaPayload,
        },
      });
    }

    if (qaResult.status === "completed") {
      if (!params.featureLifecycle) {
        console.log(`[run:start] QA aprobó en el intento ${attempt}.`);
        return qaResult;
      }

      const readinessWorktree: RunWorktree = {
        branchName: "",
        worktreePath: developerExecutor.options.workingDirectory,
      };
      const snapshotBefore = await services.gitReadinessSnapshot(readinessWorktree);
      await services.updateRunCurrentPhase(runId, "developer");
      const readinessInvocation: PhaseInvocation = {
        agentRole: "developer",
        roleInstructions: developerRoleInstructions,
        context: {
          readinessRequest: true,
          plan: planningResult.outputArtifact,
          qaResult: qaResult.outputArtifact,
          testResult,
          gitSnapshot: snapshotBefore,
        },
        permissions: {
          filesystem: "workspace-write",
          writableRoots: [developerExecutor.options.workingDirectory],
        },
      };
      phaseTiming.agentRole = "developer";
      phaseTiming.startedAt = Date.now();
      await services.recordRunEvent(runId, "phase_started", {
        agentRole: "developer",
        attempt,
        purpose: "readiness",
      });
      const readinessResult = await developerExecutor.runPhase(readinessInvocation, {
        timeoutMs: DEVELOPER_TIMEOUT_MS,
      });
      const readinessDurationMs = Date.now() - phaseTiming.startedAt;
      const readinessEventId = await services.recordRunEvent(runId, "phase_finished", {
        agentRole: "developer",
        attempt,
        purpose: "readiness",
        result: readinessResult,
        durationMs: readinessDurationMs,
      });
      if (readinessResult.status !== "completed") return readinessResult;
      const readiness = parseDeveloperReadiness(readinessResult.outputArtifact);
      const snapshotAfter = await services.gitReadinessSnapshot(readinessWorktree);
      const snapshotChanged =
        snapshotBefore.branch !== snapshotAfter.branch ||
        snapshotBefore.headSha !== snapshotAfter.headSha ||
        snapshotBefore.treeHash !== snapshotAfter.treeHash;
      await services.persistFeatureContribution({
        runId,
        phaseFinishedEventId: String(readinessEventId),
        role: "developer",
        attempt,
        contribution: {
          purpose: "developer-readiness",
          sectionKey: "developer_readiness",
          operation: "record_readiness",
          content: readiness,
        },
      });

      if (!snapshotChanged && readiness.readiness !== "not_ready" && !readiness.requiresCodeChanges) {
        console.log(`[run:start] Developer declaró readiness en el intento ${attempt}.`);
        return readinessResult;
      }
      lastQaResult = {
        status: "rejected",
        outputArtifact: readiness,
        summary: snapshotChanged
          ? "Readiness invalidado: branch, HEAD o tree hash cambiaron durante el turno post-QA."
          : readiness.summary,
        escalationReason: null,
      };
      if (attempt === maxAttempts) {
        return {
          status: "escalated",
          outputArtifact: readiness,
          summary: `Se agotaron ${maxAttempts} intentos sin readiness estable.`,
          escalationReason: `Límite de reintentos (${maxAttempts}) alcanzado durante readiness.`,
        };
      }
      continue;
    }

    if (qaResult.status === "escalated") {
      console.log(`[run:start] QA escaló en el intento ${attempt} (no pudo ejecutar la validación) — loop detenido.`);
      return qaResult;
    }

    // status === "rejected"
    console.log(`[run:start] QA rechazó el intento ${attempt}: ${qaResult.summary}`);

    if (attempt === maxAttempts) {
      const exhausted: PhaseResult = {
        status: "escalated",
        outputArtifact: null,
        summary: `Se agotaron los ${maxAttempts} intentos del loop Developer↔QA sin aprobación. Último rechazo: ${qaResult.summary}`,
        escalationReason: `Límite de reintentos (${maxAttempts}) alcanzado — último rechazo de QA: ${qaResult.summary}`,
      };
      await persistLoopExhaustionArtifact(
        { runId, phase: "qa", attempt, result: exhausted },
        services.persistArtifact
      );
      await services.recordRunEvent(runId, "loop_exhausted", { maxAttempts, lastQaResult: qaResult });
      console.log(`[run:start] Límite de ${maxAttempts} intentos alcanzado — run escalado, sin cuarto intento.`);
      return exhausted;
    }
  }

  // Inalcanzable en la práctica (todo camino retorna dentro del for), pero TypeScript exige un
  // retorno exhaustivo fuera del loop.
  return lastQaResult as PhaseResult;
}

async function finishRun(
  repoRoot: string | undefined,
  runId: string,
  worktree: RunWorktree,
  finalResult: PhaseResult,
  opts: { pushAndClean: boolean; cleanupStrategy: "shared-worktree" | "standalone-clone" }
): Promise<void> {
  await finalizeRun(runId, finalResult);

  if (opts.pushAndClean) {
    const committed = await commitAllChanges(worktree, `feat: implementación aprobada por QA (run ${runId})`);
    await recordRunEvent(runId, "run_committed", { committed });
    console.log(committed ? `[run:start] cambios commiteados en la rama.` : `[run:start] no había cambios sin commitear.`);

    await pushRunBranch(worktree);
    await recordRunEvent(runId, "run_pushed", { branchName: worktree.branchName });
    console.log(`[run:start] push real de la rama "${worktree.branchName}" a origin.`);

    if (opts.cleanupStrategy === "standalone-clone") {
      await removeRunClone(worktree);
    } else {
      if (!repoRoot) {
        throw new Error("finishRun: cleanupStrategy 'shared-worktree' requiere projectRepoRoot.");
      }
      await removeRunWorktree(repoRoot, worktree);
    }
    await recordRunEvent(runId, "worktree_cleaned", { worktreePath: worktree.worktreePath });
    console.log(`[run:start] worktree limpiado tras aprobación.`);
  } else {
    console.log(`[run:start] worktree preservado (política de retención de 21 días): ${worktree.worktreePath}`);
  }

  console.log(`[run:start] status final: ${finalResult.status}`);
  console.log(`[run:start] run ${runId} persistido. Consultar con: npm run cli -- run:status --run ${runId}`);
}

async function baseCommitShaForRun(runId: string): Promise<string> {
  const result = await pool.query<{ payload: unknown }>(
    `select payload from run_events
     where run_id = $1 and event_type = 'run_started'
     order by id asc limit 1`,
    [runId]
  );
  const payload = result.rows[0]?.payload as { baseCommitSha?: unknown } | undefined;
  if (typeof payload?.baseCommitSha !== "string") {
    throw new Error(`Run ${runId} sin baseCommitSha persistido.`);
  }
  return payload.baseCommitSha;
}

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

export function parseExecutorProvider(value: string): ExecutorProvider {
  if (value === "claude" || value === "codex") return value;
  throw new Error(`Executor desconocido: "${value}". Disponibles: claude, codex`);
}

export function parseAuthMode(value: string): AuthMode {
  if (value === "api_key" || value === "cli_session") return value;
  throw new Error(`authMode desconocido: "${value}". Disponibles: api_key, cli_session`);
}

function buildExecutor(
  selection: AgentConfig,
  workingDirectory: string,
  requestingRunId: string,
  model: string | undefined,
  opts: { sandbox?: "host" | "container" } = {}
): RunExecutor {
  if (selection.executorProvider === "codex") {
    return new CodexExecutor({ workingDirectory, requestingRunId, model, authMode: selection.authMode, ...opts });
  }

  return new ClaudeCodeExecutor({ workingDirectory, requestingRunId, model, authMode: selection.authMode, ...opts });
}
