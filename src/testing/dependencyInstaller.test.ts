import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DependencyInstaller } from "./dependencyInstaller.js";

// FEATURE-032: mismo criterio que buildExecutor.test.ts — los casos que retornan antes de invocar
// Docker son testeables directamente contra el filesystem real, sin mockear nada. El camino real
// de "npm ci"/"npm install" (que sí invoca Docker) queda para validación real contra la VPS, mismo
// criterio que BuildExecutor/TestExecutor.

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dependency-installer-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("DependencyInstaller.installIfNeeded es no-op limpio cuando no existe package.json (ENOENT)", async () => {
  await withTempDir(async (dir) => {
    const result = await new DependencyInstaller().installIfNeeded(dir, 5_000);
    assert.deepEqual(result, { ran: false, command: null, exitCode: null, stdout: "", stderr: "", timedOut: false });
  });
});

test("DependencyInstaller.installIfNeeded es no-op cuando package.json no declara dependencias instalables", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { build: "tsc" } }));
    const result = await new DependencyInstaller().installIfNeeded(dir, 5_000);
    assert.equal(result.ran, false);
  });
});

test("DependencyInstaller.installIfNeeded es no-op cuando solo declara peerDependencies (Regla 8)", async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "x", peerDependencies: { react: "^19.0.0" } })
    );
    const result = await new DependencyInstaller().installIfNeeded(dir, 5_000);
    assert.equal(result.ran, false);
  });
});

test("DependencyInstaller.installIfNeeded trata un package.json corrupto como fallo, no como no-op (Regla 7)", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, "package.json"), "{ esto no es json");
    const result = await new DependencyInstaller().installIfNeeded(dir, 5_000);
    assert.equal(result.ran, true);
    assert.equal(result.command, null);
    assert.equal(result.exitCode, null);
    assert.match(result.stderr, /no es JSON válido/);
  });
});

test(
  "DependencyInstaller.installIfNeeded propaga un error de lectura distinto de ENOENT",
  { skip: process.platform === "win32" ? "ENOTDIR determinista solo en POSIX — Windows da ENOENT para este mismo caso" : false },
  async () => {
    await withTempDir(async (dir) => {
      const notADirectory = path.join(dir, "not-a-directory");
      await writeFile(notADirectory, "contenido");

      await assert.rejects(() => new DependencyInstaller().installIfNeeded(notADirectory, 5_000), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as NodeJS.ErrnoException).code, "ENOTDIR");
        return true;
      });
    });
  }
);
