import { parseEncryptionKey } from "./gitCredentialEncryption.js";

// FEATURE-025-Parte-1, sección 7.3: clave de cifrado separada de GIT_CREDENTIAL_ENCRYPTION_KEY
// (separación de dominios de secreto, blast radius distinto por tipo de credencial). Reutiliza
// `parseEncryptionKey` y el resto de las primitivas AES-256-GCM de FEATURE-026
// (`encryptGitToken`/`decryptGitToken`, ya genéricas -- aceptan la key como parámetro) sin tocar
// la interfaz pública que usa GitHub. Para generar una clave nueva compatible, reutilizar
// `generateGitCredentialEncryptionKey()` (32 bytes aleatorios en hex) -- el algoritmo es el mismo,
// solo cambia qué variable de entorno la resuelve.

export class AiCredentialEncryptionKeyError extends Error {}

export function aiCredentialEncryptionKeyFromEnv(): Buffer {
  const hex = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  if (!hex) {
    throw new AiCredentialEncryptionKeyError("AI_CREDENTIAL_ENCRYPTION_KEY no está definida.");
  }
  try {
    return parseEncryptionKey(hex);
  } catch (err) {
    throw new AiCredentialEncryptionKeyError((err as Error).message);
  }
}
