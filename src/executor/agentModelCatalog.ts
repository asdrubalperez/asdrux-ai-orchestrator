import type { ExecutorProviderName } from "../db/repository.js";

// FEATURE-025-Parte-1, sección 7.4: catálogo cerrado y server-side, actualizado manualmente por
// código -- nunca consultado en vivo contra proveedores externos (Scope Excluido). Los valores de
// Claude se toman de los modelos vigentes documentados en el entorno de este repo
// (docs/features/FEATURE-001/002-spike-results.md, src/intake/mapBusinessCase.ts:
// DEFAULT_MAPPING_MODEL). Los de Codex se toman de la evidencia real más reciente encontrada en
// docs/features/evidence/FEATURE-008/*.md (`gpt-5.6-luna`/`gpt-5.6-sol`) -- a diferencia de Claude,
// no hay una fuente única de verdad vigente para Codex dentro del repo. **Debe confirmarse contra
// las versiones realmente soportadas por `codex` CLI antes de habilitar esta Feature en
// producción** (Riesgo 6 del diseño: catálogo desactualizado, mantenimiento manual explícito).
export const AGENT_MODEL_CATALOG: Readonly<Record<ExecutorProviderName, readonly string[]>> = {
  claude: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
  codex: ["gpt-5.6-luna", "gpt-5.6-sol"],
};

export function modelsForProvider(provider: ExecutorProviderName): readonly string[] {
  return AGENT_MODEL_CATALOG[provider];
}

export function isModelSupportedByProvider(provider: ExecutorProviderName, model: string): boolean {
  return AGENT_MODEL_CATALOG[provider].includes(model);
}
