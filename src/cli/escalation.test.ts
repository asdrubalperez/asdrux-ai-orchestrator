import assert from "node:assert/strict";
import test from "node:test";
import {
  activeReleaseFromRoadmap,
  artifactsAreEquivalent,
  canonicalJson,
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
