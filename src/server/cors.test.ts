import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";

// Hallazgo real recurrente (dos veces ya: PATCH/PUT en FEATURE-042, DELETE en FEATURE-025-Parte-1):
// agregar un método HTTP nuevo a una ruta sin agregarlo también a
// `Access-Control-Allow-Methods` hace que el preflight del browser bloquee el pedido antes de que
// llegue al servidor -- "Failed to fetch" sin ningún log ni error visible, muy fácil de no notar en
// pruebas manuales con curl (que no aplica la política CORS del browser). Test de regresión directo
// sobre el preflight real, no solo sobre el código que lo genera.
test("preflight OPTIONS declara todos los métodos HTTP que la API realmente usa", async () => {
  const app = createApp({ allowedOrigin: "https://aio.asdru.space", cookieSecure: true });
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No se pudo resolver el puerto efímero.");

    const response = await fetch(`http://127.0.0.1:${address.port}/agent-config/architect`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://aio.asdru.space",
        "Access-Control-Request-Method": "DELETE",
      },
    });

    assert.equal(response.status, 204);
    const allowedMethods = (response.headers.get("access-control-allow-methods") ?? "").split(",");
    for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]) {
      assert.ok(allowedMethods.includes(method), `Access-Control-Allow-Methods debería incluir ${method}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
