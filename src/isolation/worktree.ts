import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
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
 *
 * FEATURE-026, Regla 17: entorno mínimo por allowlist en vez de heredar `process.env` completo —
 * mismo patrón que `runtimeEnvironment()` en `src/executor/isolated-tools/roleRuntime.ts:176-184`,
 * ya usado para los `docker run` del sistema. `extra` fusiona variables específicas de la
 * operación (p. ej. `GIT_ASKPASS`/el token efímero de `createGitProcessAuth`), pisando el default
 * de `GIT_ASKPASS=echo` cuando corresponde autenticar contra GitHub en nombre de un usuario.
 */
const GIT_PROCESS_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "SystemRoot",
  "windir",
  "LANG",
  "LC_ALL",
] as const;

function gitNoPromptEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" };
  for (const key of GIT_PROCESS_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, ...extra };
}

/**
 * FEATURE-026, sección 7.9/7.10: contrato mínimo que `worktree.ts` acepta para autenticar contra
 * GitHub en nombre de un usuario. Deliberadamente ciego a OAuth/Postgres/cifrado — solo conoce
 * variables de entorno ya resueltas y una función de normalización de URL. La resolución real
 * (`run.owner_id` -> conexión -> token descifrado) vive en `src/auth/gitConnectionService.ts` y se
 * invoca en la capa de aplicación, no acá.
 */
export interface GitProcessAuth {
  authEnv: NodeJS.ProcessEnv;
  cloneUrl(repoUrl: string): string;
}

export interface RunWorktree {
  branchName: string;
  worktreePath: string;
}

export interface GitReadinessSnapshot {
  branch: string;
  headSha: string;
  treeHash: string;
}

export interface BaseBranchSyncResult {
  mergeSha: string;
  remoteSha: string;
  localBaseSha: string;
}

/**
 * Hallazgo de validación en vivo (FEATURE-025-Parte-2): el default anterior derivaba la base de
 * `repoRoot` (`path.resolve(repoRoot, "..", "ai-orchestrator-worktrees")`), asumiendo un `repoRoot`
 * estable de un único repo compartido -- el diseño original de FEATURE-019 (ver 6.2b del
 * documento). En el flujo real "standalone-clone" del web/intake (FEATURE-017), cada run
 * encadenado (reingreso tras escalamiento, continuación tras merge) pasa el `worktreePath` del run
 * PADRE como `repoRoot` del hijo -- y como ese `worktreePath` YA vive dentro de
 * ".../ai-orchestrator-worktrees/<uuid>", el default recalculaba otra vez "hermano de repoRoot",
 * agregando un nivel más de "ai-orchestrator-worktrees" por cada hop de la cadena (confirmado en
 * el VPS: un run con 3 reingresos previos llegó a anidar el nombre 4 veces). Mismo criterio
 * estable que ya usa `cloneRunRepository` más abajo (`RUN_CLONES_BASE_DIR`/`HOME`): independiente
 * de `repoRoot`, nunca compone.
 */
function defaultWorktreesBaseDir(): string {
  return process.env.WORKTREES_BASE_DIR ?? path.resolve(os.homedir(), "ai-orchestrator-case-clones", "ai-orchestrator-worktrees");
}

export async function createRunWorktree(repoRoot: string, runId: string, baseRef = "HEAD"): Promise<RunWorktree> {
  const branchName = `run/${runId}`;
  const worktreesBaseDir = defaultWorktreesBaseDir();
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
export async function pushRunBranch(worktree: RunWorktree, gitAuth?: GitProcessAuth): Promise<void> {
  await execFileAsync("git", ["push", "origin", worktree.branchName], {
    cwd: worktree.worktreePath,
    env: gitNoPromptEnv(gitAuth?.authEnv),
  });
}

export async function gitReadinessSnapshot(worktree: RunWorktree): Promise<GitReadinessSnapshot> {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "orchestrator-git-index-"));
  const temporaryIndex = path.join(temporaryDirectory, "index");
  const env = { ...gitNoPromptEnv(), GIT_INDEX_FILE: temporaryIndex };
  try {
    const [branch, headSha] = await Promise.all([
      execFileAsync("git", ["branch", "--show-current"], { cwd: worktree.worktreePath, env: gitNoPromptEnv() }),
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: worktree.worktreePath, env: gitNoPromptEnv() }),
    ]);
    await execFileAsync("git", ["read-tree", "HEAD"], { cwd: worktree.worktreePath, env });
    await execFileAsync("git", ["add", "-A"], { cwd: worktree.worktreePath, env });
    const tree = await execFileAsync("git", ["write-tree"], { cwd: worktree.worktreePath, env });
    return {
      branch: branch.stdout.trim(),
      headSha: headSha.stdout.trim(),
      treeHash: tree.stdout.trim(),
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function assertFeatureDocsUnchanged(
  worktree: RunWorktree,
  baseCommitSha: string,
  allowedPath?: string
): Promise<void> {
  const [committed, working] = await Promise.all([
    execFileAsync("git", ["diff", "--name-only", `${baseCommitSha}..HEAD`, "--", "docs/features"], {
      cwd: worktree.worktreePath,
      env: gitNoPromptEnv(),
    }),
    execFileAsync("git", ["status", "--porcelain", "--untracked-files=all", "--", "docs/features"], {
      cwd: worktree.worktreePath,
      env: gitNoPromptEnv(),
    }),
  ]);
  const paths = [
    ...committed.stdout.split(/\r?\n/).filter(Boolean),
    ...working.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.slice(3)),
  ].map((value) => value.replaceAll("\\", "/"));
  const unexpected = paths.filter((value) => !allowedPath || value !== allowedPath);
  if (unexpected.length > 0) {
    throw new Error(`Cambios no autorizados bajo docs/features/: ${[...new Set(unexpected)].join(", ")}`);
  }
}

export async function headSha(worktree: RunWorktree): Promise<string> {
  const result = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: worktree.worktreePath,
    env: gitNoPromptEnv(),
  });
  return result.stdout.trim();
}

export async function fileAtCommit(worktree: RunWorktree, commitSha: string, relativePath: string): Promise<string> {
  const result = await execFileAsync("git", ["show", `${commitSha}:${relativePath}`], {
    cwd: worktree.worktreePath,
    env: gitNoPromptEnv(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout;
}

export async function remoteBranchSha(worktree: RunWorktree): Promise<string> {
  const result = await execFileAsync(
    "git",
    ["ls-remote", "--heads", "origin", `refs/heads/${worktree.branchName}`],
    { cwd: worktree.worktreePath, env: gitNoPromptEnv() }
  );
  const sha = result.stdout.trim().split(/\s+/)[0];
  if (!sha) throw new Error(`La rama remota ${worktree.branchName} no existe.`);
  return sha;
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
  /**
   * Hallazgo de validación en vivo (FEATURE-025-Parte-2): a diferencia de pushRunBranch/
   * cloneRunRepository, esta función nunca aceptó gitAuth -- el fetch/push acá abajo corrían con
   * gitNoPromptEnv() sin credencial real, así que dependían por completo de lo que ya hubiera
   * configurado el remote `origin` del worktree (típicamente nada, para un repo privado). GitHub
   * rechazaba el push con "Invalid username or token" -- no era un token vencido, era que nunca se
   * inyectaba ninguno. Sin gitAuth (compatibilidad con el flujo legacy del host), se mantiene el
   * comportamiento previo sin cambios.
   */
  gitAuth?: GitProcessAuth;
}): Promise<BaseBranchSyncResult> {
  // La rama persistente del clon administrado es la base de la siguiente Feature. Antes de
  // integrar, se avanza por fast-forward hasta el estado remoto vigente; después del push se
  // vuelve a avanzar hasta el SHA publicado. Nunca se crea una continuación desde una ref local
  // atrasada.
  await execFileAsync(
    "git",
    [
      "fetch",
      "origin",
      `refs/heads/${params.baseBranch}:refs/remotes/origin/${params.baseBranch}`,
    ],
    { cwd: params.repoRoot, env: gitNoPromptEnv(params.gitAuth?.authEnv) }
  );
  await fastForwardLocalBranch(
    params.repoRoot,
    params.baseBranch,
    `refs/remotes/origin/${params.baseBranch}`
  );
  await assertFeatureBasedOnCurrentBase(
    params.repoRoot,
    params.baseBranch,
    params.featureBranch
  );

  const baseWorktreePath = path.join(defaultWorktreesBaseDir(), `base-${randomUUID()}`);

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
    const mergeSha = (
      await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: baseWorktreePath,
        env: gitNoPromptEnv(),
      })
    ).stdout.trim();
    await execFileAsync("git", ["push", "origin", `HEAD:refs/heads/${params.baseBranch}`], {
      cwd: baseWorktreePath,
      env: gitNoPromptEnv(params.gitAuth?.authEnv),
    });
    const remoteSha = await remoteBranchSha({
      branchName: params.baseBranch,
      worktreePath: params.repoRoot,
    });
    if (remoteSha !== mergeSha) {
      throw new Error(
        `SHA remoto inesperado para ${params.baseBranch}: esperado ${mergeSha}, recibido ${remoteSha}.`
      );
    }

    await fastForwardLocalBranch(params.repoRoot, params.baseBranch, remoteSha);
    const localBaseSha = (
      await execFileAsync("git", ["rev-parse", `refs/heads/${params.baseBranch}`], {
        cwd: params.repoRoot,
        env: gitNoPromptEnv(),
      })
    ).stdout.trim();
    if (localBaseSha !== remoteSha) {
      throw new Error(
        `La base local ${params.baseBranch} no quedó alineada: local ${localBaseSha}, remoto ${remoteSha}.`
      );
    }
    return { mergeSha, remoteSha, localBaseSha };
  } finally {
    await execFileAsync("git", ["worktree", "remove", baseWorktreePath, "--force"], {
      cwd: params.repoRoot,
      env: gitNoPromptEnv(),
    });
  }
}

async function fastForwardLocalBranch(
  repoRoot: string,
  branchName: string,
  targetRef: string
): Promise<void> {
  const checkedOutPath = await worktreeForBranch(repoRoot, branchName);
  if (checkedOutPath) {
    const status = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: checkedOutPath,
      env: gitNoPromptEnv(),
    });
    if (status.stdout.trim()) {
      throw new Error(
        `No se puede actualizar la base local ${branchName}: su worktree tiene cambios locales.`
      );
    }
    await execFileAsync("git", ["merge", "--ff-only", targetRef], {
      cwd: checkedOutPath,
      env: gitNoPromptEnv(),
    });
    return;
  }

  await execFileAsync("git", ["merge-base", "--is-ancestor", branchName, targetRef], {
    cwd: repoRoot,
    env: gitNoPromptEnv(),
  });
  await execFileAsync("git", ["branch", "-f", branchName, targetRef], {
    cwd: repoRoot,
    env: gitNoPromptEnv(),
  });
}

async function assertFeatureBasedOnCurrentBase(
  repoRoot: string,
  baseBranch: string,
  featureBranch: string
): Promise<void> {
  const [base, commonBase] = await Promise.all([
    execFileAsync("git", ["rev-parse", `refs/heads/${baseBranch}`], {
      cwd: repoRoot,
      env: gitNoPromptEnv(),
    }),
    execFileAsync("git", ["merge-base", baseBranch, featureBranch], {
      cwd: repoRoot,
      env: gitNoPromptEnv(),
    }),
  ]);
  const baseSha = base.stdout.trim();
  const commonBaseSha = commonBase.stdout.trim();
  if (baseSha !== commonBaseSha) {
    throw new Error(
      `La rama base ${baseBranch} avanzó desde que comenzó ${featureBranch}; ` +
        "se requiere integrar la base actual y repetir build/QA antes del merge."
    );
  }
}

async function worktreeForBranch(repoRoot: string, branchName: string): Promise<string | null> {
  const result = await execFileAsync("git", ["worktree", "list", "--porcelain", "-z"], {
    cwd: repoRoot,
    env: gitNoPromptEnv(),
  });
  let currentWorktree: string | null = null;
  for (const field of result.stdout.split("\0")) {
    if (field.startsWith("worktree ")) {
      currentWorktree = field.slice("worktree ".length);
      continue;
    }
    if (field === `branch refs/heads/${branchName}`) return currentWorktree;
  }
  return null;
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
 * Credencial git: por defecto (sin `gitAuth`), la misma configuración ambiente de git del
 * host/VPS que ya usa `pushRunBranch` para push a `origin` (SSH agent / credential helper ya
 * configurado) -- flujo legacy, sin cambios. FEATURE-026 agrega `gitAuth` como parámetro opcional:
 * cuando el caller lo provee (`src/auth/gitConnectionService.ts:createGitProcessAuth`), el clon
 * usa la conexión GitHub del owner del run en vez de la identidad global del host. Sin `gitAuth`,
 * el comportamiento es exactamente el de antes -- este archivo no decide cuándo corresponde cada
 * modo, eso es responsabilidad del caller (ver Regla 32, modo `user_oauth` vs `server_legacy`).
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
  gitAuth?: GitProcessAuth;
}): Promise<RunWorktree> {
  const branchName = `run/${params.runId}`;
  const clonesBaseDir = process.env.RUN_CLONES_BASE_DIR ?? path.resolve(os.homedir(), "ai-orchestrator-case-clones");
  const worktreePath = path.join(clonesBaseDir, params.runId);
  const cloneUrl = params.gitAuth ? params.gitAuth.cloneUrl(params.repoUrl) : normalizeGitCloneUrl(params.repoUrl);

  try {
    // Confirmado en una corrida real (2026-07-25): sin esto, un repo privado/inexistente-pero-
    // indistinguible-de-privado deja a `git clone` colgado esperando credenciales interactivas
    // ("Username for 'https://github.com':") — nunca falla, nunca resuelve, bloquea el request
    // HTTP para siempre. GIT_TERMINAL_PROMPT=0 hace que git falle al instante en vez de esperar
    // input que nunca va a llegar (proceso no interactivo, sin terminal real); GIT_ASKPASS=echo
    // bloquea también cualquier askpass gráfico configurado en el host como vía alternativa.
    // FEATURE-026: antes este env se armaba inline (bug lateral encontrado en la validación
    // técnica -- duplicaba `gitNoPromptEnv()` sin usarla). Ahora reusa la misma función que el
    // resto del archivo, así el fix del allowlist (Regla 17) y la inyección de `gitAuth` aplican
    // acá también, no solo en las otras funciones.
    await execFileAsync(
      "git",
      ["clone", "--branch", params.baseRef, "--single-branch", cloneUrl, worktreePath],
      { env: gitNoPromptEnv(params.gitAuth?.authEnv) }
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
