import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { releasePlanDocumentPath, releasePlanTemplateMetadata, renderReleasePlanDocument } from "./releasePlanDocument.js";
import type { EvaluacionTamano, FeaturePlan, SecuenciaEntry } from "./releasePlanContracts.js";
import type { ReleasePlanFeatureEntry } from "../cli/escalation.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const evaluacionTamano: EvaluacionTamano = {
  cantidadFeatures: 2,
  factoresRiesgo: ["Dependencia entre Features"],
  conclusion: "Riesgo razonable",
};

const secuencia: SecuenciaEntry[] = [
  { sourceKey: "f1", motivoOrden: "Sin dependencias, base para f2." },
  { sourceKey: "f2", motivoOrden: "Depende de f1." },
];

const operationalFeatures: ReleasePlanFeatureEntry[] = [
  { id: "f1", nombre: "Cálculo de propina", estado: "Completada" },
  { id: "f2", nombre: "Reparto entre comensales", estado: "En curso" },
];

const featurePlanF1: FeaturePlan = {
  sourceKey: "f1",
  technicalApproach: { affectedComponents: ["src/tip.ts"], impact: "Bajo", alternativesConsidered: [] },
  testPlan: {
    level: "L1",
    scenarios: [{ scenario: "Caso base", action: "calculateTip(100, 10)", expected: "10" }],
    evidenceRequired: ["Salida de node --test"],
    validationEnvironment: "local",
    externalWrites: null,
  },
};

test("renderiza las 4 secciones del template en orden fijo", () => {
  const projection = renderReleasePlanDocument({
    evaluacionTamano,
    secuencia,
    featurePlans: [featurePlanF1],
    operationalFeatures,
    hallazgos: "",
  });
  assert.match(projection.markdown, /## 0\. Evaluación de Tamaño del Release/);
  assert.match(projection.markdown, /## 1\. Secuencia del Release/);
  assert.match(projection.markdown, /## 2\. Por Feature — Enfoque Técnico y Test Plan/);
  assert.match(projection.markdown, /## 3\. Hallazgos y Anomalías/);
  assert.ok(projection.markdown.indexOf("## 0.") < projection.markdown.indexOf("## 1."));
  assert.ok(projection.markdown.indexOf("## 2.") < projection.markdown.indexOf("## 3."));
  assert.ok(projection.markdown.endsWith("\n"));
  assert.doesNotMatch(projection.markdown, /\r/);
});

test("§2 respeta el orden de la secuencia, no el orden de llegada de los featurePlans", () => {
  const featurePlanF2: FeaturePlan = { ...featurePlanF1, sourceKey: "f2" };
  const markdown = renderReleasePlanDocument({
    evaluacionTamano,
    secuencia,
    featurePlans: [featurePlanF2, featurePlanF1], // f2 llega primero en el array
    operationalFeatures,
    hallazgos: "",
  }).markdown;
  const indexF1 = markdown.indexOf("### 2.1");
  const indexF2 = markdown.indexOf("### 2.2");
  assert.ok(indexF1 < indexF2);
  assert.match(markdown, /### 2\.1 — Cálculo de propina/);
  assert.match(markdown, /### 2\.2 — Reparto entre comensales/);
});

test("Feature de la secuencia sin featurePlan todavía muestra el placeholder explícito", () => {
  const markdown = renderReleasePlanDocument({
    evaluacionTamano,
    secuencia,
    featurePlans: [featurePlanF1], // f2 todavía no tiene plan
    operationalFeatures,
    hallazgos: "",
  }).markdown;
  assert.match(markdown, /Enfoque técnico y Test Plan todavía no planificados/);
});

test("proyección es determinista", () => {
  const params = { evaluacionTamano, secuencia, featurePlans: [featurePlanF1], operationalFeatures, hallazgos: "" };
  const a = renderReleasePlanDocument(params).markdown;
  const b = renderReleasePlanDocument(params).markdown;
  assert.equal(a, b);
  assert.equal(sha256(a), sha256(b));
});

test("releasePlanDocumentPath usa la ruta canónica por release-key", () => {
  assert.equal(releasePlanDocumentPath("r1"), "docs/releases/r1/RELEASE-PLAN.md");
});

test("metadata conserva versión, hash y snapshot del asset distribuido", () => {
  const metadata = releasePlanTemplateMetadata({
    runbookVersion: "v1.0",
    assetRelativePath: "09-RELEASE-PLAN-TEMPLATE.md",
    assetHash: "abc123",
    content: "# Template\n",
  });
  assert.equal(metadata.templateVersion, "v1.0");
  assert.equal(metadata.templateHash, "abc123");
  assert.deepEqual(metadata.templateSnapshot.descriptor, {
    key: "runbook-release-plan",
    version: "v1.0",
    sections: ["size_evaluation", "sequence", "feature_plans", "findings"],
  });
});
