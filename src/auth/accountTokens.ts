// FEATURE-041, Regla 5.5: tokens de un solo uso para verificación de email, recuperación de
// contraseña y activación de cuentas creadas por un administrador. Mismas propiedades de
// seguridad para las tres: aleatorios, persistidos únicamente como hash, con expiración, de un
// solo uso, revocables mediante reenvío. Reutiliza las mismas primitivas criptográficas que las
// sesiones web (sessionCore.ts) -- generación aleatoria base64url + hash SHA-256 -- en vez de
// introducir un segundo mecanismo equivalente.
import { generateRawSessionToken, hashSessionToken } from "./sessionCore.js";
import {
  consumeAccountToken,
  createAccountToken,
  findValidAccountTokenByHash,
  revokeUnusedAccountTokens,
  type AccountTokenPurpose,
  type AccountTokenRow,
} from "../db/repository.js";

const TOKEN_TTL_MS: Record<AccountTokenPurpose, number> = {
  email_verification: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
  account_activation: 7 * 24 * 60 * 60 * 1000,
};

export interface IssuedAccountToken {
  rawToken: string;
  row: AccountTokenRow;
}

/**
 * Un reenvío invalida el token anterior (Regla 5.5) -- revocar y crear en la misma llamada, nunca
 * dos tokens vigentes del mismo propósito para el mismo usuario a la vez.
 */
export async function issueAccountToken(userId: string, purpose: AccountTokenPurpose): Promise<IssuedAccountToken> {
  await revokeUnusedAccountTokens(userId, purpose);
  const rawToken = generateRawSessionToken();
  const row = await createAccountToken({
    userId,
    tokenHash: hashSessionToken(rawToken),
    purpose,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]),
  });
  return { rawToken, row };
}

/** Valida sin consumir -- usado cuando el flujo necesita confirmar vigencia antes de pedir datos adicionales (ej. nueva contraseña) sin gastar el token todavía. */
export async function findValidAccountToken(
  rawToken: string,
  purpose: AccountTokenPurpose
): Promise<AccountTokenRow | null> {
  return findValidAccountTokenByHash(hashSessionToken(rawToken), purpose);
}

/**
 * Valida y consume atómicamente en un solo paso -- el camino que deben usar todos los flujos que
 * no necesitan una validación previa separada (verificación de email, activación). Nunca reactiva
 * un token vencido/usado/revocado entretanto (Validation Evidence: concurrencia de uso único).
 */
export async function consumeValidAccountToken(
  rawToken: string,
  purpose: AccountTokenPurpose
): Promise<AccountTokenRow | null> {
  const candidate = await findValidAccountTokenByHash(hashSessionToken(rawToken), purpose);
  if (!candidate) return null;
  return consumeAccountToken(candidate.id);
}
