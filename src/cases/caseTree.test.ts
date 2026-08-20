import assert from "node:assert/strict";
import test from "node:test";
import type { RunRow, CaseRoadmapRow, CaseFeatureRow, CaseRunEventRow } from "../db/repository.js";
import { buildCaseTrees, classifyRunKind } from "./caseTree.js";

let seq = 0;
function makeRun(overrides: Partial<RunRow> & { id: string }): RunRow {
  seq += 1;
  return {
    pipeline_definition_id: "pipeline-1",
    owner_id: "user-1",
    project_id: "project-1",
    current_phase: null,
    status: "sin_iniciar",
    branch_name: null,
    worktree_path: null,
    originated_from_run_id: null,
    root_run_id: null,
    active_feature_id: null,
    business_case: null,
    base_branch_name: null,
    created_at: new Date(2026, 0, 1, 0, 0, seq).toISOString(),
    updated_at: new Date(2026, 0, 1, 0, 0, seq).toISOString(),
    ...overrides,
  };
}

function roadmap(caseKey: string, releases: { id: string; nombre: string; estado: string }[], validFrom: string): CaseRoadmapRow {
  return {
    caseKey,
    validFrom,
    value: {
      releases: releases.map((r) => ({ ...r, alcanceResumen: "" })),
      activeReleaseId: releases[0]?.id ?? null,
    },
  };
}

function feature(caseKey: string, id: string, releaseKey: string): CaseFeatureRow {
  return { caseKey, id, featureCode: `FEATURE-${id}`, name: `Feature ${id}`, releaseKey };
}

// Escenario 1: Caso sin Features todavía -- solo un run raíz.
test("Caso sin Features: un solo run bajo el Caso", () => {
  const root = makeRun({ id: "r1" });
  const trees = buildCaseTrees({ runs: [root], roadmaps: [], features: [], events: [] });
  assert.equal(trees.length, 1);
  assert.equal(trees[0].caseKey, "r1");
  assert.equal(trees[0].releases.length, 0);
  assert.equal(trees[0].runs.length, 1);
  assert.equal(trees[0].runs[0].id, "r1");
});

// Escenario 3: dos runs con genealogía técnica A->B pero Features distintas -- no deben anidarse
// bajo la misma Feature (Regla 9/11).
test("Features sucesivas: genealogía técnica no fuerza anidamiento bajo la misma Feature", () => {
  const root = makeRun({ id: "r1", root_run_id: "r1" });
  const runA = makeRun({ id: "rA", root_run_id: "r1", active_feature_id: "f1" });
  const runB = makeRun({ id: "rB", root_run_id: "r1", originated_from_run_id: "rA", active_feature_id: "f2" });
  const features = [feature("r1", "f1", "rel1"), feature("r1", "f2", "rel1")];
  const roadmaps = [roadmap("r1", [{ id: "rel1", nombre: "Release 1", estado: "Activo" }], "2026-01-01")];

  const trees = buildCaseTrees({ runs: [root, runA, runB], roadmaps, features, events: [] });
  const release = trees[0].releases[0];
  const featureA = release.features.find((f) => f.id === "f1")!;
  const featureB = release.features.find((f) => f.id === "f2")!;
  assert.equal(featureA.runs.length, 1);
  assert.equal(featureA.runs[0].children.length, 0, "runA no debe tener a runB como hijo (Feature distinta)");
  assert.equal(featureB.runs.length, 1);
  assert.equal(featureB.runs[0].id, "rB");
});

// Escenario 5: varios niveles sin active_feature_id heredan por ancestry hasta el primer ancestro
// con Feature explícita.
test("Herencia P2: varios niveles sin active_feature_id resuelven la Feature del ancestro", () => {
  const root = makeRun({ id: "r1", root_run_id: "r1" });
  const runA = makeRun({ id: "rA", root_run_id: "r1", active_feature_id: "f1" });
  const runB = makeRun({ id: "rB", root_run_id: "r1", originated_from_run_id: "rA" });
  const runC = makeRun({ id: "rC", root_run_id: "r1", originated_from_run_id: "rB" });
  const features = [feature("r1", "f1", "rel1")];
  const roadmaps = [roadmap("r1", [{ id: "rel1", nombre: "Release 1", estado: "Activo" }], "2026-01-01")];

  const trees = buildCaseTrees({ runs: [root, runA, runB, runC], roadmaps, features, events: [] });
  const featureNode = trees[0].releases[0].features[0];
  assert.equal(featureNode.runs.length, 1);
  assert.equal(featureNode.runs[0].id, "rA");
  assert.equal(featureNode.runs[0].children[0].id, "rB");
  assert.equal(featureNode.runs[0].children[0].children[0].id, "rC");
});

// Escenario 6: ningún ancestro tiene Feature -- nunca se inventa una asociación, sube de nivel.
test("Sin Feature en ningún ancestro: el Run sube al nivel del Caso, no se inventa asociación", () => {
  const root = makeRun({ id: "r1", root_run_id: "r1" });
  const runB = makeRun({ id: "rB", root_run_id: "r1", originated_from_run_id: "r1" });
  const trees = buildCaseTrees({ runs: [root, runB], roadmaps: [], features: [], events: [] });
  assert.equal(trees[0].releases.length, 0);
  assert.equal(trees[0].runs.length, 1, "runB debe anidar bajo root dentro del bucket de Caso");
  assert.equal(trees[0].runs[0].id, "r1");
  assert.equal(trees[0].runs[0].children[0].id, "rB");
});

// Escenario 9: dos Casos distintos sobre la misma rama "main" nunca se agrupan por nombre.
test("Dos Casos con el mismo base_branch_name quedan separados por caseKey", () => {
  const rootA = makeRun({ id: "a1", root_run_id: "a1", base_branch_name: "main" });
  const rootB = makeRun({ id: "b1", root_run_id: "b1", base_branch_name: "main" });
  const trees = buildCaseTrees({ runs: [rootA, rootB], roadmaps: [], features: [], events: [] });
  assert.equal(trees.length, 2);
  assert.equal(trees.every((t) => t.displayName === "main"), true);
  assert.notEqual(trees[0].caseKey, trees[1].caseKey);
});

// Escenario 10: run legacy sin root_run_id ni base_branch_name se degrada a Caso independiente.
test("Run legacy sin root_run_id/base_branch_name usa fallback de ID corto", () => {
  const legacy = makeRun({ id: "12345678-aaaa-bbbb-cccc-000000000000" });
  const trees = buildCaseTrees({ runs: [legacy], roadmaps: [], features: [], events: [] });
  assert.equal(trees[0].displayName, "Caso 12345678");
});

// Escenario 11: dos Casos reutilizan el mismo release_key -- la proyección no debe mezclar los
// Releases entre ellos (mitigación de lectura, ver Regla 4).
test("Dos Casos reutilizan release_key: cada uno ve solo su propio Release", () => {
  const rootA = makeRun({ id: "a1", root_run_id: "a1" });
  const rootB = makeRun({ id: "b1", root_run_id: "b1" });
  const roadmaps = [
    roadmap("a1", [{ id: "r1", nombre: "Release de A", estado: "Activo" }], "2026-01-01"),
    roadmap("b1", [{ id: "r1", nombre: "Release de B", estado: "Activo" }], "2026-01-02"),
  ];
  const trees = buildCaseTrees({ runs: [rootA, rootB], roadmaps, features: [], events: [] });
  const treeA = trees.find((t) => t.caseKey === "a1")!;
  const treeB = trees.find((t) => t.caseKey === "b1")!;
  assert.equal(treeA.releases[0].nombre, "Release de A");
  assert.equal(treeB.releases[0].nombre, "Release de B");
});

// Escenario 13: defensa cross-root -- un originated_from_run_id que apunta fuera del propio
// root_run_id (estado anómalo) nunca hereda Feature a través de la frontera del Caso.
test("Ancestry nunca cruza la frontera de root_run_id, aunque el dato esté anómalo", () => {
  const rootOther = makeRun({ id: "other-root", root_run_id: "other-root", active_feature_id: "f-other" });
  const anomalous = makeRun({ id: "b1", root_run_id: "b1", originated_from_run_id: "other-root" });
  const features = [feature("other-root", "f-other", "rel1")];
  const trees = buildCaseTrees({ runs: [rootOther, anomalous], roadmaps: [], features, events: [] });
  const treeB = trees.find((t) => t.caseKey === "b1")!;
  assert.equal(treeB.releases.length, 0);
  assert.equal(treeB.runs[0].id, "b1");
  assert.equal(treeB.runs[0].children.length, 0);
});

// classifyRunKind -- Regla 9/10: reingreso automático vs continuación de Gate (Roadmap/cierre de
// Release), ambos con originated_from_run_id set, distinguidos por eventos estructurados.
test("classifyRunKind: camino automático de reingreso (evento en el padre)", () => {
  const run = makeRun({ id: "child", originated_from_run_id: "parent" });
  const parentEvents: CaseRunEventRow[] = [
    { runId: "parent", eventType: "escalation_cross_pipeline_reentry_prepared", payload: {} },
  ];
  assert.equal(classifyRunKind({ run, parentEvents, ownEvents: [] }), "reentry");
});

test("classifyRunKind: aprobación de Gate no es Reingreso aunque cree un child run", () => {
  const run = makeRun({ id: "child", originated_from_run_id: "parent" });
  const ownEvents: CaseRunEventRow[] = [
    { runId: "child", eventType: "escalation_retry_context_prepared", payload: { parentArtifactId: "artifact-1" } },
  ];
  const parentEvents: CaseRunEventRow[] = [
    { runId: "parent", eventType: "escalation_gate_recognized", payload: { artifactId: "artifact-1", gate: "roadmap_approval" } },
  ];
  assert.equal(classifyRunKind({ run, parentEvents, ownEvents }), "run");
});

test("classifyRunKind: escalación real resuelta manualmente sí es Reingreso", () => {
  const run = makeRun({ id: "child", originated_from_run_id: "parent" });
  const ownEvents: CaseRunEventRow[] = [
    { runId: "child", eventType: "escalation_retry_context_prepared", payload: { parentArtifactId: "artifact-2" } },
  ];
  const parentEvents: CaseRunEventRow[] = [];
  assert.equal(classifyRunKind({ run, parentEvents, ownEvents }), "reentry");
});

test("classifyRunKind: continuación PLANNING_TO_QA sin originated_from_run_id no es Reingreso", () => {
  const run = makeRun({ id: "child" });
  assert.equal(classifyRunKind({ run, parentEvents: [], ownEvents: [] }), "run");
});
