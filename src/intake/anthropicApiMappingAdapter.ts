import type { IntakeMappingAdapter, IntakeMappingRequest } from "./intakeMappingAdapters.js";
import { classifyHttpMappingError, IntakeMappingInvalidResponseError, IntakeMappingTimeoutError } from "./intakeMappingErrors.js";

// FEATURE-017/FEATURE-025-Parte-3: llamada directa a la Messages API de Anthropic, sin SDK (no hay
// SDK de Anthropic como dependencia en este repo -- ver claudeCodeExecutor.ts). Camino sin cambios
// de fondo respecto al que ya usaba mapBusinessCase.ts -- solo se extrae a su propio adaptador y se
// le agrega timeout/taxonomía de error común (decisión de arquitectura, sección 3.1: API key nunca
// pasa por Docker).
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Default cuando el rol "intake" no tiene un modelo propio configurado -- económico, porque esta
// llamada es extracción estructurada de texto, no razonamiento complejo.
export const DEFAULT_ANTHROPIC_MAPPING_MODEL = "claude-haiku-4-5-20251001";

/** FEATURE-026, mismo patrón: fetchImpl inyectable para tests, default fetch real. */
export function createAnthropicApiMappingAdapter(apiKey: string, fetchImpl: typeof fetch = fetch): IntakeMappingAdapter {
  return {
    async map(request: IntakeMappingRequest): Promise<string> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model: request.model ?? DEFAULT_ANTHROPIC_MAPPING_MODEL,
            max_tokens: 4096,
            system: request.systemPrompt,
            messages: [{ role: "user", content: request.userPrompt }],
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          throw new IntakeMappingTimeoutError("Timeout esperando la respuesta de Anthropic.");
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error(`[intake-mapping] Anthropic Messages API respondió ${response.status}: ${body}`);
        throw classifyHttpMappingError(response.status, "Anthropic");
      }

      const payload = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
      const textBlock = payload.content?.find((block) => block.type === "text" && typeof block.text === "string");
      if (!textBlock?.text) {
        throw new IntakeMappingInvalidResponseError("La respuesta de Anthropic no tiene contenido de texto.");
      }
      return textBlock.text;
    },
  };
}
