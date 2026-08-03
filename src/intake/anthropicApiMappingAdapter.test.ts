import assert from "node:assert/strict";
import test from "node:test";
import { createAnthropicApiMappingAdapter } from "./anthropicApiMappingAdapter.js";
import { IntakeMappingAuthenticationRequiredError, IntakeMappingInvalidResponseError } from "./intakeMappingErrors.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const REQUEST = { systemPrompt: "sistema", userPrompt: "usuario", model: "claude-haiku-4-5-20251001", timeoutMs: 5000 };

test("createAnthropicApiMappingAdapter extrae el bloque de texto de la respuesta y manda la API key en el header correcto", async () => {
  let capturedInit: RequestInit | undefined;
  const adapter = createAnthropicApiMappingAdapter("sk-ant-test", async (_url, init) => {
    capturedInit = init;
    return jsonResponse(200, { content: [{ type: "text", text: '{"vision":"x"}' }] });
  });
  const result = await adapter.map(REQUEST);
  assert.equal(result, '{"vision":"x"}');
  assert.equal((capturedInit?.headers as Record<string, string>)["x-api-key"], "sk-ant-test");
  assert.match(String(capturedInit?.body), /claude-haiku-4-5-20251001/);
});

test("createAnthropicApiMappingAdapter clasifica un 401 como authentication_required, sin filtrar el cuerpo crudo", async () => {
  const adapter = createAnthropicApiMappingAdapter("sk-ant-test", async () => jsonResponse(401, { error: { message: "secreto interno" } }));
  await assert.rejects(adapter.map(REQUEST), (err: unknown) => {
    assert.ok(err instanceof IntakeMappingAuthenticationRequiredError);
    assert.doesNotMatch(err.message, /secreto interno/);
    return true;
  });
});

test("createAnthropicApiMappingAdapter rechaza una respuesta sin bloque de texto", async () => {
  const adapter = createAnthropicApiMappingAdapter("sk-ant-test", async () => jsonResponse(200, { content: [] }));
  await assert.rejects(adapter.map(REQUEST), IntakeMappingInvalidResponseError);
});
