# FEATURE-025-Parte-3 — Soporte Codex/OAuth para el Asistente de Entrada (mapeo de intake)

# 1. Feature Identity

* **Name:** Soporte Codex y OAuth para el Asistente de Entrada
* **Type:** Ampliación de integración
* **Owner:** Asdrubal Pérez
* **Status:** Diseño preliminar — punto de partida, no cerrado
* **Priority:** Baja (deferred explícito, ver origen)

---

# 2. Origen y Problem Statement

Al implementar FEATURE-025-Parte-1 se identificó que el mapeo de texto libre a campos del caso de
negocio (`src/intake/mapBusinessCase.ts`, FEATURE-017) usaba la misma clave global del host
(`ANTHROPIC_API_KEY`) que esta Feature retira para los 5 roles reales del pipeline — un hueco que
no estaba contemplado en el diseño original porque el mapeo nunca se identificó como "un agente".

Decisión del owner (2026-08-02): tratar el mapeo con el mismo mecanismo de configuración que los 5
roles reales — un sexto rol configurable, `"intake"` ("Asistente de Entrada"), con override propio
o herencia de la config global, resuelto por `resolveAgentConfig`/`resolveExecutorAuthentication`
exactamente igual que Architect/Functional/Planning/Developer/QA. **Esa parte ya se implementó
dentro de FEATURE-025-Parte-1** (migración `0022_agent_config_intake_role.sql`).

Lo que queda pendiente, y es el alcance de esta Parte 3: `mapBusinessCase.ts` es una llamada HTTP
directa y exclusiva a la API de Anthropic (Messages API) — no pasa por `ClaudeCodeExecutor` ni por
`CodexExecutor`, no tiene tools, no usa el mecanismo de holder/worker. Si el rol "intake" resuelve a
`executorProvider: "codex"` o a `authMode: "cli_session"`, hoy el sistema corta explícitamente con
un error claro (`IntakeMappingProviderUnsupportedError` / `IntakeMappingAuthModeUnsupportedError`,
`src/cli/intakeService.ts`) en vez de intentar algo que no existe — comportamiento deliberado y
documentado, no un bug.

---

# 3. Functional Goal

Después de implementar esta parte:

* si el usuario configura "intake" (override propio o vía global) con Codex, el mapeo efectivamente
  llama a la API de OpenAI para hacer la misma extracción estructurada de texto;
* si el usuario configura "intake" con `cli_session` para cualquiera de los dos proveedores, el
  mapeo usa esa sesión en vez de exigir una API key.

---

# 4. Scope (preliminar)

## Included

* Camino de llamada a la API de OpenAI equivalente al que ya existe para Anthropic —
  mismo contrato de entrada/salida (`buildMappingPrompt`/`parseMappingResponse` ya son agnósticos
  de proveedor, section reusable sin cambios).
* Decisión de diseño: ¿se llama a la API de OpenAI directamente (mismo patrón liviano que hoy,
  sin CLI/Executor), o se reutiliza `CodexExecutor`/su CLI headless para esta tarea puntual? La
  Parte 1 asumió lo primero como más simple, pero no está confirmado que el mapeo se beneficie de
  las mismas garantías de aislamiento que un `CodexExecutor` completo — a definir con ARIA.
* Soporte de `cli_session` para el mapeo — depende directamente de que FEATURE-025-Parte-2 (OAuth
  personal por proveedor) exista primero; hasta entonces, `cli_session` para "intake" seguiría
  cortando igual que hoy.

## Excluded

* Cualquier cambio al comportamiento ya implementado para Claude + API key (Parte 1, sección
  intacta).

---

# 5. Dependencias

* FEATURE-025-Parte-1 — ya implementada, establece el rol "intake" y su mecanismo de resolución;
  esta parte solo agrega los caminos de ejecución que hoy cortan explícitamente.
* FEATURE-025-Parte-2 — requerida para que `cli_session` tenga sentido real para "intake" (sesión
  por usuario, no la compartida del host).

---

# 6. Approval Gate

La implementación permanece prohibida. Diseño preliminar, no cerrado — sin urgencia (prioridad
Baja): el mapeo funciona hoy con Claude + API key propia, que es la configuración por defecto y la
más simple de adoptar.

**Estado del gate:** abierto — diseño preliminar, pendiente de ARIA y de que Parte 2 exista para la
mitad de OAuth.
