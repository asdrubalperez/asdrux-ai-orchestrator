import type { ExecutorProviderName } from "../db/repository.js";

// FEATURE-025-Parte-1, sección 7.4: catálogo cerrado y server-side, actualizado manualmente por
// código -- nunca consultado en vivo contra proveedores externos (Scope Excluido). Los valores de
// Claude se toman de los modelos vigentes documentados en el entorno de este repo
// (docs/features/FEATURE-001/002-spike-results.md, src/intake/mapBusinessCase.ts:
// DEFAULT_MAPPING_MODEL) -- estos IDs con fecha/versión son los que necesita el rol "intake"
// (llama directo a la API de Anthropic, mapBusinessCase.ts); para los 5 roles del pipeline en modo
// OAuth, claudeCodeExecutor.ts los traduce internamente a alias genéricos (ver
// toCliSessionModelAlias) -- el catálogo no necesita duplicarse por eso.
// Los de Codex se confirmaron contra la documentación oficial vigente
// (https://learn.chatgpt.com/codex/models, 2026-08-03): gpt-5.6-sol/terra/luna son los tres
// modelos GPT-5.6 recomendados; "terra" faltaba en el catálogo anterior (hallazgo del owner
// durante la validación en vivo de FEATURE-025).
export const AGENT_MODEL_CATALOG: Readonly<Record<ExecutorProviderName, readonly string[]>> = {
  claude: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
  codex: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
};

export function modelsForProvider(provider: ExecutorProviderName): readonly string[] {
  return AGENT_MODEL_CATALOG[provider];
}

export function isModelSupportedByProvider(provider: ExecutorProviderName, model: string): boolean {
  return AGENT_MODEL_CATALOG[provider].includes(model);
}
