// FEATURE-041, Regla 5.8: jerarquía administrativa de 3 niveles (usuario/admin/superadmin), sin
// RBAC genérico. Toda la matriz de la Regla 5.8 se aplica acá, en backend -- nunca solo en la UI
// (sección 6, "Estrategia Algorítmica"). `setUserRole`/`setUserStatus` en repository.ts ya
// excluyen `is_protected_superadmin` a nivel de query (defensa en profundidad); este servicio es
// la primera línea, con mensajes de error distinguibles.
import { normalizeEmail } from "./accountService.js";
import { issueAccountToken } from "./accountTokens.js";
import { defaultEmailClient, type EmailClient } from "../email/resendClient.js";
import { sendAccountActivationEmail, sendVerificationEmail } from "../email/accountEmails.js";
import {
  createAccountByAdmin,
  DuplicateAccountError,
  findUserById,
  listAccountsForAdmin,
  revokeAllSessionsForUser,
  setUserRole,
  setUserStatus,
  type AccountListEntry,
  type AccountRole,
  type UserRow,
} from "../db/repository.js";

export class InsufficientRoleError extends Error {}
export class CannotActOnSelfError extends Error {}
export class CannotActOnTargetError extends Error {}
export class TargetNotFoundError extends Error {}

const ROLE_ORDER: Record<AccountRole, number> = { user: 0, admin: 1, superadmin: 2 };

function assertActorRole(actor: UserRow, minimum: AccountRole): void {
  if (ROLE_ORDER[actor.role] < ROLE_ORDER[minimum]) {
    throw new InsufficientRoleError(`Se requiere rol "${minimum}" o superior.`);
  }
}

async function requireTarget(targetId: string): Promise<UserRow> {
  const target = await findUserById(targetId);
  if (!target) throw new TargetNotFoundError("La cuenta no existe.");
  return target;
}

export { DuplicateAccountError };

export function assertAdminOrAbove(actor: UserRow): void {
  assertActorRole(actor, "admin");
}

export async function listAccounts(actor: UserRow): Promise<AccountListEntry[]> {
  assertActorRole(actor, "admin");
  return listAccountsForAdmin();
}

/** Escenario del Scope: sin contraseña temporal, correo de activación, la cuenta elige su propia contraseña. */
export async function createAccount(
  actor: UserRow,
  email: string,
  emailClient: EmailClient = defaultEmailClient()
): Promise<UserRow> {
  assertActorRole(actor, "admin");
  const user = await createAccountByAdmin(email.trim(), normalizeEmail(email));
  const { rawToken } = await issueAccountToken(user.id, "account_activation");
  await sendAccountActivationEmail(emailClient, { to: user.email!, rawToken });
  return user;
}

/** Regla 5.8: usuario normal -> cualquier admin+; administrador -> solo superadmin. Nunca la propia cuenta. */
export async function suspendAccount(actor: UserRow, targetId: string): Promise<UserRow> {
  assertActorRole(actor, "admin");
  const target = await requireTarget(targetId);
  if (target.id === actor.id) throw new CannotActOnSelfError("No podés suspender tu propia cuenta.");
  if (target.role !== "user") assertActorRole(actor, "superadmin");
  if (target.is_protected_superadmin) throw new CannotActOnTargetError("La cuenta protegida no puede suspenderse.");
  const updated = await setUserStatus(targetId, "suspended");
  if (!updated) throw new CannotActOnTargetError("No se pudo suspender la cuenta.");
  await revokeAllSessionsForUser(targetId);
  return updated;
}

export async function reactivateAccount(actor: UserRow, targetId: string): Promise<UserRow> {
  assertActorRole(actor, "admin");
  const target = await requireTarget(targetId);
  if (target.role !== "user") assertActorRole(actor, "superadmin");
  if (target.is_protected_superadmin) throw new CannotActOnTargetError("La cuenta protegida no puede reactivarse.");
  const updated = await setUserStatus(targetId, "active");
  if (!updated) throw new CannotActOnTargetError("No se pudo reactivar la cuenta.");
  return updated;
}

/** Regla 5.8: promover usuario normal -> admin+. Nunca el propio rol. */
export async function promoteToAdmin(actor: UserRow, targetId: string): Promise<UserRow> {
  assertActorRole(actor, "admin");
  const target = await requireTarget(targetId);
  if (target.id === actor.id) throw new CannotActOnSelfError("No podés modificar tu propio rol.");
  if (target.role !== "user") throw new CannotActOnTargetError("Solo se puede promover a un usuario normal.");
  const updated = await setUserRole(targetId, "admin");
  if (!updated) throw new CannotActOnTargetError("No se pudo promover la cuenta.");
  return updated;
}

/** Regla 5.8: degradar administrador -> solo superadmin. Nunca el propio rol. */
export async function demoteToUser(actor: UserRow, targetId: string): Promise<UserRow> {
  assertActorRole(actor, "superadmin");
  const target = await requireTarget(targetId);
  if (target.id === actor.id) throw new CannotActOnSelfError("No podés modificar tu propio rol.");
  if (target.role !== "admin") throw new CannotActOnTargetError("Solo se puede degradar a un administrador.");
  const updated = await setUserRole(targetId, "user");
  if (!updated) throw new CannotActOnTargetError("No se pudo degradar la cuenta.");
  return updated;
}

/** Reenvío manual por administrador (Scope) -- reenvía lo que la cuenta esté esperando: activación (creada por admin, sin password_hash todavía) o verificación (self-service). */
export async function resendVerificationByAdmin(
  actor: UserRow,
  targetId: string,
  emailClient: EmailClient = defaultEmailClient()
): Promise<void> {
  assertActorRole(actor, "admin");
  const target = await requireTarget(targetId);
  if (target.status !== "pending_verification" || !target.email) {
    throw new CannotActOnTargetError("La cuenta no está pendiente de verificación.");
  }
  if (target.password_hash === null) {
    const { rawToken } = await issueAccountToken(target.id, "account_activation");
    await sendAccountActivationEmail(emailClient, { to: target.email, rawToken });
  } else {
    const { rawToken } = await issueAccountToken(target.id, "email_verification");
    await sendVerificationEmail(emailClient, { to: target.email, rawToken });
  }
}
