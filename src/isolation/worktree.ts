import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Mecanismo confirmado en FEATURE-002 (docs/features/FEATURE-002-spike-results.md):
// una rama + git worktree real por run, fuera del checkout principal.

export interface RunWorktree {
  branchName: string;
  worktreePath: string;
}

export async function createRunWorktree(repoRoot: string, runId: string, baseRef = "HEAD"): Promise<RunWorktree> {
  const branchName = `run/${runId}`;
  const worktreesBaseDir = process.env.WORKTREES_BASE_DIR ?? path.resolve(repoRoot, "..", "ai-orchestrator-worktrees");
  const worktreePath = path.join(worktreesBaseDir, runId);

  await execFileAsync("git", ["worktree", "add", "-b", branchName, worktreePath, baseRef], {
    cwd: repoRoot,
  });

  return { branchName, worktreePath };
}

export async function removeRunWorktree(repoRoot: string, worktree: RunWorktree): Promise<void> {
  await execFileAsync("git", ["worktree", "remove", worktree.worktreePath, "--force"], {
    cwd: repoRoot,
  });
  await execFileAsync("git", ["branch", "-D", worktree.branchName], { cwd: repoRoot });
}

/**
 * Commitea los cambios reales que Developer escribió en el worktree (workspace-write no commitea
 * por sí solo — escribir archivos y dejarlos en git status no es lo mismo que persistirlos en la
 * rama). Se llama antes de pushRunBranch; sin esto, `git worktree remove --force` descarta el
 * trabajo no commiteado silenciosamente (hallazgo real de FEATURE-005, corregido acá).
 * No-op (sin error) si no hay cambios para commitear.
 */
export async function commitAllChanges(worktree: RunWorktree, message: string): Promise<boolean> {
  const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: worktree.worktreePath });
  if (!status.stdout.trim()) {
    return false;
  }

  await execFileAsync("git", ["add", "-A"], { cwd: worktree.worktreePath });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=ai-orchestrator-bot",
      "-c",
      "user.email=ai-orchestrator-bot@localhost",
      "commit",
      "-m",
      message,
    ],
    { cwd: worktree.worktreePath }
  );
  return true;
}

/**
 * Finalización real (FEATURE-005): push de la rama del run a `origin`, ejecutado dentro del
 * propio worktree. Solo se llama cuando QA aprueba dentro del límite de intentos — si el run
 * escala, no hay push y el worktree permanece vivo (política de retención de 21 días).
 */
export async function pushRunBranch(worktree: RunWorktree): Promise<void> {
  await execFileAsync("git", ["push", "origin", worktree.branchName], {
    cwd: worktree.worktreePath,
  });
}

export async function assertRunWorktreeAvailable(repoRoot: string, worktree: RunWorktree): Promise<void> {
  await access(worktree.worktreePath);
  await execFileAsync("git", ["rev-parse", "--verify", worktree.branchName], { cwd: repoRoot });
}
