import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyHttpMappingError,
  IntakeMappingAuthenticationRequiredError,
  IntakeMappingModelUnsupportedError,
  IntakeMappingProviderUnavailableError,
  IntakeMappingRateLimitedError,
  IntakeMappingFailedError,
} from "./intakeMappingErrors.js";

test("classifyHttpMappingError mapea los status HTTP a la taxonomía funcional de la sección 5.15", () => {
  assert.ok(classifyHttpMappingError(401, "Anthropic") instanceof IntakeMappingAuthenticationRequiredError);
  assert.ok(classifyHttpMappingError(403, "OpenAI") instanceof IntakeMappingAuthenticationRequiredError);
  assert.ok(classifyHttpMappingError(429, "Anthropic") instanceof IntakeMappingRateLimitedError);
  assert.ok(classifyHttpMappingError(500, "OpenAI") instanceof IntakeMappingProviderUnavailableError);
  assert.ok(classifyHttpMappingError(503, "Anthropic") instanceof IntakeMappingProviderUnavailableError);
  assert.ok(classifyHttpMappingError(400, "OpenAI") instanceof IntakeMappingModelUnsupportedError);
  assert.ok(classifyHttpMappingError(404, "Anthropic") instanceof IntakeMappingModelUnsupportedError);
  assert.ok(classifyHttpMappingError(418, "OpenAI") instanceof IntakeMappingFailedError);
});

test("classifyHttpMappingError nunca incluye el providerLabel como si fuera un secreto -- solo el status", () => {
  const err = classifyHttpMappingError(401, "Anthropic");
  assert.match(err.message, /Anthropic/);
  assert.match(err.message, /401/);
});
