import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeExecutor } from "../../executor/claudeCodeExecutor.js";
import { createRunWorktree } from "../../isolation/worktree.js";
import {
  createRun,
  ensurePipelineDefinition,
  finalizeRun,
  recordArtifact,
  recordRunEvent,
  updateRunCurrentPhase,
} from "../../db/repository.js";
import type { PhaseInvocation, PhaseResult } from "../../contracts/executor.js";
import { PIPELINES, SINGLE_PHASE_ARCHITECT } from "../../pipelines/definitions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

export async function runStart(args: string[]): Promise<void> {
  const casePath = getFlag(args, "--case");
  const ownerId = getFlag(args, "--owner") ?? "asdru";
  const pipelineName = getFlag(args, "--pipeline") ?? SINGLE_PHASE_ARCHITECT.name;

  if (!casePath) {
    throw new Error("Uso: npm run cli -- run:start --case <ruta-a-json> [--owner <id>] [--pipeline <nombre>]");
  }

  const pipelineSpec = PIPELINES[pipelineName];
  if (!pipelineSpec) {
    throw new Error(`Pipeline desconocido: "${pipelineName}". Disponibles: ${Object.keys(PIPELINES).join(", ")}`);
  }

  const businessCase = JSON.parse(await readFile(casePath, "utf8"));
  const pipelineDefinition = await ensurePipelineDefinition(pipelineSpec);

  const runId = randomUUID();
  console.log(`[run:start] runId=${runId}`);
  console.log(`[run:start] pipeline=${pipelineSpec.name}@${pipelineSpec.version} (${pipelineSpec.definition.phases.length} fase/s)`);

  const { branchName, worktreePath } = await createRunWorktree(repoRoot, runId);
  console.log(`[run:start] worktree creado: ${worktreePath} (rama ${branchName})`);

  const run = await createRun({
    id: runId,
    pipelineDefinitionId: pipelineDefinition.id,
    ownerId,
    firstPhase: pipelineSpec.definition.phases[0].agentRole,
    branchName,
    worktreePath,
  });

  await recordRunEvent(run.id, "run_started", {
    branchName,
    worktreePath,
    casePath,
    pipeline: `${pipelineSpec.name}@${pipelineSpec.version}`,
  });

  const executor = new ClaudeCodeExecutor({ workingDirectory: worktreePath });

  // Transición automática entre fases: se continúa a la siguiente únicamente si la anterior
  // terminó con status "completed" (FEATURE-004, Regla Funcional 1). El orden y las fases mismas
  // vienen de pipelineSpec.definition.phases — no están hardcodeadas acá.
  let previousResult: PhaseResult | null = null;

  for (const phase of pipelineSpec.definition.phases) {
    await updateRunCurrentPhase(run.id, phase.agentRole);

    const context = previousResult === null ? businessCase : previousResult.outputArtifact;

    const roleInstructions = await readFile(
      path.join(repoRoot, "src", "executor", "roles", `${phase.agentRole}.txt`),
      "utf8"
    );

    const invocation: PhaseInvocation = {
      agentRole: phase.agentRole,
      roleInstructions,
      context,
      permissions: phase.permissions,
    };

    await recordRunEvent(run.id, "phase_started", { agentRole: invocation.agentRole });

    const result = await executor.runPhase(invocation, { timeoutMs: 180_000 });

    await recordRunEvent(run.id, "phase_finished", { agentRole: invocation.agentRole, result });

    await recordArtifact({
      runId: run.id,
      phase: invocation.agentRole,
      kind: result.status === "escalated" ? "escalation" : "design",
      content: { outputArtifact: result.outputArtifact, summary: result.summary },
    });

    previousResult = result;

    if (result.status !== "completed") {
      console.log(`[run:start] fase "${phase.agentRole}" terminó con status "${result.status}" — pipeline detenido, no se invoca la siguiente fase.`);
      break;
    }
  }

  await finalizeRun(run.id, previousResult as PhaseResult);

  console.log(`[run:start] status final: ${previousResult?.status}`);
  console.log(`[run:start] run ${run.id} persistido. Consultar con: npm run cli -- run:status --run ${run.id}`);
}

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
