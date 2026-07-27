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
  mergeFeatureBranchIntoBase,
  pushRunBranch,
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
      const executor = buildExecutor(selection, worktree.worktreePath, model);

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
      await recordRunEvent(runId, "phase_finished", { agentRole: invocation.agentRole, result, durationMs });
      // FEATURE-020, Regla 5/10b: Planning nunca pasa (alimenta al loop Developer↔QA, ver 6.4.a) —
      // el marcador solo aplica a Architect/Functional acá.
      const isPass = phase.agentRole !== "planning" && result.status === "completed" && isNotApplicableOutput(result.outputArtifact);
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
      const developerExecutor = buildExecutor(developerSelection, worktree.worktreePath, model, { sandbox: "container" });
      const qaExecutor = buildExecutor(qaSelection, worktree.worktreePath, model);
      const finalResult = await runDeveloperQaLoop({
        executor: qaExecutor,
        developerExecutor,
        readRole,
        runId,
        planningResult: previousResult as PhaseResult,
        maxAttempts: pipelineSpec.definition.loop.maxAttempts,
        phaseTiming,
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
async function persistReleasePlanIfDeclared(params: {
  projectId: string;
  runId: string;
  result: PhaseResult;
  fallbackRamaBaseTrabajo: string | undefined;
}): Promise<void> {
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

  await setProjectConfig({
    projectId: params.projectId,
    configKey: "release_plan",
    value: { ...declaration, ramaBaseTrabajo },
    changedInRunId: params.runId,
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

  const committed = await commitAllChanges(worktree, `feat: implementación aprobada por QA (run ${runId})`);
  await recordRunEvent(runId, "run_committed", { committed });
  await pushRunBranch(worktree);
  await recordRunEvent(runId, "run_pushed", { branchName: worktree.branchName });
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

  const approvalModeConfig = await getCurrentProjectConfig(projectId, "approval_mode");
  const approvalModeValue = approvalModeConfig?.value as { mode?: unknown } | undefined;
  const mode = approvalModeValue?.mode === "auto" ? "auto" : "manual";

  if (mode === "manual") {
    const mergeApprovalPayload: MergeApprovalPayload = {
      mergeApproval: true,
      baseBranch,
      featureBranch: worktree.branchName,
      featureActualId,
    };
    const summary =
      "Feature aprobada por QA — pendiente de aprobación humana para mergear a la rama base del release.";
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

  // Modo Auto (Regla Funcional 10): merge directo, sin escalar.
  await finalizeRun(runId, {
    status: "completed",
    outputArtifact: null,
    summary: `Feature aprobada por QA, mergeada automáticamente a "${baseBranch}" (Modo Auto).`,
    escalationReason: null,
  });
  await mergeFeatureBranchIntoBase({ repoRoot, baseBranch, featureBranch: worktree.branchName });
  await recordRunEvent(runId, "feature_merged_to_base", {
    baseBranch,
    featureBranch: worktree.branchName,
    mode: "auto",
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
  /** Compartido con executePipelineRun — ver el comentario en su declaración. */
  phaseTiming: { agentRole: AgentRole | null; startedAt: number | null };
}): Promise<PhaseResult> {
  const { executor, developerExecutor, readRole, runId, planningResult, maxAttempts, phaseTiming } = params;
  const testExecutor = new TestExecutor();
  const buildExecutor = new BuildExecutor();
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
    await haltIfCancelledExternally(runId);
    await updateRunCurrentPhase(runId, "developer");

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
    await recordRunEvent(runId, "phase_started", { agentRole: "developer", attempt });
    const developerResult = await developerExecutor.runPhase(developerInvocation, { timeoutMs: DEVELOPER_TIMEOUT_MS });
    const developerDurationMs = Date.now() - phaseTiming.startedAt;
    await recordRunEvent(runId, "phase_finished", {
      agentRole: "developer",
      attempt,
      result: developerResult,
      durationMs: developerDurationMs,
    });
    await recordArtifact({
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

    await haltIfCancelledExternally(runId);

    // FEATURE-021: build determinístico garantizado por el Orquestador, entre el turno de
    // Developer y el de QA — nunca por decisión de ningún agente. QA es intencionalmente
    // read-only (Regla 10, Ownership de Artefactos) y no puede recompilar; este paso corre en un
    // contenedor efímero propio, separado, con permiso de escritura, antes de que TestExecutor
    // monte el worktree en modo :ro para correr el test.
    const buildResult = await buildExecutor.runIfNeeded(executor.options.workingDirectory, 120_000);
    if (buildResult.ran) {
      await recordRunEvent(runId, "build_executed", { attempt, buildResult });
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
        await recordRunEvent(runId, "loop_exhausted", { maxAttempts, reason: "build", lastBuildResult: buildResult });
        console.log(`[run:start] Límite de ${maxAttempts} intentos alcanzado sin build exitoso — run escalado.`);
        return exhausted;
      }

      // No se invoca a QA este intento — continúa al siguiente attempt del mismo for,
      // consumiendo el mismo contador maxAttempts que ya existe (sin inventar uno nuevo).
      continue;
    }
    lastBuildFailureSummary = null; // se limpia apenas un build corre bien (o es no-op) en este intento

    await updateRunCurrentPhase(runId, "qa");

    // FEATURE-006 (resuelve H14): el TestExecutor —no el agente QA— corre el comando de test,
    // como executable + args estructurados, dentro de un contenedor sin red. QA nunca recibe Bash.
    const { executable, args: testArgs } = parseTestCommand(testCommand);
    const testResult = await testExecutor.run({
      executable,
      args: testArgs,
      workingDirectory: executor.options.workingDirectory,
      timeoutMs: 60_000,
    });
    await recordRunEvent(runId, "test_executed", { attempt, testCommand, testResult });

    const qaInvocation: PhaseInvocation = {
      agentRole: "qa",
      roleInstructions: qaRoleInstructions,
      context: { plan: planningResult.outputArtifact, testCommand, testResult, developerSummary: developerResult.summary },
      permissions: { filesystem: "read-only" },
    };

    phaseTiming.agentRole = "qa";
    phaseTiming.startedAt = Date.now();
    await recordRunEvent(runId, "phase_started", { agentRole: "qa", attempt });
    const qaResult = await executor.runPhase(qaInvocation, { timeoutMs: QA_TIMEOUT_MS });
    const qaDurationMs = Date.now() - phaseTiming.startedAt;
    await recordRunEvent(runId, "phase_finished", { agentRole: "qa", attempt, result: qaResult, durationMs: qaDurationMs });
    await recordArtifact({
      runId,
      phase: "qa",
      kind:
        qaResult.status === "completed"
          ? "verdict_approved"
          : qaResult.status === "rejected"
            ? "verdict_rejected"
            : "escalation",
      content: { attempt, ...artifactContentForResult(qaResult) },
    });

    lastQaResult = qaResult;

    if (qaResult.status === "completed") {
      console.log(`[run:start] QA aprobó en el intento ${attempt}.`);
      return qaResult;
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
      await recordRunEvent(runId, "loop_exhausted", { maxAttempts, lastQaResult: qaResult });
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
  model: string | undefined,
  opts: { sandbox?: "host" | "container" } = {}
): RunExecutor {
  if (selection.executorProvider === "codex") {
    return new CodexExecutor({ workingDirectory, model, authMode: selection.authMode, ...opts });
  }

  return new ClaudeCodeExecutor({ workingDirectory, model, authMode: selection.authMode, ...opts });
}
