import assert from "node:assert/strict";
import test from "node:test";
import { generateGitCredentialEncryptionKey } from "./gitCredentialEncryption.js";
import { AiCredentialEncryptionKeyError, aiCredentialEncryptionKeyFromEnv } from "./aiCredentialEncryptionKey.js";

// FEATURE-025-Parte-1, sección 7.3: la clave de credenciales de IA es independiente de
// GIT_CREDENTIAL_ENCRYPTION_KEY -- confirma que resuelve su propia variable de entorno, no la de Git.
test("aiCredentialEncryptionKeyFromEnv resuelve AI_CREDENTIAL_ENCRYPTION_KEY, no GIT_CREDENTIAL_ENCRYPTION_KEY", () => {
  const original = { ai: process.env.AI_CREDENTIAL_ENCRYPTION_KEY, git: process.env.GIT_CREDENTIAL_ENCRYPTION_KEY };
  try {
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    process.env.GIT_CREDENTIAL_ENCRYPTION_KEY = generateGitCredentialEncryptionKey();
    assert.throws(() => aiCredentialEncryptionKeyFromEnv(), AiCredentialEncryptionKeyError);

    const aiKey = generateGitCredentialEncryptionKey();
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = aiKey;
    const resolved = aiCredentialEncryptionKeyFromEnv();
    assert.equal(resolved.toString("hex"), aiKey);
  } finally {
    if (original.ai === undefined) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = original.ai;
    if (original.git === undefined) delete process.env.GIT_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.GIT_CREDENTIAL_ENCRYPTION_KEY = original.git;
  }
});

test("aiCredentialEncryptionKeyFromEnv rechaza una clave con longitud inválida", () => {
  const original = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  try {
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = "deadbeef";
    assert.throws(() => aiCredentialEncryptionKeyFromEnv(), AiCredentialEncryptionKeyError);
  } finally {
    if (original === undefined) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = original;
  }
});
