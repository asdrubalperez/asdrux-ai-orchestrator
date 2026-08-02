# FEATURE-025-Parte-1 — Asistente IA, modelo y credenciales API por agente

# 1. Feature Identity

* **Name:** Asistente IA, modelo y credenciales API por agente
* **Type:** Configuración de ejecución / self-service de credenciales
* **Owner:** Asdrubal Pérez
* **Status:** Diseño preliminar — punto de partida para ARIA, no cerrado
* **Priority:** Alta (ver handoff de priorización)

---

# 2. Problem Statement

Hoy, para los cinco roles del pipeline (`architect`, `functional`, `planning`, `developer`, `qa`):

* el **asistente de IA** (Claude Code / Codex) por rol ya se resuelve de forma real y por usuario
  (`user_agent_config`, `resolveAgentConfig` — override por rol -> global -> default, FEATURE-016),
  pero no tiene ninguna UI: se configura hoy vía flags de CLI (`--executor`, `--auth-mode`) o
  directamente en la tabla;
* el **modelo** dentro de ese asistente no existe como concepto persistido en absoluto — es un
  string suelto (`--model` de CLI) que se aplica igual a todos los roles de un run, sin
  validación de que el modelo pertenezca al asistente elegido, y sin relación con `user_agent_config`;
* el **modo de autenticación** (`api_key` / `cli_session`) también ya se resuelve por usuario y por
  rol desde FEATURE-016, pero el secreto real detrás de `api_key` es hoy una única variable de
  entorno del proceso (`ANTHROPIC_API_KEY`, `CODEX_API_KEY`) — **compartida por todos los usuarios
  del Orquestador**, sin importar cuál esté logueado ni qué diga `user_agent_config`.

El owner confirmó (2026-08-02) que la personalización debe ser libre por agente — un usuario puede
tener, por ejemplo, `architect` en Claude/Opus/API-key propia y `developer` en Codex/otro
modelo/otra credencial, sin que el sistema fuerce "mismo asistente para todos". El schema actual
(`user_agent_config`, una fila por rol o una global) ya lo permite tal cual está — no hace falta
ningún cambio para soportar esa libertad.

---

# 3. Functional Goal

Después de implementar esta parte:

* cada usuario puede elegir, por rol (o una config global), qué asistente de IA usar, entre los
  soportados hoy (Claude Code, Codex);
* cada usuario puede elegir, por rol, qué modelo usar dentro del asistente elegido, de un catálogo
  cerrado y validado contra ese asistente — nunca un string libre sin validar;
* cada usuario puede cargar su propia API key (Anthropic y/o OpenAI/Codex, según qué asistentes
  use), cifrada en reposo, reemplazando en su caso las variables de entorno compartidas del host;
* un run de un usuario que cargó su propia credencial la usa; un usuario que no cargó ninguna sigue
  funcionando contra la credencial compartida existente (comportamiento legacy intacto, sin
  romper nada para quien no adopta la Feature);
* el modo de autenticación `cli_session` (OAuth) sigue existiendo tal cual está hoy (mecanismo
  compartido del host) — esta parte NO lo toca. Ver FEATURE-025-Parte-2.

---

# 4. Scope

## Included

* UI de configuración de agente (probablemente una pantalla nueva de "Configuración" o una
  extensión de la de proyecto/perfil) con: selector de asistente por rol, selector de modelo
  (filtrado por asistente), campo de API key por asistente.
* Catálogo cerrado de modelos por asistente (ej. Claude: Opus/Sonnet/Haiku vigentes; Codex: los
  modelos que exponga su CLI) — server-side, no inventado por el cliente.
* Persistencia del modelo elegido, ligada a `user_agent_config` (columna nueva o tabla
  complementaria — a decidir por ARIA, ver sección 7).
* Almacenamiento cifrado de API keys por usuario y por asistente (Anthropic, OpenAI/Codex),
  reutilizando el mecanismo AES-256-GCM ya construido en FEATURE-026
  (`src/auth/gitCredentialEncryption.ts`) — mismo patrón, nueva tabla, sin inventar cifrado nuevo.
* Resolución en runtime: `resolveAgentConfig` (o su sucesor) devuelve asistente + modelo +
  credencial efectiva a usar para cada invocación de rol, con precedencia por-rol -> global ->
  default, igual que hoy.
* Fallback a la credencial compartida del host (`.env.local`) cuando el usuario no cargó la propia
  — no se puede romper el funcionamiento actual para quien no usa la Feature.
* Actualización de `claudeCodeExecutor.ts`/`codexExecutor.ts` para aceptar una API key resuelta por
  el caller en vez de leer siempre `process.env.*` directamente.

## Excluded

* OAuth personal por proveedor de IA (conexión real a una cuenta Claude.ai/ChatGPT propia,
  reemplazando `CLAUDE_OAUTH_CACHE_DIR`/`CODEX_OAUTH_CACHE_DIR`) — alcance completo de
  FEATURE-025-Parte-2.
* Cualquier cambio al mecanismo `cli_session` existente.
* Forzar un único asistente/modelo/credencial para todos los roles — explícitamente rechazado por
  el owner, cada rol se configura de forma independiente.
* Selección de proveedor/modelo para el paso de mapeo del intake (`mapBusinessCase.ts`) — ese paso
  no usa Executor/holder-worker hoy (no necesita tools), queda pendiente de diseño técnico aparte,
  ya anotado en el Roadmap como parte de esta Feature pero de resolución posterior.
* Límites de uso, cuotas o facturación por usuario sobre su propia credencial.

---

# 5. Functional Rules (borrador, a validar con ARIA)

1. La configuración es siempre por (usuario, rol) o (usuario, global) — nunca compartida entre
   usuarios, nunca forzada a ser igual entre roles.
2. El modelo elegido debe pertenecer al catálogo del asistente elegido para ese mismo (usuario,
   rol) — un cambio de asistente sin modelo compatible debe invalidar o resetear el modelo, nunca
   dejar una combinación inconsistente persistida.
3. La API key de un usuario nunca se expone en texto plano fuera del momento de creación (mismo
   criterio que FEATURE-026, Regla de "nunca se decodifica salvo para uso efímero en el proceso
   hijo").
4. Un usuario sin credencial propia cargada para un asistente sigue funcionando contra la
   credencial compartida del host — no hay corte técnico ni error nuevo introducido por esta
   Feature para quien no la adopta.
5. El modo de autenticación sigue siendo `api_key` o `cli_session` como hoy; esta parte solo agrega
   una fuente real detrás de `api_key` (la del usuario) además de la compartida — no toca
   `cli_session`.

---

# 6. Estrategia Algorítmica

No aplica como estrategia de optimización. Es resolución de configuración por precedencia
(idéntico patrón a `resolveAgentConfig` de FEATURE-016) más un catálogo de validación
asistente-modelo, ambos determinísticos.

---

# 7. Technical Considerations (abiertas para ARIA)

## 7.1 Modelo de datos — abierto

Dos caminos posibles, a decidir por ARIA:

* (a) extender `user_agent_config` con una columna `model` (nullable) — más simple, pero mezcla
  configuración de ejecución con credenciales si después se le agrega la API key ahí mismo;
* (b) `user_agent_config` se queda con asistente + modo de auth (como hoy), y se agrega una tabla
  nueva `user_provider_credentials` (user_id, provider, api_key_ciphertext, created_at,
  updated_at) para las credenciales, con el modelo viviendo en `user_agent_config` o en una tercera
  tabla si conviene versionarlo aparte.

Recomendación inicial (no cerrada): separar credenciales de configuración de ejecución, mismo
criterio que FEATURE-026 separó `user_git_connections` de cualquier tabla de configuración de
proyecto — las credenciales tienen su propio ciclo de vida (conectar/desconectar/rotar), distinto
del de "qué asistente uso en este rol".

## 7.2 Catálogo de modelos

¿Hardcodeado en código (lista fija por asistente, actualizada a mano cuando salen modelos nuevos,
mismo criterio que `TIPO_SOLUCION_OPTIONS` en el frontend) o consultado en vivo contra la API de
cada proveedor? Recomendación inicial: hardcodeado — los otros catálogos cerrados del sistema
(motivos de escalamiento, tipos de campo de intake) siguen ese patrón, y evita depender de un
endpoint de terceros para una pantalla de configuración.

## 7.3 Resolución en runtime

`resolveAgentConfig(userId, role)` (o un sucesor con más campos) necesita devolver no solo
asistente + modo de auth, sino también modelo + la credencial efectiva ya resuelta (desencriptada
en el momento, nunca antes) para pasarla a `buildExecutor`. Esto cambia la firma de `AgentConfig`
(hoy `{executorProvider, authMode}`) y todos sus call sites en `runStart.ts` — hay que mapear el
alcance real de ese cambio (`buildExecutor`, `ClaudeCodeExecutor`, `CodexExecutor`, sus
constructores y tests).

## 7.4 Ejecutores

`claudeCodeExecutor.ts`/`codexExecutor.ts` hoy leen `process.env.ANTHROPIC_API_KEY`/
`process.env.CODEX_API_KEY` directamente en varios puntos (confirmado por grep sobre el código
real). Necesitan aceptar una API key resuelta por el caller como parámetro opcional, con fallback a
la variable de entorno cuando no se provee — mismo patrón retrocompatible que `gitAuth` opcional en
FEATURE-026 (`cloneRunRepository`/`pushRunBranch`).

## 7.5 Arquitectura afectada (lista preliminar, a confirmar)

* Migración nueva para credenciales/modelo (tabla(s) a decidir, 7.1).
* `src/db/repository.ts` — CRUD de la tabla nueva, extensión de `resolveAgentConfig`.
* `src/auth/gitCredentialEncryption.ts` — posible generalización a un módulo de cifrado no
  específico de Git (renombrar o extraer lo genérico), dado que se reutiliza para credenciales de
  IA.
* `src/executor/claudeCodeExecutor.ts`, `src/executor/codexExecutor.ts`.
* `src/cli/commands/runStart.ts` — todos los call sites de `buildExecutor`.
* Endpoints nuevos en `src/server/app.ts` (equivalentes a `/auth/github/*` pero para credenciales
  de IA: alta, listado sin exponer el secreto, borrado).
* UI nueva en `web/src/` — pantalla de configuración de agente.

## 7.6 Dependencias

* FEATURE-016 (asistente/modo de auth por rol) — base directa.
* FEATURE-026 (patrón de cifrado AES-256-GCM) — se reutiliza, no se reinventa.
* Ninguna dependencia de FEATURE-041 (cuentas self-service) — funciona igual sobre cualquier fila
  de `users` existente, sin importar cómo se creó.

---

# 8. Validation Criteria (borrador)

* Un usuario configura `developer` en Codex/modelo X/API key propia y `qa` en Claude/modelo Y sin
  credencial propia — el run usa la key propia para `developer` y la compartida del host para `qa`.
* Cambiar el asistente de un rol sin modelo compatible no deja una combinación inconsistente
  persistida.
* Un usuario sin ninguna configuración propia corre exactamente como corre hoy (comportamiento
  legacy, sin cambios).
* La API key nunca aparece en logs, eventos persistidos, ni respuestas de API — mismo criterio de
  auditoría que FEATURE-026.

---

# 9. Risks (borrador)

* **Cambiar la firma de `AgentConfig`** toca muchos call sites en `runStart.ts` — alcance real a
  medir antes de comprometerse a un tamaño de Feature.
* **Generalizar el módulo de cifrado** (hoy nombrado explícitamente para Git) puede tentar a un
  refactor más grande del necesario — mitigación: extraer solo lo genérico (cifrar/descifrar un
  string), sin tocar la API pública de `gitCredentialEncryption.ts` que ya usa FEATURE-026.
* **Catálogo de modelos desactualizado** si se hardcodea — mitigación: mismo criterio que otros
  catálogos cerrados del sistema, se actualiza a mano cuando el owner lo pide, no es responsabilidad
  de esta Feature mantenerlo sincronizado automáticamente con los proveedores.

---

# 10. Approval Gate

La implementación permanece prohibida hasta que ARIA cierre el diseño completo y el owner lo
apruebe explícitamente. Este documento es el punto de partida, no un diseño cerrado.

**Estado del gate:** abierto — diseño preliminar, pendiente de ARIA.
