import {
  arrayAt,
  assertClosedObject,
  extractStructuredValue,
  objectAt,
  stringAt,
} from "./contracts.js";

/**
 * FEATURE-035: contrato estructurado del documento rico que Planning declara en la etiqueta
 * RELEASE_PLAN_DOCUMENT (mismo mecanismo que PROJECT_BRIEF/ARCHITECTURE). Deliberadamente
 * separado de RELEASE_PLAN (que sigue gobernando secuenciación operacional sin cambios, Rule 3) y
 * construido incrementalmente: `featurePlan` es singular -- sólo el bloque de la Feature que
 * Planning asigna en esta invocación, nunca el array completo. El runtime acumula (ver
 * `releasePlanLifecycle.ts`), Planning nunca redeclara bloques de Features ya planificadas.
 */
export const CONCLUSION_TAMANO = ["Riesgo razonable", "Riesgo real"] as const;
export type ConclusionTamano = (typeof CONCLUSION_TAMANO)[number];

export const NIVELES_TEST = ["L1", "L2", "L3", "L4"] as const;
export type NivelTest = (typeof NIVELES_TEST)[number];

export interface EvaluacionTamano {
  cantidadFeatures: number;
  factoresRiesgo: string[];
  conclusion: ConclusionTamano;
}

export interface SecuenciaEntry {
  sourceKey: string;
  motivoOrden: string;
}

export interface TestScenario {
  scenario: string;
  action: string;
  expected: string;
}

export interface ExternalWrites {
  expectedEffect: string;
  confirmationMethod: string;
  safetyIdempotencyCleanup: string;
}

export interface TestPlan {
  level: NivelTest;
  scenarios: TestScenario[];
  evidenceRequired: string[];
  validationEnvironment: string;
  externalWrites: ExternalWrites | null;
}

export interface TechnicalApproach {
  affectedComponents: string[];
  impact: string;
  alternativesConsidered: string[];
}

export interface FeaturePlan {
  sourceKey: string;
  technicalApproach: TechnicalApproach;
  testPlan: TestPlan;
}

export interface ReleasePlanDocumentPayload {
  evaluacionTamano: EvaluacionTamano;
  secuencia: SecuenciaEntry[];
  featurePlan: FeaturePlan | null;
  hallazgos: string;
}

export function parseReleasePlanDocumentPayload(outputArtifact: unknown): ReleasePlanDocumentPayload {
  const value = extractStructuredValue(outputArtifact, "RELEASE_PLAN_DOCUMENT", "releasePlanDocument");
  assertClosedObject(
    value,
    ["evaluacionTamano", "secuencia", "featurePlan", "hallazgos"],
    "RELEASE_PLAN_DOCUMENT"
  );

  return {
    evaluacionTamano: parseEvaluacionTamano(value.evaluacionTamano),
    secuencia: arrayAt(value.secuencia, "RELEASE_PLAN_DOCUMENT.secuencia").map((item, index) =>
      parseSecuenciaEntry(item, index)
    ),
    featurePlan: value.featurePlan === null ? null : parseFeaturePlan(value.featurePlan),
    hallazgos: typeof value.hallazgos === "string" ? value.hallazgos : "",
  };
}

function parseEvaluacionTamano(value: unknown): EvaluacionTamano {
  const evaluacion = objectAt(value, "RELEASE_PLAN_DOCUMENT.evaluacionTamano");
  assertClosedObject(
    evaluacion,
    ["cantidadFeatures", "factoresRiesgo", "conclusion"],
    "RELEASE_PLAN_DOCUMENT.evaluacionTamano"
  );
  if (typeof evaluacion.cantidadFeatures !== "number" || evaluacion.cantidadFeatures < 1) {
    throw new Error("RELEASE_PLAN_DOCUMENT.evaluacionTamano.cantidadFeatures debe ser un número >= 1.");
  }
  if (!CONCLUSION_TAMANO.includes(evaluacion.conclusion as ConclusionTamano)) {
    throw new Error('RELEASE_PLAN_DOCUMENT.evaluacionTamano.conclusion debe ser "Riesgo razonable" o "Riesgo real".');
  }
  const factoresRiesgo = arrayAt(evaluacion.factoresRiesgo, "RELEASE_PLAN_DOCUMENT.evaluacionTamano.factoresRiesgo");
  if (!factoresRiesgo.every((item) => typeof item === "string")) {
    throw new Error("RELEASE_PLAN_DOCUMENT.evaluacionTamano.factoresRiesgo debe contener strings.");
  }
  return {
    cantidadFeatures: evaluacion.cantidadFeatures,
    factoresRiesgo: factoresRiesgo as string[],
    conclusion: evaluacion.conclusion as ConclusionTamano,
  };
}

function parseSecuenciaEntry(value: unknown, index: number): SecuenciaEntry {
  const entry = objectAt(value, `RELEASE_PLAN_DOCUMENT.secuencia[${index}]`);
  assertClosedObject(entry, ["sourceKey", "motivoOrden"], `RELEASE_PLAN_DOCUMENT.secuencia[${index}]`);
  return {
    sourceKey: stringAt(entry.sourceKey, `RELEASE_PLAN_DOCUMENT.secuencia[${index}].sourceKey`),
    motivoOrden: stringAt(entry.motivoOrden, `RELEASE_PLAN_DOCUMENT.secuencia[${index}].motivoOrden`),
  };
}

function parseFeaturePlan(value: unknown): FeaturePlan {
  const plan = objectAt(value, "RELEASE_PLAN_DOCUMENT.featurePlan");
  assertClosedObject(plan, ["sourceKey", "technicalApproach", "testPlan"], "RELEASE_PLAN_DOCUMENT.featurePlan");
  return {
    sourceKey: stringAt(plan.sourceKey, "RELEASE_PLAN_DOCUMENT.featurePlan.sourceKey"),
    technicalApproach: parseTechnicalApproach(plan.technicalApproach),
    testPlan: parseTestPlan(plan.testPlan),
  };
}

function parseTechnicalApproach(value: unknown): TechnicalApproach {
  const approach = objectAt(value, "RELEASE_PLAN_DOCUMENT.featurePlan.technicalApproach");
  assertClosedObject(
    approach,
    ["affectedComponents", "impact", "alternativesConsidered"],
    "RELEASE_PLAN_DOCUMENT.featurePlan.technicalApproach"
  );
  const affectedComponents = arrayAt(
    approach.affectedComponents,
    "RELEASE_PLAN_DOCUMENT.featurePlan.technicalApproach.affectedComponents"
  );
  const alternativesConsidered = arrayAt(
    approach.alternativesConsidered,
    "RELEASE_PLAN_DOCUMENT.featurePlan.technicalApproach.alternativesConsidered"
  );
  if (!affectedComponents.every((item) => typeof item === "string")) {
    throw new Error("RELEASE_PLAN_DOCUMENT.featurePlan.technicalApproach.affectedComponents debe contener strings.");
  }
  if (!alternativesConsidered.every((item) => typeof item === "string")) {
    throw new Error("RELEASE_PLAN_DOCUMENT.featurePlan.technicalApproach.alternativesConsidered debe contener strings.");
  }
  return {
    affectedComponents: affectedComponents as string[],
    impact: stringAt(approach.impact, "RELEASE_PLAN_DOCUMENT.featurePlan.technicalApproach.impact"),
    alternativesConsidered: alternativesConsidered as string[],
  };
}

function parseTestPlan(value: unknown): TestPlan {
  const testPlan = objectAt(value, "RELEASE_PLAN_DOCUMENT.featurePlan.testPlan");
  assertClosedObject(
    testPlan,
    ["level", "scenarios", "evidenceRequired", "validationEnvironment", "externalWrites"],
    "RELEASE_PLAN_DOCUMENT.featurePlan.testPlan"
  );
  if (!NIVELES_TEST.includes(testPlan.level as NivelTest)) {
    throw new Error("RELEASE_PLAN_DOCUMENT.featurePlan.testPlan.level debe ser L1, L2, L3 o L4.");
  }
  const scenarios = arrayAt(testPlan.scenarios, "RELEASE_PLAN_DOCUMENT.featurePlan.testPlan.scenarios").map(
    (item, index) => parseScenario(item, index)
  );
  const evidenceRequired = arrayAt(
    testPlan.evidenceRequired,
    "RELEASE_PLAN_DOCUMENT.featurePlan.testPlan.evidenceRequired"
  );
  if (!evidenceRequired.every((item) => typeof item === "string")) {
    throw new Error("RELEASE_PLAN_DOCUMENT.featurePlan.testPlan.evidenceRequired debe contener strings.");
  }
  return {
    level: testPlan.level as NivelTest,
    scenarios,
    evidenceRequired: evidenceRequired as string[],
    validationEnvironment: stringAt(
      testPlan.validationEnvironment,
      "RELEASE_PLAN_DOCUMENT.featurePlan.testPlan.validationEnvironment"
    ),
    externalWrites: testPlan.externalWrites === null ? null : parseExternalWrites(testPlan.externalWrites),
  };
}

function parseScenario(value: unknown, index: number): TestScenario {
  const scenario = objectAt(value, `RELEASE_PLAN_DOCUMENT.featurePlan.testPlan.scenarios[${index}]`);
  assertClosedObject(
    scenario,
    ["scenario", "action", "expected"],
    `RELEASE_PLAN_DOCUMENT.featurePlan.testPlan.scenarios[${index}]`
  );
  return {
    scenario: stringAt(scenario.scenario, `RELEASE_PLAN_DOCUMENT.featurePlan.testPlan.scenarios[${index}].scenario`),
    action: stringAt(scenario.action, `RELEASE_PLAN_DOCUMENT.featurePlan.testPlan.scenarios[${index}].action`),
    expected: stringAt(scenario.expected, `RELEASE_PLAN_DOCUMENT.featurePlan.testPlan.scenarios[${index}].expected`),
  };
}

function parseExternalWrites(value: unknown): ExternalWrites {
  const writes = objectAt(value, "RELEASE_PLAN_DOCUMENT.featurePlan.testPlan.externalWrites");
  assertClosedObject(
    writes,
    ["expectedEffect", "confirmationMethod", "safetyIdempotencyCleanup"],
    "RELEASE_PLAN_DOCUMENT.featurePlan.testPlan.externalWrites"
  );
  return {
    expectedEffect: stringAt(writes.expectedEffect, "RELEASE_PLAN_DOCUMENT.featurePlan.testPlan.externalWrites.expectedEffect"),
    confirmationMethod: stringAt(
      writes.confirmationMethod,
      "RELEASE_PLAN_DOCUMENT.featurePlan.testPlan.externalWrites.confirmationMethod"
    ),
    safetyIdempotencyCleanup: stringAt(
      writes.safetyIdempotencyCleanup,
      "RELEASE_PLAN_DOCUMENT.featurePlan.testPlan.externalWrites.safetyIdempotencyCleanup"
    ),
  };
}
