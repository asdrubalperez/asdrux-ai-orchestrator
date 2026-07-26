import assert from "node:assert/strict";
import test from "node:test";
import { extractRoadmapApproval } from "./respondService.js";

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
