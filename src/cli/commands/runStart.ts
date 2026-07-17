import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeExecutor } from "../../executor/claudeCodeExecutor.js";
import { createRunWorktree } from "../../isolation/worktree.js";
import {
  createRun,
  ensureSinglePhasePipelineDefinition,
  finalizeRun,
  recordArtifact,
  recordRunEvent,
} from "../../db/repository.js";
import type { PhaseInvocation } from "../../contracts/executor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

export async function runStart(args: string[]): Promise<void> {
  const casePath = getFlag(args, "--case");
  const ownerId = getFlag(args, "--owner") ?? "asdru";

  if (!casePath) {
    throw new Error("Uso: npm run cli -- run:start --case <ruta-a-json> [--owner <id>]");
  }

  const context = JSON.parse(await readFile(casePath, "utf8"));
  const roleInstructions = await readFile(
    path.join(repoRoot, "src", "executor", "roles", "architect.txt"),
    "utf8"
  );

  const pipelineDefinition = await ensureSinglePhasePipelineDefinition();

  const runId = randomUUID();
  console.log(`[run:start] runId=${runId}`);

  const { branchName, worktreePath } = await createRunWorktree(repoRoot, runId);
  console.log(`[run:start] worktree creado: ${worktreePath} (rama ${branchName})`);

  const run = await createRun({
    id: runId,
    pipelineDefinitionId: pipelineDefinition.id,
    ownerId,
    branchName,
    worktreePath,
  });

  await recordRunEvent(run.id, "run_started", { branchName, worktreePath, casePath });

  const invocation: PhaseInvocation = {
    agentRole: "architect",
    roleInstructions,
    context,
    permissions: { filesystem: "read-only" },
  };

  await recordRunEvent(run.id, "phase_started", { agentRole: invocation.agentRole });

  const executor = new ClaudeCodeExecutor({ workingDirectory: worktreePath });
  const result = await executor.runPhase(invocation, { timeoutMs: 180_000 });

  await recordRunEvent(run.id, "phase_finished", { agentRole: invocation.agentRole, result });

  await recordArtifact({
    runId: run.id,
    phase: invocation.agentRole,
    kind: result.status === "escalated" ? "escalation" : "design",
    content: { outputArtifact: result.outputArtifact, summary: result.summary },
  });

  await finalizeRun(run.id, result);

  console.log(`[run:start] status final: ${result.status}`);
  console.log(`[run:start] run ${run.id} persistido. Consultar con: npm run cli -- run:status --run ${run.id}`);
}

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
