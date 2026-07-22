import { createSession } from "../../auth/session.js";
import { verifyPassword } from "../../auth/password.js";
import { promptHiddenLine, promptLine } from "../../auth/prompt.js";
import { findUserByHandle } from "../../db/repository.js";
import type { SessionData } from "../../auth/session.js";

interface LoginDependencies {
  findUserByHandle: typeof findUserByHandle;
  verifyPassword: typeof verifyPassword;
  createSession: typeof createSession;
}

const defaultDependencies: LoginDependencies = { findUserByHandle, verifyPassword, createSession };

export async function login(): Promise<void> {
  const handle = (await promptLine("Handle: ")).trim();
  const password = await promptHiddenLine("Password: ");

  const session = await authenticateCliLogin(handle, password);
  console.log(`Login correcto. Sesión válida hasta ${session.expiresAt}.`);
}

export async function authenticateCliLogin(
  handle: string,
  password: string,
  dependencies: LoginDependencies = defaultDependencies
): Promise<SessionData> {
  const user = await dependencies.findUserByHandle(handle);
  if (!user?.password_hash) {
    throw new Error("Credenciales inválidas.");
  }

  const ok = await dependencies.verifyPassword(password, user.password_hash);
  if (!ok) {
    throw new Error("Credenciales inválidas.");
  }

  return dependencies.createSession(user.id);
}
