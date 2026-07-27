import assert from "node:assert/strict";
import test from "node:test";
import { ramaBaseTrabajoFromBusinessCase } from "./runStart.js";

test("ramaBaseTrabajoFromBusinessCase lee rama_base_trabajo del business_case crudo de un run raíz", () => {
  assert.equal(ramaBaseTrabajoFromBusinessCase({ rama_base_trabajo: "release/mvp" }), "release/mvp");
});

test("ramaBaseTrabajoFromBusinessCase devuelve undefined para un contexto sin rama_base_trabajo (ej. continuación { featureJustCompleted })", () => {
  assert.equal(ramaBaseTrabajoFromBusinessCase({ featureJustCompleted: "f1" }), undefined);
  assert.equal(ramaBaseTrabajoFromBusinessCase(null), undefined);
});

// FEATURE-020, bug encontrado en prueba real: con la Regla 6 del camino genérico de
// respondService.ts (siempre FULL_PIPELINE), el initialContext de la primera Feature de
// cualquier release es un ReentryContext (con businessCase anidado), no el business_case crudo.
test("ramaBaseTrabajoFromBusinessCase encuentra rama_base_trabajo anidado en businessCase de un ReentryContext", () => {
  const reentryContext = {
    businessCase: { rama_base_trabajo: "release/mvp", repositorio: "git@github.com:org/repo.git" },
    escalationReason: "Roadmap aprobado por el usuario.",
    rejectedArtifact: null,
    originAgentRole: "architect",
    targetAgentRole: null,
    humanSolution: "aprobado",
    attempt: 1,
    originalVersionRef: "config-row-id",
  };
  assert.equal(ramaBaseTrabajoFromBusinessCase(reentryContext), "release/mvp");
});

test("ramaBaseTrabajoFromBusinessCase devuelve undefined si el ReentryContext no tiene businessCase real", () => {
  const reentryContext = {
    businessCase: null,
    escalationReason: "algo",
    rejectedArtifact: null,
    originAgentRole: "architect",
    targetAgentRole: null,
    humanSolution: null,
    attempt: 1,
    originalVersionRef: "x",
  };
  assert.equal(ramaBaseTrabajoFromBusinessCase(reentryContext), undefined);
});
