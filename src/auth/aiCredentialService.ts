import {
  deleteAiProviderCredential,
  getAiProviderCredential,
  listAiProviderCredentials,
  upsertAiProviderCredential,
  type EffectiveAgentConfig,
  type ExecutorProviderName,
} from "../db/repository.js";
import { aiCredentialEncryptionKeyFromEnv } from "./aiCredentialEncryptionKey.js";
import { decryptGitToken, encryptGitToken } from "./gitCredentialEncryption.js";

// FEATURE-025-Parte-1: capa de servicio sobre user_ai_provider_credentials -- cifrado/descifrado y
// resolución de autenticación en runtime, mismo criterio de capas que gitConnectionService.ts sobre
// user_git_connections (FEATURE-026). Reutiliza encryptGitToken/decryptGitToken (genéricas, ya
// aceptan la key como parámetro) con AI_CREDENTIAL_ENCRYPTION_KEY en vez de
// GIT_CREDENTIAL_ENCRYPTION_KEY -- sin duplicar la lógica de cifrado.

/**
 * Regla Funcional 5.4: se lanza antes de invocar al agente cuando `auth_mode = api_key` y el
 * usuario no tiene una credencial propia y válida para el proveedor efectivo -- nunca hay fallback
 * a una API key global del host. El mensaje nunca incluye el secreto (no hay secreto en juego
 * cuando este error se lanza).
 */
export class AgentCredentialMissingError extends Error {}

export interface AiCredentialStatus {
  provider: ExecutorProviderName;
  configured: boolean;
  updatedAt: string | null;
}

const ALL_PROVIDERS: ExecutorProviderName[] = ["claude", "codex"];

/** Sección 7.7 del diseño: estado de las credenciales del usuario, sin exponer nunca el secreto. */
export async function listAiCredentialStatuses(userId: string): Promise<AiCredentialStatus[]> {
  const rows = await listAiProviderCredentials(userId);
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  return ALL_PROVIDERS.map((provider) => {
    const row = byProvider.get(provider);
    return { provider, configured: Boolean(row), updatedAt: row?.updated_at ?? null };
  });
}

/** Regla 5.6.7: sustituir reemplaza el secreto anterior -- mismo upsert, no se versiona. */
export async function setAiCredential(
  userId: string,
  provider: ExecutorProviderName,
  apiKey: string
): Promise<AiCredentialStatus> {
  const ciphertext = encryptGitToken(apiKey, aiCredentialEncryptionKeyFromEnv());
  const row = await upsertAiProviderCredential(userId, provider, ciphertext);
  return { provider: row.provider, configured: true, updatedAt: row.updated_at };
}

/** Regla 5.6.8: eliminar impide futuras ejecuciones `api_key` para ese proveedor. */
export async function removeAiCredential(userId: string, provider: ExecutorProviderName): Promise<void> {
  await deleteAiProviderCredential(userId, provider);
}

/**
 * Sección 6.3 del diseño: resolución separada y efímera de la autenticación efectiva -- nunca
 * forma parte de un objeto que pueda persistirse o serializarse junto a la configuración funcional
 * (`EffectiveAgentConfig`). Para `cli_session` no hay credencial que resolver (Regla 5.5.2, sigue
 * usando el mecanismo compartido del host hasta FEATURE-025-Parte-2).
 */
export type ResolvedExecutorAuthentication = { mode: "cli_session" } | { mode: "api_key"; apiKey: string };

export async function resolveExecutorAuthentication(
  userId: string,
  config: EffectiveAgentConfig
): Promise<ResolvedExecutorAuthentication> {
  if (config.authMode === "cli_session") {
    return { mode: "cli_session" };
  }

  const credential = await getAiProviderCredential(userId, config.executorProvider);
  if (!credential) {
    throw new AgentCredentialMissingError(
      `No hay una API key propia registrada para "${config.executorProvider}". Registrala en la configuración de agente antes de ejecutar.`
    );
  }

  try {
    const apiKey = decryptGitToken(credential.credential_ciphertext, aiCredentialEncryptionKeyFromEnv());
    return { mode: "api_key", apiKey };
  } catch {
    throw new AgentCredentialMissingError(
      `No se pudo descifrar la credencial registrada para "${config.executorProvider}". Registrala de nuevo en la configuración de agente.`
    );
  }
}
