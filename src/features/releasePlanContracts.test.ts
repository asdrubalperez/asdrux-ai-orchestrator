import assert from "node:assert/strict";
import test from "node:test";
import { parseReleasePlanDocumentPayload } from "./releasePlanContracts.js";

function validPayload(): Record<string, unknown> {
  return {
    evaluacionTamano: {
      cantidadFeatures: 2,
      factoresRiesgo: ["Dependencia entre Features"],
      conclusion: "Riesgo razonable",
    },
    secuencia: [
      { sourceKey: "f1", motivoOrden: "Sin dependencias, base para f2." },
      { sourceKey: "f2", motivoOrden: "Depende de f1." },
    ],
    featurePlan: {
      sourceKey: "f1",
      technicalApproach: { affectedComponents: ["src/tip.ts"], impact: "Bajo", alternativesConsidered: [] },
      testPlan: {
        level: "L1",
        scenarios: [{ scenario: "Caso base", action: "calculateTip(100, 10)", expected: "10" }],
        evidenceRequired: ["Salida de node --test"],
        validationEnvironment: "local",
        externalWrites: null,
      },
    },
    hallazgos: "",
  };
}

test("parsea RELEASE_PLAN_DOCUMENT en forma de objeto estructurado (Claude)", () => {
  const payload = parseReleasePlanDocumentPayload({ releasePlanDocument: validPayload() });
  assert.equal(payload.evaluacionTamano.conclusion, "Riesgo razonable");
  assert.equal(payload.secuencia.length, 2);
  assert.equal(payload.featurePlan?.sourceKey, "f1");
});

test("parsea RELEASE_PLAN_DOCUMENT en forma de texto plano (Codex)", () => {
  const line = `RELEASE_PLAN_DOCUMENT: ${JSON.stringify(validPayload())}`;
  const payload = parseReleasePlanDocumentPayload(`ESTADO: completed\n${line}\nRAZON_ESCALAMIENTO: null`);
  assert.equal(payload.secuencia[0].sourceKey, "f1");
});

// Fix (2026-08-17), hallazgo en vivo: un run real murió con "RELEASE_PLAN_DOCUMENT no contiene
// JSON válido (Expected ',' or '}' after property value...)" -- Codex había emitido el JSON con
// saltos de línea reales adentro (formato "pretty", no en una sola línea pese a la instrucción), y
// el extractor de texto plano lo truncaba en el primer \n, dejando un objeto incompleto. Reproduce
// ese caso exacto (JSON.stringify con indentación, saltos de línea de verdad) para confirmar que la
// extracción balanceada por llaves de `extractStructuredValue` ya no depende de que el modelo
// respete el formato de una sola línea.
test("parsea RELEASE_PLAN_DOCUMENT en forma de texto plano de Codex aunque el JSON venga con saltos de línea reales adentro", () => {
  const multilineJson = JSON.stringify(validPayload(), null, 2);
  const line = `RELEASE_PLAN_DOCUMENT: ${multilineJson}`;
  const payload = parseReleasePlanDocumentPayload(`ESTADO: completed\n${line}\nRAZON_ESCALAMIENTO: null`);
  assert.equal(payload.secuencia[0].sourceKey, "f1");
  assert.equal(payload.featurePlan?.sourceKey, "f1");
});

test("featurePlan puede ser null (RELEASE_COMPLETO, sin Feature nueva que aportar)", () => {
  const payload = parseReleasePlanDocumentPayload({
    releasePlanDocument: { ...validPayload(), featurePlan: null },
  });
  assert.equal(payload.featurePlan, null);
});

test("rechaza payload con campos adicionales (schema cerrado)", () => {
  const invalid = { ...validPayload(), roadmap: [] };
  assert.throws(() => parseReleasePlanDocumentPayload({ releasePlanDocument: invalid }));
});

test("rechaza conclusion fuera de Riesgo razonable/Riesgo real", () => {
  const invalid = validPayload();
  (invalid.evaluacionTamano as Record<string, unknown>).conclusion = "Depende";
  assert.throws(() => parseReleasePlanDocumentPayload({ releasePlanDocument: invalid }));
});

test("rechaza cantidadFeatures no numérica o menor a 1", () => {
  const invalid = validPayload();
  (invalid.evaluacionTamano as Record<string, unknown>).cantidadFeatures = 0;
  assert.throws(() => parseReleasePlanDocumentPayload({ releasePlanDocument: invalid }));
});

test("rechaza nivel de test fuera de L1-L4", () => {
  const invalid = validPayload();
  ((invalid.featurePlan as Record<string, unknown>).testPlan as Record<string, unknown>).level = "L5";
  assert.throws(() => parseReleasePlanDocumentPayload({ releasePlanDocument: invalid }));
});

test("acepta externalWrites completo cuando no es null", () => {
  const withExternalWrites = validPayload();
  ((withExternalWrites.featurePlan as Record<string, unknown>).testPlan as Record<string, unknown>).externalWrites = {
    expectedEffect: "Escribe un archivo temporal.",
    confirmationMethod: "Leer el archivo después.",
    safetyIdempotencyCleanup: "Se borra al final del test.",
  };
  const payload = parseReleasePlanDocumentPayload({ releasePlanDocument: withExternalWrites });
  assert.equal(payload.featurePlan?.testPlan.externalWrites?.expectedEffect, "Escribe un archivo temporal.");
});
