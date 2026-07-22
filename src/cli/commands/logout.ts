import { closeSession } from "../../auth/session.js";

export async function logout(): Promise<void> {
  const result = await closeSession();
  console.log(result === "closed" ? "Sesión cerrada." : "No había sesión local para cerrar.");
}
