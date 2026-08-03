import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import type { OAuthSessionProvider } from "./aiOAuthSessionEnvelope.js";

// FEATURE-025-Parte-2, sección 7.5/5.5: registry transitorio en memoria de intentos de login --
// válido mientras exista una única instancia del backend (sección 7.4, mismo criterio que el
// single-flight de refresh). No contiene secretos persistentes, solo metadata de coordinación.
// Si el backend se replica, este registry debe moverse a un mecanismo distribuido -- documentado
// como deuda conocida, no resuelto acá (fuera del alcance de esta Feature en una VPS única).

const LOGIN_ATTEMPT_TTL_MS = 10 * 60 * 1000;

export class LoginInProgressError extends Error {}

export interface LoginAttempt {
  attemptId: string;
  userId: string;
  provider: OAuthSessionProvider;
  temporaryDirectory: string;
  expiresAt: number;
  /** Cancela el proceso de login en curso (mata el CLI, corta el app-server) -- provisto por el adaptador. */
  cancel: () => Promise<void>;
}

const attemptsById = new Map<string, LoginAttempt>();
const attemptIdByUserProvider = new Map<string, string>();

function key(userId: string, provider: OAuthSessionProvider): string {
  return `${userId}:${provider}`;
}

function sweepIfExpired(attempt: LoginAttempt): boolean {
  if (Date.now() < attempt.expiresAt) return false;
  void discardAttempt(attempt.attemptId).catch(() => {});
  return true;
}

/** Regla 5.5.1/2: un único intento activo por (user_id, provider); un segundo debe rechazarse. */
export function reserveLoginAttempt(params: {
  userId: string;
  provider: OAuthSessionProvider;
  temporaryDirectory: string;
  cancel: () => Promise<void>;
}): LoginAttempt {
  const existingId = attemptIdByUserProvider.get(key(params.userId, params.provider));
  if (existingId) {
    const existing = attemptsById.get(existingId);
    if (existing && !sweepIfExpired(existing)) {
      throw new LoginInProgressError(
        `Ya hay un intento de conexión en curso para "${params.provider}". Cancelalo o esperá a que termine.`
      );
    }
  }

  const attempt: LoginAttempt = {
    attemptId: randomUUID(),
    userId: params.userId,
    provider: params.provider,
    temporaryDirectory: params.temporaryDirectory,
    expiresAt: Date.now() + LOGIN_ATTEMPT_TTL_MS,
    cancel: params.cancel,
  };
  attemptsById.set(attempt.attemptId, attempt);
  attemptIdByUserProvider.set(key(params.userId, params.provider), attempt.attemptId);
  return attempt;
}

/** Devuelve null si no existe, fue completado/cancelado, o venció (y ya se descartó). */
export function getLoginAttempt(attemptId: string): LoginAttempt | null {
  const attempt = attemptsById.get(attemptId);
  if (!attempt) return null;
  if (sweepIfExpired(attempt)) return null;
  return attempt;
}

/** Regla 5.5.4/5: al completar o cancelar, se libera el slot sin dejar nunca una conexión a medias. */
export async function discardAttempt(attemptId: string): Promise<void> {
  const attempt = attemptsById.get(attemptId);
  if (!attempt) return;
  attemptsById.delete(attemptId);
  if (attemptIdByUserProvider.get(key(attempt.userId, attempt.provider)) === attemptId) {
    attemptIdByUserProvider.delete(key(attempt.userId, attempt.provider));
  }
  try {
    await attempt.cancel();
  } catch {
    // best-effort: el proceso puede haber terminado solo.
  }
  await rm(attempt.temporaryDirectory, { recursive: true, force: true }).catch(() => {});
}

// --- Regla 5.11: single-flight de refresh por (user_id, provider) -----------------------------

const refreshLocks = new Map<string, Promise<unknown>>();

/**
 * Sección 6.3/5.11.4-6: mientras haya un refresh en vuelo para el mismo (user_id, provider), un
 * segundo caller espera el mismo resultado en vez de disparar otro refresh -- evita ramas
 * divergentes sin necesitar coordinación distribuida (VPS única, sección 7.4).
 */
export async function withOAuthRefreshLock<T>(
  userId: string,
  provider: OAuthSessionProvider,
  fn: () => Promise<T>
): Promise<T> {
  const lockKey = key(userId, provider);
  const existing = refreshLocks.get(lockKey);
  if (existing) return existing as Promise<T>;

  const run = (async () => {
    try {
      return await fn();
    } finally {
      refreshLocks.delete(lockKey);
    }
  })();
  refreshLocks.set(lockKey, run);
  return run;
}
