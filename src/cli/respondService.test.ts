import assert from "node:assert/strict";
import test from "node:test";
import { extractRoadmapApproval, resolveChildPipelineSpec } from "./respondService.js";
import { FULL_PIPELINE, PLANNING_TO_QA } from "../pipelines/definitions.js";

const VALID_ROADMAP = {
  releases: [{ id: "r1", nombre: "MVP", alcanceResumen: "Alcance mínimo.", estado: "Activo" }],
  activeReleaseId: "r1",
};

test("extractRoadmapApproval devuelve null para escalaciones que no son de architect", () => {
  const content = { outputArtifact: { text: "diseño", roadmap: JSON.stringify(VALID_ROADMAP) } };
  assert.equal(extractRoadmapApproval({ phase: "planning" }, content), null);
});

test("extractRoadmapApproval devuelve null cuando el outputArtifact no trae roadmap (ambigüedad genérica)", () => {
  assert.equal(extractRoadmapApproval({ phase: "architect" }, { outputArtifact: "propuesta en texto plano" }), null);
  assert.equal(extractRoadmapApproval({ phase: "architect" }, { outputArtifact: null }), null);
});

test("extractRoadmapApproval parsea un ROADMAP válido bolteado a outputArtifact", () => {
  const content = { outputArtifact: { text: "diseño", roadmap: JSON.stringify(VALID_ROADMAP) } };
  assert.deepEqual(extractRoadmapApproval({ phase: "architect" }, content), VALID_ROADMAP);
});

test("extractRoadmapApproval trata JSON malformado como si no hubiera roadmap (riesgo H12 aceptado)", () => {
  const content = { outputArtifact: { text: "diseño", roadmap: "{ esto no es json" } };
  assert.equal(extractRoadmapApproval({ phase: "architect" }, content), null);
});

test("extractRoadmapApproval rechaza un roadmap con activeReleaseId inexistente", () => {
  const malformed = { releases: VALID_ROADMAP.releases, activeReleaseId: "no-existe" };
  const content = { outputArtifact: { text: "diseño", roadmap: JSON.stringify(malformed) } };
  assert.equal(extractRoadmapApproval({ phase: "architect" }, content), null);
});

const PLANNING_TO_QA_ROW = {
  id: "planning-to-qa-row-id",
  name: PLANNING_TO_QA.name,
  version: 1,
  definition: PLANNING_TO_QA.definition,
};

test("resolveChildPipelineSpec fuerza FULL_PIPELINE al cerrar un release con release siguiente, aunque el run padre sea PLANNING_TO_QA", () => {
  const releaseClosureRoadmap = {
    releases: [
      { id: "r1", nombre: "MVP", alcanceResumen: "Alcance mínimo.", estado: "Completado" as const },
      { id: "r2", nombre: "Siguiente", alcanceResumen: "Alcance siguiente.", estado: "Activo" as const },
    ],
    activeReleaseId: "r2",
  };

  const spec = resolveChildPipelineSpec(releaseClosureRoadmap, PLANNING_TO_QA_ROW);

  assert.equal(spec.name, FULL_PIPELINE.name);
  assert.equal(spec.definition.phases[0].agentRole, "architect");
});

test("resolveChildPipelineSpec reusa el pipeline del run padre cuando no hay cierre de release (camino genérico, incluye roadmapApproval)", () => {
  const spec = resolveChildPipelineSpec(null, PLANNING_TO_QA_ROW);

  assert.equal(spec.name, PLANNING_TO_QA.name);
});
