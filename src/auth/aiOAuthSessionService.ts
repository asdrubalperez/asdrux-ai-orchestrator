import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getAiOAuthConnection,
  markAiOAuthConnectionReauthRequired,
  promoteAiOAuthSession,
  type ExecutorProviderName,
  type UserAiOAuthConnectionRow,
} from "../db/repository.js";
import { decryptOAuthSession, encryptOAuthSession, type OAuthSessionProvider } from "./aiOAuthSessionEnvelope.js";
import { withOAuthRefreshLock } from "./aiOAuthLoginRegistry.js";

// FEATURE-025-Parte-2, sección 7.8: runtime de sesión OAuth -- resolución, materialización
// temporal escribible, recolección/promoción posterior al run (CAS), y limpieza. Consumido por
// ClaudeCodeExecutor/CodexExecutor en reemplazo del caché global de solo lectura actual.

const SESSION_FILENAME: Record<OAuthSessionProvider, string> = {
  claude: ".credentials.json",
  codex: "auth.json",
};

export type ResolveOAuthConnectionResult =
  | { status: "connected"; connection: UserAiOAuthConnectionRow }
  | { status: "reauth_required" }
  | { status: "not_connected" };

/** Sección 5.2: nunca consulta el caché global legacy, nunca cae a una API key. */
export async function resolveOAuthConnection(
  userId: string,
  provider: ExecutorProviderName
): Promise<ResolveOAuthConnectionResult> {
  const connection = await getAiOAuthConnection(userId, provider);
  if (!connection) return { status: "not_connected" };
  if (connection.status === "reauth_required") return { status: "reauth_required" };
  return { status: "connected", connection };
}

export interface MaterializedOAuthSession {
  directory: string;
  connectionId: string;
  userId: string;
  sessionVersion: number;
  provider: OAuthSessionProvider;
  originalContent: string;
}

/** Sección 5.9: temporal exclusivo, 0700/0600, escribible -- nunca compartido entre runs. */
export async function materializeOAuthSession(connection: UserAiOAuthConnectionRow): Promise<MaterializedOAuthSession> {
  const provider = connection.provider as OAuthSessionProvider;
  const plaintext = decryptOAuthSession(connection.encrypted_session, provider);

  const directory = await mkdtemp(path.join(os.tmpdir(), `orchestrator-oauth-${provider}-`));
  await chmod(directory, 0o700);
  const filePath = path.join(directory, SESSION_FILENAME[provider]);
  await writeFile(filePath, plaintext, "utf8");
  await chmod(filePath, 0o600);

  return {
    directory,
    connectionId: connection.id,
    userId: connection.user_id,
    sessionVersion: connection.session_version,
    provider,
    originalContent: plaintext,
  };
}

/**
 * Sección 6.2/6.4: al terminar la invocación, compara el artefacto contra lo que se materializó --
 * si el CLI lo actualizó (refresh reactivo), lo cifra y lo promueve por CAS. Si el CAS se pierde
 * (otro proceso ya promovió una versión más nueva), se descarta la rama local sin reintentar
 * (Regla 5.11.8) -- nunca se sobrescribe una versión más nueva con una más vieja.
 */
export async function collectAndPromoteOAuthSession(materialized: MaterializedOAuthSession): Promise<void> {
  const filePath = path.join(materialized.directory, SESSION_FILENAME[materialized.provider]);
  const currentContent = await readFile(filePath, "utf8").catch(() => materialized.originalContent);
  if (currentContent === materialized.originalContent) return;

  await withOAuthRefreshLock(materialized.userId, materialized.provider, async () => {
    const encrypted = encryptOAuthSession(currentContent, materialized.provider);
    await promoteAiOAuthSession({
      connectionId: materialized.connectionId,
      expectedVersion: materialized.sessionVersion,
      encryptedSession: encrypted,
    });
    // CAS perdido (retorno null): otro proceso ya promovió -- se descarta la rama local sin
    // reintentar, tal como exige la Regla 5.11.8. No es un error del run actual.
  });
}

export async function cleanupMaterializedOAuthSession(materialized: MaterializedOAuthSession): Promise<void> {
  await rm(materialized.directory, { recursive: true, force: true }).catch(() => {});
}

export async function markOAuthConnectionReauthRequired(connectionId: string): Promise<void> {
  await markAiOAuthConnectionReauthRequired(connectionId);
}
