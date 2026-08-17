import { normalizeLf } from "./canonicalDocument.js";
import type { EvaluacionTamano, FeaturePlan, SecuenciaEntry } from "./releasePlanContracts.js";
import type { ReleasePlanFeatureEntry } from "../cli/escalation.js";
import type { RunbookTextAsset } from "../runbook/runbookProvider.js";

export const RELEASE_PLAN_TEMPLATE_KEY = "runbook-release-plan";

const RELEASE_PLAN_DESCRIPTOR_SECTIONS = Object.freeze([
  "size_evaluation",
  "sequence",
  "feature_plans",
  "findings",
]);

export function releasePlanDocumentPath(releaseKey: string): string {
  return `docs/releases/${releaseKey}/RELEASE-PLAN.md`;
}

/** FEATURE-035: mismo patrón de snapshot de template que Project Brief/Architecture. */
export function releasePlanTemplateMetadata(templateAsset: RunbookTextAsset) {
  return {
    templateVersion: templateAsset.runbookVersion,
    templateHash: templateAsset.assetHash,
    templateSnapshot: {
      template: templateAsset.content,
      runbookVersion: templateAsset.runbookVersion,
      assetRelativePath: templateAsset.assetRelativePath,
      descriptor: {
        key: RELEASE_PLAN_TEMPLATE_KEY,
        version: templateAsset.runbookVersion,
        sections: RELEASE_PLAN_DESCRIPTOR_SECTIONS,
      },
    },
  };
}

export interface ReleasePlanProjection {
  markdown: string;
  summary: string;
}

/**
 * Renderer determinístico de `09-RELEASE-PLAN-TEMPLATE.md`. §0/§1 vienen del payload rico
 * (redeclarado completo en cada invocación, Rule 6); §2 viene de `featurePlans` YA ACUMULADOS por
 * el runtime (`releasePlanLifecycle.ts`), nunca del payload crudo de una sola invocación -- el
 * merge ya ocurrió antes de llamar a este renderer. El orden de los bloques de §2 sigue el orden
 * de `secuencia`, no el orden de llegada de los featurePlans.
 */
export function renderReleasePlanDocument(params: {
  evaluacionTamano: EvaluacionTamano;
  secuencia: SecuenciaEntry[];
  featurePlans: FeaturePlan[];
  operationalFeatures: ReleasePlanFeatureEntry[];
  hallazgos: string;
}): ReleasePlanProjection {
  const featurePlanBySourceKey = new Map(params.featurePlans.map((plan) => [plan.sourceKey, plan]));
  const nombreBySourceKey = new Map(params.operationalFeatures.map((feature) => [feature.id, feature.nombre]));

  const lines: string[] = [
    "# Release Plan",
    "",
    "## 0. Evaluación de Tamaño del Release",
    "",
    `- **Cantidad de Features en este release:** ${params.evaluacionTamano.cantidadFeatures}`,
    `- **Factores de riesgo considerados:** ${bulletsInline(params.evaluacionTamano.factoresRiesgo)}`,
    `- **Conclusión:** ${params.evaluacionTamano.conclusion}`,
    "",
    "## 1. Secuencia del Release",
    "",
    "| Orden | Feature | Motivo del orden |",
    "|---|---|---|",
    ...params.secuencia.map(
      (entry, index) =>
        `| ${index + 1} | ${inlineCell(nombreBySourceKey.get(entry.sourceKey) ?? entry.sourceKey)} | ${inlineCell(entry.motivoOrden)} |`
    ),
    "",
    "## 2. Por Feature — Enfoque Técnico y Test Plan",
    "",
    ...params.secuencia.flatMap((entry, index) =>
      renderFeatureBlock(index + 1, entry, nombreBySourceKey.get(entry.sourceKey) ?? entry.sourceKey, featurePlanBySourceKey.get(entry.sourceKey))
    ),
    "## 3. Hallazgos y Anomalías",
    "",
    params.hallazgos.trim().length > 0 ? params.hallazgos : "Sin hallazgos.",
    "",
  ];

  return {
    markdown: normalizeLf(lines.join("\n")),
    summary: `Release Plan — ${params.secuencia.length} Feature(s), ${params.evaluacionTamano.conclusion}.`,
  };
}

function renderFeatureBlock(
  orden: number,
  entry: SecuenciaEntry,
  nombre: string,
  plan: FeaturePlan | undefined
): string[] {
  if (!plan) {
    return [
      `### 2.${orden} — ${nombre}`,
      "",
      "_Enfoque técnico y Test Plan todavía no planificados._",
      "",
    ];
  }
  return [
    `### 2.${orden} — ${nombre}`,
    "",
    "**Enfoque técnico:**",
    "",
    `- Componentes afectados: ${bulletsInline(plan.technicalApproach.affectedComponents)}`,
    `- Impacto: ${plan.technicalApproach.impact}`,
    `- Alternativas consideradas: ${bulletsInline(plan.technicalApproach.alternativesConsidered)}`,
    "",
    "**Test Plan:**",
    "",
    `- Nivel de testing: ${plan.testPlan.level}`,
    "- Escenarios:",
    ...plan.testPlan.scenarios.map(
      (s) => `  - ${s.scenario}: ${s.action} → ${s.expected}`
    ),
    `- Evidencia requerida: ${bulletsInline(plan.testPlan.evidenceRequired)}`,
    `- Ambiente de validación: ${plan.testPlan.validationEnvironment}`,
    ...(plan.testPlan.externalWrites
      ? [
          `- Efecto externo esperado: ${plan.testPlan.externalWrites.expectedEffect}`,
          `- Método de confirmación: ${plan.testPlan.externalWrites.confirmationMethod}`,
          `- Seguridad/idempotencia/limpieza: ${plan.testPlan.externalWrites.safetyIdempotencyCleanup}`,
        ]
      : []),
    "",
  ];
}

function bulletsInline(items: string[]): string {
  return items.length > 0 ? items.join("; ") : "Ninguno.";
}

function inlineCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
