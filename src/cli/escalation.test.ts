import assert from "node:assert/strict";
import test from "node:test";
import {
  activeReleaseFromRoadmap,
  artifactsAreEquivalent,
  canonicalJson,
  extractMergeApproval,
  extractReleasePlanDeclaration,
  isMergeApprovalPayload,
  isReleaseCompletionEscalation,
  isReleasePlanDeclaration,
  isRoadmapApprovalPayload,
  parsePipelineDefinitionRow,
} from "./escalation.js";

test("canonicalJson ordena claves de objetos anidados", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
});

test("artifactsAreEquivalent ignora orden de claves pero preserva arrays", () => {
  assert.equal(artifactsAreEquivalent({ steps: [{ b: 2, a: 1 }] }, { steps: [{ a: 1, b: 2 }] }), true);
  assert.equal(artifactsAreEquivalent({ steps: [1, 2] }, { steps: [2, 1] }), false);
});

test("parsePipelineDefinitionRow rechaza definitions sin phases validas", () => {
  assert.throws(
    () => parsePipelineDefinitionRow({ name: "x", version: 1, definition: { phases: [{ agentRole: "ghost" }] } }),
    /Definición de pipeline inválida/
  );
});

const VALID_ROADMAP = {
  releases: [
    { id: "r1", nombre: "MVP", alcanceResumen: "Alcance mínimo.", estado: "Activo" },
    { id: "r2", nombre: "Fase 2", alcanceResumen: "Resto del alcance.", estado: "Pendiente" },
  ],
  activeReleaseId: "r1",
};

test("isRoadmapApprovalPayload acepta un roadmap válido con release activo existente", () => {
  assert.equal(isRoadmapApprovalPayload(VALID_ROADMAP), true);
});

test("isRoadmapApprovalPayload rechaza forma inválida (FEATURE-018, riesgo H12)", () => {
  assert.equal(isRoadmapApprovalPayload(null), false);
  assert.equal(isRoadmapApprovalPayload({ releases: [], activeReleaseId: "r1" }), false);
  assert.equal(
    isRoadmapApprovalPayload({ releases: [{ id: "r1" }], activeReleaseId: "r1" }),
    false
  );
  assert.equal(
    isRoadmapApprovalPayload({ ...VALID_ROADMAP, activeReleaseId: "no-existe" }),
    false
  );
});

test("activeReleaseFromRoadmap devuelve el release marcado como activo", () => {
  assert.deepEqual(activeReleaseFromRoadmap(VALID_ROADMAP), VALID_ROADMAP.releases[0]);
});

test("activeReleaseFromRoadmap devuelve null si el valor no es un roadmap válido", () => {
  assert.equal(activeReleaseFromRoadmap(null), null);
  assert.equal(activeReleaseFromRoadmap({ foo: "bar" }), null);
});

// FEATURE-019

const VALID_RELEASE_PLAN_DECLARATION = {
  features: [
    { id: "f1", nombre: "Feature 1", estado: "Completada" },
    { id: "f2", nombre: "Feature 2", estado: "En curso" },
  ],
  featureActualId: "f2",
};

test("isReleasePlanDeclaration acepta una declaración válida", () => {
  assert.equal(isReleasePlanDeclaration(VALID_RELEASE_PLAN_DECLARATION), true);
});

test("isReleasePlanDeclaration rechaza forma inválida", () => {
  assert.equal(isReleasePlanDeclaration(null), false);
  assert.equal(isReleasePlanDeclaration({ features: [{ id: "f1" }], featureActualId: null }), false);
  assert.equal(isReleasePlanDeclaration({ features: [], featureActualId: 123 }), false);
});

test("extractReleasePlanDeclaration parsea un RELEASE_PLAN válido bolteado a outputArtifact", () => {
  const content = { outputArtifact: { text: "plan", releasePlan: JSON.stringify(VALID_RELEASE_PLAN_DECLARATION) } };
  assert.deepEqual(extractReleasePlanDeclaration({ phase: "planning" }, content), VALID_RELEASE_PLAN_DECLARATION);
});

test("extractReleasePlanDeclaration devuelve null para roles distintos de planning", () => {
  const content = { outputArtifact: { text: "plan", releasePlan: JSON.stringify(VALID_RELEASE_PLAN_DECLARATION) } };
  assert.equal(extractReleasePlanDeclaration({ phase: "functional" }, content), null);
});

test("extractReleasePlanDeclaration trata JSON malformado como ausente (riesgo H12 aceptado)", () => {
  const content = { outputArtifact: { text: "plan", releasePlan: "{ no es json" } };
  assert.equal(extractReleasePlanDeclaration({ phase: "planning" }, content), null);
});

test("isReleaseCompletionEscalation detecta el marcador releaseCompleto de Planning", () => {
  assert.equal(
    isReleaseCompletionEscalation({ phase: "planning" }, { outputArtifact: { releaseCompleto: "true" } }),
    true
  );
});

test("isReleaseCompletionEscalation es false para ambigüedad genérica de Planning o rol distinto", () => {
  assert.equal(isReleaseCompletionEscalation({ phase: "planning" }, { outputArtifact: null }), false);
  assert.equal(
    isReleaseCompletionEscalation({ phase: "developer" }, { outputArtifact: { releaseCompleto: "true" } }),
    false
  );
});

const VALID_MERGE_APPROVAL = {
  mergeApproval: true,
  baseBranch: "release/base",
  featureBranch: "run/abc",
  featureActualId: "f2",
};

test("isMergeApprovalPayload acepta un payload válido", () => {
  assert.equal(isMergeApprovalPayload(VALID_MERGE_APPROVAL), true);
});

test("isMergeApprovalPayload rechaza forma inválida", () => {
  assert.equal(isMergeApprovalPayload(null), false);
  assert.equal(isMergeApprovalPayload({ mergeApproval: true, baseBranch: "x" }), false);
});

test("extractMergeApproval detecta la aprobación de merge sintética atribuida a developer", () => {
  assert.deepEqual(
    extractMergeApproval({ phase: "developer" }, { outputArtifact: VALID_MERGE_APPROVAL }),
    VALID_MERGE_APPROVAL
  );
});

test("extractMergeApproval no confunde una escalación real de ambigüedad de Developer (sin mergeApproval)", () => {
  assert.equal(
    extractMergeApproval({ phase: "developer" }, { outputArtifact: "ambigüedad real, texto libre" }),
    null
  );
});

test("extractMergeApproval devuelve null para roles distintos de developer", () => {
  assert.equal(extractMergeApproval({ phase: "planning" }, { outputArtifact: VALID_MERGE_APPROVAL }), null);
});
