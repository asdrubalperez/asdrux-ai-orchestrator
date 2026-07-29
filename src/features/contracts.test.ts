import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDeveloperReadiness,
  parseFeatureUpdatePayload,
  parseFeaturesPayload,
  parseQaResult,
} from "./contracts.js";

const functionalFeature = {
  id: "f1",
  nombre: "Autenticación segura",
  resumen: "Permite iniciar sesión.",
  prioridad: "P0",
  documento: {
    problemStatement: "No existe acceso autenticado.",
    functionalGoal: "El usuario inicia sesión.",
    scope: { included: ["Login"], excluded: ["SSO"], futureIdeas: [] },
    functionalRules: ["Una sesión por usuario."],
    algorithmicStrategy: null,
    validationCriteria: [{ scenario: "Login", input: "Credenciales válidas", expectedOutput: "Sesión creada" }],
    validationEvidence: "Respuesta y sesión persistida.",
    risks: ["Fuerza bruta"],
  },
};

test("FEATURES normaliza la forma objeto de Codex y la forma JSON de Claude", () => {
  const objectPayload = parseFeaturesPayload({ features: [functionalFeature] });
  const stringPayload = parseFeaturesPayload({ features: JSON.stringify({ features: [functionalFeature] }) });
  assert.deepEqual(objectPayload, stringPayload);
  assert.equal(objectPayload.features[0].prioridad, "P0");
});

test("FEATURES rechaza propiedades adicionales, source keys repetidos y prioridades abiertas", () => {
  assert.throws(
    () => parseFeaturesPayload({ features: [{ ...functionalFeature, extra: true }] }),
    /schema cerrado/
  );
  assert.throws(
    () => parseFeaturesPayload({ features: [functionalFeature, functionalFeature] }),
    /duplicados/
  );
  assert.throws(
    () => parseFeaturesPayload({ features: [{ ...functionalFeature, prioridad: "urgente" }] }),
    /P0, P1 o P2/
  );
});
test("FEATURE_UPDATE usa schema cerrado y conserva el testCommand verificable", () => {
  const update = parseFeatureUpdatePayload({
    featureUpdate: {
      sourceKey: "f1",
      technicalConsiderations: {
        affectedComponents: ["src/auth.ts"],
        approach: "Cambio localizado.",
        dependencies: [],
      },
      validationPlan: {
        testCommand: "node --test dist/auth.test.js",
        scenarios: [{ scenario: "Login", action: "Enviar credenciales", expected: "200" }],
        evidenceRequired: ["Test verde"],
      },
      technicalRisks: [],
    },
  });
  assert.equal(update.sourceKey, "f1");
  assert.equal(update.validationPlan.testCommand, "node --test dist/auth.test.js");
});

test("QA_RESULT exige tests y READINESS impide ready con cambios pendientes", () => {
  assert.throws(
    () =>
      parseQaResult({
        qaResult: {
          testStatus: "passed",
          testsExecuted: [],
          evidence: "ok",
          defects: [],
          observations: [],
          qualityRisks: [],
        },
      }),
    /no puede quedar vacío/
  );
  assert.throws(
    () =>
      parseDeveloperReadiness({
        readiness: {
          readiness: "ready",
          summary: "Faltan cambios.",
          knownRisks: [],
          requiresCodeChanges: true,
          finalNotes: [],
        },
      }),
    /no puede requerir cambios/
  );
});

test("normalizador acepta schemas raíz de Codex sin exigir envelopes de transporte", () => {
  assert.equal(
    parseQaResult({
      testStatus: "passed",
      testsExecuted: ["node --test x"],
      evidence: "ok",
      defects: [],
      observations: [],
      qualityRisks: [],
    }).testStatus,
    "passed"
  );
  assert.equal(
    parseDeveloperReadiness({
      readiness: "ready",
      summary: "Listo.",
      knownRisks: [],
      requiresCodeChanges: false,
      finalNotes: [],
    }).readiness,
    "ready"
  );
});
