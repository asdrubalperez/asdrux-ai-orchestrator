import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CODING_STANDARDS_ASSET,
  DEFAULT_RUNBOOK_ROOT,
  FEATURE_TEMPLATE_ASSET,
  REQUIRED_RUNBOOK_ASSETS,
  RunbookProvider,
  RunbookProviderError,
  TESTING_POLICY_ASSET,
  assertRunbookAvailableAtStartup,
  normalizeAssetPath,
} from "./runbookProvider.js";

async function fixture(version = "v1.0") {
  const root = await mkdtemp(path.join(os.tmpdir(), "runbook-provider-"));
  await writeFile(path.join(root, "VERSION"), `${version}\n`, "utf8");
  await writeFile(path.join(root, FEATURE_TEMPLATE_ASSET), "template\n", "utf8");
  await writeFile(path.join(root, TESTING_POLICY_ASSET), "testing policy\n", "utf8");
  await writeFile(path.join(root, CODING_STANDARDS_ASSET), "coding standards\n", "utf8");
  return root;
}

function assertCode(error: unknown, code: string): boolean {
  assert.ok(error instanceof RunbookProviderError);
  assert.equal(error.code, code);
  return true;
}

test("RunbookProvider lee desde raíz confiable y calcula SHA-256 sobre los bytes reales", async () => {
  const root = await fixture();
  const provider = new RunbookProvider({ trustedRoot: root });
  const asset = await provider.readText(FEATURE_TEMPLATE_ASSET);

  assert.deepEqual(asset, {
    runbookVersion: "v1.0",
    assetRelativePath: FEATURE_TEMPLATE_ASSET,
    assetHash: createHash("sha256").update(Buffer.from("template\n")).digest("hex"),
    content: "template\n",
  });
});

test("resolución es independiente del cwd y de un archivo homónimo externo", async () => {
  const root = await fixture();
  const external = await mkdtemp(path.join(os.tmpdir(), "runbook-external-"));
  await mkdir(path.join(external, "docs", "runbook"), { recursive: true });
  await writeFile(path.join(external, "docs", "runbook", FEATURE_TEMPLATE_ASSET), "externo\n", "utf8");
  const provider = new RunbookProvider({ trustedRoot: root });
  const originalCwd = process.cwd();

  try {
    process.chdir(external);
    assert.equal((await provider.readText(FEATURE_TEMPLATE_ASSET)).content, "template\n");
  } finally {
    process.chdir(originalCwd);
  }
});

test("rechaza paths absolutos, traversal y traversal codificado", () => {
  const invalid = [
    path.resolve("outside.md"),
    "../outside.md",
    "nested/../outside.md",
    "nested\\..\\outside.md",
    "%2e%2e/outside.md",
    "nested/%2e%2e/outside.md",
    "%00VERSION",
    "",
  ];
  for (const candidate of invalid) {
    assert.throws(() => normalizeAssetPath(candidate), (error) =>
      assertCode(error, "RUNBOOK_ASSET_PATH_INVALID")
    );
  }
});

test("startup valida sólo el catálogo obligatorio actual", async () => {
  const root = await fixture();
  const provider = new RunbookProvider({ trustedRoot: root });

  await assertRunbookAvailableAtStartup(provider);
  assert.deepEqual(REQUIRED_RUNBOOK_ASSETS, [
    "VERSION",
    FEATURE_TEMPLATE_ASSET,
    TESTING_POLICY_ASSET,
    CODING_STANDARDS_ASSET,
  ]);
});

test("startup falla si falta VERSION o el template obligatorio", async () => {
  const missingVersion = await mkdtemp(path.join(os.tmpdir(), "runbook-no-version-"));
  await writeFile(path.join(missingVersion, FEATURE_TEMPLATE_ASSET), "template\n");
  await assert.rejects(
    () => assertRunbookAvailableAtStartup(new RunbookProvider({ trustedRoot: missingVersion })),
    (error) => assertCode(error, "RUNBOOK_VERSION_NOT_FOUND")
  );

  const missingTemplate = await mkdtemp(path.join(os.tmpdir(), "runbook-no-template-"));
  await writeFile(path.join(missingTemplate, "VERSION"), "v1.0\n");
  await assert.rejects(
    () => assertRunbookAvailableAtStartup(new RunbookProvider({ trustedRoot: missingTemplate })),
    (error) => assertCode(error, "RUNBOOK_ASSET_NOT_FOUND")
  );
});

// FEATURE-037: Testing Policy y Coding Standards pasan a ser assets obligatorios de arranque —
// Planning/Developer dependen de poder leerlos en cada invocación (fallo cerrado, Regla 13).
test("startup falla si falta Testing Policy o Coding Standards", async () => {
  const missingTestingPolicy = await mkdtemp(path.join(os.tmpdir(), "runbook-no-testing-policy-"));
  await writeFile(path.join(missingTestingPolicy, "VERSION"), "v1.0\n");
  await writeFile(path.join(missingTestingPolicy, FEATURE_TEMPLATE_ASSET), "template\n");
  await writeFile(path.join(missingTestingPolicy, CODING_STANDARDS_ASSET), "coding standards\n");
  await assert.rejects(
    () => assertRunbookAvailableAtStartup(new RunbookProvider({ trustedRoot: missingTestingPolicy })),
    (error) => assertCode(error, "RUNBOOK_ASSET_NOT_FOUND")
  );

  const missingCodingStandards = await mkdtemp(path.join(os.tmpdir(), "runbook-no-coding-standards-"));
  await writeFile(path.join(missingCodingStandards, "VERSION"), "v1.0\n");
  await writeFile(path.join(missingCodingStandards, FEATURE_TEMPLATE_ASSET), "template\n");
  await writeFile(path.join(missingCodingStandards, TESTING_POLICY_ASSET), "testing policy\n");
  await assert.rejects(
    () => assertRunbookAvailableAtStartup(new RunbookProvider({ trustedRoot: missingCodingStandards })),
    (error) => assertCode(error, "RUNBOOK_ASSET_NOT_FOUND")
  );
});

test("rechaza raíz relativa, versión no soportada y directorio usado como asset", async () => {
  assert.throws(
    () => new RunbookProvider({ trustedRoot: "relative/runbook" }),
    (error) => assertCode(error, "RUNBOOK_ROOT_INVALID")
  );

  const unsupported = await fixture("v9.9");
  await assert.rejects(
    () => new RunbookProvider({ trustedRoot: unsupported }).getRunbookVersion(),
    (error) => assertCode(error, "RUNBOOK_VERSION_UNSUPPORTED")
  );

  const root = await fixture();
  await mkdir(path.join(root, "directory"));
  await assert.rejects(
    () => new RunbookProvider({ trustedRoot: root }).readText("directory"),
    (error) => assertCode(error, "RUNBOOK_ASSET_UNREADABLE")
  );
});

test(
  "rechaza symlink que resuelve fuera de la raíz",
  { skip: process.platform === "win32" ? "symlink sin privilegios no es determinista en Windows" : false },
  async () => {
    const root = await fixture();
    const external = await mkdtemp(path.join(os.tmpdir(), "runbook-symlink-target-"));
    const target = path.join(external, "outside.md");
    await writeFile(target, "outside\n");
    await symlink(target, path.join(root, "linked.md"));

    await assert.rejects(
      () => new RunbookProvider({ trustedRoot: root }).readText("linked.md"),
      (error) => assertCode(error, "RUNBOOK_ASSET_PATH_INVALID")
    );
  }
);

test(
  "distingue asset ilegible",
  { skip: process.platform === "win32" ? "chmod no niega lectura de forma estable en Windows" : false },
  async () => {
    const root = await fixture();
    const assetPath = path.join(root, FEATURE_TEMPLATE_ASSET);
    await chmod(assetPath, 0);
    try {
      await assert.rejects(
        () => new RunbookProvider({ trustedRoot: root }).readText(FEATURE_TEMPLATE_ASSET),
        (error) => assertCode(error, "RUNBOOK_ASSET_UNREADABLE")
      );
    } finally {
      await chmod(assetPath, 0o600);
    }
  }
);

test("assets distribuidos reflejan todos los documentos de referencia", async () => {
  const referenceRoot = path.resolve(DEFAULT_RUNBOOK_ROOT, "..", "..", "docs", "runbook");
  const names = (await readdir(referenceRoot)).filter((name) => name.endsWith(".md")).sort();
  assert.ok(names.includes("BOOTSTRAP.md"));
  assert.ok(names.includes(FEATURE_TEMPLATE_ASSET));

  for (const name of names) {
    const [reference, distributed] = await Promise.all([
      readFile(path.join(referenceRoot, name)),
      readFile(path.join(DEFAULT_RUNBOOK_ROOT, name)),
    ]);
    assert.deepEqual(distributed, reference, `${name} no coincide con la copia distribuida`);
  }
});
