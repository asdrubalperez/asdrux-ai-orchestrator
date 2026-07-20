import { randomUUID } from "node:crypto";
import path from "node:path";
import { readValidSession } from "../../auth/session.js";
import {
  createRun,
  getPipelineDefinitionById,
  getRunDetailForUser,
  recordRunConfigVersions,
  recordRunEvent,
} from "../../db/repository.js";
import { pool } from "../../db/pool.js";
import {
  assertRunWorktreeAvailable,
  commitAllChanges,
  createRunWorktree,
  type RunWorktree,
} from "../../isolation/worktree.js";
import { buildEscalationContext, isAgentRole, parsePipelineDefinitionRow } from "../escalation.js";
import { executePipelineRun, parseExecutorProvider } from "./runStart.js";

export async function runRespond(args: string[]): Promise<void> {
  const parentRunId = getFlag(args, "--run");
  const solution = getFlag(args, "--solution");
  const abort = args.includes("--abort");

  if (!parentRunId || (abort && solution !== undefined) || (!abort && solution === undefined)) {
    throw new Error('Uso: npm run cli -- run:respond --run <runId> (--solution "<texto>" | --abort)');
  }

  const session = await readValidSession();
  const parentDetail = await getRunDetailForUser(parentRunId, session.userId);
  if (!parentDetail) {
    throw new Error(`No existe ningún run escalado accesible con id ${parentRunId}.`);
  }

  const parentRun = parentDetail.run;
  if (parentRun.status !== "escalated") {
    throw new Error(`El run ${parentRunId} no está en status escalated.`);
  }

  if (abort) {
    await recordRunEvent(parentRunId, "escalation_aborted", {});
    console.log(`[run:respond] escalamiento abortado para run ${parentRunId}.`);
    return;
  }
  const humanSolution = solution;
  if (humanSolution === undefined) {
    throw new Error('Uso: npm run cli -- run:respond --run <runId> (--solution "<texto>" | --abort)');
  }

  const runStarted = runStartedPayload(parentDetail.events);
  const executorProvider = parseExecutorProvider(runStarted.provider);
  const model = runStarted.model ?? undefined;
  const projectRepoRoot = path.resolve(runStarted.repoPath);

  if (!parentRun.branch_name || !parentRun.worktree_path) {
    throw new Error(`El run ${parentRunId} no tiene branch_name/worktree_path persistidos.`);
  }

  const parentWorktree: RunWorktree = {
    branchName: parentRun.branch_name,
    worktreePath: parentRun.worktree_path,
  };
  await assertRunWorktreeAvailable(projectRepoRoot, parentWorktree);
  await commitAllChanges(parentWorktree, `chore: preserve escalated work (run ${parentRunId})`);

  const pipelineDefinition = await getPipelineDefinitionById(parentRun.pipeline_definition_id);
  if (!pipelineDefinition) {
    throw new Error(`No existe pipeline_definition_id ${parentRun.pipeline_definition_id} para run ${parentRunId}.`);
  }
  const pipelineSpec = parsePipelineDefinitionRow(pipelineDefinition);

  if (!parentRun.project_id) {
    throw new Error(`El run ${parentRunId} no tiene project_id persistido.`);
  }

  const escalationArtifact = latestEscalationArtifact(parentDetail.artifacts);
  const escalationContent = escalationArtifactContent(escalationArtifact);

  const childRunId = randomUUID();
  const childWorktree = await createRunWorktree(projectRepoRoot, childRunId, parentWorktree.branchName);
  console.log(
    `[run:respond] run hijo=${childRunId}; worktree=${childWorktree.worktreePath} (rama ${childWorktree.branchName}, base ${parentWorktree.branchName})`
  );

  const client = await pool.connect();
  try {
    await client.query("begin");
    const childRun = await createRun({
      id: childRunId,
      pipelineDefinitionId: parentRun.pipeline_definition_id,
      ownerId: session.userId,
      projectId: parentRun.project_id,
      firstPhase: pipelineSpec.definition.phases[0].agentRole,
      branchName: childWorktree.branchName,
      worktreePath: childWorktree.worktreePath,
      originatedFromRunId: parentRunId,
      client,
    });
    await recordRunConfigVersions(childRun.id, client);
    await recordRunEvent(
      childRun.id,
      "run_started",
      {
        branchName: childWorktree.branchName,
        worktreePath: childWorktree.worktreePath,
        provider: executorProvider,
        model: model ?? null,
        pipeline: `${pipelineSpec.name}@${pipelineSpec.version}`,
        projectId: parentRun.project_id,
        repoPath: projectRepoRoot,
        originatedFromRunId: parentRunId,
      },
      client
    );
    await recordRunEvent(parentRunId, "escalation_human_response", { solution: humanSolution, newRunId: childRun.id }, client);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  await executePipelineRun({
    projectRepoRoot,
    runId: childRunId,
    worktree: childWorktree,
    pipelineSpec,
    initialContext: buildEscalationContext({
      escalationReason: escalationContent.escalationReason,
      rejectedArtifact: escalationContent.outputArtifact,
      originAgentRole: escalationArtifact.phase,
      humanSolution,
    }),
    executorProvider,
    model,
  });
}

function runStartedPayload(events: unknown[]): { provider: string; model: string | null; repoPath: string } {
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
    model: typeof payload.model === "string" ? payload.model : null,
    repoPath: payload.repoPath,
  };
}

function latestEscalationArtifact(artifacts: unknown[]): { id: string; phase: import("../../contracts/executor.js").AgentRole; content: unknown } {
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

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
