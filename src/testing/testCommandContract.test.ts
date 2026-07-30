import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateTestCommandContract } from "./testCommandContract.js";

// FEATURE-029: mismo criterio que buildExecutor.test.ts — casos testeables directamente contra el
// filesystem real, sin mockear nada ni levantar Docker.

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "test-command-contract-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("node --test: acepta una ruta explícita que existe", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, "example.test.js"), "// test");
    const result = await validateTestCommandContract({ executable: "node", args: ["--test", "example.test.js"] }, dir);
    assert.deepEqual(result, { valid: true });
  });
});

test("node --test: rechaza una ruta que no existe después del build", async () => {
  await withTempDir(async (dir) => {
    const result = await validateTestCommandContract(
      { executable: "node", args: ["--test", "dist/missing.test.js"] },
      dir
    );
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.reason, /no existe después del build/);
  });
});

test("node --test: rechaza una ruta que resuelve fuera del worktree", async () => {
  await withTempDir(async (dir) => {
    const result = await validateTestCommandContract(
      { executable: "node", args: ["--test", "../fuera-del-worktree.test.js"] },
      dir
    );
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.reason, /fuera del worktree/);
  });
});

test("node --test: rechaza una ruta absoluta", async () => {
  await withTempDir(async (dir) => {
    const absolute = path.join(dir, "example.test.js");
    await writeFile(absolute, "// test");
    const result = await validateTestCommandContract({ executable: "node", args: ["--test", absolute] }, dir);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.reason, /ruta absoluta/);
  });
});

test("node --test: rechaza cuando la ruta es un directorio, no un archivo", async () => {
  await withTempDir(async (dir) => {
    await mkdir(path.join(dir, "dist"));
    const result = await validateTestCommandContract({ executable: "node", args: ["--test", "dist"] }, dir);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.reason, /no es un archivo/);
  });
});

test("node --test: no confunde flags (empiezan con -) con rutas candidatas", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, "example.test.js"), "// test");
    const result = await validateTestCommandContract(
      { executable: "node", args: ["--test", "--test-name-pattern=foo", "example.test.js"] },
      dir
    );
    assert.deepEqual(result, { valid: true });
  });
});

test("node --test: valida múltiples rutas explícitas, todas deben existir", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, "a.test.js"), "// test");
    const result = await validateTestCommandContract(
      { executable: "node", args: ["--test", "a.test.js", "b.test.js"] },
      dir
    );
    assert.equal(result.valid, false);
  });
});

test("npm test: acepta cuando package.json define scripts.test", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test dist" } }));
    const result = await validateTestCommandContract({ executable: "npm", args: ["test"] }, dir);
    assert.deepEqual(result, { valid: true });
  });
});

test("npm run <script>: acepta cuando el script nombrado existe", async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { "test:unit": "node --test dist/unit" } })
    );
    const result = await validateTestCommandContract({ executable: "npm", args: ["run", "test:unit"] }, dir);
    assert.deepEqual(result, { valid: true });
  });
});

test("npm run <script>: rechaza cuando el script no existe en package.json", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: {} }));
    const result = await validateTestCommandContract({ executable: "npm", args: ["run", "test:unit"] }, dir);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.reason, /no lo define en "scripts"/);
  });
});

test("npm test: rechaza cuando no hay package.json", async () => {
  await withTempDir(async (dir) => {
    const result = await validateTestCommandContract({ executable: "npm", args: ["test"] }, dir);
    assert.equal(result.valid, false);
  });
});

test("comando no reconocido: conserva el comportamiento previo, no se bloquea", async () => {
  await withTempDir(async (dir) => {
    const result = await validateTestCommandContract({ executable: "pytest", args: ["tests/"] }, dir);
    assert.deepEqual(result, { valid: true });
  });
});
