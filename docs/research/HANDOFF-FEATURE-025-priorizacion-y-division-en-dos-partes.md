# Handoff — FEATURE-025: por qué se priorizó y por qué se dividió en dos partes

## 1. Destinatario

ARIA (AI Product Architect). El owner va a retomar el diseño de FEATURE-025 con este documento como
punto de partida, junto con los dos diseños preliminares:

* `docs/features/FEATURE-025-Parte-1-Asistente-Modelo-y-Credenciales-API-por-Agente.md`
* `docs/features/FEATURE-025-Parte-2-OAuth-Personal-por-Proveedor-de-IA.md`

No son diseños cerrados — son el punto de partida real contra el que diseñar, con el alcance,
el modelo de datos abierto y los riesgos ya identificados contra el código actual.

## 2. Por qué FEATURE-025 se prioriza antes que FEATURE-041

Con FEATURE-043 recién cerrada, la pregunta era qué encarar a continuación entre FEATURE-025
(selección de asistente/modelo/credenciales por rol) y FEATURE-041 (cuentas de usuario
self-service). Análisis de dependencia contra el código real:

* **No hay dependencia técnica en ningún sentido.** F025 no necesita que existan cuentas
  self-service — ya funciona sobre cualquier fila de `users` existente, sin importar si se creó por
  `seed:user` (CLI, admin) o por un signup futuro. F041 tampoco necesita F025 — crear cuentas y
  pedir perfil no requiere selección de proveedor de IA.
* **Hay una asimetría de riesgo real, no solo de alcance.** Hoy, con un único usuario real
  operando el sistema, las credenciales de IA (`ANTHROPIC_API_KEY`, `CODEX_API_KEY`) ya son
  compartidas — cualquier usuario adicional que entre (incluso vía `seed:user` manual) corre
  automáticamente contra esa misma clave, sin aislamiento. Abrir FEATURE-041 (cuentas abiertas a
  cualquiera) antes de resolver ese aislamiento amplifica exactamente el problema que FEATURE-025
  resuelve: más gente con sesión válida, todos pegándole a la misma clave compartida del dueño.
  Resolver F025 primero cierra un hueco de seguridad/costo que ya existe hoy, no uno que empeora
  recién cuando llegue F041.
* **Menor riesgo técnico de implementación.** F025 reutiliza patrones ya construidos y validados en
  producción: `user_agent_config` (FEATURE-016) ya es multi-usuario con precedencia por-rol ->
  global -> default; el cifrado AES-256-GCM de credenciales por usuario (FEATURE-026) ya existe y
  es reutilizable tal cual para las API keys de proveedores de IA.

## 3. Por qué se dividió en dos partes

Al revisar el alcance real que el owner pidió para FEATURE-025 — (1) asistente por agente, (2)
modelo por agente según el asistente, (3) modo de autenticación (API u OAuth) — contra el código
actual, aparece una asimetría importante entre los tres puntos que cambia el tamaño real de la
Feature:

| Punto | Estado real hoy |
|---|---|
| 1. Asistente por agente | Ya construido casi entero desde FEATURE-016 (`user_agent_config.executor_provider`, `resolveAgentConfig`). Falta solo UI. |
| 2. Modelo por agente | No existe nada — ni columna, ni tipo, ni resolución. Hoy es un flag de CLI (`--model`) global al run entero, sin persistir y sin validar contra el proveedor. |
| 3. Modo de autenticación | El *selector* (`api_key`/`cli_session`) ya existe desde FEATURE-016. Pero el secreto real detrás de `cli_session` es hoy una única sesión OAuth **compartida del host** (`CLAUDE_OAUTH_CACHE_DIR`/`CODEX_OAUTH_CACHE_DIR`, variables de entorno globales, confirmado en `claudeCodeExecutor.ts`/`codexExecutor.ts`) — exactamente el mismo problema de credencial compartida que tiene hoy `api_key`, no algo ya resuelto. |

En otras palabras: el punto 3, tal como está hoy, es **selector real + secreto falso** — aparenta
ser por-usuario pero no lo es. Resolverlo de verdad (que cada usuario conecte su propia cuenta de
Claude/Codex) es, en tamaño y naturaleza, una Feature equivalente a FEATURE-026 (que hizo
exactamente esto para GitHub) pero para dos proveedores de IA más — con una diferencia crítica: no
está confirmado que Claude Code CLI o Codex CLI expongan un mecanismo de OAuth delegable como el de
GitHub. FEATURE-026 pudo diseñarse con confianza porque GitHub tiene OAuth Apps estándar y bien
documentados; acá hace falta un spike técnico antes de poder comprometerse a un diseño funcional
completo (ver sección 7.1 de Parte 2).

Mezclar todo en una sola Feature hubiera atado el trabajo de bajo riesgo y alto valor (puntos 1 y 2,
más el modo `api_key` del punto 3 — que cierra el hueco de seguridad real de hoy) a un riesgo técnico
no confirmado (el mecanismo real de OAuth de cada CLI). La división dejó:

* **Parte 1** — asistente + modelo + API key propia por agente. Alcance conocido, patrones ya
  validados en producción (FEATURE-016 + FEATURE-026), shippeable con confianza. Cierra el
  problema de seguridad real de hoy.
* **Parte 2** — OAuth personal por proveedor de IA. Alcance abierto hasta completar un spike
  técnico sobre cómo autentica realmente cada CLI. No bloquea a Parte 1 ni viceversa.

Nota sobre el punto 3 tal como lo planteó originalmente el owner ("modo de autenticación... para
todos los Agentes que tengan ese Asistente de IA"): al revisarlo, el owner confirmó que en realidad
prefiere permitir personalización libre por agente (no forzar un único modo por asistente) — el
schema actual (`user_agent_config`, una fila por rol) ya soporta esa libertad sin ningún cambio, así
que ambos diseños preliminares la asumen directamente.

## 4. Qué falta antes de implementar

Ninguna de las dos partes tiene luz verde de implementación todavía — ambas requieren pasar primero
por el diseño completo de ARIA y aprobación explícita del owner (Approval Gate cerrado en los dos
documentos). Parte 2 además requiere el spike técnico de su sección 7.1 antes de que el diseño
funcional pueda cerrarse con la misma confianza que Parte 1.

## 5. Documentos relevantes

1. `docs/features/FEATURE-025-Parte-1-Asistente-Modelo-y-Credenciales-API-por-Agente.md` — diseño
   preliminar completo (Problem Statement, Scope, Functional Rules borrador, Technical
   Considerations abiertas, Risks).
2. `docs/features/FEATURE-025-Parte-2-OAuth-Personal-por-Proveedor-de-IA.md` — ídem, con énfasis en
   el spike técnico previo requerido.
3. `docs/ROADMAP.md` — entrada de FEATURE-025 actualizada, dividida en las dos partes.
