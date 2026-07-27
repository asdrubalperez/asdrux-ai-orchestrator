import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BuildExecutor } from "./buildExecutor.js";

// FEATURE-021: los 3 casos "missing"/"invalid"/"no-script" retornan antes de invocar Docker —
// testeables directamente contra el filesystem real, sin mockear nada. El caso "present" (corre
// `npm run build` de verdad) queda para validación real contra la VPS, mismo criterio que
// TestExecutor (sin tests unitarios propios, validado con Docker real en runtime).

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "build-executor-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("BuildExecutor.runIfNeeded es no-op limpio cuando no existe package.json (ENOENT)", async () => {
  await withTempDir(async (dir) => {
    const result = await new BuildExecutor().runIfNeeded(dir, 5_000);
    assert.deepEqual(result, { ran: false, exitCode: null, stdout: "", stderr: "", timedOut: false });
  });
});

test("BuildExecutor.runIfNeeded es no-op limpio cuando package.json no declara scripts.build", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: {} }));
    const result = await new BuildExecutor().runIfNeeded(dir, 5_000);
    assert.equal(result.ran, false);
  });
});

test("BuildExecutor.runIfNeeded es no-op limpio cuando package.json no tiene scripts en absoluto", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "x" }));
    const result = await new BuildExecutor().runIfNeeded(dir, 5_000);
    assert.equal(result.ran, false);
  });
});

test("BuildExecutor.runIfNeeded trata un package.json corrupto como build fallido, no como no-op (Regla 8)", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, "package.json"), "{ esto no es json");
    const result = await new BuildExecutor().runIfNeeded(dir, 5_000);
    assert.equal(result.ran, true);
    assert.equal(result.exitCode, null);
    assert.match(result.stderr, /no es JSON válido/);
  });
});

test(
  "BuildExecutor.runIfNeeded propaga un error de lectura distinto de ENOENT (no lo trata como 'missing')",
  // ENOTDIR: apuntamos workingDirectory a un archivo (no un directorio) — path.join(...,
  // "package.json") intenta leer "<archivo>/package.json". En POSIX eso falla con ENOTDIR, no
  // ENOENT — confirmado que en Windows el mismo caso da ENOENT (comportamiento de filesystem
  // distinto, no un bug de esta Feature), así que este test específico solo corre en POSIX. El
  // entorno real de despliegue (Docker/VPS, ver docker/developer.Dockerfile) es Linux.
  { skip: process.platform === "win32" ? "ENOTDIR determinista solo en POSIX — Windows da ENOENT para este mismo caso" : false },
  async () => {
    await withTempDir(async (dir) => {
      const notADirectory = path.join(dir, "not-a-directory");
      await writeFile(notADirectory, "contenido");

      await assert.rejects(() => new BuildExecutor().runIfNeeded(notADirectory, 5_000), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as NodeJS.ErrnoException).code, "ENOTDIR");
        return true;
      });
    });
  }
);
