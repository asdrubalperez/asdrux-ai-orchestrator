import { randomUUID } from "node:crypto";
import type { AgentRole } from "../contracts/executor.js";
import { pool } from "../db/pool.js";
import {
  createRun,
  ensurePipelineDefinition,
  getBusinessCaseForRun,
  getCurrentProjectConfig,
  getRunDetailForUser,
  recordRunConfigVersions,
  recordRunEvent,
  resolveEscalatedRunStatus,
  setProjectConfig,
} from "../db/repository.js";
import {
  assertRunWorktreeAvailable,
  commitAllChanges,
  createRunWorktree,
  mergeFeatureBranchIntoBase,
  type RunWorktree,
} from "../isolation/worktree.js";
import {
  artifactsAreEquivalent,
  buildReentryContext,
  extractMergeApproval,
  isAgentRole,
  isReentryContext,
  isReleaseCompletionEscalation,
  isRoadmapApprovalPayload,
  type MergeApprovalPayload,
  type ReentryContext,
  type RoadmapApprovalPayload,
} from "./escalation.js";
import { createPlanningToQaChildRun, executePipelineRun, parseAuthMode, parseExecutorProvider } from "./commands/runStart.js";
import { FULL_PIPELINE, PLANNING_TO_QA } from "../pipelines/definitions.js";
import type { AgentConfig } from "../db/repository.js";

// FEATURE-020, Regla 8: mismo criterio de tope que `MAX_ESCALATION_ATTEMPTS` (runStart.ts), pero
// contando recorridos completos del mecanismo de reingreso encadenado, no invocaciones sueltas.
const MAX_REENTRY_ATTEMPTS = 3;

export type EscalationResponseAction = { abort: true } | { solution: string };

export type EscalationResponseResult =
  | { kind: "aborted" }
  | { kind: "conflict" }
  | { kind: "project_closed" }
  /**
   * FEATURE-020, Regla 7/8: el recorrido volvió a escalar el mismo rol con contenido equivalente
   * al que ya se había rechazado (`repeated`), o se alcanzó el tope de 3 recorridos sin resolución
   * (`exhausted`) — el run queda `resolved` (el humano ya respondió) pero no se crea otro run
   * encadenado; corta acá, sin más automatismo.
   */
  | { kind: "escalation_dead_end"; reason: "repeated" | "attempts_exhausted" }
  | {
      kind: "solution";
      childRunId: string;
      execute: () => Promise<void>;
    };

export class EscalationRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`No existe ningún run escalado accesible con id ${runId}.`);
  }
}

export async function respondToEscalation(params: {
  parentRunId: string;
  userId: string;
  action: EscalationResponseAction;
}): Promise<EscalationResponseResult> {
  const parentDetail = await getRunDetailForUser(params.parentRunId, params.userId);
  if (!parentDetail) {
    throw new EscalationRunNotFoundError(params.parentRunId);
  }

  const parentRun = parentDetail.run;
  if (parentRun.status !== "escalated") {
    return { kind: "conflict" };
  }

  if ("abort" in params.action) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const updated = await resolveEscalatedRunStatus(params.parentRunId, "aborted", client);
      if (!updated) {
        await client.query("rollback");
        return { kind: "conflict" };
      }
      await recordRunEvent(params.parentRunId, "escalation_aborted", {}, client);
      await client.query("commit");
      return { kind: "aborted" };
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  const rawSolution = params.action.solution;
  const runStarted = runStartedPayload(parentDetail.events);
  // FEATURE-016: un reintento de escalación reusa exactamente lo que se usó en el run original —
  // no re-resuelve contra user_agent_config, que pudo haber cambiado desde entonces. Runs previos
  // a esta Feature no tienen authMode persistido; default api_key (regresión cero).
  const cliAgentOverride: AgentConfig = {
    executorProvider: parseExecutorProvider(runStarted.provider),
    authMode: parseAuthMode(runStarted.authMode ?? "api_key"),
  };
  const model = runStarted.model ?? undefined;

  if (!parentRun.branch_name || !parentRun.worktree_path) {
    throw new Error(`El run ${params.parentRunId} no tiene branch_name/worktree_path persistidos.`);
  }

  const parentWorktree: RunWorktree = {
    branchName: parentRun.branch_name,
    worktreePath: parentRun.worktree_path,
  };
  // FEATURE-019, hallazgo de cierre: bug preexistente de FEATURE-018 — `runStarted.repoPath` (del
  // evento run_started) es ambiguo entre las dos cleanupStrategy de FEATURE-017: para runs
  // "standalone-clone" (el camino real de intake/UI) es la URL de git del caso, no una ruta de
  // filesystem — `path.resolve()` sobre eso no tira, produce una ruta inexistente que rompía acá
  // mismo, en el primer comando git (`assertRunWorktreeAvailable`). `parentWorktree.worktreePath`
  // SÍ es siempre una ruta local válida de un repo git completo en los dos casos (clon standalone,
  // o worktree linkeado de un repo compartido) — git worktree add/merge funcionan igual desde
  // cualquiera de los dos, sin necesitar el repo "raíz" compartido.
  const repoRoot = parentWorktree.worktreePath;
  await assertRunWorktreeAvailable(repoRoot, parentWorktree);
  await commitAllChanges(parentWorktree, `chore: preserve escalated work (run ${params.parentRunId})`);

  if (!parentRun.project_id) {
    throw new Error(`El run ${params.parentRunId} no tiene project_id persistido.`);
  }
  const projectId = parentRun.project_id;

  const escalationArtifact = latestEscalationArtifact(parentDetail.artifacts);
  const escalationContent = escalationArtifactContent(escalationArtifact);

  // FEATURE-019, sección 6.2b: aprobación de merge (Modo Manual) — camino totalmente aparte, no
  // reusa el pipeline del run padre ni el patrón de reintento con humanSolution (no hay ninguna
  // fase para re-ejecutar, la Feature ya fue aprobada por QA).
  const mergeApproval = extractMergeApproval(escalationArtifact, escalationContent);
  if (mergeApproval) {
    return respondMergeApproval({
      parentRunId: params.parentRunId,
      userId: params.userId,
      projectId,
      repoRoot,
      cliAgentOverride,
      model,
      mergeApproval,
      rawSolution,
    });
  }

  // FEATURE-019, sección 6.4: cierre de release — puede haber un release siguiente (cae al camino
  // genérico de abajo, reusando exactamente el mismo mecanismo que la aprobación de roadmap de
  // FEATURE-018) o no haberlo (el proyecto queda cerrado, sin child run).
  let releaseClosureRoadmap: RoadmapApprovalPayload | null = null;
  if (isReleaseCompletionEscalation(escalationArtifact, escalationContent)) {
    const roadmapConfig = await getCurrentProjectConfig(projectId, "release_roadmap");
    if (!isRoadmapApprovalPayload(roadmapConfig?.value)) {
      throw new Error(`Run ${params.parentRunId}: no hay release_roadmap persistido — no se puede cerrar el release.`);
    }
    const roadmap = roadmapConfig!.value as RoadmapApprovalPayload;
    const nextRelease = roadmap.releases.find((release) => release.estado === "Pendiente");
    releaseClosureRoadmap = {
      releases: roadmap.releases.map((release) => {
        if (release.id === roadmap.activeReleaseId) return { ...release, estado: "Completado" as const };
        if (nextRelease && release.id === nextRelease.id) return { ...release, estado: "Activo" as const };
        return release;
      }),
      activeReleaseId: nextRelease ? nextRelease.id : roadmap.activeReleaseId,
    };

    if (!nextRelease) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const updated = await resolveEscalatedRunStatus(params.parentRunId, "resolved", client);
        if (!updated) {
          await client.query("rollback");
          return { kind: "conflict" };
        }
        await setProjectConfig({
          projectId,
          configKey: "release_roadmap",
          value: releaseClosureRoadmap,
          changedByUserId: params.userId,
          changedInRunId: params.parentRunId,
          client,
        });
        await recordRunEvent(params.parentRunId, "project_closed", { roadmap: releaseClosureRoadmap }, client);
        await client.query("commit");
        return { kind: "project_closed" };
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    }
  }

  // FEATURE-020, Regla 6: el camino genérico siempre usa FULL_PIPELINE — nunca hay reingreso
  // gratis posible acá (a diferencia del reinicio en el mismo run, que sigue sin cambios y no pasa
  // por esta función), así que ya no hace falta reusar el pipeline del run padre.
  const pipelineDefinitionRow = await ensurePipelineDefinition(FULL_PIPELINE);

  // FEATURE-018, sección 7.2: no hace falta un campo ni un tipo de acción nuevo para distinguir una
  // escalación de "aprobación de roadmap" de una escalación genérica — la señal ya está en el
  // propio artifact (ROADMAP con contenido, bolteado a outputArtifact igual que COMANDO_TEST). Si
  // el JSON viene malformado (riesgo H12 aceptado, no resuelto con código — ver sección 7.5 del
  // documento de la Feature), se trata como si no hubiera roadmap: comportamiento genérico actual,
  // sin persistir nada nuevo.
  const roadmapApproval = extractRoadmapApproval(escalationArtifact, escalationContent);

  const humanSolution = roadmapApproval
    ? buildRoadmapApprovalHumanSolution(rawSolution)
    : releaseClosureRoadmap
      ? buildReleaseClosureHumanSolution(rawSolution)
      : rawSolution;

  // FEATURE-020, sección 6.4/6.6: `attempt` viaja en el contexto entre runs encadenados — se lee
  // del último `escalation_retry_context_prepared` persistido en el run padre (si el padre mismo
  // nació de este mecanismo), nunca de memoria de proceso.
  const originatingContext = findOriginatingReentryContext(parentDetail.events);
  const attempt = (originatingContext?.attempt ?? 0) + 1;

  // FEATURE-020, Regla 7/8: solo aplica al camino de escalación genérica (una aprobación —
  // roadmapApproval/releaseClosureRoadmap — es una decisión humana, no "el mismo problema volvió a
  // aparecer sin resolver"). Si el rol que escala ahora es el mismo que originó el recorrido
  // anterior y el contenido es equivalente al que ya se había rechazado, nadie lo corrigió — corta
  // acá, sin crear otro run encadenado.
  if (!roadmapApproval && !releaseClosureRoadmap && originatingContext) {
    const repeated =
      originatingContext.originAgentRole === escalationArtifact.phase &&
      artifactsAreEquivalent(originatingContext.rejectedArtifact, escalationContent.outputArtifact);

    if (repeated || attempt > MAX_REENTRY_ATTEMPTS) {
      const reason = repeated ? "repeated" : "attempts_exhausted";
      const client = await pool.connect();
      try {
        await client.query("begin");
        const updated = await resolveEscalatedRunStatus(params.parentRunId, "resolved", client);
        if (!updated) {
          await client.query("rollback");
          return { kind: "conflict" };
        }
        await recordRunEvent(
          params.parentRunId,
          reason === "repeated" ? "escalation_repeated_detected" : "escalation_exhausted",
          { agentRole: escalationArtifact.phase, artifactId: escalationArtifact.id, attempt },
          client
        );
        await recordRunEvent(params.parentRunId, "escalation_human_response", { solution: rawSolution, deadEnd: reason }, client);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
      await commitAllChanges(parentWorktree, `chore: preserve escalated work (run ${params.parentRunId})`);
      return { kind: "escalation_dead_end", reason };
    }
  }

  const retryContext: ReentryContext = buildReentryContext({
    businessCase: await getBusinessCaseForRun(params.parentRunId),
    escalationReason: escalationContent.escalationReason,
    rejectedArtifact: escalationContent.outputArtifact,
    originAgentRole: escalationArtifact.phase,
    humanSolution,
    attempt,
    // FEATURE-020, sección 6.5: referencia estable de auditoría (artifacts es insert-only) — la
    // detección real de "repetido" (más abajo, Regla 7/8) compara CONTENIDO
    // (`artifactsAreEquivalent`) entre `rejectedArtifact` y el nuevo `outputArtifact`, no este id.
    originalVersionRef: escalationArtifact.id,
  });

  const childRunId = randomUUID();
  const client = await pool.connect();
  let childWorktree: RunWorktree | null = null;
  try {
    await client.query("begin");
    const updated = await resolveEscalatedRunStatus(params.parentRunId, "resolved", client);
    if (!updated) {
      await client.query("rollback");
      return { kind: "conflict" };
    }

    if (roadmapApproval || releaseClosureRoadmap) {
      // Misma transacción que crea el child run (más abajo): si algo falla a mitad de camino, el
      // rollback del catch deshace ambas escrituras, no solo una — atomicidad real (ver 7.1/7.2 del
      // documento de la Feature).
      await setProjectConfig({
        projectId,
        configKey: "release_roadmap",
        value: roadmapApproval ?? releaseClosureRoadmap,
        changedByUserId: params.userId,
        changedInRunId: params.parentRunId,
        client,
      });
    }

    childWorktree = await createRunWorktree(repoRoot, childRunId, parentWorktree.branchName);
    const childRun = await createRun({
      id: childRunId,
      pipelineDefinitionId: pipelineDefinitionRow.id,
      ownerId: params.userId,
      projectId: parentRun.project_id,
      firstPhase: FULL_PIPELINE.definition.phases[0].agentRole,
      branchName: childWorktree.branchName,
      worktreePath: childWorktree.worktreePath,
      originatedFromRunId: params.parentRunId,
      client,
    });
    await recordRunConfigVersions(childRun.id, client);
    await recordRunEvent(
      childRun.id,
      "run_started",
      {
        branchName: childWorktree.branchName,
        worktreePath: childWorktree.worktreePath,
        provider: cliAgentOverride.executorProvider,
        authMode: cliAgentOverride.authMode,
        model: model ?? null,
        pipeline: `${FULL_PIPELINE.name}@${FULL_PIPELINE.version}`,
        projectId: parentRun.project_id,
        repoPath: childWorktree.worktreePath,
        originatedFromRunId: params.parentRunId,
      },
      client
    );
    await recordRunEvent(
      childRun.id,
      "escalation_retry_context_prepared",
      {
        parentRunId: params.parentRunId,
        parentArtifactId: escalationArtifact.id,
        context: retryContext,
      },
      client
    );
    await recordRunEvent(params.parentRunId, "escalation_human_response", { solution: humanSolution, newRunId: childRun.id }, client);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  if (!childWorktree) {
    throw new Error("No se pudo preparar el worktree del run hijo.");
  }

  return {
    kind: "solution",
    childRunId,
    execute: () =>
      executePipelineRun({
        projectRepoRoot: (childWorktree as RunWorktree).worktreePath,
        runId: childRunId,
        projectId,
        worktree: childWorktree as RunWorktree,
        pipelineSpec: FULL_PIPELINE,
        initialContext: retryContext,
        userId: params.userId,
        cliAgentOverride,
        model,
      }),
  };
}

/**
 * FEATURE-020, sección 6.4/6.6/Regla 7: el contexto de reingreso que creó este run, leído de sus
 * propios eventos persistidos (no de memoria de proceso) — `null` si este run no nació de este
 * mecanismo (primer recorrido de una escalación, o un run anterior a esta Feature).
 */
export function findOriginatingReentryContext(events: unknown[]): ReentryContext | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const item = events[i] as { event_type?: unknown; payload?: unknown };
    if (item.event_type !== "escalation_retry_context_prepared") continue;
    const payload = item.payload as { context?: unknown } | undefined;
    if (isReentryContext(payload?.context)) return payload!.context;
  }
  return null;
}

/** FEATURE-020, sección 6.6: 0 si este run no nació del mecanismo de reingreso (primer recorrido). */
export function previousAttemptFromEvents(events: unknown[]): number {
  return findOriginatingReentryContext(events)?.attempt ?? 0;
}

function runStartedPayload(
  events: unknown[]
): { provider: string; authMode: string | null; model: string | null; repoPath: string } {
  const event = events.find(
    (item): item is { event_type: string; payload: Record<string, unknown> } =>
      item !== null &&
      typeof item === "object" &&
      "event_type" in item &&
      (item as { event_type: unknown }).event_type === "run_started" &&
      "payload" in item &&
      (item as { payload: unknown }).payload !== null &&
      typeof (item as { payload: unknown }).payload === "object"
  );
  const payload = event?.payload;
  if (!payload || typeof payload.provider !== "string" || !("model" in payload) || typeof payload.repoPath !== "string") {
    throw new Error(
      "Este run no tiene provider/model/repoPath registrado - corrida anterior a esta Feature, no se puede reanudar automáticamente."
    );
  }
  return {
    provider: payload.provider,
    // FEATURE-016: runs previos a esta Feature no tienen authMode persistido — null, no un valor
    // inventado; el llamador lo trata como "api_key" (default, regresión cero).
    authMode: typeof payload.authMode === "string" ? payload.authMode : null,
    model: typeof payload.model === "string" ? payload.model : null,
    repoPath: payload.repoPath,
  };
}

function latestEscalationArtifact(artifacts: unknown[]): { id: string; phase: AgentRole; content: unknown } {
  for (let i = artifacts.length - 1; i >= 0; i--) {
    const item = artifacts[i] as { id?: unknown; phase?: unknown; kind?: unknown; content?: unknown };
    if (item.kind === "escalation" && typeof item.id === "string" && isAgentRole(item.phase)) {
      return { id: item.id, phase: item.phase, content: item.content };
    }
  }
  throw new Error("El run escalado no tiene artifact de escalamiento persistido.");
}

function escalationArtifactContent(artifact: { id: string; content: unknown }): {
  outputArtifact: unknown;
  escalationReason: string | null;
} {
  if (artifact.content === null || typeof artifact.content !== "object" || !("outputArtifact" in artifact.content)) {
    throw new Error(`El artifact de escalamiento ${artifact.id} no tiene outputArtifact persistido.`);
  }
  const content = artifact.content as { outputArtifact: unknown; escalationReason?: unknown };
  return {
    outputArtifact: content.outputArtifact,
    escalationReason: typeof content.escalationReason === "string" ? content.escalationReason : null,
  };
}

/**
 * FEATURE-018, sección 7.2: distingue una escalación de "aprobación de roadmap" de una escalación
 * genérica sin campo/tipo de acción nuevo — solo Architect declara ROADMAP, y solo lo declara con
 * contenido cuando completó su análisis (nunca junto con una ambigüedad genérica sin resolver, por
 * construcción del contrato de architect.txt). Devuelve null tanto si no aplica (rol distinto,
 * ROADMAP ausente) como si el contenido no es JSON válido con la forma esperada — mismo tratamiento
 * que "sin roadmap", riesgo aceptado de H12 (ver 7.5 del documento de la Feature).
 */
export function extractRoadmapApproval(
  artifact: { phase: AgentRole },
  content: { outputArtifact: unknown }
): RoadmapApprovalPayload | null {
  if (artifact.phase !== "architect") return null;
  if (content.outputArtifact === null || typeof content.outputArtifact !== "object") return null;

  const raw = (content.outputArtifact as { roadmap?: unknown }).roadmap;
  if (typeof raw !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  return isRoadmapApprovalPayload(parsed) ? parsed : null;
}

function buildRoadmapApprovalHumanSolution(rawSolution: string): string {
  return [
    "El Roadmap de Releases propuesto fue aprobado por el humano.",
    `Comentario del humano: "${rawSolution}".`,
    "No vuelvas a proponer el roadmap ni a escalar por este motivo — continuá tu fase declarando",
    "ESTADO: completed, usando el mismo ARTEFACTO y ROADMAP ya propuestos.",
  ].join(" ");
}

/** FEATURE-019: humanSolution para el reinicio en Architect tras aprobar el cierre de un release con release siguiente. */
function buildReleaseClosureHumanSolution(rawSolution: string): string {
  return [
    "El cierre del release anterior fue aprobado, y el release siguiente del Roadmap ya quedó",
    "marcado como Activo.",
    `Comentario del humano: "${rawSolution}".`,
    "Confirmá o ajustá tu diseño para este nuevo release — no vuelvas a proponer el roadmap desde",
    "cero, ya existe una versión vigente aprobada.",
  ].join(" ");
}

/**
 * FEATURE-019, sección 6.2b: aprobación humana del merge de una Feature a la rama base del
 * release (Modo Manual). No reusa el patrón genérico de reintento con `humanSolution` — no hay
 * ninguna fase para re-ejecutar, la Feature ya fue aprobada por QA. Mergea directo y crea el run
 * de continuación (`PLANNING_TO_QA`), mismas piezas que ya usa el camino de Modo Auto en
 * `runStart.ts` (`mergeFeatureBranchIntoBase`, `createPlanningToQaChildRun`).
 */
async function respondMergeApproval(params: {
  parentRunId: string;
  userId: string;
  projectId: string;
  repoRoot: string;
  cliAgentOverride: AgentConfig;
  model?: string;
  mergeApproval: MergeApprovalPayload;
  rawSolution: string;
}): Promise<EscalationResponseResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const updated = await resolveEscalatedRunStatus(params.parentRunId, "resolved", client);
    if (!updated) {
      await client.query("rollback");
      return { kind: "conflict" };
    }
    await recordRunEvent(
      params.parentRunId,
      "escalation_human_response",
      { solution: params.rawSolution, action: "merge_approved" },
      client
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  await mergeFeatureBranchIntoBase({
    repoRoot: params.repoRoot,
    baseBranch: params.mergeApproval.baseBranch,
    featureBranch: params.mergeApproval.featureBranch,
  });

  const { childRunId, childWorktree } = await createPlanningToQaChildRun({
    repoRoot: params.repoRoot,
    parentRunId: params.parentRunId,
    projectId: params.projectId,
    baseBranch: params.mergeApproval.baseBranch,
    userId: params.userId,
    cliAgentOverride: params.cliAgentOverride,
    model: params.model,
  });

  return {
    kind: "solution",
    childRunId,
    execute: () =>
      executePipelineRun({
        projectRepoRoot: childWorktree.worktreePath,
        runId: childRunId,
        projectId: params.projectId,
        worktree: childWorktree,
        pipelineSpec: PLANNING_TO_QA,
        initialContext: { featureJustCompleted: params.mergeApproval.featureActualId },
        userId: params.userId,
        cliAgentOverride: params.cliAgentOverride,
        model: params.model,
      }),
  };
}
