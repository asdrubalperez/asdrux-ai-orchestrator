import { createSession } from "../../auth/session.js";
import { verifyPassword } from "../../auth/password.js";
import { promptHiddenLine, promptLine } from "../../auth/prompt.js";
import { findUserByHandle } from "../../db/repository.js";

export async function login(): Promise<void> {
  const handle = (await promptLine("Handle: ")).trim();
  const password = await promptHiddenLine("Password: ");

  const user = await findUserByHandle(handle);
  if (!user?.password_hash) {
    throw new Error("Credenciales inválidas.");
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    throw new Error("Credenciales inválidas.");
  }

  const session = await createSession(user.id);
  console.log(`Login correcto. Sesión válida hasta ${session.expiresAt}.`);
}
