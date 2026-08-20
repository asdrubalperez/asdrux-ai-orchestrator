import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readValidSession } from "../../auth/session.js";
import { createGitProcessAuth } from "../../auth/gitConnectionService.js";
import { finalizeExecutorAuthentication, resolveExecutorAuthentication } from "../../auth/aiCredentialService.js";
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
  getReleasePlanAssociationCandidate,
  getRootRunExecutionContext,
  getRunRootRunId,
  getRunStatus,
  recordArtifact,
  recordRunConfigVersions,
  recordRunEvent,
  getProjectAgentConfigProfileId,
  resolveAgentConfig,
  setProjectConfig,
  updateRunCurrentPhase,
  updateRunStatus,
  type AgentConfig,
  type ArtifactRow,
  type AuthMode,
  type EffectiveAgentConfig,
  type ReleasePlanAssociationCandidate,
  type RunRow,
} from "../../db/repository.js";
import { pool } from "../../db/pool.js";
import type { AgentRole, PhaseInvocation, PhaseResult } from "../../contracts/executor.js";
import { FULL_PIPELINE, PIPELINES, PLANNING_TO_QA, SINGLE_PHASE_ARCHITECT } from "../../pipelines/definitions.js";
import type { PipelineSpec } from "../../pipelines/definitions.js";
import { extractTestCommand } from "../../pipelines/extractTestCommand.js";
import { TestExecutor, parseTestCommand } from "../../testing/testExecutor.js";
import { BuildExecutor } from "../../testing/buildExecutor.js";
import { validateTestCommandContract } from "../../testing/testCommandContract.js";
import { DependencyInstaller } from "../../testing/dependencyInstaller.js";
import {
  activeReleaseFromRoadmap,
  artifactsAreEquivalent,
  buildEscalationContext,
  buildReentryContext,
  classifyGateEscalation,
  extractReleasePlanDeclaration,
  isFeatureContinuationContext,
  isNotApplicableOutput,
  isReentryContext,
  isReleaseCompletionEscalation,
  isReleasePlanDeclaration,
  isTaggedFieldNull,
  type MergeApprovalPayload,
  type ReentryContext,
  type ReleasePlanDeclaration,
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
  getActivatedFeatureIdentities,
  FeatureLifecycleEscalationError,
  persistActiveFeatureContribution,
  persistFunctionalFeatureBatch,
  persistPlanningFeatureSelection,
  recordFeatureCommit,
  recordFeaturePush,
} from "../../features/lifecycle.js";
import { sha256 } from "../../features/document.js";
import { parseProjectBriefPayload } from "../../features/projectBriefContracts.js";
import { materializeProjectBriefDocument, persistProjectBrief } from "../../features/projectBriefLifecycle.js";
import { parseArchitecturePayload } from "../../features/architectureContracts.js";
import { materializeArchitectureDocument, persistArchitecture } from "../../features/architectureLifecycle.js";
import { parseReleasePlanDocumentPayload } from "../../features/releasePlanContracts.js";
import { materializeReleasePlanDocument, persistReleasePlanDocument } from "../../features/releasePlanLifecycle.js";
import {
  ARCHITECTURE_TEMPLATE_ASSET,
  CODING_STANDARDS_ASSET,
  defaultRunbookProvider,
  FEATURE_TEMPLATE_ASSET,
  PROJECT_BRIEF_TEMPLATE_ASSET,
  RELEASE_PLAN_TEMPLATE_ASSET,
  TESTING_POLICY_ASSET,
  type RunbookProvider,
  type RunbookTextAsset,
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

// FEATURE-032: BUILD_TIMEOUT_MS y TEST_TIMEOUT_MS existían hardcodeados (120_000/60_000) desde
// FEATURE-021/FEATURE-006 — se hacen configurables acá, mismo patrón que los timeouts de fase de
// arriba, sin cambiar el valor por defecto (regresión cero para quien no configure la variable).
// DEPENDENCY_INSTALL_TIMEOUT_MS es nuevo: npm ci/install depende de red real (registry), por eso
// un default más alto que build/test.
const BUILD_TIMEOUT_MS = parsePositiveIntEnv("BUILD_TIMEOUT_MS", 120_000);
const TEST_TIMEOUT_MS = parsePositiveIntEnv("TEST_TIMEOUT_MS", 60_000);
const DEPENDENCY_INSTALL_TIMEOUT_MS = parsePositiveIntEnv("DEPENDENCY_INSTALL_TIMEOUT_MS", 180_000);

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

  // FEATURE-042: repo_path pasó a ser nullable (proyectos del flujo web no la usan). Este comando
  // CLI (cleanupStrategy "shared-worktree") sigue dependiendo de una ruta real de filesystem.
  if (!project.repo_path) {
    throw new Error(
      `El proyecto "${project.name}" no tiene repo_path configurada -- requerida para run:start --case.`
    );
  }
  const projectRepoRoot = path.resolve(project.repo_path);
  const worktree = await createRunWorktree(projectRepoRoot, runId);
  console.log(`[run:start] worktree creado: ${worktree.worktreePath} (rama ${worktree.branchName})`);

  // Solo para el evento de auditoría run_started: refleja la selección de la primera fase. Cada
  // fase resuelve la suya propia dentro de executePipelineRun — puede diferir por rol si hay
  // overrides en user_agent_config (FEATURE-016).
  const firstPhaseSelection: AgentConfig =
    cliAgentOverride ??
    (await resolveAgentConfig(
      user.id,
      pipelineSpec.definition.phases[0].agentRole,
      await getProjectAgentConfigProfileId(project.id)
    ));
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
        // FEATURE-025-Parte-1/2: distingue "esta corrida entera está fijada por flags de CLI, nunca
        // consulta la DB" (Regla 2 de FEATURE-016) de "esto es solo un snapshot de auditoría de la
        // primera fase". respondService.ts lo usa para decidir si un reingreso humano debe reusar un
        // único proveedor/modelo para todas las fases, o resolver cada una por su propio rol.
        cliOverrideForced: cliAgentOverride !== null,
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
  // FEATURE-046: epoch (Caso de negocio) de este run -- toda lectura/escritura de config vigente
  // del proyecto dentro de este pipeline se acota a este Caso, nunca a "lo último vigente en el
  // proyecto" (que podría pertenecer a un Caso concurrente ajeno).
  const rootRunId = await getRunRootRunId(pool, runId);
  // FEATURE-025-Parte-1, sección 5.8: se resuelve por invocación, nunca una sola vez para todo el
  // run. Bajo cliAgentOverride (flags de CLI, Regla 2 de FEATURE-016: nunca consulta la DB), el
  // modelo sigue siendo el `--model` de CLI aplicado a todas las fases -- mismo comportamiento que
  // antes de esta Feature, sin tocarlo (sección 7.12 del diseño).
  const resolveSelection = async (role: AgentRole): Promise<EffectiveAgentConfig> =>
    cliAgentOverride
      ? { ...cliAgentOverride, model: model ?? null }
      : resolveAgentConfig(userId, role, await getProjectAgentConfigProfileId(projectId));
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
        phase.agentRole === "planning"
          ? await withRoleContext(projectId, rootRunId, runId, baseContext)
          : phase.agentRole === "architect"
            ? await withArchitectRoleContext(projectId, rootRunId, baseContext)
            : phase.agentRole === "functional"
              ? await withFunctionalRoleContext(projectId, rootRunId, baseContext)
              : baseContext;
      const roleInstructions = await readRole(phase.agentRole);
      const selection = await resolveSelection(phase.agentRole);
      const { executor, finalizeAuth } = await buildExecutor(selection, worktree.worktreePath, runId, userId);

      const invocation: PhaseInvocation = {
        agentRole: phase.agentRole,
        roleInstructions,
        context,
        permissions: phase.permissions,
      };

      phaseTiming.agentRole = invocation.agentRole;
      phaseTiming.startedAt = Date.now();
      await recordRunEvent(runId, "phase_started", { agentRole: invocation.agentRole });
      // FEATURE-025-Parte-2, Regla 5.9.11/12: recoge un posible refresh OAuth y limpia el temporal
      // materializado, sin importar si la fase terminó bien o mal -- no-op para api_key.
      let result: PhaseResult;
      try {
        result = await executor.runPhase(invocation, { timeoutMs: timeoutForLinearPhase(phase.agentRole) });
      } finally {
        await finalizeAuth();
      }
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
      // FEATURE-033: Project Brief se persiste recién cuando Architect declara ESTADO: completed
      // (Roadmap ya aprobado, Regla 5 de architect.txt) — no en la propuesta inicial escalada
      // (Regla 4), que sólo pide aprobación humana del roadmap todavía.
      const architectProjectBrief =
        invocation.agentRole === "architect" && result.status === "completed" && !isPass
          ? {
              payload: parseProjectBriefPayload(result.outputArtifact),
              templateAsset: await runbookProvider.readText(PROJECT_BRIEF_TEMPLATE_ASSET),
            }
          : null;
      // FEATURE-034: mismo criterio que Project Brief -- se persiste recién cuando Architect
      // declara ESTADO: completed (Roadmap ya aprobado). ARCHITECTURE no trae el Roadmap (Rule 3
      // del diseño), así que el gate de aprobación (ROADMAP:, extractRoadmapApproval) queda
      // exactamente igual que antes de esta Feature.
      const architectArchitecture =
        invocation.agentRole === "architect" && result.status === "completed" && !isPass
          ? {
              payload: parseArchitecturePayload(result.outputArtifact),
              templateAsset: await runbookProvider.readText(ARCHITECTURE_TEMPLATE_ASSET),
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
        const { featureJustCompleted, inputReleasePlan } = planningInputFieldsFromContext(context);
        // FEATURE-043, sección 5.7/7.7: precedencia de resolución de la rama base del run raíz:
        // 1) ubicación persistente nueva (`runs.base_branch_name`, casos nuevos del flujo web);
        // 2) `business_case` del run raíz ya persistido en DB (runs legacy del flujo web, creados
        //    antes de esta Feature, cuando `rama_base_trabajo` todavía viajaba dentro del JSON);
        // 3) `initialContext` en memoria (camino `run:start --case` del CLI: ese comando nunca
        //    persiste `business_case` en la DB -- `createRun`, a diferencia de
        //    `createRunPendingStart`, no tiene esa columna entre sus parámetros -- así que para
        //    ese camino la única fuente posible sigue siendo el contexto en memoria, igual que
        //    antes de esta Feature).
        const rootExecution = await getRootRunExecutionContext(runId);
        await persistReleasePlanIfDeclared({
          projectId,
          runId,
          result,
          fallbackRamaBaseTrabajo:
            rootExecution.baseBranchName ??
            ramaBaseTrabajoFromBusinessCase(rootExecution.businessCase) ??
            ramaBaseTrabajoFromBusinessCase(initialContext),
          phaseFinishedEventId,
          featureJustCompleted,
          inputReleasePlan,
        });

        // FEATURE-035: mismo criterio de "declaración conjunta" que F034 -- se persiste el
        // documento rico cada vez que RELEASE_PLAN trae contenido operacional real, incluida la
        // excepción ya existente del cierre de release (RELEASE_COMPLETO viaja con status
        // "escalated", mismo patrón que ya usa persistReleasePlanIfDeclared arriba).
        const releaseDeclarationForDocument = extractReleasePlanDeclaration(
          { phase: "planning" },
          { outputArtifact: result.outputArtifact }
        );
        const isReleaseCompletionForDocument =
          result.status === "escalated" &&
          isReleaseCompletionEscalation({ phase: "planning" }, { outputArtifact: result.outputArtifact });
        if ((result.status === "completed" || isReleaseCompletionForDocument) && releaseDeclarationForDocument) {
          const roadmapForReleasePlan = await getCurrentProjectConfig(projectId, "release_roadmap", rootRunId);
          const activeReleaseForPlanning = activeReleaseFromRoadmap(roadmapForReleasePlan?.value);
          if (!activeReleaseForPlanning) {
            throw new Error(`Run ${runId}: Planning declaró RELEASE_PLAN sin release activo fijado.`);
          }
          // Fix (2026-08-17), hallazgo en vivo: `RELEASE_PLAN` (arriba, control del pipeline) ya
          // quedó persistido con éxito en este punto -- `RELEASE_PLAN_DOCUMENT` es contenido
          // enriquecido de solo lectura (el documento Markdown), y un JSON malformado del modelo acá
          // (riesgo inherente de generación de LLM, mismo tipo de riesgo H12 ya aceptado en otros
          // campos etiquetados del sistema) no debería tirar abajo un turno de Planning que por lo
          // demás fue exitoso -- antes de este fix, un JSON inválido en este campo dejaba el run
          // entero en `failed` pese a que la Feature ya había sido asignada correctamente,
          // desincronizando el estado real del pipeline del estado del run. Se degrada a un evento
          // diagnóstico: el documento simplemente no se actualiza en este turno (se regenera solito
          // en el próximo turno exitoso de Planning para este release, mismo patrón de acumulación
          // que ya usa `RELEASE_PLAN_DOCUMENT`), pero el pipeline continúa.
          try {
            await persistReleasePlanDocument({
              projectId,
              runId,
              releaseKey: activeReleaseForPlanning.id,
              phaseFinishedEventId,
              payload: parseReleasePlanDocumentPayload(result.outputArtifact),
              operationalFeatures: releaseDeclarationForDocument.features,
              templateAsset: await runbookProvider.readText(RELEASE_PLAN_TEMPLATE_ASSET),
            });
            await materializeReleasePlanDocument({
              projectId,
              rootRunId,
              releaseKey: activeReleaseForPlanning.id,
              worktreePath: worktree.worktreePath,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await recordRunEvent(runId, "release_plan_document_persist_failed", { error: message });
            console.error(`[run:start] no se pudo persistir RELEASE_PLAN_DOCUMENT en el run ${runId}:`, message);
          }
        }
      }

      if (functionalBatch) {
        const roadmap = await getCurrentProjectConfig(projectId, "release_roadmap", rootRunId);
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

      if (architectProjectBrief) {
        await persistProjectBrief({
          projectId,
          runId,
          phaseFinishedEventId,
          payload: architectProjectBrief.payload,
          templateAsset: architectProjectBrief.templateAsset,
        });
        // Se materializa ya en esta fase (aunque Architect en sí mismo sea read-only) para que
        // docs/project/PROJECT-BRIEF.md quede en el worktree antes de Functional/Developer, y viaje
        // naturalmente en el primer commit real del run — mismo criterio que Feature, sin requerir
        // un paso de commit/push dedicado para este documento (fuera de alcance de F033).
        await materializeProjectBriefDocument({ projectId, worktreePath: worktree.worktreePath });
      }

      if (architectArchitecture) {
        await persistArchitecture({
          projectId,
          runId,
          phaseFinishedEventId,
          payload: architectArchitecture.payload,
          templateAsset: architectArchitecture.templateAsset,
        });
        // Mismo criterio que Project Brief: se materializa ya en esta fase para que
        // docs/architecture/ARCHITECTURE.md viaje en el primer commit real del run.
        await materializeArchitectureDocument({ projectId, worktreePath: worktree.worktreePath });
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
        // Corrección del runtime de circuitos: roadmap_approval (Architect) y release_completion
        // (Planning declarando RELEASE_COMPLETO) son decisiones de gobernanza esperadas — Approval
        // Gates, no errores reintentables. Antes de esta clasificación, ambas entraban primero a
        // handleLinearEscalation y podían reintentarse automáticamente (hasta 3 veces) antes de
        // mostrarse al humano.
        const gateKind = classifyGateEscalation(invocation.agentRole, result.outputArtifact);
        if (gateKind) {
          await recordRunEvent(runId, "escalation_gate_recognized", {
            agentRole: invocation.agentRole,
            artifactId: artifact.id,
            gate: gateKind,
          });
          console.log(
            `[run:start] fase "${phase.agentRole}" abrió un Approval Gate (${gateKind}) — pipeline detenido para aprobación humana.`
          );
          await finishRun(projectRepoRoot, runId, worktree, result, { pushAndClean: false, cleanupStrategy }, userId);
          return;
        }

        const pipelineHasArchitect = pipelineSpec.definition.phases.some((p) => p.agentRole === "architect");
        const decision = await handleLinearEscalation({
          runId,
          worktree,
          agentRole: invocation.agentRole,
          result,
          artifact,
          escalationAttemptsByRole,
          previousEscalationArtifactByRole,
          pipelineHasArchitect,
        });

        if (decision.kind === "retry-in-place") {
          retrying = true;
          contextForNextPhase = decision.context;
          previousResult = null;
          phaseIndex = 0;
          continue;
        }

        if (decision.kind === "retry-cross-pipeline") {
          // Corrección del runtime de circuitos: el pipeline en curso (ej. PLANNING_TO_QA,
          // Circuito 2/3) no incluye a Architect — reiniciar phaseIndex=0 acá reintentaría el
          // propio rol que escaló, nunca llegaría a Architect. En vez de eso, este run se resuelve
          // y se crea/ejecuta automáticamente (sin esperar humano) un run FULL_PIPELINE que
          // arranca en Architect con el mismo ReentryContext que usa el reingreso humano.
          //
          // Fix (2026-08-17), hallazgo en vivo: `updateRunStatus(runId, "resolved")` corría ACÁ,
          // antes de crear el run hijo -- eso dispara de inmediato el trigger de notify sobre ESTE
          // run (`runs_notify_observer`, `after update of status`), y el cliente SSE que lo estaba
          // mirando reconsulta `getChildRunId(runId)` en ese mismo instante. Pero `createRunWorktree`
          // (adentro de `createArchitectReentryChildRun`, más abajo) hace trabajo real de git que
          // toma tiempo real -- el run hijo todavía no existía en la DB en el momento de esa
          // reconsulta, así que el snapshot que recibía el frontend traía `childRunId: null`. Como
          // nada vuelve a tocar la fila de ESTE run después (toda la actividad siguiente es del run
          // hijo), no había ninguna notificación posterior que disparara un reintento -- el usuario
          // quedaba viendo el run viejo "resolved" para siempre, sin ninguna señal de a dónde seguir.
          // Ahora el estado del padre se marca DESPUÉS de que el run hijo ya está commiteado en la
          // DB, para que la única notificación sobre este run sea también la única consulta
          // necesaria -- ya encuentra el `childRunId` bien.
          const releasePlanConfig = await getCurrentProjectConfig(projectId, "release_plan", rootRunId);
          const ramaBaseTrabajo = (releasePlanConfig?.value as { ramaBaseTrabajo?: unknown } | undefined)
            ?.ramaBaseTrabajo;
          if (typeof ramaBaseTrabajo !== "string") {
            throw new Error(
              `Run ${runId}: no se puede cruzar a Architect sin ramaBaseTrabajo persistida en release_plan.`
            );
          }
          console.log(
            `[run:start] fase "${phase.agentRole}" no puede volver a Architect dentro de este pipeline — creando run de reingreso automático.`
          );
          const { childRunId, childWorktree } = await createArchitectReentryChildRun({
            repoRoot: worktree.worktreePath,
            parentRunId: runId,
            projectId,
            baseBranch: ramaBaseTrabajo,
            userId,
            cliAgentOverride,
            model,
          });
          await updateRunStatus(runId, "resolved");
          console.log(`[run:start] run de reingreso a Architect creado: ${childRunId}.`);
          await executePipelineRun({
            projectRepoRoot: childWorktree.worktreePath,
            runId: childRunId,
            projectId,
            worktree: childWorktree,
            pipelineSpec: FULL_PIPELINE,
            initialContext: decision.reentryContext,
            userId,
            cliAgentOverride,
            model,
            cleanupStrategy,
          });
          return;
        }

        console.log(`[run:start] fase "${phase.agentRole}" terminó con status "${result.status}" — pipeline detenido.`);
        await finishRun(projectRepoRoot, runId, worktree, result, { pushAndClean: false, cleanupStrategy }, userId);
        return;
      }

      console.log(`[run:start] fase "${phase.agentRole}" terminó con status "${result.status}" — pipeline detenido.`);
      await finishRun(projectRepoRoot, runId, worktree, result, { pushAndClean: false, cleanupStrategy }, userId);
      return;
    }

    if (pipelineSpec.definition.loop) {
      const developerSelection = await resolveSelection("developer");
      const qaSelection = await resolveSelection("qa");
      const { executor: developerExecutor, finalizeAuth: finalizeDeveloperAuth } = await buildExecutor(
        developerSelection,
        worktree.worktreePath,
        runId,
        userId,
        { sandbox: "container" }
      );
      const { executor: qaExecutor, finalizeAuth: finalizeQaAuth } = await buildExecutor(
        qaSelection,
        worktree.worktreePath,
        runId,
        userId
      );
      // FEATURE-025-Parte-2, Regla 5.9.11/12: ambos executors viven durante todo el loop
      // Developer↔QA (incluido el chequeo de readiness interno) -- se recoge/limpia recién cuando
      // termina, no-op para api_key.
      let finalResult: PhaseResult;
      try {
        finalResult = await runDeveloperQaLoop({
          executor: qaExecutor,
          developerExecutor,
          readRole,
          runId,
          planningResult: previousResult as PhaseResult,
          maxAttempts: pipelineSpec.definition.loop.maxAttempts,
          phaseTiming,
          featureLifecycle: true,
        });
      } finally {
        await finalizeDeveloperAuth();
        await finalizeQaAuth();
      }

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

      await finishRun(projectRepoRoot, runId, worktree, finalResult, { pushAndClean: false, cleanupStrategy }, userId);
      return;
    }

    await finishRun(
      projectRepoRoot,
      runId,
      worktree,
      previousResult as PhaseResult,
      { pushAndClean: false, cleanupStrategy },
      userId
    );
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
      await finishRun(
        projectRepoRoot,
        runId,
        worktree,
        escalation,
        { pushAndClean: false, cleanupStrategy },
        userId
      );
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
    await finishRun(projectRepoRoot, runId, worktree, failure, { pushAndClean: false, cleanupStrategy }, userId);
    throw err;
  }
}

export type LinearEscalationDecisionKind = "retry-in-place" | "retry-cross-pipeline" | "stop";

/**
 * Corrección del runtime de circuitos: núcleo de decisión sin efectos (sin DB/git), separado para
 * poder testearlo directamente. `pipelineHasArchitect` es falso para pipelines de Circuito 2/3
 * (ej. PLANNING_TO_QA) — ahí reiniciar `phaseIndex=0` del pipeline en curso reintentaría el mismo
 * rol que escaló, nunca llegaría a Architect (Architect no es una fase de ese pipeline). En ese
 * caso, mientras no se repita el contenido ni se agoten los intentos, la decisión es cruzar de
 * pipeline en vez de reintentar en el lugar.
 */
export function decideLinearEscalationKind(params: {
  isRepeated: boolean;
  attempt: number;
  maxAttempts: number;
  pipelineHasArchitect: boolean;
}): LinearEscalationDecisionKind {
  if (params.isRepeated) return "stop";
  if (params.attempt >= params.maxAttempts) return "stop";
  return params.pipelineHasArchitect ? "retry-in-place" : "retry-cross-pipeline";
}

async function handleLinearEscalation(params: {
  runId: string;
  worktree: RunWorktree;
  agentRole: AgentRole;
  result: PhaseResult;
  artifact: ArtifactRow;
  escalationAttemptsByRole: Map<AgentRole, number>;
  previousEscalationArtifactByRole: Map<AgentRole, ArtifactRow>;
  pipelineHasArchitect: boolean;
}): Promise<
  | { kind: "retry-in-place"; context: unknown }
  | { kind: "retry-cross-pipeline"; reentryContext: ReentryContext }
  | { kind: "stop" }
> {
  const attempt = (params.escalationAttemptsByRole.get(params.agentRole) ?? 0) + 1;
  params.escalationAttemptsByRole.set(params.agentRole, attempt);

  await recordRunEvent(params.runId, "escalation_opened", {
    agentRole: params.agentRole,
    artifactId: params.artifact.id,
    attempt,
  });

  const previousArtifact = params.previousEscalationArtifactByRole.get(params.agentRole);
  params.previousEscalationArtifactByRole.set(params.agentRole, params.artifact);
  const isRepeated = Boolean(
    previousArtifact && artifactsAreEquivalent(outputArtifactOf(previousArtifact), params.result.outputArtifact)
  );

  const kind = decideLinearEscalationKind({
    isRepeated,
    attempt,
    maxAttempts: MAX_ESCALATION_ATTEMPTS,
    pipelineHasArchitect: params.pipelineHasArchitect,
  });

  if (kind === "stop") {
    await recordRunEvent(
      params.runId,
      isRepeated ? "escalation_repeated_detected" : "escalation_exhausted",
      isRepeated
        ? { agentRole: params.agentRole, artifactId: params.artifact.id, previousArtifactId: previousArtifact!.id }
        : { agentRole: params.agentRole, attempts: attempt }
    );
    await commitAllChanges(params.worktree, `chore: preserve escalated work (run ${params.runId})`);
    return { kind: "stop" };
  }

  const businessCase = await getBusinessCaseForRun(params.runId);

  if (kind === "retry-cross-pipeline") {
    const reentryContext = buildReentryContext({
      businessCase,
      escalationReason: params.result.escalationReason,
      rejectedArtifact: params.result.outputArtifact,
      originAgentRole: params.agentRole,
      humanSolution: null,
      attempt,
      originalVersionRef: params.artifact.id,
    });
    await recordRunEvent(params.runId, "escalation_cross_pipeline_reentry_prepared", {
      agentRole: params.agentRole,
      attempt,
      context: reentryContext,
    });
    return { kind: "retry-cross-pipeline", reentryContext };
  }

  // FEATURE-020, Regla 2/9: se corrige acá el bug original de FEATURE-019 — el contexto de
  // reintento ahora incluye el `business_case` real (vía `root_run_id`), sin cambiar el resto del
  // mecanismo (sigue siendo un reinicio en el mismo run, gratis, sin worktree/rama nueva).
  const context = buildEscalationContext({
    businessCase,
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
  return { kind: "retry-in-place", context };
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
 * pasaron, o Planning es el `targetAgentRole`) o una continuación natural de Feature
 * (`{ featureJustCompleted }`, FEATURE-019), no se envuelve dentro de `functionalArtifact`: se le
 * agrega `activeRelease`/`releasePlan` al lado, preservando su forma raíz intacta. Solo un
 * artifact real de Functional se envuelve en `functionalArtifact`.
 *
 * Corrección del runtime de circuitos (triangulación 2026-07-29): antes de este fix,
 * `{ featureJustCompleted }` no era reconocido acá (no es un `ReentryContext` — no tiene
 * `escalationReason`/`targetAgentRole`) y terminaba envuelto como
 * `{ functionalArtifact: { featureJustCompleted } } }`, violando la Regla 5 de `planning.txt`, que
 * exige `featureJustCompleted` a nivel raíz para reconocer una invocación de continuación. Ver
 * `isFeatureContinuationContext` en `escalation.ts`.
 */
export function shapeRoleContext(
  incomingContext: unknown,
  shared: { activeRelease: unknown; releasePlan: unknown; governance?: unknown }
): unknown {
  // FEATURE-037, Regla 13/7.6: `shared` se aplica siempre en último lugar del spread — ningún
  // campo `governance` que pudiera venir en `incomingContext` (nunca debería, pero un artifact de
  // rol o el business_case no son datos confiables) puede sobrescribir la gobernanza inyectada acá.
  return isReentryContext(incomingContext) || isFeatureContinuationContext(incomingContext)
    ? { ...incomingContext, ...shared }
    : { functionalArtifact: incomingContext, ...shared };
}

/**
 * FEATURE-028: decide si el `release_plan` vigente corresponde al release actualmente activo.
 * Función pura — no hace I/O — para poder testearla sin base de datos, mismo criterio que
 * `validateFinalReleasePlanTransition` (FEATURE-038). Ambas condiciones deben cumplirse: el
 * `activeReleaseId` que tenía pinneado el roadmap del run que escribió el plan debe coincidir con
 * el release activo actual, Y el plan debe pertenecer al mismo ciclo de negocio (`root_run_id`) que
 * el roadmap vigente — un `activeReleaseId` idéntico por sí solo no alcanza, porque el mismo
 * proyecto se reutiliza entre casos de negocio no relacionados que nombran los releases con los
 * mismos IDs genéricos (ver FEATURE-036/`getReleasePlansByRelease`).
 */
export function resolveReleasePlanForActiveRelease(params: {
  activeReleaseId: string | null;
  candidate: ReleasePlanAssociationCandidate | null;
}): unknown {
  const { activeReleaseId, candidate } = params;
  if (activeReleaseId === null) return null;
  if (candidate === null) return null;
  if (candidate.pinnedActiveReleaseId === null) return null;
  if (candidate.pinnedActiveReleaseId !== activeReleaseId) return null;
  if (candidate.writerRootRunId !== candidate.currentEpochRootRunId) return null;
  return candidate.value;
}

/**
 * FEATURE-037: Testing Policy es gobernanza de Planning (dueño/consultor directo — ver
 * `docs/runbook/04-TESTING-POLICY.md:6`), entregada fresca en cada invocación (Regla 8/7.14, nunca
 * cacheada entre llamadas) para que Planning la traduzca al Test Plan de la Feature. Developer/QA
 * no la reciben directamente (Regla 5/6 del diseño) — reciben el Test Plan que Planning produce.
 */
async function withRoleContext(
  projectId: string,
  rootRunId: string,
  runId: string,
  incomingContext: unknown
): Promise<unknown> {
  const roadmap = await getCurrentProjectConfig(projectId, "release_roadmap", rootRunId);
  const activeRelease = activeReleaseFromRoadmap(roadmap?.value ?? null);
  const candidate = await getReleasePlanAssociationCandidate(projectId, rootRunId);
  const testingPolicy = await defaultRunbookProvider.readText(TESTING_POLICY_ASSET);
  await recordRunEvent(runId, "runbook_governance_delivered", {
    role: "planning",
    assetRelativePath: testingPolicy.assetRelativePath,
    runbookVersion: testingPolicy.runbookVersion,
    assetHash: testingPolicy.assetHash,
  });
  // Fix (2026-08-17): `testingPolicy` de arriba es siempre el texto estático del template, con los
  // placeholders "[Editable por producto]" sin completar -- la Configuración Editable por Producto
  // real (si Architect ya la configuró, ver architect.txt Regla 9) vive aparte, en
  // `project_config_versions` (`testing_policy_config`), y se entrega como campo estructurado
  // separado para que Planning use los valores ya resueltos en vez de escalar pidiéndolos.
  const testingPolicyConfig = await getCurrentProjectConfig(projectId, "testing_policy_config", rootRunId);
  const shared = {
    activeRelease,
    releasePlan: resolveReleasePlanForActiveRelease({ activeReleaseId: activeRelease?.id ?? null, candidate }),
    governance: { testingPolicy, testingPolicyConfig: testingPolicyConfig?.value ?? null },
  };
  return shapeRoleContext(incomingContext, shared);
}

/**
 * Fix (2026-08-17): mismo criterio que `withRoleContext` (Planning), pero para Architect --
 * `existingTestingPolicyConfig` le permite distinguir (architect.txt, Regla 9) si el producto ya
 * tiene una Testing Policy configurada (debe conservarla, declarando `TESTING_POLICY_CONFIG: null`)
 * o si todavía no existe ninguna (debe completarla junto con `ROADMAP`).
 *
 * `existingRoadmapApproval` (fix del mismo día, hallazgo en vivo): la Regla 5 original ("si tu
 * contexto indica explícitamente que el roadmap ya fue aprobado") sólo daba esa señal cuando
 * Architect respondía DIRECTAMENTE a la aprobación de su propio roadmap (`respondService.ts`,
 * `buildRoadmapApprovalHumanSolution`) -- en cualquier otro camino de reingreso (por ejemplo,
 * corrigiendo su propia propuesta tras resolver una ambigüedad de Regla 2 que Functional había
 * escalado) Architect no tenía forma de saber que este proyecto ya tenía un Roadmap aprobado, y
 * volvía a escalar pidiendo su re-aprobación aunque la estructura de releases fuera la misma --
 * mismo síntoma que el bug que motivó `existingTestingPolicyConfig`, con una causa distinta y más
 * amplia. Se entrega siempre que exista, sin importar el camino de invocación (Regla 4 ahora
 * decide en base a este dato, no a inferencia de la conversación).
 */
async function withArchitectRoleContext(
  projectId: string,
  rootRunId: string,
  incomingContext: unknown
): Promise<unknown> {
  if (incomingContext === null || typeof incomingContext !== "object") {
    return incomingContext;
  }
  const [testingPolicyConfig, roadmapApproval] = await Promise.all([
    getCurrentProjectConfig(projectId, "testing_policy_config", rootRunId),
    getCurrentProjectConfig(projectId, "release_roadmap", rootRunId),
  ]);
  const extra: Record<string, unknown> = {};
  if (testingPolicyConfig) extra.existingTestingPolicyConfig = testingPolicyConfig.value;
  if (roadmapApproval) extra.existingRoadmapApproval = roadmapApproval.value;
  if (Object.keys(extra).length === 0) return incomingContext;
  return { ...(incomingContext as Record<string, unknown>), ...extra };
}

/**
 * Fix (2026-08-17), hallazgo en vivo: cuando el reingreso cross-pipeline a Architect resuelve una
 * ambigüedad de Regla 2 y Architect declara ESTADO: completed con una propuesta fresca, Functional
 * recibe esa propuesta por el camino NORMAL (`functionalArtifact`), no por el de reingreso con
 * `escalationReason`/`targetAgentRole` -- así que su Regla 4 ("primera invocación, batch completo")
 * lo hace redeclarar TODAS las Features del release, incluidas las que ya fueron activadas e
 * implementadas en un run anterior de este mismo release, disparando el guard de
 * `persistFunctionalFeatureBatch` en loop. Mismo criterio que `existingRoadmapApproval` para
 * Architect: se le da a Functional la lista de Features ya activadas para el release actual como
 * dato explícito (`existingFeatures`), en vez de esperar que lo infiera de la conversación.
 */
async function withFunctionalRoleContext(
  projectId: string,
  rootRunId: string,
  incomingContext: unknown
): Promise<unknown> {
  if (incomingContext === null || typeof incomingContext !== "object") {
    return incomingContext;
  }
  const roadmap = await getCurrentProjectConfig(projectId, "release_roadmap", rootRunId);
  const activeRelease = activeReleaseFromRoadmap(roadmap?.value);
  if (!activeRelease) return incomingContext;
  const existingFeatures = await getActivatedFeatureIdentities(projectId, activeRelease.id, rootRunId);
  if (existingFeatures.length === 0) return incomingContext;
  return { ...(incomingContext as Record<string, unknown>), existingFeatures };
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
 *
 * FEATURE-043, sección 5.7/7.7: desde esta Feature, los runs nuevos del flujo web ya NO persisten
 * `rama_base_trabajo` dentro de `business_case` — viven en `runs.base_branch_name`
 * (`getRootRunExecutionContext`). Esta función queda exclusivamente como parser de compatibilidad
 * legacy: JSON histórico ya persistido (runs creados antes de esta Feature) y el camino
 * `run:start --case` del CLI (que nunca persiste `business_case` en la DB, solo lo pasa en memoria
 * como `initialContext` — ver el call site de `persistReleasePlanIfDeclared`). No es la fuente
 * primaria para ningún run nuevo del flujo web.
 */
export function ramaBaseTrabajoFromBusinessCase(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as { rama_base_trabajo?: unknown; businessCase?: unknown };
  const direct = record.rama_base_trabajo;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return ramaBaseTrabajoFromBusinessCase(record.businessCase);
}

export type FinalReleasePlanValidation = { valid: true } | { valid: false; reason: string };

/**
 * FEATURE-038: valida la transición del `RELEASE_PLAN` final que Planning declara al cerrar un
 * release (`RELEASE_COMPLETO`) contra el Release Plan vigente que Planning recibió como contexto de
 * ENTRADA en esa misma invocación (`inputReleasePlan` — nunca el declarado de salida, que por
 * contrato siempre trae `featureActualId: null` en un cierre; comparar contra ese sería trivialmente
 * inútil). Función pura: no hace I/O, no vuelve a consultar la base — el llamador debe pasarle
 * exactamente el mismo `releasePlan` que ya viajó en el `context` armado antes de invocar a Planning,
 * evitando así cualquier ventana de carrera entre lo que Planning vio y lo que se valida.
 */
export function validateFinalReleasePlanTransition(params: {
  featureJustCompleted: string | null;
  inputReleasePlan: unknown;
  declaredFinalReleasePlan: ReleasePlanDeclaration;
  comandoTestIsNull: boolean;
  featureUpdateIsNull: boolean;
}): FinalReleasePlanValidation {
  const { featureJustCompleted, inputReleasePlan, declaredFinalReleasePlan, comandoTestIsNull, featureUpdateIsNull } =
    params;

  if (!isReleasePlanDeclaration(inputReleasePlan)) {
    return { valid: false, reason: "no hay un Release Plan vigente de entrada con el que validar el cierre." };
  }
  if (inputReleasePlan.featureActualId === null) {
    return { valid: false, reason: "el Release Plan vigente de entrada no tiene ninguna Feature en curso." };
  }
  if (featureJustCompleted !== inputReleasePlan.featureActualId) {
    return {
      valid: false,
      reason: `featureJustCompleted ("${featureJustCompleted}") no coincide con la Feature activa del Release Plan vigente ("${inputReleasePlan.featureActualId}").`,
    };
  }
  const activeInputFeature = inputReleasePlan.features.find(
    (feature) => feature.id === inputReleasePlan.featureActualId
  );
  if (!activeInputFeature) {
    return {
      valid: false,
      reason: `la Feature activa "${inputReleasePlan.featureActualId}" no existe en el Release Plan vigente de entrada.`,
    };
  }
  if (activeInputFeature.estado !== "En curso") {
    return {
      valid: false,
      reason: `la Feature activa "${activeInputFeature.id}" del Release Plan vigente no está "En curso" (está "${activeInputFeature.estado}").`,
    };
  }

  if (declaredFinalReleasePlan.featureActualId !== null) {
    return { valid: false, reason: "el Release Plan final de un cierre debe declarar featureActualId: null." };
  }
  if (declaredFinalReleasePlan.features.some((feature) => feature.estado !== "Completada")) {
    return { valid: false, reason: "el Release Plan final de un cierre debe declarar todas las Features en estado Completada." };
  }
  if (!comandoTestIsNull) {
    return { valid: false, reason: "un cierre de release no debe declarar COMANDO_TEST." };
  }
  if (!featureUpdateIsNull) {
    return { valid: false, reason: "un cierre de release no debe declarar FEATURE_UPDATE." };
  }

  const finalIds = declaredFinalReleasePlan.features.map((feature) => feature.id);
  const finalIdSet = new Set(finalIds);
  if (finalIds.length !== finalIdSet.size) {
    return { valid: false, reason: "el Release Plan final contiene identidades de Feature duplicadas." };
  }
  const inputIdSet = new Set(inputReleasePlan.features.map((feature) => feature.id));
  if (inputIdSet.size !== finalIdSet.size || [...inputIdSet].some((id) => !finalIdSet.has(id))) {
    return {
      valid: false,
      reason: "el Release Plan final no contiene exactamente las mismas Features que el Release Plan vigente de entrada.",
    };
  }

  return { valid: true };
}

/** FEATURE-038: extrae `featureJustCompleted`/`releasePlan` del contexto ya armado para Planning (`context` en `executePipelineRun`), sin volver a consultar la base. */
function planningInputFieldsFromContext(context: unknown): { featureJustCompleted: string | null; inputReleasePlan: unknown } {
  if (context === null || typeof context !== "object") {
    return { featureJustCompleted: null, inputReleasePlan: null };
  }
  const record = context as { featureJustCompleted?: unknown; releasePlan?: unknown };
  return {
    featureJustCompleted: typeof record.featureJustCompleted === "string" ? record.featureJustCompleted : null,
    inputReleasePlan: "releasePlan" in record ? record.releasePlan : null,
  };
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
  featureJustCompleted: string | null;
  inputReleasePlan: unknown;
}): Promise<void> {
  // FEATURE-038: excepción exclusiva de persistencia para el cierre de release — RELEASE_COMPLETO
  // viaja con status "escalated" (es un Approval Gate, no un error), así que sin esta excepción el
  // guard de abajo descartaría el RELEASE_PLAN final antes de persistirlo, dejando el estado
  // persistido obsoleto ("En curso") pese al cierre exitoso. Cualquier otra escalación (ambigüedad,
  // requisitos insuficientes, etc.) sigue el camino existente de handleLinearEscalation sin
  // persistir nada acá.
  const isReleaseCompletion =
    params.result.status === "escalated" &&
    isReleaseCompletionEscalation({ phase: "planning" }, { outputArtifact: params.result.outputArtifact });
  if (params.result.status !== "completed" && !isReleaseCompletion) {
    // Fix (2026-08-17), hallazgo en vivo: Planning puede escalar por una razón legítima ajena a la
    // Feature que QA ya aprobó -- por ejemplo, una ambigüedad real en la SIGUIENTE Feature que le
    // toca asignar. Antes de este fix, esa finalización ya conocida (`featureJustCompleted`) se
    // perdía en silencio: como esta función retornaba sin persistir nada, nadie volvía a marcar esa
    // Feature como completada en `release_plan` hasta la próxima vez que Planning lograra declarar
    // un RELEASE_PLAN íntegro (incluyendo la Feature siguiente) -- dejando el plan persistido
    // desactualizado ("En curso") en el medio. Confirmado como causa raíz de una escalación
    // encadenada de Planning ("inconsistencia entre el artefacto funcional y el plan persistido")
    // cuando Functional corregía la Feature siguiente sin redeclarar la ya completada (tal como debe
    // hacer, ver functional.txt Regla 5) y Planning volvía a ver esa Feature marcada "En curso" en su
    // propio Release Plan vigente. Es determinístico -- no depende de que el LLM lo redeclare -- así
    // que corre sin importar si Planning llegó a escalar por cualquier otro motivo.
    await markFeatureCompletedInPersistedReleasePlan({
      projectId: params.projectId,
      runId: params.runId,
      featureJustCompleted: params.featureJustCompleted,
      inputReleasePlan: params.inputReleasePlan,
    });
    return;
  }

  const declaration = extractReleasePlanDeclaration(
    { phase: "planning" },
    { outputArtifact: params.result.outputArtifact }
  );

  if (isReleaseCompletion) {
    if (!declaration) {
      throw new FeatureLifecycleEscalationError(
        `Run ${params.runId}: Planning declaró RELEASE_COMPLETO sin un RELEASE_PLAN final válido.`
      );
    }
    const validation = validateFinalReleasePlanTransition({
      featureJustCompleted: params.featureJustCompleted,
      inputReleasePlan: params.inputReleasePlan,
      declaredFinalReleasePlan: declaration,
      comandoTestIsNull: isTaggedFieldNull(params.result.outputArtifact, "COMANDO_TEST", "comandoTest"),
      featureUpdateIsNull: isTaggedFieldNull(params.result.outputArtifact, "FEATURE_UPDATE", "featureUpdate"),
    });
    if (!validation.valid) {
      throw new FeatureLifecycleEscalationError(
        `Run ${params.runId}: cierre de release inconsistente — ${validation.reason}`
      );
    }
  }

  if (!declaration) return;

  // FEATURE-046: config de Caso -- se resuelve recién acá (no al principio de la función) para
  // preservar el contrato ya testeado de que una escalación inválida o "sin RELEASE_PLAN" nunca
  // toca la base: los guards de arriba (early return sin declaración, validación de cierre
  // fallida) deben poder cortar sin resolver el run raíz de un runId que, en esos caminos, puede
  // no existir todavía como fila real (ver runStart.test.ts, tests "sin tocar la base").
  const rootRunId = await getRunRootRunId(pool, params.runId);
  const existing = await getCurrentProjectConfig(params.projectId, "release_plan", rootRunId);
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

  const roadmap = await getCurrentProjectConfig(params.projectId, "release_roadmap", rootRunId);
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
 * Fix (2026-08-17): contraparte determinística de `persistReleasePlanIfDeclared` para cuando
 * Planning escala por un motivo ajeno a la Feature que QA ya aprobó. No depende de que Planning
 * redeclare nada -- marca `featureJustCompleted` como "Completada" directamente sobre el
 * `inputReleasePlan` que el propio Planning recibió como contexto de entrada en esta invocación
 * (nunca sobre lo que declaró de salida, que en este camino de escalación no es un RELEASE_PLAN
 * válido), y persiste esa versión actualizada. No-op si no hay `featureJustCompleted`, si
 * `inputReleasePlan` no tiene forma válida, si esa Feature no aparece en el plan, o si ya estaba
 * marcada "Completada" (evita reescrituras redundantes de `project_config_versions`).
 */
async function markFeatureCompletedInPersistedReleasePlan(params: {
  projectId: string;
  runId: string;
  featureJustCompleted: string | null;
  inputReleasePlan: unknown;
}): Promise<void> {
  if (!params.featureJustCompleted) return;
  if (!isReleasePlanDeclaration(params.inputReleasePlan)) return;

  const plan = params.inputReleasePlan as ReleasePlanDeclaration & { ramaBaseTrabajo?: unknown };
  const entry = plan.features.find((feature) => feature.id === params.featureJustCompleted);
  if (!entry || entry.estado === "Completada") return;

  const updatedFeatures = plan.features.map((feature) =>
    feature.id === params.featureJustCompleted ? { ...feature, estado: "Completada" as const } : feature
  );
  // Ninguna Feature queda "en curso" hasta que Planning logre asignar la siguiente con éxito -- si
  // la que se acaba de completar era la activa, se limpia junto con la marca de completada.
  const featureActualId = plan.featureActualId === params.featureJustCompleted ? null : plan.featureActualId;
  await setProjectConfig({
    projectId: params.projectId,
    configKey: "release_plan",
    value: { ...plan, features: updatedFeatures, featureActualId },
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
  // FEATURE-046: config de Caso -- se resuelve una vez y se usa en todas las lecturas de config
  // vigente del proyecto dentro de esta función.
  const rootRunId = await getRunRootRunId(pool, runId);

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
    // FEATURE-042 (cableado con FEATURE-026): credencial efímera del owner del run, nunca la
    // clave SSH legacy del host — se crea justo antes de pushear y se descarta enseguida.
    const gitAuth = await createGitProcessAuth(userId);
    try {
      await pushRunBranch(worktree, gitAuth);
    } finally {
      await gitAuth.dispose();
    }
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

  const releasePlanConfig = await getCurrentProjectConfig(projectId, "release_plan", rootRunId);
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
  console.log(`[run:start] Modo Auto: sub-rama "${worktree.branchName}" mergeada y pusheada a "${baseBranch}".`);

  // Fix (2026-08-17): mismo criterio que el reingreso a Architect más arriba -- `finalizeRun`
  // (status: "completed") corre DESPUÉS de crear el run de continuación, no antes, para que la
  // única notificación de este run que le llega al SSE ya encuentre el `childRunId` en la DB.
  // Antes de este fix, `finalizeRun` acá arriba disparaba el notify antes de que
  // `createPlanningToQaChildRun` (que hace trabajo real de git) terminara de commitear el run hijo
  // -- mismo síntoma que el otro camino: el usuario quedaba viendo el run "completed" sin ninguna
  // señal de a qué run seguir.
  const { childRunId, childWorktree } = await createPlanningToQaChildRun({
    repoRoot,
    parentRunId: runId,
    projectId,
    baseBranch,
    userId,
    cliAgentOverride,
    model,
  });
  await finalizeRun(runId, {
    status: "completed",
    outputArtifact: null,
    summary: `Feature lista, mergeada a "${baseBranch}" en modo auto.`,
    escalationReason: null,
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
  // FEATURE-025-Parte-1, sección 5.12: reingreso automático -- la resolución de modelo/credencial
  // efectiva ocurre igual que en cualquier fase, en el `executePipelineRun` que sigue a esta
  // función (mismo `cliAgentOverride`/`model`, ver call site). Acá solo se persiste el valor
  // resuelto en el evento `run_started` para que quede disponible si este run hijo escala y se
  // reintenta más adelante (respondService.ts, sección 5.9 del diseño).
  const firstPhaseSelection: EffectiveAgentConfig = params.cliAgentOverride
    ? { ...params.cliAgentOverride, model: params.model ?? null }
    : await resolveAgentConfig(
        params.userId,
        "planning",
        await getProjectAgentConfigProfileId(params.projectId)
      );

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
        model: firstPhaseSelection.model,
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

/**
 * Corrección del runtime de circuitos: crea el run hijo `FULL_PIPELINE` que arranca en Architect
 * para un reingreso automático (sin esperar humano) — usado cuando `handleLinearEscalation`
 * necesita "volver a Architect" pero el pipeline en curso (ej. `PLANNING_TO_QA`, Circuito 2/3) no
 * incluye esa fase. Architect (y luego Functional, si corresponde) ve el `ReentryContext` y decide
 * si la escalación es suya, la deja pasar (`notApplicable`) hacia el rol real
 * (`targetAgentRole`/`predecessorRoleFor`), o la atiende directamente — mismo mecanismo que ya usa
 * `respondService.ts` para el reingreso humano, aplicado acá sin intervención humana.
 */
export async function createArchitectReentryChildRun(params: {
  repoRoot: string;
  parentRunId: string;
  projectId: string;
  baseBranch: string;
  userId: string;
  cliAgentOverride: AgentConfig | null;
  model?: string;
}): Promise<{ childRunId: string; childWorktree: RunWorktree }> {
  const childRunId = randomUUID();
  const pipelineDefinition = await ensurePipelineDefinition(FULL_PIPELINE);
  const childWorktree = await createRunWorktree(params.repoRoot, childRunId, params.baseBranch);
  const baseCommitSha = await headSha(childWorktree);
  // FEATURE-025-Parte-1, sección 5.12: ver comentario equivalente en createPlanningToQaChildRun.
  const firstPhaseSelection: EffectiveAgentConfig = params.cliAgentOverride
    ? { ...params.cliAgentOverride, model: params.model ?? null }
    : await resolveAgentConfig(
        params.userId,
        "architect",
        await getProjectAgentConfigProfileId(params.projectId)
      );

  const client = await pool.connect();
  try {
    await client.query("begin");
    await createRun({
      id: childRunId,
      pipelineDefinitionId: pipelineDefinition.id,
      ownerId: params.userId,
      projectId: params.projectId,
      firstPhase: "architect",
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
        model: firstPhaseSelection.model,
        pipeline: `${FULL_PIPELINE.name}@${FULL_PIPELINE.version}`,
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

/**
 * FEATURE-037: Coding Standards es gobernanza de Developer (dueño/consultor directo — ver
 * `docs/runbook/05-CODING-STANDARDS.md:6-8`), entregada fresca en cada invocación (Regla 8/16,
 * incluidos reintentos y el turno de readiness — Regla 17) para que Developer la aplique
 * directamente al escribir código. No sustituye al Test Plan de Planning, que sigue siendo la única
 * fuente de alcance de testing (Regla 12).
 */
async function loadDeveloperGovernance(
  runbookProvider: Pick<RunbookProvider, "readText">,
  recordEvent: (runId: string, eventType: string, payload: unknown) => Promise<string | number | void>,
  runId: string
): Promise<{ codingStandards: RunbookTextAsset }> {
  const codingStandards = await runbookProvider.readText(CODING_STANDARDS_ASSET);
  await recordEvent(runId, "runbook_governance_delivered", {
    role: "developer",
    assetRelativePath: codingStandards.assetRelativePath,
    runbookVersion: codingStandards.runbookVersion,
    assetHash: codingStandards.assetHash,
  });
  return { codingStandards };
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
    dependencyInstaller?: Pick<DependencyInstaller, "installIfNeeded">;
    persistFeatureContribution?: typeof persistActiveFeatureContribution;
    gitReadinessSnapshot?: typeof gitReadinessSnapshot;
    validateTestCommandContract?: typeof validateTestCommandContract;
    /** FEATURE-037: Coding Standards es gobernanza de Developer — inyectada fresca en cada intento. */
    runbookProvider?: Pick<RunbookProvider, "readText">;
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
    dependencyInstaller: new DependencyInstaller() as Pick<DependencyInstaller, "installIfNeeded">,
    persistFeatureContribution: persistActiveFeatureContribution,
    gitReadinessSnapshot,
    validateTestCommandContract,
    runbookProvider: defaultRunbookProvider as Pick<RunbookProvider, "readText">,
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
  // FEATURE-029: motivo del reintento cuando COMANDO_TEST no supera la prevalidación posterior al
  // build (ej. declara una ruta que el build no produjo) — mutuamente excluyente con
  // buildFailureReason y qaRejectionReason. Nunca se le pide a Developer que toque COMANDO_TEST
  // (Regla 4 de developer.txt: esa declaración es propiedad exclusiva de Planning); el motivo
  // siempre apunta a alinear el output que el proyecto genera.
  let lastTestCommandFailureSummary: string | null = null;
  // FEATURE-032: motivo del reintento cuando la instalación de dependencias falla antes del build
  // — el primero en la cadena de exclusión mutua, porque es el primer paso cronológico (Developer
  // → instalación → build → contrato de test → QA). Igual que los otros tres motivos, nunca le
  // pide a Developer que toque COMANDO_TEST.
  let lastDependencyInstallFailureSummary: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await services.haltIfCancelledExternally(runId);
    await services.updateRunCurrentPhase(runId, "developer");

    const governance = await loadDeveloperGovernance(services.runbookProvider, services.recordRunEvent, runId);

    const developerContext =
      attempt === 1
        ? { plan: planningResult.outputArtifact, governance }
        : {
            plan: planningResult.outputArtifact,
            governance,
            previousAttemptSummary: lastDeveloperResult?.summary,
            ...(lastDependencyInstallFailureSummary
              ? { dependencyInstallationFailureReason: lastDependencyInstallFailureSummary }
              : lastBuildFailureSummary
                ? { buildFailureReason: lastBuildFailureSummary }
                : lastTestCommandFailureSummary
                  ? { testCommandFailureReason: lastTestCommandFailureSummary }
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

    // FEATURE-032: instalación de dependencias npm garantizada por el Orquestador, siempre antes
    // del build — sin depender de que Developer recuerde instalarlas. Corre en cada intento normal
    // (incluido el primero), nunca durante el turno post-QA de readiness (ese turno no llega a
    // este punto del loop en absoluto). Causa real que motivó esta Feature: el contenedor de
    // Developer es --read-only sin NPM_CONFIG_CACHE configurado, y BuildExecutor corre con
    // --network none — ninguno de los dos puede instalar nada por su cuenta.
    const installResult = await services.dependencyInstaller.installIfNeeded(
      executor.options.workingDirectory,
      DEPENDENCY_INSTALL_TIMEOUT_MS
    );
    if (installResult.ran) {
      await services.recordRunEvent(runId, "dependency_install_executed", { attempt, installResult });
    }
    if (installResult.ran && installResult.exitCode !== 0) {
      lastDependencyInstallFailureSummary = installResult.timedOut
        ? `Instalación de dependencias superó el timeout (${DEPENDENCY_INSTALL_TIMEOUT_MS}ms) sin terminar.`
        : `Instalación de dependencias falló (comando "${installResult.command}", exitCode ${installResult.exitCode}): ${installResult.stderr.slice(0, 2000)}`;
      console.log(`[run:start] Instalación de dependencias (intento ${attempt}) falló — Developer recibe el error en el próximo intento.`);

      if (attempt === maxAttempts) {
        const exhausted: PhaseResult = {
          status: "escalated",
          outputArtifact: null,
          summary: `Se agotaron los ${maxAttempts} intentos sin instalar las dependencias. Último error: ${lastDependencyInstallFailureSummary}`,
          escalationReason: `Límite de reintentos (${maxAttempts}) alcanzado — instalación de dependencias rota en todos los intentos, el build nunca llegó a correr.`,
        };
        await persistLoopExhaustionArtifact(
          { runId, phase: "developer", attempt, result: exhausted },
          services.persistArtifact
        );
        await services.recordRunEvent(runId, "loop_exhausted", { maxAttempts, reason: "dependency_install", lastInstallResult: installResult });
        console.log(`[run:start] Límite de ${maxAttempts} intentos alcanzado sin instalar dependencias — run escalado.`);
        return exhausted;
      }

      // No se ejecutan build, contrato de test, tests ni QA este intento — continúa al siguiente
      // attempt del mismo for, consumiendo el mismo contador maxAttempts que ya existe.
      continue;
    }
    lastDependencyInstallFailureSummary = null; // se limpia apenas la instalación corre bien (o es no-op)

    // FEATURE-021: build determinístico garantizado por el Orquestador, entre el turno de
    // Developer y el de QA — nunca por decisión de ningún agente. QA es intencionalmente
    // read-only (Regla 10, Ownership de Artefactos) y no puede recompilar; este paso corre en un
    // contenedor efímero propio, separado, con permiso de escritura, antes de que TestExecutor
    // monte el worktree en modo :ro para correr el test.
    const buildResult = await services.buildExecutor.runIfNeeded(executor.options.workingDirectory, BUILD_TIMEOUT_MS);
    if (buildResult.ran) {
      await services.recordRunEvent(runId, "build_executed", { attempt, buildResult });
    }
    if (buildResult.ran && buildResult.exitCode !== 0) {
      lastBuildFailureSummary = buildResult.timedOut
        ? `Build superó el timeout (${BUILD_TIMEOUT_MS}ms) sin terminar.`
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

    // FEATURE-006 (resuelve H14): el TestExecutor —no el agente QA— corre el comando de test,
    // como executable + args estructurados, dentro de un contenedor sin red. QA nunca recibe Bash.
    const { executable, args: testArgs } = parseTestCommand(testCommand);

    // FEATURE-029: antes de invocar QA, verificar que COMANDO_TEST sea consistente con lo que el
    // proyecto realmente produjo después del build — ej. Planning declaró una ruta compilada que
    // Developer nunca generó. Sin esto, el fallo recién aparecía durante la ejecución del test,
    // indistinguible de un rechazo real de QA.
    const contractValidation = await services.validateTestCommandContract(
      { executable, args: testArgs },
      executor.options.workingDirectory
    );
    if (!contractValidation.valid) {
      lastTestCommandFailureSummary = contractValidation.reason;
      console.log(
        `[run:start] COMANDO_TEST (intento ${attempt}) no superó la prevalidación — QA no se invoca: ${contractValidation.reason}`
      );

      if (attempt === maxAttempts) {
        const exhausted: PhaseResult = {
          status: "escalated",
          outputArtifact: null,
          summary: `Se agotaron los ${maxAttempts} intentos sin un COMANDO_TEST alineado con el output del build. Último motivo: ${contractValidation.reason}`,
          escalationReason: `Límite de reintentos (${maxAttempts}) alcanzado — COMANDO_TEST inconsistente con el output del build en todos los intentos.`,
        };
        await persistLoopExhaustionArtifact(
          { runId, phase: "developer", attempt, result: exhausted },
          services.persistArtifact
        );
        await services.recordRunEvent(runId, "loop_exhausted", {
          maxAttempts,
          reason: "test_command_contract",
          lastReason: contractValidation.reason,
        });
        console.log(`[run:start] Límite de ${maxAttempts} intentos alcanzado sin COMANDO_TEST válido — run escalado.`);
        return exhausted;
      }

      // No se invoca a QA este intento — continúa al siguiente attempt del mismo for,
      // consumiendo el mismo contador maxAttempts que ya existe (sin inventar uno nuevo).
      continue;
    }
    lastTestCommandFailureSummary = null;

    await services.updateRunCurrentPhase(runId, "qa");

    const testResult = await services.testExecutor.run({
      executable,
      args: testArgs,
      workingDirectory: executor.options.workingDirectory,
      timeoutMs: TEST_TIMEOUT_MS,
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
      // FEATURE-037, Regla 17: el turno de readiness también recibe Coding Standards fresco — su
      // presencia no autoriza cambios de código, solo permite a Developer evaluar el estado
      // vigente contra el estándar que le corresponde aplicar.
      const readinessGovernance = await loadDeveloperGovernance(services.runbookProvider, services.recordRunEvent, runId);
      const readinessInvocation: PhaseInvocation = {
        agentRole: "developer",
        roleInstructions: developerRoleInstructions,
        context: {
          readinessRequest: true,
          plan: planningResult.outputArtifact,
          governance: readinessGovernance,
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
  opts: { pushAndClean: boolean; cleanupStrategy: "shared-worktree" | "standalone-clone" },
  userId: string
): Promise<void> {
  await finalizeRun(runId, finalResult);

  if (opts.pushAndClean) {
    const committed = await commitAllChanges(worktree, `feat: implementación aprobada por QA (run ${runId})`);
    await recordRunEvent(runId, "run_committed", { committed });
    console.log(committed ? `[run:start] cambios commiteados en la rama.` : `[run:start] no había cambios sin commitear.`);

    // FEATURE-042 (cableado con FEATURE-026): mismo criterio que en
    // continueReleaseAfterFeatureApproved -- credencial efímera del owner, no la clave del host.
    const gitAuth = await createGitProcessAuth(userId);
    try {
      await pushRunBranch(worktree, gitAuth);
    } finally {
      await gitAuth.dispose();
    }
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

/**
 * FEATURE-025-Parte-1, sección 5.10: corte técnico previo a la invocación -- resuelve la
 * autenticación efectiva (credencial propia del usuario para `api_key`, conexión OAuth personal
 * materializada para `cli_session` desde FEATURE-025-Parte-2) antes de construir el Executor. Si
 * falta la credencial/conexión, `resolveExecutorAuthentication` lanza un error que se propaga y
 * cae en el catch genérico de `executePipelineRun` (mismo mecanismo que cualquier otro error
 * técnico mid-run: finaliza el run como `failed` con un evento `run_error`, nunca invoca al
 * agente). `finalizeAuth` DEBE llamarse en un `finally` por el caller después de usar el Executor
 * (recoge un posible refresh OAuth y limpia el temporal -- no-op para `api_key`).
 */
async function buildExecutor(
  selection: EffectiveAgentConfig,
  workingDirectory: string,
  requestingRunId: string,
  userId: string,
  opts: { sandbox?: "host" | "container" } = {}
): Promise<{ executor: RunExecutor; finalizeAuth: () => Promise<void> }> {
  const authentication = await resolveExecutorAuthentication(userId, selection);
  const apiKey = authentication.mode === "api_key" ? authentication.apiKey : undefined;
  const oauthDirectory = authentication.mode === "cli_session" ? authentication.oauthDirectory : undefined;
  const model = selection.model ?? undefined;
  const finalizeAuth = () => finalizeExecutorAuthentication(authentication);

  const executor =
    selection.executorProvider === "codex"
      ? new CodexExecutor({ workingDirectory, requestingRunId, model, authMode: selection.authMode, apiKey, oauthDirectory, ...opts })
      : new ClaudeCodeExecutor({ workingDirectory, requestingRunId, model, authMode: selection.authMode, apiKey, oauthDirectory, ...opts });

  return { executor, finalizeAuth };
}
