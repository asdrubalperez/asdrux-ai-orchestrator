import { randomUUID } from "node:crypto";
import type { AgentRole } from "../contracts/executor.js";
import { createGitProcessAuth } from "../auth/gitConnectionService.js";
import { pool } from "../db/pool.js";
import {
  createRun,
  ensurePipelineDefinition,
  getBusinessCaseForRun,
  getCurrentProjectConfig,
  getRunDetailForUser,
  getRunRootRunId,
  recordRunConfigVersions,
  recordRunEvent,
  getProjectAgentConfigProfileId,
  resolveAgentConfig,
  resolveEscalatedRunStatus,
  setProjectConfig,
} from "../db/repository.js";
import {
  assertRunWorktreeAvailable,
  commitAllChanges,
  createRunWorktree,
  headSha,
  mergeFeatureBranchIntoBase,
  type RunWorktree,
} from "../isolation/worktree.js";
import {
  artifactsAreEquivalent,
  buildReentryContext,
  extractMergeApproval,
  extractRoadmapApproval,
  extractTestingPolicyConfig,
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
import type { AgentConfig, EffectiveAgentConfig } from "../db/repository.js";

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
  // FEATURE-016 fijaba SIEMPRE un único proveedor/authMode para todo el reingreso ("lo que se usó
  // en el run original"), asumiendo una única selección por run -- supuesto que dejó de valer con
  // FEATURE-025-Parte-1 (override por rol en user_agent_config). Si el run original fue lanzado con
  // flags de CLI (Regla 2: nunca consulta la DB), ese comportamiento sigue siendo correcto y se
  // preserva vía `cliOverrideForced`. Si no, cada fase del reingreso debe volver a resolver su
  // propia configuración por rol (mismo criterio que ya usan createPlanningToQaChildRun y
  // createArchitectReentryChildRun) -- de lo contrario, TODAS las fases del run hijo terminan
  // corriendo con el asistente/modelo/authMode de la fase que escaló, ignorando sus propios
  // overrides (hallazgo de validación en vivo de FEATURE-025-Parte-2).
  const cliAgentOverride: AgentConfig | null = runStarted.cliOverrideForced
    ? {
        executorProvider: parseExecutorProvider(runStarted.provider),
        authMode: parseAuthMode(runStarted.authMode ?? "api_key"),
      }
    : null;
  const model = cliAgentOverride ? runStarted.model ?? undefined : undefined;

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
  // FEATURE-046: config de Caso -- toda lectura de config vigente del proyecto en esta función se
  // acota al Caso de negocio del run que está respondiendo la escalación.
  const rootRunId = await getRunRootRunId(pool, params.parentRunId);

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
    const roadmapConfig = await getCurrentProjectConfig(projectId, "release_roadmap", rootRunId);
    if (!isRoadmapApprovalPayload(roadmapConfig?.value)) {
      throw new Error(`Run ${params.parentRunId}: no hay release_roadmap persistido — no se puede cerrar el release.`);
    }
    const roadmap = roadmapConfig!.value as RoadmapApprovalPayload;
    const { roadmap: computedRoadmap, hasNextRelease } = computeReleaseClosureRoadmap(roadmap);
    releaseClosureRoadmap = computedRoadmap;

    if (!hasNextRelease) {
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

  // Fix (2026-08-17): mismo momento y misma señal de aprobación humana que `roadmapApproval` --
  // Architect declara `TESTING_POLICY_CONFIG` junto con `ROADMAP` (architect.txt, Regla 9), así
  // que se persiste en la misma transacción, sólo cuando de verdad viene con contenido (Architect
  // declara null cuando ya existe una Testing Policy vigente que no está cambiando).
  const testingPolicyConfig = extractTestingPolicyConfig(escalationArtifact, escalationContent);

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

    if (testingPolicyConfig) {
      await setProjectConfig({
        projectId,
        configKey: "testing_policy_config",
        value: testingPolicyConfig,
        changedByUserId: params.userId,
        changedInRunId: params.parentRunId,
        client,
      });
    }

    childWorktree = await createRunWorktree(repoRoot, childRunId, parentWorktree.branchName);
    const baseCommitSha = await headSha(childWorktree);
    // Mismo criterio que createPlanningToQaChildRun/createArchitectReentryChildRun: sin override
    // forzado, el snapshot de auditoría refleja la selección real de la primera fase (architect),
    // no un valor inventado -- cada fase del child run resuelve la suya propia de todos modos.
    const firstPhaseSelection: EffectiveAgentConfig = cliAgentOverride
      ? { ...cliAgentOverride, model: model ?? null }
      : await resolveAgentConfig(
          params.userId,
          FULL_PIPELINE.definition.phases[0].agentRole,
          await getProjectAgentConfigProfileId(projectId)
        );
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
        provider: firstPhaseSelection.executorProvider,
        authMode: firstPhaseSelection.authMode,
        model: firstPhaseSelection.model,
        cliOverrideForced: cliAgentOverride !== null,
        pipeline: `${FULL_PIPELINE.name}@${FULL_PIPELINE.version}`,
        projectId: parentRun.project_id,
        repoPath: childWorktree.worktreePath,
        originatedFromRunId: params.parentRunId,
        baseCommitSha,
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
): { provider: string; authMode: string | null; model: string | null; repoPath: string; cliOverrideForced: boolean } {
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
    // Runs previos a este campo (FEATURE-025-Parte-2) no lo tienen persistido -- default false:
    // resuelve por rol, el comportamiento correcto para el 100% de los runs reales (web/intake).
    cliOverrideForced: payload.cliOverrideForced === true,
  };
}

export function latestEscalationArtifact(artifacts: unknown[]): { id: string; phase: AgentRole; content: unknown } {
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
 * FEATURE-036: computa el Roadmap resultante de cerrar el release actualmente activo. Extraída
 * como función pura (separada de la lectura/persistencia en DB) para poder testear directamente
 * los dos caminos (con y sin release siguiente) sin necesitar una conexión real a la base.
 *
 * Cierra por estado ("Activo" → "Completado"), no solo por coincidencia con
 * `roadmap.activeReleaseId` — garantiza determinísticamente que ningún release quede "Activo"
 * cuando no hay siguiente, sin depender de que el roadmap leído ya tuviera esa relación
 * perfectamente sincronizada (sección 7.4 del diseño).
 */
export function computeReleaseClosureRoadmap(
  roadmap: RoadmapApprovalPayload
): { roadmap: RoadmapApprovalPayload; hasNextRelease: boolean } {
  const nextRelease = roadmap.releases.find((release) => release.estado === "Pendiente");
  return {
    roadmap: {
      releases: roadmap.releases.map((release) => {
        if (nextRelease && release.id === nextRelease.id) return { ...release, estado: "Activo" as const };
        if (release.estado === "Activo") return { ...release, estado: "Completado" as const };
        return release;
      }),
      activeReleaseId: nextRelease ? nextRelease.id : null,
    },
    hasNextRelease: nextRelease !== undefined,
  };
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
  cliAgentOverride: AgentConfig | null;
  model?: string;
  mergeApproval: MergeApprovalPayload;
  rawSolution: string;
}): Promise<EscalationResponseResult> {
  // fix/merge-approval-atomicity: el merge real corre PRIMERO, antes de tocar la DB. Antes de este
  // fix, `resolveEscalatedRunStatus(..., "resolved", ...)` se commiteaba en su propia transacción
  // ANTES de intentar este merge — si el merge fallaba (ej. un `git push` colgado esperando un
  // prompt de credencial que nunca llega en un proceso no interactivo, ver `gitNoPromptEnv` en
  // `worktree.ts`), el run quedaba "resolved" para siempre sin que el merge ni la continuación
  // hubieran ocurrido realmente, sin ningún rastro de error. Con el merge primero, si falla, no se
  // tocó la DB todavía — el run sigue "escalated", tal como estaba, sin ningún cambio de estado
  // falso. Mismo patrón que ya usa el camino genérico de escalamiento (más arriba en este archivo):
  // el paso que puede fallar corre antes de comprometer el estado del run.
  // Hallazgo de validación en vivo (FEATURE-025-Parte-2): mergeFeatureBranchIntoBase nunca recibía
  // la credencial de GitHub del owner del run -- el push corría sin ningún token real y GitHub lo
  // rechazaba con "Invalid username or token" (no es un token vencido, nunca se inyectaba
  // ninguno). Mismo criterio que runStart.ts al pushear la rama del run: credencial efímera del
  // owner, creada justo antes de usarla y descartada enseguida.
  const gitAuth = await createGitProcessAuth(params.userId);
  try {
    await mergeFeatureBranchIntoBase({
      repoRoot: params.repoRoot,
      baseBranch: params.mergeApproval.baseBranch,
      featureBranch: params.mergeApproval.featureBranch,
      gitAuth,
    });
  } finally {
    await gitAuth.dispose();
  }

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

  // El merge y el "resolved" ya están confirmados en este punto. `createPlanningToQaChildRun`
  // tiene su propia transacción interna (rollback si falla) — pero si falla, el código de la
  // Feature ya está mergeado de forma segura en la rama base; lo único que no arrancó es la
  // continuación a Planning. Se distingue con un evento propio (`continuation_creation_failed`)
  // para que quede visible que esto NO es un run "fantasma" silencioso — el merge sí ocurrió, solo
  // falta que alguien retome la continuación del release.
  let childRunId: string;
  let childWorktree: RunWorktree;
  try {
    const created = await createPlanningToQaChildRun({
      repoRoot: params.repoRoot,
      parentRunId: params.parentRunId,
      projectId: params.projectId,
      baseBranch: params.mergeApproval.baseBranch,
      userId: params.userId,
      cliAgentOverride: params.cliAgentOverride,
      model: params.model,
    });
    childRunId = created.childRunId;
    childWorktree = created.childWorktree;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRunEvent(params.parentRunId, "continuation_creation_failed", { error: message }).catch(() => {});
    throw err;
  }

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
