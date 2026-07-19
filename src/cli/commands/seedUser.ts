import { hashPassword } from "../../auth/password.js";
import { promptHiddenLine, promptLine } from "../../auth/prompt.js";
import { upsertUserPassword } from "../../db/repository.js";

export async function seedUser(): Promise<void> {
  const handle = (await promptLine("Handle: ")).trim();
  if (!handle) {
    throw new Error("Handle vacío.");
  }

  const password = await promptHiddenLine("Password: ");
  if (!password) {
    throw new Error("Password vacío.");
  }

  const passwordHash = await hashPassword(password);
  const user = await upsertUserPassword(handle, passwordHash);
  console.log(`Usuario "${user.handle}" creado/actualizado correctamente.`);
}
