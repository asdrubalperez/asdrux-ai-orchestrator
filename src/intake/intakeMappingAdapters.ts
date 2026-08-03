import type { ResolvedExecutorAuthentication } from "../auth/aiCredentialService.js";
import type { ExecutorProviderName } from "../db/repository.js";
import { createAnthropicApiMappingAdapter } from "./anthropicApiMappingAdapter.js";
import { createOpenAiApiMappingAdapter } from "./openAiApiMappingAdapter.js";
import { createClaudeOAuthMappingAdapter } from "./claudeOAuthMappingAdapter.js";
import { createCodexOAuthMappingAdapter } from "./codexOAuthMappingAdapter.js";

// FEATURE-025-Parte-3, sección 6.2: contrato común de los 4 adaptadores -- reciben el mismo prompt
// (buildMappingPrompt) y devuelven texto plano, que el caller procesa con parseMappingResponse. La
// diferencia de arquitectura entre API key (HTTP directo) y OAuth (holder Docker) queda encapsulada
// adentro de cada adaptador; el caller (mapBusinessCase.ts) no la ve.

export interface IntakeMappingRequest {
  systemPrompt: string;
  userPrompt: string;
  model: string | null;
  timeoutMs: number;
}

export interface IntakeMappingAdapter {
  map(request: IntakeMappingRequest): Promise<string>;
}

/**
 * Sección 5.2/5.3: selecciona exactamente un camino según provider + el modo de autenticación ya
 * resuelto por el caller (resolveExecutorAuthentication, Parte 1/2) -- nunca fallback entre
 * proveedores ni entre modos de autenticación.
 */
export function selectIntakeMappingAdapter(
  provider: ExecutorProviderName,
  authentication: ResolvedExecutorAuthentication
): IntakeMappingAdapter {
  if (authentication.mode === "api_key") {
    if (provider === "claude") return createAnthropicApiMappingAdapter(authentication.apiKey);
    if (provider === "codex") return createOpenAiApiMappingAdapter(authentication.apiKey);
  } else {
    if (provider === "claude") return createClaudeOAuthMappingAdapter(authentication.oauthDirectory);
    if (provider === "codex") return createCodexOAuthMappingAdapter(authentication.oauthDirectory);
  }
  // Defensivo (Escenario 26/27 del diseño): provider/authMode fuera del union ya validado por
  // TypeScript y por el CHECK constraint de la DB -- solo alcanzable por corrupción de datos.
  throw new Error(`Combinación de mapeo de intake no soportada: provider=${provider}, authMode=${authentication.mode}.`);
}
