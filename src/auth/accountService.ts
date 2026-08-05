// FEATURE-041: servicio de cuentas self-service -- registro, verificación, recuperación de
// contraseña, onboarding de nombre. Regla 5.4 (enumeración): registro/recuperación/reenvío
// siempre devuelven una respuesta neutra al llamador; la existencia o no de la cuenta nunca se
// filtra por una diferencia de respuesta observable. Regla 5.7: nunca se confía en un `user_id`
// enviado por el cliente -- todas las mutaciones de este servicio parten de una sesión ya
// autenticada o de un token ya validado, nunca de un id crudo del body.
import { hashPassword, verifyPassword } from "./password.js";
import { validatePasswordPolicy, type PasswordPolicyViolation } from "./passwordPolicy.js";
import { issueAccountToken, consumeValidAccountToken } from "./accountTokens.js";
import { defaultEmailClient, type EmailClient } from "../email/resendClient.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "../email/accountEmails.js";
import {
  createSelfServiceAccount,
  DuplicateAccountError,
  findUserByHandleOrEmail,
  findUserById,
  markUserEmailVerified,
  revokeAllSessionsForUser,
  setUserDisplayName,
  setUserPasswordHash,
  type UserRow,
} from "../db/repository.js";

export class WeakPasswordError extends Error {
  constructor(public readonly violations: PasswordPolicyViolation[]) {
    super("La contraseña no cumple la política de seguridad.");
  }
}

export class PasswordConfirmationMismatchError extends Error {}
export class InvalidOrExpiredTokenError extends Error {}
export class InvalidDisplayNameError extends Error {}

/** Regla 5.4: normaliza para comparación (login, unicidad) sin destruir el valor mostrado al usuario. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertPasswordPolicy(password: string, confirmation: string): void {
  if (password !== confirmation) throw new PasswordConfirmationMismatchError("Las contraseñas no coinciden.");
  const violations = validatePasswordPolicy(password);
  if (violations.length > 0) throw new WeakPasswordError(violations);
}

/**
 * Escenario 1/2/3: crea la cuenta pendiente de verificación y envía el email. Si el email ya
 * existe, no se crea una segunda cuenta ni se revela el conflicto -- se devuelve el mismo
 * resultado neutro que un registro exitoso (Regla 5.4), sin reenviar un token de verificación a
 * una cuenta que el llamador no demostró controlar.
 */
export async function registerAccount(
  params: { email: string; password: string; passwordConfirmation: string },
  emailClient: EmailClient = defaultEmailClient()
): Promise<void> {
  assertPasswordPolicy(params.password, params.passwordConfirmation);
  const normalizedHandle = normalizeEmail(params.email);
  const passwordHash = await hashPassword(params.password);

  let user: UserRow;
  try {
    user = await createSelfServiceAccount({ email: params.email.trim(), normalizedHandle, passwordHash });
  } catch (err) {
    if (err instanceof DuplicateAccountError) return; // Regla 5.4: respuesta neutra, sin crear ni reenviar.
    throw err;
  }

  const { rawToken } = await issueAccountToken(user.id, "email_verification");
  await sendVerificationEmail(emailClient, { to: user.email!, rawToken });
}

/** Escenario 4/5: verificación sin inicio automático de sesión (Scope). */
export async function verifyEmail(rawToken: string): Promise<UserRow> {
  const token = await consumeValidAccountToken(rawToken, "email_verification");
  if (!token) throw new InvalidOrExpiredTokenError("El enlace de verificación venció o ya fue usado.");
  const user = await markUserEmailVerified(token.user_id);
  if (!user) throw new InvalidOrExpiredTokenError("La cuenta asociada a este enlace ya no existe.");
  return user;
}

/** Reenvío self-service desde login (Scope) -- misma respuesta neutra que el registro. */
export async function resendVerificationEmail(
  email: string,
  emailClient: EmailClient = defaultEmailClient()
): Promise<void> {
  const user = await findUserByHandleOrEmail(normalizeEmail(email));
  if (!user || user.status !== "pending_verification" || !user.email) return;
  const { rawToken } = await issueAccountToken(user.id, "email_verification");
  await sendVerificationEmail(emailClient, { to: user.email, rawToken });
}

/** Escenario 8: respuesta neutra sin importar si el email existe (Regla 5.4). */
export async function requestPasswordReset(
  email: string,
  emailClient: EmailClient = defaultEmailClient()
): Promise<void> {
  const user = await findUserByHandleOrEmail(normalizeEmail(email));
  if (!user || !user.email) return;
  const { rawToken } = await issueAccountToken(user.id, "password_reset");
  await sendPasswordResetEmail(emailClient, { to: user.email, rawToken });
}

/**
 * Escenario 9: contraseña actualizada, token invalidado, TODAS las sesiones revocadas
 * (Scope "Contraseña y sesiones"). El token ya viene consumido atómicamente antes de tocar la
 * contraseña -- si la escritura de la contraseña fallara luego, el token no queda reutilizable.
 */
export async function resetPassword(
  rawToken: string,
  newPassword: string,
  newPasswordConfirmation: string
): Promise<void> {
  assertPasswordPolicy(newPassword, newPasswordConfirmation);
  const token = await consumeValidAccountToken(rawToken, "password_reset");
  if (!token) throw new InvalidOrExpiredTokenError("El enlace de recuperación venció o ya fue usado.");
  const passwordHash = await hashPassword(newPassword);
  await setUserPasswordHash(token.user_id, passwordHash);
  await revokeAllSessionsForUser(token.user_id);
}

/**
 * Escenario del Scope "Administración de cuentas": cuentas creadas por un administrador no
 * reciben contraseña temporal -- activan la cuenta y eligen su propia contraseña en el mismo
 * paso, que también verifica el email (mismo flujo de activación, Scope). A diferencia de
 * `resetPassword`, no requiere que ya exista un `password_hash` (las cuentas creadas por admin
 * nacen sin uno).
 */
export async function activateAccount(rawToken: string, password: string, passwordConfirmation: string): Promise<void> {
  assertPasswordPolicy(password, passwordConfirmation);
  const token = await consumeValidAccountToken(rawToken, "account_activation");
  if (!token) throw new InvalidOrExpiredTokenError("El enlace de activación venció o ya fue usado.");
  const passwordHash = await hashPassword(password);
  await setUserPasswordHash(token.user_id, passwordHash);
  await markUserEmailVerified(token.user_id);
}

/**
 * Cambio de contraseña autenticado (Scope: "incluido solo si puede implementarse de forma simple
 * reutilizando la infraestructura existente"). Reutiliza exactamente lo mismo que resetPassword
 * salvo la fuente de autorización (sesión vigente + contraseña actual, no un token de email) --
 * mismo efecto: revoca todas las sesiones (incluida la que hizo el cambio; el cliente vuelve a
 * loguearse con la contraseña nueva, consistente con el resto de la Feature).
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  newPasswordConfirmation: string
): Promise<void> {
  const user = await findUserById(userId);
  if (!user?.password_hash || !(await verifyPassword(currentPassword, user.password_hash))) {
    throw new InvalidOrExpiredTokenError("La contraseña actual no es correcta.");
  }
  assertPasswordPolicy(newPassword, newPasswordConfirmation);
  const passwordHash = await hashPassword(newPassword);
  await setUserPasswordHash(userId, passwordHash);
  await revokeAllSessionsForUser(userId);
}

/** Regla 5.2/Escenario 7: nombre visible obligatorio antes de acceder al resto de la aplicación. */
export async function completeOnboardingDisplayName(userId: string, displayName: string): Promise<UserRow> {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) throw new InvalidDisplayNameError("El nombre visible no puede estar vacío.");
  const user = await setUserDisplayName(userId, trimmed);
  if (!user) throw new InvalidDisplayNameError("La cuenta no existe.");
  return user;
}
