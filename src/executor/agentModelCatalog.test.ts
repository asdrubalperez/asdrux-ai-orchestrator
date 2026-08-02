import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_MODEL_CATALOG, isModelSupportedByProvider, modelsForProvider } from "./agentModelCatalog.js";

// FEATURE-025-Parte-1, Regla 5.3: el modelo debe pertenecer a un único proveedor soportado; nunca
// un string libre sin validar.
test("isModelSupportedByProvider acepta un modelo del catálogo de su propio proveedor", () => {
  for (const model of AGENT_MODEL_CATALOG.claude) {
    assert.equal(isModelSupportedByProvider("claude", model), true);
  }
  for (const model of AGENT_MODEL_CATALOG.codex) {
    assert.equal(isModelSupportedByProvider("codex", model), true);
  }
});

test("isModelSupportedByProvider rechaza un modelo de otro proveedor (Escenario 6 del diseño)", () => {
  const [claudeModel] = AGENT_MODEL_CATALOG.claude;
  assert.equal(isModelSupportedByProvider("codex", claudeModel), false);
  const [codexModel] = AGENT_MODEL_CATALOG.codex;
  assert.equal(isModelSupportedByProvider("claude", codexModel), false);
});

test("isModelSupportedByProvider rechaza un string arbitrario", () => {
  assert.equal(isModelSupportedByProvider("claude", "modelo-inventado"), false);
});

test("modelsForProvider devuelve el catálogo cerrado de cada proveedor", () => {
  assert.deepEqual(modelsForProvider("claude"), AGENT_MODEL_CATALOG.claude);
  assert.deepEqual(modelsForProvider("codex"), AGENT_MODEL_CATALOG.codex);
});
