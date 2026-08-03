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
import {
  collectAndPromoteOAuthSession,
  cleanupMaterializedOAuthSession,
  materializeOAuthSession,
  resolveOAuthConnection,
  type MaterializedOAuthSession,
} from "./aiOAuthSessionService.js";

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

/** FEATURE-025-Parte-2, sección 5.2.4/5: not_connected/reauth_required, distinguibles del caso genérico de api_key. */
export class AgentOAuthNotConnectedError extends AgentCredentialMissingError {}
export class AgentOAuthReauthRequiredError extends AgentCredentialMissingError {}

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
 * (`EffectiveAgentConfig`). FEATURE-025-Parte-2, sección 5.2: `cli_session` resuelve la conexión
 * OAuth personal del owner del run y materializa un temporal exclusivo y escribible -- reemplaza
 * el caché global compartido de antes. El caller SIEMPRE debe llamar
 * `finalizeExecutorAuthentication` en un `finally` después de usar el Executor, para recoger un
 * posible refresh y limpiar el temporal (Regla 5.9.12).
 */
export type ResolvedExecutorAuthentication =
  | { mode: "cli_session"; oauthDirectory: string; materialized: MaterializedOAuthSession }
  | { mode: "api_key"; apiKey: string };

export async function resolveExecutorAuthentication(
  userId: string,
  config: EffectiveAgentConfig
): Promise<ResolvedExecutorAuthentication> {
  if (config.authMode === "cli_session") {
    const resolved = await resolveOAuthConnection(userId, config.executorProvider);
    if (resolved.status === "not_connected") {
      throw new AgentOAuthNotConnectedError(
        `No hay una conexión OAuth propia para "${config.executorProvider}". Conectala en la configuración de agente antes de ejecutar.`
      );
    }
    if (resolved.status === "reauth_required") {
      throw new AgentOAuthReauthRequiredError(
        `La conexión OAuth de "${config.executorProvider}" requiere reautenticación. Reconectala en la configuración de agente.`
      );
    }
    const materialized = await materializeOAuthSession(resolved.connection);
    return { mode: "cli_session", oauthDirectory: materialized.directory, materialized };
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

/**
 * Regla 5.9.11/12: recoge un posible refresh (lo promueve por CAS) y elimina siempre el temporal,
 * incluso si `collectAndPromoteOAuthSession` falla -- nunca deja un directorio materializado
 * huérfano. No-op para `api_key` (nada que limpiar).
 */
export async function finalizeExecutorAuthentication(authentication: ResolvedExecutorAuthentication): Promise<void> {
  if (authentication.mode !== "cli_session") return;
  try {
    await collectAndPromoteOAuthSession(authentication.materialized);
  } finally {
    await cleanupMaterializedOAuthSession(authentication.materialized);
  }
}
