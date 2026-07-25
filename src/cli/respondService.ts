import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentRole } from "../contracts/executor.js";
import { pool } from "../db/pool.js";
import {
  createRun,
  getPipelineDefinitionById,
  getRunDetailForUser,
  recordRunConfigVersions,
  recordRunEvent,
  resolveEscalatedRunStatus,
} from "../db/repository.js";
import {
  assertRunWorktreeAvailable,
  commitAllChanges,
  createRunWorktree,
  type RunWorktree,
} from "../isolation/worktree.js";
import { buildEscalationContext, isAgentRole, parsePipelineDefinitionRow } from "./escalation.js";
import { executePipelineRun, parseAuthMode, parseExecutorProvider } from "./commands/runStart.js";
import type { AgentConfig } from "../db/repository.js";

export type EscalationResponseAction = { abort: true } | { solution: string };

export type EscalationResponseResult =
  | { kind: "aborted" }
  | { kind: "conflict" }
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

  const humanSolution = params.action.solution;
  const runStarted = runStartedPayload(parentDetail.events);
  // FEATURE-016: un reintento de escalación reusa exactamente lo que se usó en el run original —
  // no re-resuelve contra user_agent_config, que pudo haber cambiado desde entonces. Runs previos
  // a esta Feature no tienen authMode persistido; default api_key (regresión cero).
  const cliAgentOverride: AgentConfig = {
    executorProvider: parseExecutorProvider(runStarted.provider),
    authMode: parseAuthMode(runStarted.authMode ?? "api_key"),
  };
  const model = runStarted.model ?? undefined;
  const projectRepoRoot = path.resolve(runStarted.repoPath);

  if (!parentRun.branch_name || !parentRun.worktree_path) {
    throw new Error(`El run ${params.parentRunId} no tiene branch_name/worktree_path persistidos.`);
  }

  const parentWorktree: RunWorktree = {
    branchName: parentRun.branch_name,
    worktreePath: parentRun.worktree_path,
  };
  await assertRunWorktreeAvailable(projectRepoRoot, parentWorktree);
  await commitAllChanges(parentWorktree, `chore: preserve escalated work (run ${params.parentRunId})`);

  const pipelineDefinition = await getPipelineDefinitionById(parentRun.pipeline_definition_id);
  if (!pipelineDefinition) {
    throw new Error(`No existe pipeline_definition_id ${parentRun.pipeline_definition_id} para run ${params.parentRunId}.`);
  }
  const pipelineSpec = parsePipelineDefinitionRow(pipelineDefinition);

  if (!parentRun.project_id) {
    throw new Error(`El run ${params.parentRunId} no tiene project_id persistido.`);
  }

  const escalationArtifact = latestEscalationArtifact(parentDetail.artifacts);
  const escalationContent = escalationArtifactContent(escalationArtifact);
  const retryContext = buildEscalationContext({
    escalationReason: escalationContent.escalationReason,
    rejectedArtifact: escalationContent.outputArtifact,
    originAgentRole: escalationArtifact.phase,
    humanSolution,
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

    childWorktree = await createRunWorktree(projectRepoRoot, childRunId, parentWorktree.branchName);
    const childRun = await createRun({
      id: childRunId,
      pipelineDefinitionId: parentRun.pipeline_definition_id,
      ownerId: params.userId,
      projectId: parentRun.project_id,
      firstPhase: pipelineSpec.definition.phases[0].agentRole,
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
        pipeline: `${pipelineSpec.name}@${pipelineSpec.version}`,
        projectId: parentRun.project_id,
        repoPath: projectRepoRoot,
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
        projectRepoRoot,
        runId: childRunId,
        worktree: childWorktree as RunWorktree,
        pipelineSpec,
        initialContext: retryContext,
        userId: params.userId,
        cliAgentOverride,
        model,
      }),
  };
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
