import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeExecutor } from "../../executor/claudeCodeExecutor.js";
import { CodexExecutor } from "../../executor/codexExecutor.js";
import {
  commitAllChanges,
  createRunWorktree,
  pushRunBranch,
  removeRunWorktree,
  type RunWorktree,
} from "../../isolation/worktree.js";
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
import { extractTestCommand } from "../../pipelines/extractTestCommand.js";
import { TestExecutor, parseTestCommand } from "../../testing/testExecutor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
type ExecutorProvider = "claude" | "codex";
type RunExecutor = ClaudeCodeExecutor | CodexExecutor;

export async function runStart(args: string[]): Promise<void> {
  const casePath = getFlag(args, "--case");
  const ownerId = getFlag(args, "--owner") ?? "asdru";
  const pipelineName = getFlag(args, "--pipeline") ?? SINGLE_PHASE_ARCHITECT.name;
  const model = getFlag(args, "--model");
  const executorProvider = parseExecutorProvider(getFlag(args, "--executor") ?? "claude");

  if (!casePath) {
    throw new Error(
      "Uso: npm run cli -- run:start --case <ruta-a-json> [--owner <id>] [--pipeline <nombre>] [--model <alias>] [--executor claude|codex]"
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

  const worktree = await createRunWorktree(repoRoot, runId);
  console.log(`[run:start] worktree creado: ${worktree.worktreePath} (rama ${worktree.branchName})`);

  const run = await createRun({
    id: runId,
    pipelineDefinitionId: pipelineDefinition.id,
    ownerId,
    firstPhase: pipelineSpec.definition.phases[0].agentRole,
    branchName: worktree.branchName,
    worktreePath: worktree.worktreePath,
  });

  await recordRunEvent(run.id, "run_started", {
    branchName: worktree.branchName,
    worktreePath: worktree.worktreePath,
    casePath,
    pipeline: `${pipelineSpec.name}@${pipelineSpec.version}`,
  });

  const executor = createExecutor(executorProvider, worktree.worktreePath, model);
  const readRole = (agentRole: string) =>
    readFile(path.join(repoRoot, "src", "executor", "roles", `${agentRole}.txt`), "utf8");

  try {
    // --- Fases lineales (FEATURE-004): transición automática solo si status === "completed" ---
    let previousResult: PhaseResult | null = null;

    for (const phase of pipelineSpec.definition.phases) {
      await updateRunCurrentPhase(run.id, phase.agentRole);
      const context = previousResult === null ? businessCase : previousResult.outputArtifact;
      const roleInstructions = await readRole(phase.agentRole);

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
        console.log(`[run:start] fase "${phase.agentRole}" terminó con status "${result.status}" — pipeline detenido.`);
        await finishRun(run.id, worktree, result, { pushAndClean: false });
        return;
      }
    }

    // --- Loop Developer↔QA (FEATURE-005) ---
    if (pipelineSpec.definition.loop) {
      // FEATURE-006 (resuelve H14): Developer corre en un Executor separado, en modo "container"
      // — su invocación completa (Bash incluido) queda confinada dentro de un contenedor Docker
      // endurecido, no en el host. QA sigue en read-only (ya no necesita Bash en absoluto).
      const developerExecutor = createDeveloperExecutor(executorProvider, worktree.worktreePath, model);

      const finalResult = await runDeveloperQaLoop({
        executor,
        developerExecutor,
        readRole,
        runId: run.id,
        planningResult: previousResult as PhaseResult,
        maxAttempts: pipelineSpec.definition.loop.maxAttempts,
      });

      const approved = finalResult.status === "completed";
      await finishRun(run.id, worktree, finalResult, { pushAndClean: approved });
      return;
    }

    await finishRun(run.id, worktree, previousResult as PhaseResult, { pushAndClean: false });
  } catch (err) {
    // Un error inesperado (timeout, crash del CLI, etc.) no debe dejar el run colgado en
    // "running" para siempre sin ningún cierre persistido — se registra como failed y se
    // preserva el worktree (no se sabe en qué estado quedó) para inspección manual.
    const message = err instanceof Error ? err.message : String(err);
    const failure: PhaseResult = {
      status: "failed",
      outputArtifact: null,
      summary: `Error inesperado durante la ejecución del run: ${message}`,
      escalationReason: null,
    };
    await recordRunEvent(run.id, "run_error", { message });
    await finishRun(run.id, worktree, failure, { pushAndClean: false });
    throw err;
  }
}

export async function runDeveloperQaLoop(params: {
  executor: RunExecutor;
  developerExecutor: RunExecutor;
  readRole: (agentRole: string) => Promise<string>;
  runId: string;
  planningResult: PhaseResult;
  maxAttempts: number;
}): Promise<PhaseResult> {
  const { executor, developerExecutor, readRole, runId, planningResult, maxAttempts } = params;
  const testExecutor = new TestExecutor();
  const testCommand = extractTestCommand(planningResult.outputArtifact);
  console.log(`[run:start] COMANDO_TEST declarado por Planning: ${testCommand}`);

  const developerRoleInstructions = await readRole("developer");
  const qaRoleInstructions = await readRole("qa");

  let lastDeveloperResult: PhaseResult | null = null;
  let lastQaResult: PhaseResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await updateRunCurrentPhase(runId, "developer");

    const developerContext =
      attempt === 1
        ? { plan: planningResult.outputArtifact }
        : {
            plan: planningResult.outputArtifact,
            previousAttemptSummary: lastDeveloperResult?.summary,
            qaRejectionReason: lastQaResult?.summary,
          };

    const developerInvocation: PhaseInvocation = {
      agentRole: "developer",
      roleInstructions: developerRoleInstructions,
      context: developerContext,
      permissions: { filesystem: "workspace-write", writableRoots: [developerExecutor.options.workingDirectory] },
    };

    await recordRunEvent(runId, "phase_started", { agentRole: "developer", attempt });
    const developerResult = await developerExecutor.runPhase(developerInvocation, { timeoutMs: 300_000 });
    await recordRunEvent(runId, "phase_finished", { agentRole: "developer", attempt, result: developerResult });
    await recordArtifact({
      runId,
      phase: "developer",
      kind: developerResult.status === "escalated" ? "escalation" : "code",
      content: { attempt, outputArtifact: developerResult.outputArtifact, summary: developerResult.summary },
    });

    lastDeveloperResult = developerResult;

    if (developerResult.status !== "completed") {
      console.log(`[run:start] Developer (intento ${attempt}) terminó con status "${developerResult.status}" — loop detenido.`);
      return developerResult;
    }

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

    await recordRunEvent(runId, "phase_started", { agentRole: "qa", attempt });
    const qaResult = await executor.runPhase(qaInvocation, { timeoutMs: 300_000 });
    await recordRunEvent(runId, "phase_finished", { agentRole: "qa", attempt, result: qaResult });
    await recordArtifact({
      runId,
      phase: "qa",
      kind:
        qaResult.status === "completed"
          ? "verdict_approved"
          : qaResult.status === "rejected"
            ? "verdict_rejected"
            : "escalation",
      content: { attempt, outputArtifact: qaResult.outputArtifact, summary: qaResult.summary },
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
  runId: string,
  worktree: RunWorktree,
  finalResult: PhaseResult,
  opts: { pushAndClean: boolean }
): Promise<void> {
  await finalizeRun(runId, finalResult);

  if (opts.pushAndClean) {
    const committed = await commitAllChanges(worktree, `feat: implementación aprobada por QA (run ${runId})`);
    await recordRunEvent(runId, "run_committed", { committed });
    console.log(committed ? `[run:start] cambios commiteados en la rama.` : `[run:start] no había cambios sin commitear.`);

    await pushRunBranch(worktree);
    await recordRunEvent(runId, "run_pushed", { branchName: worktree.branchName });
    console.log(`[run:start] push real de la rama "${worktree.branchName}" a origin.`);

    await removeRunWorktree(repoRoot, worktree);
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

function parseExecutorProvider(value: string): ExecutorProvider {
  if (value === "claude" || value === "codex") return value;
  throw new Error(`Executor desconocido: "${value}". Disponibles: claude, codex`);
}

function createExecutor(provider: ExecutorProvider, workingDirectory: string, model: string | undefined): RunExecutor {
  if (provider === "codex") {
    return new CodexExecutor({ workingDirectory, model });
  }

  return new ClaudeCodeExecutor({ workingDirectory, model });
}

function createDeveloperExecutor(provider: ExecutorProvider, workingDirectory: string, model: string | undefined): RunExecutor {
  if (provider === "codex") {
    return new CodexExecutor({ workingDirectory, model, sandbox: "container" });
  }

  return new ClaudeCodeExecutor({ workingDirectory, model, sandbox: "container" });
}
