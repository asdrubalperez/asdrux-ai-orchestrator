import test from "node:test";
import assert from "node:assert/strict";
import { extractCodexHeaderValue, parseCodexPhaseResultFromStdout } from "./codexExecutor.js";

test("parsea header de modelo y JSON final de Codex", () => {
  const stdout = [
    "OpenAI Codex v0.144.5",
    "--------",
    "model: gpt-5.6-luna",
    "provider: openai",
    "sandbox: read-only",
    "--------",
    "codex",
    '{"status":"completed","outputArtifact":"artefacto","summary":"ok","escalationReason":null}',
    "tokens used",
    "9,655",
    '{"status":"completed","outputArtifact":"artefacto","summary":"ok","escalationReason":null}',
  ].join("\n");

  assert.equal(extractCodexHeaderValue(stdout, "model"), "gpt-5.6-luna");
  assert.deepEqual(parseCodexPhaseResultFromStdout(stdout), {
    status: "completed",
    outputArtifact: "artefacto",
    summary: "ok",
    escalationReason: null,
  });
});

test("rechaza status fuera del contrato", () => {
  const stdout = '{"status":"unknown","outputArtifact":null,"summary":"x","escalationReason":null}';

  assert.throws(() => parseCodexPhaseResultFromStdout(stdout), /status invalido/);
});
