import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  createRunWorktree,
  gitReadinessSnapshot,
  mergeFeatureBranchIntoBase,
  normalizeGitCloneUrl,
} from "./worktree.js";

const execFileAsync = promisify(execFile);

test("normalizeGitCloneUrl convierte https de GitHub a SSH", () => {
  assert.equal(normalizeGitCloneUrl("https://github.com/owner/repo"), "git@github.com:owner/repo.git");
  assert.equal(normalizeGitCloneUrl("https://github.com/owner/repo.git"), "git@github.com:owner/repo.git");
  assert.equal(normalizeGitCloneUrl("https://github.com/owner/repo/"), "git@github.com:owner/repo.git");
});

test("normalizeGitCloneUrl deja intacta una URL SSH ya existente", () => {
  assert.equal(normalizeGitCloneUrl("git@github.com:owner/repo.git"), "git@github.com:owner/repo.git");
});

test("normalizeGitCloneUrl deja intactas URLs de otros hosts", () => {
  assert.equal(normalizeGitCloneUrl("https://gitlab.com/owner/repo"), "https://gitlab.com/owner/repo");
  assert.equal(normalizeGitCloneUrl("https://example.com/owner/repo.git"), "https://example.com/owner/repo.git");
});

test("normalizeGitCloneUrl recorta espacios sin alterar el resto", () => {
  assert.equal(normalizeGitCloneUrl("  https://github.com/owner/repo  "), "git@github.com:owner/repo.git");
});

test("gitReadinessSnapshot incluye tracked, unstaged y untracked sin modificar el índice real", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "readiness-snapshot-"));
  try {
    await execFileAsync("git", ["init", "-b", "main"], { cwd: tmp });
    await fs.writeFile(path.join(tmp, "tracked.txt"), "base\n");
    await execFileAsync("git", ["add", "tracked.txt"], { cwd: tmp });
    await execFileAsync("git", [...GIT_IDENTITY, "commit", "-m", "initial"], { cwd: tmp });
    await fs.writeFile(path.join(tmp, "tracked.txt"), "changed\n");
    await fs.writeFile(path.join(tmp, "untracked.txt"), "new\n");

    const beforeStatus = await execFileAsync("git", ["status", "--porcelain"], { cwd: tmp });
    const first = await gitReadinessSnapshot({ branchName: "ignored", worktreePath: tmp });
    const afterStatus = await execFileAsync("git", ["status", "--porcelain"], { cwd: tmp });
    assert.equal(first.branch, "main");
    assert.equal(beforeStatus.stdout, afterStatus.stdout);

    await fs.writeFile(path.join(tmp, "untracked.txt"), "newer\n");
    const second = await gitReadinessSnapshot({ branchName: "ignored", worktreePath: tmp });
    assert.notEqual(first.treeHash, second.treeHash);
    assert.equal(first.headSha, second.headSha);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

const GIT_IDENTITY = ["-c", "user.name=test", "-c", "user.email=test@localhost"];

/**
 * FEATURE-019, hallazgo de cierre — dos bugs reales, verificados contra git real, no solo en
 * diseño:
 *
 * 1. Bug preexistente de FEATURE-018: `respondToEscalation` (y, sin este arreglo, la continuación
 *    de FEATURE-019) derivaba `repoRoot` de `path.resolve(run_started.repoPath)`, que para un run
 *    creado vía el flujo real de intake ("standalone-clone", FEATURE-017) es la URL de git del
 *    caso, no una ruta de filesystem — `path.resolve` sobre eso no tira, produce una ruta
 *    inexistente que rompía en el primer comando git.
 * 2. Bug propio de `mergeFeatureBranchIntoBase` (FEATURE-019): checkoutear `baseBranch` tal cual
 *    (sin `--detach`) revienta con "already used by worktree" en cuanto esa rama ya está checked
 *    out en OTRO worktree del mismo repo — el caso común, no un edge case: el clon compartido
 *    original de un proyecto (`project.repo_path`, estrategia "shared-worktree") queda checked out
 *    en su rama default para siempre, y esa rama default suele ser exactamente `ramaBaseTrabajo`
 *    (default "main").
 *
 * No hay DB en esta suite de tests (ningún test del repo toca Postgres), así que no se puede
 * invocar `respondToEscalation` en sí — este test ejercita, contra un repo git real, el escenario
 * de producción más común que ejercita ambos bugs a la vez: un clon "raíz" (`rootClone`, hace de
 * `project.repo_path`) que se queda checked out en la misma rama que es la base del release, y el
 * merge disparándose usando el propio worktree de la Feature ya aprobada como `repoRoot` — nunca
 * `rootClone` ni ninguna URL — exactamente el mismo valor que ahora usan `respondService.ts`
 * (`parentWorktree.worktreePath`) y `runStart.ts` (`worktree.worktreePath`).
 */
test("mergeFeatureBranchIntoBase mergea y pushea usando el worktree de la Feature como repoRoot, incluso con la rama base ya checked out en el clon raíz compartido", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-merge-"));
  const originPath = path.join(tmp, "origin.git");
  const rootClonePath = path.join(tmp, "root-clone");
  const originalWorktreesBaseDir = process.env.WORKTREES_BASE_DIR;
  process.env.WORKTREES_BASE_DIR = path.join(tmp, "worktrees");

  try {
    await execFileAsync("git", ["init", "--bare", "-b", "main", originPath]);

    // `rootClonePath` hace de `project.repo_path` (estrategia "shared-worktree") — se clona una
    // vez y queda checked out en "main" para siempre, mismo patrón real: todos los runs del
    // proyecto reusan este mismo clon vía `createRunWorktree`, sin tocar su propio checkout.
    await execFileAsync("git", ["clone", originPath, rootClonePath]);
    await fs.writeFile(path.join(rootClonePath, "README.md"), "hola\n");
    await execFileAsync("git", ["add", "-A"], { cwd: rootClonePath });
    await execFileAsync("git", [...GIT_IDENTITY, "commit", "-m", "chore: initial"], { cwd: rootClonePath });
    await execFileAsync("git", ["push", "origin", "main"], { cwd: rootClonePath });

    const featureWorktree = await createRunWorktree(rootClonePath, "feature-run-1", "main");
    await fs.writeFile(path.join(featureWorktree.worktreePath, "feature.txt"), "contenido de la feature\n");
    await execFileAsync("git", ["add", "-A"], { cwd: featureWorktree.worktreePath });
    await execFileAsync("git", [...GIT_IDENTITY, "commit", "-m", "feat: feature"], {
      cwd: featureWorktree.worktreePath,
    });
    await execFileAsync("git", ["push", "origin", featureWorktree.branchName], {
      cwd: featureWorktree.worktreePath,
    });

    // `rootClonePath` sigue en "main" en este punto — confirma el escenario real que rompía antes.
    const rootBranch = await execFileAsync("git", ["branch", "--show-current"], { cwd: rootClonePath });
    assert.equal(rootBranch.stdout.trim(), "main");

    // El punto central del arreglo: `repoRoot` es el worktree de la Feature ya aprobada, no
    // `rootClonePath` ni ninguna URL — y el merge no revienta aunque "main" siga checked out ahí.
    const merged = await mergeFeatureBranchIntoBase({
      repoRoot: featureWorktree.worktreePath,
      baseBranch: "main",
      featureBranch: featureWorktree.branchName,
    });

    const verifyClone = path.join(tmp, "verify");
    await execFileAsync("git", ["clone", originPath, verifyClone]);
    const content = await fs.readFile(path.join(verifyClone, "feature.txt"), "utf8");
    assert.equal(content.replace(/\r\n/g, "\n"), "contenido de la feature\n");
    const localBase = await execFileAsync("git", ["rev-parse", "main"], { cwd: rootClonePath });
    assert.equal(localBase.stdout.trim(), merged.remoteSha);
    assert.equal(merged.localBaseSha, merged.remoteSha);
  } finally {
    if (originalWorktreesBaseDir === undefined) delete process.env.WORKTREES_BASE_DIR;
    else process.env.WORKTREES_BASE_DIR = originalWorktreesBaseDir;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("cada Feature siguiente nace desde la base local sincronizada con el merge remoto anterior", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-sequential-features-"));
  const originPath = path.join(tmp, "origin.git");
  const rootClonePath = path.join(tmp, "root-clone");
  const originalWorktreesBaseDir = process.env.WORKTREES_BASE_DIR;
  process.env.WORKTREES_BASE_DIR = path.join(tmp, "worktrees");

  try {
    await execFileAsync("git", ["init", "--bare", "-b", "main", originPath]);
    await execFileAsync("git", ["clone", originPath, rootClonePath]);
    await fs.writeFile(path.join(rootClonePath, "README.md"), "base\n");
    await execFileAsync("git", ["add", "-A"], { cwd: rootClonePath });
    await execFileAsync("git", [...GIT_IDENTITY, "commit", "-m", "chore: initial"], {
      cwd: rootClonePath,
    });
    await execFileAsync("git", ["push", "origin", "main"], { cwd: rootClonePath });
    await execFileAsync("git", ["checkout", "-b", "run/root"], { cwd: rootClonePath });

    const featureOne = await createRunWorktree(rootClonePath, "sequential-1", "main");
    await fs.writeFile(path.join(featureOne.worktreePath, "feature-one.txt"), "uno\n");
    await execFileAsync("git", ["add", "-A"], { cwd: featureOne.worktreePath });
    await execFileAsync("git", [...GIT_IDENTITY, "commit", "-m", "feat: one"], {
      cwd: featureOne.worktreePath,
    });
    await execFileAsync("git", ["push", "origin", featureOne.branchName], {
      cwd: featureOne.worktreePath,
    });
    const firstMerge = await mergeFeatureBranchIntoBase({
      repoRoot: featureOne.worktreePath,
      baseBranch: "main",
      featureBranch: featureOne.branchName,
    });

    const featureTwo = await createRunWorktree(rootClonePath, "sequential-2", "main");
    const featureTwoBase = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: featureTwo.worktreePath,
    });
    assert.equal(featureTwoBase.stdout.trim(), firstMerge.remoteSha);

    await fs.writeFile(path.join(featureTwo.worktreePath, "feature-two.txt"), "dos\n");
    await execFileAsync("git", ["add", "-A"], { cwd: featureTwo.worktreePath });
    await execFileAsync("git", [...GIT_IDENTITY, "commit", "-m", "feat: two"], {
      cwd: featureTwo.worktreePath,
    });
    await execFileAsync("git", ["push", "origin", featureTwo.branchName], {
      cwd: featureTwo.worktreePath,
    });
    const secondMerge = await mergeFeatureBranchIntoBase({
      repoRoot: featureTwo.worktreePath,
      baseBranch: "main",
      featureBranch: featureTwo.branchName,
    });

    const verifyClone = path.join(tmp, "verify");
    await execFileAsync("git", ["clone", originPath, verifyClone]);
    assert.equal(
      (await fs.readFile(path.join(verifyClone, "feature-one.txt"), "utf8")).replace(/\r\n/g, "\n"),
      "uno\n"
    );
    assert.equal(
      (await fs.readFile(path.join(verifyClone, "feature-two.txt"), "utf8")).replace(/\r\n/g, "\n"),
      "dos\n"
    );
    const localBase = await execFileAsync("git", ["rev-parse", "main"], { cwd: rootClonePath });
    assert.equal(localBase.stdout.trim(), secondMerge.remoteSha);
  } finally {
    if (originalWorktreesBaseDir === undefined) delete process.env.WORKTREES_BASE_DIR;
    else process.env.WORKTREES_BASE_DIR = originalWorktreesBaseDir;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// La sincronización preventiva no autoriza integrar silenciosamente una base que avanzó durante
// Development: actualiza la única base local, pero exige nueva integración y validación.
test("si origin/base avanzó durante una Feature, sincroniza la base local y rechaza el merge antes del push", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-base-advanced-"));
  const originPath = path.join(tmp, "origin.git");
  const rootClonePath = path.join(tmp, "root-clone");
  const externalClonePath = path.join(tmp, "external-clone");
  const originalWorktreesBaseDir = process.env.WORKTREES_BASE_DIR;
  process.env.WORKTREES_BASE_DIR = path.join(tmp, "worktrees");

  try {
    await execFileAsync("git", ["init", "--bare", "-b", "main", originPath]);
    await execFileAsync("git", ["clone", originPath, rootClonePath]);
    await fs.writeFile(path.join(rootClonePath, "README.md"), "base\n");
    await execFileAsync("git", ["add", "-A"], { cwd: rootClonePath });
    await execFileAsync("git", [...GIT_IDENTITY, "commit", "-m", "chore: initial"], {
      cwd: rootClonePath,
    });
    await execFileAsync("git", ["push", "origin", "main"], { cwd: rootClonePath });

    const feature = await createRunWorktree(rootClonePath, "base-advanced", "main");
    await fs.writeFile(path.join(feature.worktreePath, "feature.txt"), "feature\n");
    await execFileAsync("git", ["add", "-A"], { cwd: feature.worktreePath });
    await execFileAsync("git", [...GIT_IDENTITY, "commit", "-m", "feat: stale feature"], {
      cwd: feature.worktreePath,
    });
    await execFileAsync("git", ["push", "origin", feature.branchName], {
      cwd: feature.worktreePath,
    });

    await execFileAsync("git", ["clone", originPath, externalClonePath]);
    await fs.writeFile(path.join(externalClonePath, "external.txt"), "avance externo\n");
    await execFileAsync("git", ["add", "-A"], { cwd: externalClonePath });
    await execFileAsync("git", [...GIT_IDENTITY, "commit", "-m", "feat: external advance"], {
      cwd: externalClonePath,
    });
    await execFileAsync("git", ["push", "origin", "main"], { cwd: externalClonePath });
    const remoteBefore = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: externalClonePath,
    });

    await assert.rejects(
      () =>
        mergeFeatureBranchIntoBase({
          repoRoot: feature.worktreePath,
          baseBranch: "main",
          featureBranch: feature.branchName,
        }),
      /avanzó desde que comenzó.*repetir build\/QA/
    );

    const localBase = await execFileAsync("git", ["rev-parse", "main"], { cwd: rootClonePath });
    assert.equal(localBase.stdout.trim(), remoteBefore.stdout.trim());
    const remoteAfter = await execFileAsync("git", ["ls-remote", "--heads", "origin", "main"], {
      cwd: rootClonePath,
    });
    assert.equal(remoteAfter.stdout.trim().split(/\s+/)[0], remoteBefore.stdout.trim());
  } finally {
    if (originalWorktreesBaseDir === undefined) delete process.env.WORKTREES_BASE_DIR;
    else process.env.WORKTREES_BASE_DIR = originalWorktreesBaseDir;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

/**
 * fix/merge-approval-atomicity: un fallo real debe propagarse antes de que respondService marque
 * el run como resolved. Este test conserva esa precondición sin depender de PostgreSQL.
 */
test("mergeFeatureBranchIntoBase lanza una excepción real cuando la rama de la Feature no existe (precondición del fix de atomicidad de aprobación de merge)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-merge-fail-"));
  const originPath = path.join(tmp, "origin.git");
  const rootClonePath = path.join(tmp, "root-clone");
  const originalWorktreesBaseDir = process.env.WORKTREES_BASE_DIR;
  process.env.WORKTREES_BASE_DIR = path.join(tmp, "worktrees");

  try {
    await execFileAsync("git", ["init", "--bare", "-b", "main", originPath]);
    await execFileAsync("git", ["clone", originPath, rootClonePath]);
    await fs.writeFile(path.join(rootClonePath, "README.md"), "hola\n");
    await execFileAsync("git", ["add", "-A"], { cwd: rootClonePath });
    await execFileAsync("git", [...GIT_IDENTITY, "commit", "-m", "chore: initial"], { cwd: rootClonePath });
    await execFileAsync("git", ["push", "origin", "main"], { cwd: rootClonePath });

    await assert.rejects(() =>
      mergeFeatureBranchIntoBase({
        repoRoot: rootClonePath,
        baseBranch: "main",
        featureBranch: "run/rama-que-no-existe",
      })
    );
  } finally {
    if (originalWorktreesBaseDir === undefined) delete process.env.WORKTREES_BASE_DIR;
    else process.env.WORKTREES_BASE_DIR = originalWorktreesBaseDir;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
