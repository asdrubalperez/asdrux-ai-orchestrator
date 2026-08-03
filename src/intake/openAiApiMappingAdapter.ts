import type { IntakeMappingAdapter, IntakeMappingRequest } from "./intakeMappingAdapters.js";
import { classifyHttpMappingError, IntakeMappingInvalidResponseError, IntakeMappingTimeoutError } from "./intakeMappingErrors.js";

// FEATURE-025-Parte-3, sección 5.7/7.7: primera llamada HTTP directa a la API de OpenAI en este
// repo -- no hay SDK de OpenAI instalado, y una única llamada no lo justifica (Regla del cambio
// mínimo). Usa la Responses API (recomendada por OpenAI sobre Chat Completions para modelos Codex,
// confirmado contra developers.openai.com/api/docs/models -- los IDs gpt-5.6-sol/terra/luna son
// válidos ahí, mismos nombres que usa el Codex CLI). No se pudo validar en vivo contra una cuenta
// real en este entorno de desarrollo -- el parseo de la respuesta es defensivo (intenta el campo de
// conveniencia `output_text` primero, y si no está, recorre `output[].content[]` buscando el primer
// bloque de texto) precisamente porque no hay forma de confirmar la forma exacta sin una llamada
// real. Ajustar `extractResponseText` si la forma real difiere.
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export const DEFAULT_OPENAI_MAPPING_MODEL = "gpt-5.6-luna";

interface OpenAiResponsesPayload {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
}

function extractResponseText(payload: OpenAiResponsesPayload): string | null {
  if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text;
  }
  for (const item of payload.output ?? []) {
    for (const block of item.content ?? []) {
      if (typeof block.text === "string" && block.text.trim().length > 0) {
        return block.text;
      }
    }
  }
  return null;
}

/** FEATURE-026, mismo patrón: fetchImpl inyectable para tests, default fetch real. */
export function createOpenAiApiMappingAdapter(apiKey: string, fetchImpl: typeof fetch = fetch): IntakeMappingAdapter {
  return {
    async map(request: IntakeMappingRequest): Promise<string> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(OPENAI_RESPONSES_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: request.model ?? DEFAULT_OPENAI_MAPPING_MODEL,
            input: [
              { role: "system", content: request.systemPrompt },
              { role: "user", content: request.userPrompt },
            ],
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          throw new IntakeMappingTimeoutError("Timeout esperando la respuesta de OpenAI.");
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error(`[intake-mapping] OpenAI Responses API respondió ${response.status}: ${body}`);
        throw classifyHttpMappingError(response.status, "OpenAI");
      }

      const payload = (await response.json()) as OpenAiResponsesPayload;
      const text = extractResponseText(payload);
      if (!text) {
        throw new IntakeMappingInvalidResponseError("La respuesta de OpenAI no tiene contenido de texto.");
      }
      return text;
    },
  };
}
