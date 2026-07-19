import { clearSession } from "../../auth/session.js";

export async function logout(): Promise<void> {
  const removed = await clearSession();
  console.log(removed ? "Sesión cerrada." : "No había sesión local para cerrar.");
}
