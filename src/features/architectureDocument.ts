import { normalizeLf } from "./canonicalDocument.js";
import type { ArchitecturePayload } from "./architectureContracts.js";
import type { RoadmapApprovalPayload } from "../cli/escalation.js";
import type { RunbookTextAsset } from "../runbook/runbookProvider.js";

export const ARCHITECTURE_TEMPLATE_KEY = "runbook-architecture";
export const ARCHITECTURE_DOCUMENT_PATH = "docs/architecture/ARCHITECTURE.md";

const ARCHITECTURE_DESCRIPTOR_SECTIONS = Object.freeze([
  "roadmap",
  "technical_analysis",
  "components",
  "risk_analysis",
  "findings",
]);

/** FEATURE-034: mismo patrón de snapshot de template que `functionalTemplateMetadata`/`projectBriefTemplateMetadata`. */
export function architectureTemplateMetadata(templateAsset: RunbookTextAsset) {
  return {
    templateVersion: templateAsset.runbookVersion,
    templateHash: templateAsset.assetHash,
    templateSnapshot: {
      template: templateAsset.content,
      runbookVersion: templateAsset.runbookVersion,
      assetRelativePath: templateAsset.assetRelativePath,
      descriptor: {
        key: ARCHITECTURE_TEMPLATE_KEY,
        version: templateAsset.runbookVersion,
        sections: ARCHITECTURE_DESCRIPTOR_SECTIONS,
      },
    },
  };
}

export interface ArchitectureProjection {
  markdown: string;
  summary: string;
}

/**
 * Renderer determinístico y específico de `02-ARCHITECTURE-TEMPLATE.md`. §0 (Roadmap) se compone
 * SIEMPRE desde `approvedRoadmap` (project_config_versions.release_roadmap ya aprobado) -- el
 * payload de Architect no trae Roadmap (Rule 3/Rule 5 del diseño F034), así que nunca hay una
 * segunda copia que pueda divergir. La severidad de cada riesgo ya viene derivada
 * determinísticamente por `parseArchitecturePayload` (Rule 15), el renderer sólo la imprime.
 */
export function renderArchitectureDocument(
  payload: ArchitecturePayload,
  approvedRoadmap: RoadmapApprovalPayload
): ArchitectureProjection {
  const lines: string[] = [
    "# Architecture",
    "",
    "## 0. Roadmap de Releases",
    "",
    "| Release | Alcance (resumen) | Estado |",
    "|---|---|---|",
    ...approvedRoadmap.releases.map(
      (release) => `| ${inlineCell(release.nombre)} | ${inlineCell(release.alcanceResumen)} | ${release.estado} |`
    ),
    "",
    "## 1. Análisis Técnico",
    "",
    `- **Descripción macro de la arquitectura:** ${payload.analisisTecnico.descripcionMacro}`,
    `- **Backend:** ${payload.analisisTecnico.backend}`,
    `- **Frontend:** ${payload.analisisTecnico.frontend}`,
    `- **Bases de datos:** ${payload.analisisTecnico.basesDatos}`,
    `- **Integraciones y APIs:** ${payload.analisisTecnico.integracionesApis}`,
    `- **¿Requiere infraestructura nueva?** ${condicion(payload.analisisTecnico.requiereInfraestructura)}`,
    `- **¿Consume servicios externos?** ${condicion(payload.analisisTecnico.consumeServiciosExternos)}`,
    `- **¿Tecnología nueva para este producto?** ${condicion(payload.analisisTecnico.tecnologiaNuevaProducto)}`,
    "",
    "## 2. Componentes Técnicos",
    "",
    "| Componente | Tipo | Descripción |",
    "|---|---|---|",
    ...payload.componentes.map(
      (c) => `| ${inlineCell(c.nombre)} | ${inlineCell(c.tipo)} | ${inlineCell(c.descripcion)} |`
    ),
    "",
    "## 3. Análisis de Riesgo",
    "",
    "| Situación Analizada | Riesgo | Impacto | Severidad | Acción Recomendada |",
    "|---|---|---|---|---|",
    ...payload.riesgos.map(
      (r) =>
        `| ${inlineCell(r.situacionAnalizada)} | ${r.riesgo} | ${r.impacto} | ${r.severidad} | ${inlineCell(r.accionRecomendada)} |`
    ),
    "",
    "## 4. Hallazgos y Anomalías",
    "",
    payload.hallazgos.trim().length > 0 ? payload.hallazgos : "Sin hallazgos.",
    "",
  ];

  return {
    markdown: normalizeLf(lines.join("\n")),
    summary: payload.analisisTecnico.descripcionMacro,
  };
}

function condicion(value: { valor: "Sí" | "No"; detalle: string }): string {
  return value.detalle ? `${value.valor} — ${value.detalle}` : value.valor;
}

function inlineCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
