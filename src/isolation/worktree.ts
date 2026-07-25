import { execFile } from "node:child_process";
import { access, rm } from "node:fs/promises";
import os from "node:os";
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

/**
 * FEATURE-017, hallazgo de la prueba end-to-end del owner (2026-07-25): el repositorio/rama que
 * el usuario escribe en el intake pasa a ser el repo de trabajo real (antes era solo texto de
 * contexto para el Architect, ignorado por el pipeline real). Cada caso clona su propia copia
 * aislada — nunca un `git worktree add` sobre un repo de proyecto ya clonado y compartido, a
 * diferencia de `createRunWorktree` — porque dos casos pueden apuntar al mismo repo/rama y no
 * deben compartir working tree. Si el clonado o el checkout de la rama fallan (repo inexistente,
 * rama inexistente, sin permisos), se corta acá — antes de invocar al Architect — con un error
 * explícito de infraestructura, nunca un problema de negocio para que el agente lo note.
 *
 * Credencial git: ninguna nueva — se asume la misma configuración ambiente de git del host/VPS
 * que ya usa `pushRunBranch` para push a `origin` (SSH agent / credential helper ya configurado).
 * No se introduce manejo de tokens/API keys de git en esta función.
 */
export class RunRepoCloneError extends Error {}

export async function cloneRunRepository(params: {
  runId: string;
  repoUrl: string;
  baseRef: string;
}): Promise<RunWorktree> {
  const branchName = `run/${params.runId}`;
  const clonesBaseDir = process.env.RUN_CLONES_BASE_DIR ?? path.resolve(os.homedir(), "ai-orchestrator-case-clones");
  const worktreePath = path.join(clonesBaseDir, params.runId);

  try {
    await execFileAsync("git", ["clone", "--branch", params.baseRef, "--single-branch", params.repoUrl, worktreePath]);
  } catch (err) {
    throw new RunRepoCloneError(
      `No se pudo clonar "${params.repoUrl}" en la rama "${params.baseRef}": ${(err as Error).message}`
    );
  }

  try {
    await execFileAsync("git", ["checkout", "-b", branchName], { cwd: worktreePath });
  } catch (err) {
    await rm(worktreePath, { recursive: true, force: true });
    throw new RunRepoCloneError(
      `Clon de "${params.repoUrl}" exitoso, pero no se pudo crear la rama "${branchName}": ${(err as Error).message}`
    );
  }

  return { branchName, worktreePath };
}

/**
 * Contraparte de `removeRunWorktree` para clones aislados (no worktrees linkeados a un repo
 * compartido) — no hay `git worktree remove`/`git branch -D` que correr contra ningún repoRoot,
 * el clon completo es del run.
 */
export async function removeRunClone(worktree: RunWorktree): Promise<void> {
  await rm(worktree.worktreePath, { recursive: true, force: true });
}
