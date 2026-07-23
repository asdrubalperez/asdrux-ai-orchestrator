import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const schemaPath = new URL(
  "../../docs/features/schemas/FEATURE-015A-holder-worker-protocol.schema.json",
  import.meta.url
);
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);
const token = randomBytes(32).toString("base64url");
const callId = randomUUID();

const validMessages = [
  { protocolVersion: "1", messageType: "tool_call", callId, channelToken: token, toolName: "read.file", args: {} },
  { protocolVersion: "1", messageType: "cancel", callId, channelToken: token },
  { protocolVersion: "1", messageType: "tool_result", callId, result: { ok: true } },
  { protocolVersion: "1", messageType: "tool_error", callId, error: { code: "CANCELLED", message: "cancelled" } },
  { protocolVersion: "1", messageType: "cancel_ack", callId, status: "accepted" },
];

test("Draft 2020-12 acepta los cinco envelopes válidos", () => {
  for (const message of validMessages) {
    assert.equal(validate(message), true, JSON.stringify(validate.errors));
  }
});

test("rechaza campos extra, faltantes y discriminadores desconocidos", () => {
  const invalid = [
    { ...validMessages[0], extra: true },
    { ...validMessages[0], channelToken: undefined },
    { ...validMessages[1], channelToken: undefined },
    { ...validMessages[2], error: { code: "TIMEOUT", message: "x" } },
    { ...validMessages[2], messageType: "unknown" },
  ];
  for (const message of invalid) assert.equal(validate(message), false, JSON.stringify(message));
});

test("rechaza versión, UUID y base64url no canónicos", () => {
  const invalid = [
    { ...validMessages[0], protocolVersion: "1.0" },
    { ...validMessages[0], callId: callId.toUpperCase() },
    { ...validMessages[0], callId: "00000000-0000-4000-7000-000000000000" },
    { ...validMessages[0], channelToken: randomBytes(31).toString("base64url") },
    { ...validMessages[0], channelToken: `${token}=` },
    { ...validMessages[0], channelToken: `${token.slice(0, -1)}B` },
  ];
  for (const message of invalid) assert.equal(validate(message), false, JSON.stringify(message));
});

test("rechaza errores y acks fuera de enum", () => {
  assert.equal(
    validate({ ...validMessages[3], error: { code: "TOKEN_BAD", message: "x" } }),
    false
  );
  assert.equal(validate({ ...validMessages[4], status: "maybe" }), false);
});
