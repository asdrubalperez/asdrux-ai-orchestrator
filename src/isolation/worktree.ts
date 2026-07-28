import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Mecanismo confirmado en FEATURE-002 (docs/features/FEATURE-002-spike-results.md):
// una rama + git worktree real por run, fuera del checkout principal.

/**
 * fix/merge-approval-atomicity: sin esto, cualquier operación git que necesite input interactivo
 * (confirmación de host SSH nueva, prompt de credencial) queda colgada para siempre en un proceso
 * no interactivo — sin error, sin timeout, sin más output (síntoma real observado: aprobación de
 * merge de Modo Manual que nunca completó ni falló, `respondService.ts`, `respondMergeApproval`).
 * `GIT_TERMINAL_PROMPT=0` hace que git falle al instante en vez de esperar input que nunca va a
 * llegar; `GIT_ASKPASS=echo` bloquea también cualquier askpass gráfico configurado en el host.
 * Antes de este fix, solo `cloneRunRepository` (más abajo) lo tenía — hallazgo real de FEATURE-017
 * que no se había propagado al resto de las funciones de este archivo.
 */
function gitNoPromptEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" };
}

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
    env: gitNoPromptEnv(),
  });

  return { branchName, worktreePath };
}

export async function removeRunWorktree(repoRoot: string, worktree: RunWorktree): Promise<void> {
  await execFileAsync("git", ["worktree", "remove", worktree.worktreePath, "--force"], {
    cwd: repoRoot,
    env: gitNoPromptEnv(),
  });
  await execFileAsync("git", ["branch", "-D", worktree.branchName], { cwd: repoRoot, env: gitNoPromptEnv() });
}

/**
 * Commitea los cambios reales que Developer escribió en el worktree (workspace-write no commitea
 * por sí solo — escribir archivos y dejarlos en git status no es lo mismo que persistirlos en la
 * rama). Se llama antes de pushRunBranch; sin esto, `git worktree remove --force` descarta el
 * trabajo no commiteado silenciosamente (hallazgo real de FEATURE-005, corregido acá).
 * No-op (sin error) si no hay cambios para commitear.
 */
export async function commitAllChanges(worktree: RunWorktree, message: string): Promise<boolean> {
  const status = await execFileAsync("git", ["status", "--porcelain"], {
    cwd: worktree.worktreePath,
    env: gitNoPromptEnv(),
  });
  if (!status.stdout.trim()) {
    return false;
  }

  await execFileAsync("git", ["add", "-A"], { cwd: worktree.worktreePath, env: gitNoPromptEnv() });
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
    { cwd: worktree.worktreePath, env: gitNoPromptEnv() }
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
    env: gitNoPromptEnv(),
  });
}

/**
 * FEATURE-019: mergea la sub-rama ya pusheada de una Feature contra la rama base del release, y
 * pushea la rama base actualizada. La rama base nunca tiene su propio worktree persistente (a
 * diferencia de `run/<id>`, que sí vive en `createRunWorktree`) — se crea uno efímero puntual para
 * el merge y se borra enseguida.
 *
 * Hallazgo real (verificado contra git, no solo en diseño): checkoutear `baseBranch` tal cual (sin
 * `--detach`) revienta con "already used by worktree" en cuanto esa rama ya está checked out en
 * OTRO worktree del mismo repo — algo que pasa seguido en la práctica, no es un edge case: el clon
 * compartido original de un proyecto (`project.repo_path`, estrategia "shared-worktree") queda
 * checked out en su rama default para siempre, y esa rama default suele ser exactamente
 * `ramaBaseTrabajo` (default "main", FEATURE-017 Regla 4). Por eso el worktree efímero se crea
 * `--detach` (apunta al commit de `baseBranch`, no a la rama en sí — no colisiona con nada) y el
 * push usa el refspec explícito `HEAD:refs/heads/<baseBranch>` en vez de `git push origin
 * <baseBranch>` (que asume una rama local con ese nombre checked out, inexistente en detached
 * HEAD).
 */
export async function mergeFeatureBranchIntoBase(params: {
  repoRoot: string;
  baseBranch: string;
  featureBranch: string;
}): Promise<void> {
  const baseWorktreePath = path.join(
    process.env.WORKTREES_BASE_DIR ?? path.resolve(params.repoRoot, "..", "ai-orchestrator-worktrees"),
    `base-${randomUUID()}`
  );

  await execFileAsync("git", ["worktree", "add", "--detach", baseWorktreePath, params.baseBranch], {
    cwd: params.repoRoot,
    env: gitNoPromptEnv(),
  });
  try {
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=ai-orchestrator-bot",
        "-c",
        "user.email=ai-orchestrator-bot@localhost",
        "merge",
        "--no-ff",
        params.featureBranch,
        "-m",
        `merge: ${params.featureBranch} -> ${params.baseBranch}`,
      ],
      { cwd: baseWorktreePath, env: gitNoPromptEnv() }
    );
    await execFileAsync("git", ["push", "origin", `HEAD:refs/heads/${params.baseBranch}`], {
      cwd: baseWorktreePath,
      env: gitNoPromptEnv(),
    });
  } finally {
    await execFileAsync("git", ["worktree", "remove", baseWorktreePath, "--force"], {
      cwd: params.repoRoot,
      env: gitNoPromptEnv(),
    });
  }
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

// FEATURE-017, hallazgo de una corrida real (2026-07-25): el usuario suele escribir el repo en
// el intake como URL https (la forma que copia del navegador), pero la VPS solo tiene configurada
// una clave SSH — https siempre termina pidiendo credenciales interactivas (o colgado, ver el fix
// de GIT_TERMINAL_PROMPT más abajo). Se normaliza a SSH antes de clonar para reusar esa clave ya
// configurada. Si la URL ya viene en formato SSH (o apunta a otro host), se deja tal cual — solo
// se resuelve GitHub por ahora, no hace falta generalizar a otros hosts para esta Feature.
export function normalizeGitCloneUrl(repoUrl: string): string {
  const httpsGithubMatch = repoUrl
    .trim()
    .match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?\/?$/i);
  if (!httpsGithubMatch) return repoUrl.trim();

  const [, owner, repo] = httpsGithubMatch;
  return `git@github.com:${owner}/${repo}.git`;
}

export async function cloneRunRepository(params: {
  runId: string;
  repoUrl: string;
  baseRef: string;
}): Promise<RunWorktree> {
  const branchName = `run/${params.runId}`;
  const clonesBaseDir = process.env.RUN_CLONES_BASE_DIR ?? path.resolve(os.homedir(), "ai-orchestrator-case-clones");
  const worktreePath = path.join(clonesBaseDir, params.runId);
  const cloneUrl = normalizeGitCloneUrl(params.repoUrl);

  try {
    // Confirmado en una corrida real (2026-07-25): sin esto, un repo privado/inexistente-pero-
    // indistinguible-de-privado deja a `git clone` colgado esperando credenciales interactivas
    // ("Username for 'https://github.com':") — nunca falla, nunca resuelve, bloquea el request
    // HTTP para siempre. GIT_TERMINAL_PROMPT=0 hace que git falle al instante en vez de esperar
    // input que nunca va a llegar (proceso no interactivo, sin terminal real); GIT_ASKPASS=echo
    // bloquea también cualquier askpass gráfico configurado en el host como vía alternativa.
    await execFileAsync(
      "git",
      ["clone", "--branch", params.baseRef, "--single-branch", cloneUrl, worktreePath],
      { env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" } }
    );
  } catch (err) {
    throw new RunRepoCloneError(
      `No se pudo clonar "${cloneUrl}" en la rama "${params.baseRef}": ${(err as Error).message}`
    );
  }

  try {
    // checkout -b opera enteramente local sobre el clon ya hecho — sin acceso a red, sin riesgo
    // de prompt de credenciales; no necesita el mismo env.
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
