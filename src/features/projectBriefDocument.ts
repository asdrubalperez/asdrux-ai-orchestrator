import { normalizeLf } from "./document.js";
import type { ProjectBriefPayload } from "./projectBriefContracts.js";
import type { RunbookTextAsset } from "../runbook/runbookProvider.js";

export const PROJECT_BRIEF_TEMPLATE_KEY = "runbook-project-brief";
export const PROJECT_BRIEF_DOCUMENT_PATH = "docs/project/PROJECT-BRIEF.md";

const PROJECT_BRIEF_DESCRIPTOR_SECTIONS = Object.freeze([
  "declarative_gate",
  "context",
  "preliminary_evaluation",
  "preliminary_schema",
  "conclusion",
  "findings",
]);

/** FEATURE-033: mismo patrón de snapshot de template que `functionalTemplateMetadata` (FEATURE-023). */
export function projectBriefTemplateMetadata(templateAsset: RunbookTextAsset) {
  return {
    templateVersion: templateAsset.runbookVersion,
    templateHash: templateAsset.assetHash,
    templateSnapshot: {
      template: templateAsset.content,
      runbookVersion: templateAsset.runbookVersion,
      assetRelativePath: templateAsset.assetRelativePath,
      descriptor: {
        key: PROJECT_BRIEF_TEMPLATE_KEY,
        version: templateAsset.runbookVersion,
        sections: PROJECT_BRIEF_DESCRIPTOR_SECTIONS,
      },
    },
  };
}

export interface ProjectBriefProjection {
  markdown: string;
  summary: string;
}

/**
 * Renderer determinístico y específico de `01-PROJECT-BRIEF-TEMPLATE.md` — mismo criterio que
 * `renderFeatureDocument`: un template, un renderer, sin motor genérico (FEATURE-023, §9 Riesgos).
 */
export function renderProjectBriefDocument(payload: ProjectBriefPayload): ProjectBriefProjection {
  const lines: string[] = [
    "# Project Brief",
    "",
    "## 0. Chequeo Declarativo",
    "",
    "| Campo | Valor |",
    "|---|---|",
    `| Identidad del sistema | ${inlineCell(payload.declarativos.identidadSistema)} |`,
    `| Ubicación y forma de acceso al código fuente | ${inlineCell(payload.declarativos.accesoCodigoFuente)} |`,
    `| Restricciones de negocio | ${inlineCell(payload.declarativos.restriccionesNegocio)} |`,
    `| Intención/objetivo de negocio | ${inlineCell(payload.declarativos.intencionNegocio)} |`,
    "",
    "## 1. Contexto de la Iniciativa",
    "",
    `- **Problema que se busca resolver:** ${payload.contexto.problema}`,
    `- **Situación actual del sistema/negocio:** ${payload.contexto.situacionActual}`,
    `- **Valor esperado:** ${payload.contexto.valorEsperado}`,
    "",
    "## 2. Evaluación Preliminar",
    "",
    "| Ítem | Estado | Comentario |",
    "|---|---|---|",
    ...payload.evaluacionPreliminar.map(
      (row) => `| ${inlineCell(row.item)} | ${row.estado} | ${inlineCell(row.comentario)} |`
    ),
    "",
    "## 3. Esquema Preliminar de Solución (TO BE)",
    "",
    `- **Flujo esperado:** ${payload.esquemaPreliminar.flujoEsperado}`,
    `- **Sistemas/componentes involucrados:** ${payload.esquemaPreliminar.sistemasInvolucrados}`,
    `- **Integraciones necesarias:** ${payload.esquemaPreliminar.integracionesNecesarias}`,
    `- **¿Expuesto a Internet?:** ${payload.esquemaPreliminar.expuestoInternet}`,
    "",
    "## 4. Conclusión",
    "",
    `- **Complejidad técnica estimada:** ${payload.complejidadTecnica}`,
    "",
    "## 5. Hallazgos y Anomalías",
    "",
    payload.hallazgos.trim().length > 0 ? payload.hallazgos : "Sin hallazgos.",
    "",
  ];

  return {
    markdown: normalizeLf(lines.join("\n")),
    summary: payload.contexto.problema,
  };
}

function inlineCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
