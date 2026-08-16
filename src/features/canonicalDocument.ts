import { createHash } from "node:crypto";

/**
 * FEATURE-034: primitivas puras sin lógica de dominio, extraídas de `document.ts` ahora que hay
 * 3 consumidores reales (Feature, Project Brief, Architecture) — criterio ya acordado en el
 * handoff de F033 (Rule 15 de `architect.txt`: sólo se extrae código común con consumidores reales
 * probados, nunca por anticipación).
 */
export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeLf(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\n*$/, "\n");
}

/** Mismo contrato de truncado que usan `getFeatureDocumentForRun`/`getProjectBriefDocumentForRun` (64 KiB, FEATURE-022). */
export const DOCUMENT_SIZE_LIMIT_BYTES = 64 * 1024;

export function isWithinDocumentSizeLimit(markdown: string): boolean {
  return Buffer.byteLength(JSON.stringify(markdown), "utf8") <= DOCUMENT_SIZE_LIMIT_BYTES;
}
