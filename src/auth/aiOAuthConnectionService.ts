import {
  createAiOAuthConnection,
  deleteAiOAuthConnection,
  listAiOAuthConnections,
  listRunningRunIdsForUser,
  type ExecutorProviderName,
} from "../db/repository.js";
import { encryptOAuthSession, type OAuthSessionProvider } from "./aiOAuthSessionEnvelope.js";
import {
  cancelClaudeLogin,
  startClaudeLogin,
  submitClaudeLoginCode,
  ClaudeLoginError,
  type LoginChallenge as ClaudeLoginChallenge,
} from "./claudeLoginAdapter.js";
import {
  awaitCodexLoginCompletion,
  cancelCodexLogin,
  startCodexLogin,
  CodexLoginError,
  type LoginChallenge as CodexLoginChallenge,
} from "./codexLoginAdapter.js";

// FEATURE-025-Parte-2: orquesta login/desconexión sobre los adaptadores por proveedor + el
// registry de intentos -- capa de servicio consumida por los endpoints (src/server/app.ts).

export interface OAuthConnectionStatusView {
  provider: ExecutorProviderName;
  status: "not_connected" | "connected" | "reauth_required";
  lastValidatedAt: string | null;
}

const ALL_PROVIDERS: ExecutorProviderName[] = ["claude", "codex"];

export async function listOAuthConnectionStatuses(userId: string): Promise<OAuthConnectionStatusView[]> {
  const rows = await listAiOAuthConnections(userId);
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  return ALL_PROVIDERS.map((provider) => {
    const row = byProvider.get(provider);
    return {
      provider,
      status: row ? row.status : "not_connected",
      lastValidatedAt: row?.last_validated_at ?? null,
    };
  });
}

export type StartOAuthLoginResult =
  | { provider: "claude" } & ClaudeLoginChallenge
  | { provider: "codex" } & CodexLoginChallenge;

export async function startOAuthLogin(userId: string, provider: ExecutorProviderName): Promise<StartOAuthLoginResult> {
  if (provider === "claude") {
    const challenge = await startClaudeLogin(userId);
    return { provider: "claude", ...challenge };
  }
  const challenge = await startCodexLogin(userId);
  return { provider: "codex", ...challenge };
}

/** Regla 5.6.6/7/8: código único, escrito una sola vez. Solo aplica a Claude. */
export async function submitOAuthLoginCode(
  userId: string,
  attemptId: string,
  code: string
): Promise<OAuthConnectionStatusView> {
  const completion = await submitClaudeLoginCode(attemptId, code);
  return persistConnection(userId, "claude", completion.sessionContent);
}

/**
 * Codex confirma en el navegador sin devolver un código a la UI -- este método se pensó para
 * polling corto desde el frontend (Regla 5.7.3/4): si todavía no terminó, devuelve `pending` sin
 * consumir el intento; el frontend vuelve a llamar cada pocos segundos.
 */
export async function pollCodexOAuthLogin(
  userId: string,
  attemptId: string
): Promise<{ pending: true } | { pending: false; connection: OAuthConnectionStatusView }> {
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 2500));
  const outcome = await Promise.race([awaitCodexLoginCompletion(attemptId), timeout]);
  if (outcome === "timeout") return { pending: true };

  const connection = await persistConnection(userId, "codex", outcome.sessionContent);
  return { pending: false, connection };
}

async function persistConnection(
  userId: string,
  provider: OAuthSessionProvider,
  sessionContent: string
): Promise<OAuthConnectionStatusView> {
  const encrypted = encryptOAuthSession(sessionContent, provider);
  const row = await createAiOAuthConnection(userId, provider, encrypted);
  return { provider: row.provider, status: row.status, lastValidatedAt: row.last_validated_at };
}

export async function cancelOAuthLogin(provider: ExecutorProviderName, attemptId: string): Promise<void> {
  if (provider === "claude") {
    await cancelClaudeLogin(attemptId);
  } else {
    await cancelCodexLogin(attemptId);
  }
}

export interface DisconnectOAuthResult {
  disconnected: boolean;
  activeRunIds: string[];
}

/**
 * Regla 5.16: la coordinación completa "informar/esperar/cancelar runs activos desde la UI" queda
 * simplificada acá -- la configuración de agente se resuelve por fase, no se persiste qué runs usan
 * qué conexión en particular, así que no hay forma barata de bloquear "solo los runs que la
 * necesitan". Se advierte con el conjunto completo de runs `running` del usuario; sin `force`, no
 * desconecta y deja que el usuario decida esperarlos. Con `force`, desconecta igual (Riesgo 8 del
 * diseño: un run en curso que necesite un refresh a mitad de camino podría fallar -- probabilidad
 * baja en la práctica, aceptada explícitamente en vez de construir un subsistema de coordinación
 * completo para esto).
 */
export async function disconnectOAuth(
  userId: string,
  provider: ExecutorProviderName,
  force: boolean
): Promise<DisconnectOAuthResult> {
  const activeRunIds = await listRunningRunIdsForUser(userId);
  if (activeRunIds.length > 0 && !force) {
    return { disconnected: false, activeRunIds };
  }

  // Regla 5.16.4/5/6: logout remoto best-effort (no bloquea la eliminación local si falla) queda
  // pendiente de un cliente HTTP dedicado por proveedor -- no existe todavía en este repo (a
  // diferencia de GitHub, FEATURE-026, que sí tiene revokeGitHubToken). La eliminación local
  // garantizada sí se ejecuta siempre.
  await deleteAiOAuthConnection(userId, provider);
  return { disconnected: true, activeRunIds };
}

export { ClaudeLoginError, CodexLoginError };
