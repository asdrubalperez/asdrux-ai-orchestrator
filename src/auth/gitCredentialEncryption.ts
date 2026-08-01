import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// FEATURE-026, Regla 13 / sección 7.4: cifrado autenticado reversible del token OAuth de GitHub.
// La validación técnica confirmó que no existe en el proyecto ningún mecanismo reversible previo
// que pueda reutilizarse (password_hash usa bcrypt, unidireccional) — este módulo es el primer
// precedente de cifrado-y-recuperación de un secreto en el proyecto.

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const FORMAT_VERSION = "v1";

export class GitCredentialEncryptionKeyError extends Error {}
export class GitTokenDecryptionError extends Error {}

export function encryptionKeyFromEnv(): Buffer {
  const hex = process.env.GIT_CREDENTIAL_ENCRYPTION_KEY;
  if (!hex) {
    throw new GitCredentialEncryptionKeyError("GIT_CREDENTIAL_ENCRYPTION_KEY no está definida.");
  }
  return parseEncryptionKey(hex);
}

export function parseEncryptionKey(hex: string): Buffer {
  const key = Buffer.from(hex, "hex");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new GitCredentialEncryptionKeyError(
      `GIT_CREDENTIAL_ENCRYPTION_KEY debe representar ${KEY_LENGTH_BYTES} bytes en hexadecimal (${KEY_LENGTH_BYTES * 2} caracteres).`
    );
  }
  return key;
}

export function generateGitCredentialEncryptionKey(): string {
  return randomBytes(KEY_LENGTH_BYTES).toString("hex");
}

/**
 * Formato conceptual de la sección 7.4: v1.<iv>.<authTag>.<ciphertext>, todo en base64.
 * El authTag detecta manipulación del ciphertext (Regla 13: "detección de manipulación").
 */
export function encryptGitToken(plaintext: string, key: Buffer = encryptionKeyFromEnv()): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
    "."
  );
}

/**
 * Errores sanitizados (Regla 13/7.4): nunca se incluye el ciphertext, la clave ni el plaintext
 * parcial en el mensaje de error — solo la naturaleza del fallo.
 */
export function decryptGitToken(stored: string, key: Buffer = encryptionKeyFromEnv()): string {
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new GitTokenDecryptionError("Formato de token cifrado no reconocido.");
  }
  const [, ivB64, authTagB64, ciphertextB64] = parts;
  try {
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new GitTokenDecryptionError("No se pudo descifrar el token (clave incorrecta o dato manipulado).");
  }
}
