import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptGitToken,
  encryptGitToken,
  generateGitCredentialEncryptionKey,
  GitCredentialEncryptionKeyError,
  GitTokenDecryptionError,
  parseEncryptionKey,
} from "./gitCredentialEncryption.js";

const key = parseEncryptionKey(generateGitCredentialEncryptionKey());
const otherKey = parseEncryptionKey(generateGitCredentialEncryptionKey());

test("encryptGitToken/decryptGitToken hacen round-trip exacto", () => {
  const plaintext = "gho_" + "a".repeat(36);
  const stored = encryptGitToken(plaintext, key);
  assert.equal(decryptGitToken(stored, key), plaintext);
});

test("el valor cifrado nunca contiene el token en texto plano", () => {
  const plaintext = "gho_super-secreto-1234567890";
  const stored = encryptGitToken(plaintext, key);
  assert.equal(stored.includes(plaintext), false);
});

test("dos cifrados del mismo texto producen ciphertext distinto (IV aleatorio)", () => {
  const plaintext = "gho_mismo-token";
  const a = encryptGitToken(plaintext, key);
  const b = encryptGitToken(plaintext, key);
  assert.notEqual(a, b);
  assert.equal(decryptGitToken(a, key), plaintext);
  assert.equal(decryptGitToken(b, key), plaintext);
});

test("descifrar con la clave incorrecta falla explícitamente", () => {
  const stored = encryptGitToken("gho_token", key);
  assert.throws(() => decryptGitToken(stored, otherKey), GitTokenDecryptionError);
});

test("ciphertext manipulado falla por auth tag inválido", () => {
  const stored = encryptGitToken("gho_token", key);
  const [version, iv, authTag, ciphertext] = stored.split(".");
  const tamperedByte = Buffer.from(ciphertext, "base64");
  tamperedByte[0] = tamperedByte[0] ^ 0xff;
  const tampered = [version, iv, authTag, tamperedByte.toString("base64")].join(".");
  assert.throws(() => decryptGitToken(tampered, key), GitTokenDecryptionError);
});

test("formato no reconocido falla explícitamente", () => {
  assert.throws(() => decryptGitToken("no-es-un-formato-valido", key), GitTokenDecryptionError);
  assert.throws(() => decryptGitToken("v2.a.b.c", key), GitTokenDecryptionError);
});

test("parseEncryptionKey rechaza claves con longitud incorrecta", () => {
  assert.throws(() => parseEncryptionKey("deadbeef"), GitCredentialEncryptionKeyError);
});

test("encryptGitToken sin clave explícita exige GIT_CREDENTIAL_ENCRYPTION_KEY en el entorno", () => {
  const previous = process.env.GIT_CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.GIT_CREDENTIAL_ENCRYPTION_KEY;
  try {
    assert.throws(() => encryptGitToken("gho_token"), GitCredentialEncryptionKeyError);
  } finally {
    if (previous !== undefined) process.env.GIT_CREDENTIAL_ENCRYPTION_KEY = previous;
  }
});
