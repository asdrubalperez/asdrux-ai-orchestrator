import assert from "node:assert/strict";
import test from "node:test";
import { generateGitCredentialEncryptionKey } from "./gitCredentialEncryption.js";
import { decryptOAuthSession, encryptOAuthSession, OAuthSessionEnvelopeError } from "./aiOAuthSessionEnvelope.js";

function withKey<T>(fn: () => T): T {
  const original = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AI_CREDENTIAL_ENCRYPTION_KEY = generateGitCredentialEncryptionKey();
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = original;
  }
}

test("encryptOAuthSession/decryptOAuthSession: round trip preserva el contenido exacto", () => {
  withKey(() => {
    const plaintext = JSON.stringify({ accessToken: "at-123", refreshToken: "rt-456" });
    const stored = encryptOAuthSession(plaintext, "claude");
    assert.equal(decryptOAuthSession(stored, "claude"), plaintext);
  });
});

// Regla 5.8.4: la AAD incluye provider -- descifrar con un provider distinto debe fallar, incluso
// con la clave correcta (protege contra reasignar el blob de un proveedor a otro).
test("decryptOAuthSession rechaza un provider distinto al que se cifró (AAD)", () => {
  withKey(() => {
    const stored = encryptOAuthSession("{}", "claude");
    assert.throws(() => decryptOAuthSession(stored, "codex"), OAuthSessionEnvelopeError);
  });
});

test("decryptOAuthSession rechaza un envelope manipulado", () => {
  withKey(() => {
    const stored = encryptOAuthSession(JSON.stringify({ token: "secret" }), "codex");
    const envelope = JSON.parse(stored);
    envelope.ciphertext = Buffer.from("manipulado").toString("base64");
    assert.throws(() => decryptOAuthSession(JSON.stringify(envelope), "codex"), OAuthSessionEnvelopeError);
  });
});

test("decryptOAuthSession rechaza un string que no es JSON", () => {
  withKey(() => {
    assert.throws(() => decryptOAuthSession("no-es-json", "claude"), OAuthSessionEnvelopeError);
  });
});
