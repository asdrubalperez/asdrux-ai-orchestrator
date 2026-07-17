import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Mecanismo confirmado en FEATURE-002 (docs/features/FEATURE-002-spike-results.md):
// una rama + git worktree real por run, fuera del checkout principal.

export interface RunWorktree {
  branchName: string;
  worktreePath: string;
}

export async function createRunWorktree(repoRoot: string, runId: string): Promise<RunWorktree> {
  const branchName = `run/${runId}`;
  const worktreesBaseDir = process.env.WORKTREES_BASE_DIR ?? path.resolve(repoRoot, "..", "ai-orchestrator-worktrees");
  const worktreePath = path.join(worktreesBaseDir, runId);

  await execFileAsync("git", ["worktree", "add", "-b", branchName, worktreePath, "HEAD"], {
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
