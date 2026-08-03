import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAiApiMappingAdapter } from "./openAiApiMappingAdapter.js";
import { IntakeMappingInvalidResponseError, IntakeMappingRateLimitedError } from "./intakeMappingErrors.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const REQUEST = { systemPrompt: "sistema", userPrompt: "usuario", model: "gpt-5.6-luna", timeoutMs: 5000 };

test("createOpenAiApiMappingAdapter usa el campo de conveniencia output_text cuando está presente", async () => {
  let capturedInit: RequestInit | undefined;
  const adapter = createOpenAiApiMappingAdapter("sk-openai-test", async (_url, init) => {
    capturedInit = init;
    return jsonResponse(200, { output_text: '{"vision":"y"}' });
  });
  const result = await adapter.map(REQUEST);
  assert.equal(result, '{"vision":"y"}');
  assert.equal((capturedInit?.headers as Record<string, string>).authorization, "Bearer sk-openai-test");
  assert.match(String(capturedInit?.body), /gpt-5\.6-luna/);
});

test("createOpenAiApiMappingAdapter recorre output[].content[] cuando no hay output_text", async () => {
  const adapter = createOpenAiApiMappingAdapter("sk-openai-test", async () =>
    jsonResponse(200, { output: [{ type: "message", content: [{ type: "output_text", text: '{"vision":"z"}' }] }] })
  );
  const result = await adapter.map(REQUEST);
  assert.equal(result, '{"vision":"z"}');
});

test("createOpenAiApiMappingAdapter clasifica un 429 como rate_limited", async () => {
  const adapter = createOpenAiApiMappingAdapter("sk-openai-test", async () => jsonResponse(429, { error: "too many requests" }));
  await assert.rejects(adapter.map(REQUEST), IntakeMappingRateLimitedError);
});

test("createOpenAiApiMappingAdapter rechaza una respuesta sin ningún texto reconocible", async () => {
  const adapter = createOpenAiApiMappingAdapter("sk-openai-test", async () => jsonResponse(200, { output: [] }));
  await assert.rejects(adapter.map(REQUEST), IntakeMappingInvalidResponseError);
});
