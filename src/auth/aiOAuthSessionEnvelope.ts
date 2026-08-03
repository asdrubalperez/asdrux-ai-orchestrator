import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { aiCredentialEncryptionKeyFromEnv } from "./aiCredentialEncryptionKey.js";

// FEATURE-025-Parte-2, sección 7.2/5.8: envelope cifrado versionado para el blob de sesión OAuth
// (.credentials.json de Claude / auth.json de Codex). Usa el mismo algoritmo y la misma
// AI_CREDENTIAL_ENCRYPTION_KEY que las credenciales de api_key de FEATURE-025-Parte-1, pero con
// primitivas propias (no encryptGitToken/decryptGitToken de FEATURE-026): necesita AAD (Regla
// 5.8.4, "version de envelope y provider" autenticados) que el formato de esas funciones no
// soporta -- mismo algoritmo, formato de envelope distinto, deliberado.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const ENVELOPE_VERSION = 1;

export type OAuthSessionProvider = "claude" | "codex";

export class OAuthSessionEnvelopeError extends Error {}

export interface EncryptedOAuthSessionEnvelope {
  version: number;
  provider: OAuthSessionProvider;
  ciphertext: string;
  iv: string;
  authTag: string;
}

function aad(version: number, provider: OAuthSessionProvider): Buffer {
  return Buffer.from(`${version}:${provider}`, "utf8");
}

/** `plaintext` es el contenido crudo del artefacto mínimo (.credentials.json / auth.json). */
export function encryptOAuthSession(
  plaintext: string,
  provider: OAuthSessionProvider,
  key: Buffer = aiCredentialEncryptionKeyFromEnv()
): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad(ENVELOPE_VERSION, provider));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const envelope: EncryptedOAuthSessionEnvelope = {
    version: ENVELOPE_VERSION,
    provider,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
  return JSON.stringify(envelope);
}

/**
 * Regla 5.8.5/9: el contenido se trata como opaco -- errores sanitizados, nunca incluyen el
 * ciphertext, la clave ni el plaintext parcial.
 */
export function decryptOAuthSession(
  stored: string,
  expectedProvider: OAuthSessionProvider,
  key: Buffer = aiCredentialEncryptionKeyFromEnv()
): string {
  let envelope: EncryptedOAuthSessionEnvelope;
  try {
    envelope = JSON.parse(stored);
  } catch {
    throw new OAuthSessionEnvelopeError("Envelope de sesión OAuth no es JSON válido.");
  }
  if (envelope.version !== ENVELOPE_VERSION || envelope.provider !== expectedProvider) {
    throw new OAuthSessionEnvelopeError("Envelope de sesión OAuth con versión o proveedor inesperado.");
  }
  try {
    const iv = Buffer.from(envelope.iv, "base64");
    const authTag = Buffer.from(envelope.authTag, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(aad(envelope.version, envelope.provider));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new OAuthSessionEnvelopeError("No se pudo descifrar la sesión OAuth (clave incorrecta o dato manipulado).");
  }
}
