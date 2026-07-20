import assert from "node:assert/strict";
import test from "node:test";
import { artifactsAreEquivalent, canonicalJson, parsePipelineDefinitionRow } from "./escalation.js";

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
