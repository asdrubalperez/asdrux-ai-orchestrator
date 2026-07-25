# FEATURE-016 — Modo de autenticación por cuenta personal (OAuth) para Executors

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: Este documento es la **versión 2** del diseño de FEATURE-016, y reemplaza
> íntegramente al diseño v1 (`docs/features/FEATURE-016-auth-oauth-executors.md` tal como existía
> antes de esta revisión). La v1 fue escrita antes de FEATURE-015A/015B/015C (arquitectura
> holder/worker, catálogo cerrado de tools por rol) y contenía premisas ya invalidadas por esas
> Features — ver sección 9 (Risks) para el detalle de qué cambió y por qué. No reabre la forma
> arquitectónica ya resuelta en `docs/research/investigacion-auth-cuenta-personal-executors.md`
> (v1.1): parámetro `authMode`, sin Executors nuevos por proveedor.
>
> Este documento ya pasó por una ronda de validación del DAIA (Developer AI Assistant — hoy Claude
> Code), que encontró un bloqueante real no contemplado en el borrador anterior de esta v2 (el flag
> `--bare`, usado hoy por `runRoleIsolated()`, deshabilita explícitamente OAuth/keychain para
> Claude Code). Ese hallazgo, y los de las rondas de investigación que siguieron, fueron verificados
> independientemente — incluyendo una prueba con una cuenta OAuth real del owner — antes de quedar
> reflejados acá (ver sección 7.4 y sección 9, Risks). El resultado es un cambio real de diseño
> respecto al primer borrador: la sección 7.3 ya no asume que alcanza con agregar una rama
> condicional en `buildChildEnv`; documenta explícitamente qué mecanismo funciona, cuál no, y qué
> riesgo queda aceptado a propósito para Claude Code.

---

## 1. Feature Identity

- **Name**: Modo de autenticación por cuenta personal (OAuth) para Executors + selección de
  agente/authMode por usuario
- **Type**: Backend (Executor / autenticación de proveedor) + persistencia (DB)
- **Owner**: asdru
- **Status**: **Aprobado (2026-07-25) — implementado en la rama `feature/016-auth-oauth-executors`,
  pendiente de validación conjunta Architect + owner y merge a `main`.**
- **Priority**: Media — no bloquea nada existente (comportamiento default sin cambios). Su
  prerequisito (FEATURE-015, arquitectura holder/worker) ya está completo y aceptado.

---

## 2. Problem Statement

Hoy los Executors (`ClaudeCodeExecutor`, `CodexExecutor`) se autentican contra el proveedor
exclusivamente vía API key (`ANTHROPIC_API_KEY`/`CODEX_API_KEY`), fija por proceso/entorno. Esto
tiene dos limitaciones reales:

1. **Costo por token**, sin aprovechar suscripciones ya pagadas por el usuario (Claude Pro/Max,
   ChatGPT Plus, etc.) — motivación original de la Feature.
2. **No existe hoy ninguna forma de que un usuario elija, por sí mismo y de forma persistente**,
   qué agente (Claude Code / Codex) y qué modo de autenticación (API key / sesión de cuenta
   personal) usar para sus runs. Lo único que existe es un flag de CLI por invocación puntual
   (`--executor claude|codex`, default `claude`), pensado para uso técnico nuestro, no para un
   usuario final.

La interfaz final para que un usuario configure esto es una UI futura (ítem Tentativo "Capa de UI
— Disparo", fuera de esta Feature). Mientras esa UI no existe, se necesita un mecanismo simple —
persistente por usuario, no por sesión ni por invocación — que la futura UI pueda leer/escribir
sin rediseño posterior.

---

## 3. Functional Goal

1. Cada usuario tiene una preferencia persistente de **agente** (`claude` | `codex`) y **authMode**
   (`api_key` | `cli_session`), guardada en base de datos, independiente de la sesión — sobrevive
   logout/login.
2. Esa preferencia puede definirse **global** (aplica a los 5 roles) y, opcionalmente, **por rol**
   (override puntual para uno o más roles). Si no hay override para un rol, se usa la preferencia
   global del usuario. Si no hay ninguna preferencia guardada, se usa el default actual
   (`claude` + `api_key`) — regresión cero.
3. Cada Executor puede autenticarse por API key (default, sin cambios) o por sesión de cuenta
   personal ya autenticada (`cli_session`), sin exponer esa credencial a ningún componente salvo el
   contenedor holder que ya la usa hoy para la API key.
4. El CLI conserva flags de override (`--executor`, `--auth-mode`) para uso técnico puntual
   (nuestro, o de Claude Code en pruebas) — nunca pensados como la interfaz del usuario final.

---

## 4. Scope

### Incluido

1. Tabla nueva en DB (ver sección 7) para persistir preferencia de agente + `authMode` por
   usuario, con soporte de override por rol.
2. Funciones de repositorio: obtener preferencia global de un usuario, obtener la resuelta para un
   rol específico (aplicando precedencia), y fijar/actualizar (upsert) tanto la global como un
   override por rol.
3. Parámetro `authMode?: "api_key" | "cli_session"` en `ClaudeCodeExecutorOptions` y
   `CodexExecutorOptions`, default `"api_key"` — comportamiento actual sin cambios si no se
   especifica.
4. Rama condicional en la construcción del contenedor holder (`runRoleIsolated` en
   `claudeCodeExecutor.ts`, equivalente en `codexExecutor.ts`): `"api_key"` inyecta la key como hoy
   (`-e ANTHROPIC_API_KEY`/`-e CODEX_API_KEY`); `"cli_session"` monta de solo lectura un caché de
   credenciales dedicado del Orquestador (nunca el `HOME` personal del operador) y no inyecta
   ninguna key.
5. Para Codex específicamente: usar `type:"chatgpt"` en `account/login/start` cuando
   `authMode === "cli_session"`, en vez de `type:"apiKey"`.
6. Falla explícita si el caché OAuth dedicado no existe o la sesión está vencida — sin fallback
   silencioso a `api_key` ni a continuar sin autenticación.
7. Flag nuevo de CLI `--auth-mode api_key|cli_session`, mismo criterio que el `--executor`
   existente: override puntual de una sola invocación, no persiste nada en DB.
8. Resolución de precedencia en `runStart.ts`: flag de CLI > override de DB por rol > preferencia
   global de DB del usuario > default (`claude` + `api_key`).
9. Documentar en `docs/playbook/02-ARCHITECTURE.md` la sub-sección de modo de autenticación y
   selección de agente, con referencia a esta Feature.

### Excluido

1. **UI para que el usuario final configure esto** — pertenece al ítem Tentativo "Capa de UI
   (Disparo, Historial/admin)", Feature separada. Esta Feature deja la tabla y las funciones de
   repositorio listas para que esa UI las use sin rediseño, pero no construye ninguna interfaz.
2. **Versionado/historial de cambios de la configuración** — la tabla se diseña simple, sin
   `valid_from`/`valid_to` como `project_config_versions`. Ver Future ideas: se documenta
   explícitamente cómo migrar a versionado después, sin romper lo que esta Feature entrega, si el
   owner decide que hace falta historial más adelante.
3. **Refresh proactivo de la sesión OAuth** (renovar antes de que venza) — si el token vence a
   mitad de una fase, se falla esa fase con el error explícito (Regla 6); reintento automático
   queda como idea futura.
4. **Concurrencia de runs simultáneos usando la misma sesión de cuenta personal** — ítem Tentativo
   separado del Roadmap; esta Feature no lo resuelve ni lo bloquea, pero el Risk queda documentado
   (sección 9).
5. **Cualquier gate de bloqueo condicionado a una Feature de egress separada** — no aplica; la
   mitigación es la arquitectura holder/worker de FEATURE-015, ya implementada y aceptada.

### Future ideas

- Migrar `user_agent_config` a un esquema versionado (mismo patrón que
  `project_config_versions`: `valid_from`/`valid_to`, índice único parcial "vigente") si en algún
  momento se necesita auditar cambios de `authMode` — la tabla simple de esta Feature no bloquea
  esa migración futura, solo no la incluye ahora.
- Refresh proactivo de sesión OAuth.
- Selección de `authMode`/agente desde la UI real, por rol, cuando exista la Capa de UI de
  Disparo (ítem Tentativo separado).

---

## 5. Functional Rules

1. **Default sin cambios**: sin ninguna fila en `user_agent_config` para un usuario, el
   comportamiento es exactamente el actual (`claude` + `api_key`) — regresión cero.
2. **Precedencia única y explícita, en este orden**: flag de CLI (`--executor`/`--auth-mode`) >
   override de `user_agent_config` para ese rol específico > fila global de
   `user_agent_config` del usuario (`role IS NULL`) > default (`claude` + `api_key`). Nunca se
   mezclan parcialmente — si hay flag de CLI, ese flag decide agente **y** authMode juntos para
   toda la invocación, no se combina un valor del flag con otro de la DB.
3. **El flag de CLI no persiste nada**: es un override de una sola corrida, pensado para uso
   técnico (nuestro, o de Claude Code en pruebas), nunca para el usuario final — que solo va a
   interactuar, cuando exista, con la futura UI.
4. **`cli_session` nunca inyecta API keys**, y el contenedor holder sigue sin heredar
   `process.env` completo — mismo criterio ya vigente (H14/FEATURE-006) aplicado al modo OAuth.
5. **Caché OAuth dedicado, nunca el `HOME` personal completo**: el Orquestador gestiona su propio
   directorio de caché (separado del `HOME` real del operador), montado de solo lectura en el
   contenedor holder en cada invocación — mismo patrón `-v origen:destino:ro` que ya usa hoy
   `roleMcpBridge.mjs`/`mcp.json`, confirmado funcional (sección 7).
6. **Falla explícita, sin fallback silencioso**: si el caché no existe, está vacío, o la sesión
   está vencida, el Executor falla la invocación con un error claro
   (`authMode=cli_session requiere sesión OAuth válida; no encontrada o vencida`) — nunca cae a
   `api_key` aunque hubiera una configurada, ni continúa sin autenticación.
7. **Mismo gate para los 5 roles, sin asimetría** — el canal de respuesta (cualquier rol con tools
   de lectura puede ser inducido a filtrar una credencial en su texto, sin tráfico de red de por
   medio) ya fue documentado por FEATURE-015 como transversal a los 5 roles, no exclusivo de
   Developer. No hay ninguna regla especial ni dependencia externa distinta para Developer versus
   el resto — la mitigación (holder/worker, catálogo cerrado de tools) ya es uniforme hoy.
8. **La preferencia por rol es un override, no una obligación**: si el usuario solo configura la
   global, los 5 roles la heredan. No hace falta configurar los 5 roles para que el sistema
   funcione.

---

## 6. Estrategia Algorítmica

No aplica — no hay lógica de decisión/optimización, solo resolución de precedencia (Regla 2), que
es determinística y ya queda completamente especificada en las Reglas 1-8.

---

## 7. Technical Considerations

### 7.1 Persistencia — tabla `user_agent_config`

Migración `0008_user_agent_config.sql` (siguiente número libre; `0007_web_sessions.sql` es la
última migración real verificada en `main`):

```sql
create table user_agent_config (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  role text,
  executor_provider text not null,
  auth_mode text not null default 'api_key',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_agent_config_role_check
    check (role is null or role in ('architect', 'functional', 'planning', 'developer', 'qa')),
  constraint user_agent_config_provider_check
    check (executor_provider in ('claude', 'codex')),
  constraint user_agent_config_auth_mode_check
    check (auth_mode in ('api_key', 'cli_session'))
);

-- Una sola fila global (role IS NULL) por usuario.
create unique index one_global_agent_config_per_user
  on user_agent_config (user_id)
  where role is null;

-- Una sola fila de override por (usuario, rol) cuando role no es null.
create unique index one_role_agent_config_per_user
  on user_agent_config (user_id, role)
  where role is not null;
```

`role IS NULL` representa la preferencia global; una fila con `role` no nulo representa un
override para ese rol puntual. Sin versionado (a diferencia de `project_config_versions`) — ver
Scope, Excluido punto 2, y Future ideas para el camino de migración si hiciera falta después.

### 7.2 Funciones de repositorio (`src/db/repository.ts`)

Mismo estilo que las ya existentes (`getCurrentProjectConfig`, etc.):

- `getGlobalAgentConfig(userId): Promise<{ executorProvider, authMode } | null>` — la fila con
  `role IS NULL`.
- `getRoleAgentConfigOverride(userId, role): Promise<{ executorProvider, authMode } | null>` — la
  fila para ese rol específico, o `null` si no existe override.
- `resolveAgentConfig(userId, role): Promise<{ executorProvider, authMode }>` — aplica Regla 2
  (sin el flag de CLI, que se resuelve en `runStart.ts` antes de llamar a esta función): override
  de rol → global → default `{ executorProvider: "claude", authMode: "api_key" }`.
- `setGlobalAgentConfig(userId, config)` / `setRoleAgentConfigOverride(userId, role, config)` —
  upsert (`ON CONFLICT` sobre los índices únicos parciales de 7.1).

### 7.3 Cambios en los Executors

- `ClaudeCodeExecutorOptions` y `CodexExecutorOptions`: agregar `authMode?: "api_key" |
  "cli_session"`, default `"api_key"`. El contrato `Executor.runPhase()`
  (`src/contracts/executor.ts`) **no cambia**.
- **Codex — mecanismo limpio, confirmado de punta a punta:**
  - El caché OAuth dedicado se monta de solo lectura en el contenedor holder, mismo patrón que ya
    usa `runRoleIsolated` para `roleMcpBridgePath()`/`configPath`. **Confirmado funcional**: mount
    de solo lectura probado manualmente en la VPS con la imagen real
    (`ai-orchestrator-developer:latest`, mismos flags `--read-only --cap-drop ALL --security-opt
    no-new-privileges`).
  - `CODEX_HOME` (no `CLAUDE_CONFIG_DIR`, que es de Claude Code — ver más abajo) es la variable
    real que controla dónde busca Codex su `auth.json`. **Confirmado independientemente**:
    `codex doctor --json` reporta `"auth file": "/root/.codex/auth.json"` por default, y cambiar
    `CODEX_HOME=/tmp/fake-codex-home` mueve esa ruta exactamente ahí.
  - Cuando `authMode === "cli_session"`, el mensaje `account/login/start` usa `type:"chatgpt"` en
    vez de `type:"apiKey", apiKey`. **Confirmado en el schema real**, generado con
    `codex app-server generate-json-schema --experimental` contra `@openai/codex@0.145.0` (la
    tupla pineada).
  - **No se encontró ningún flag ni modo restrictivo equivalente a `--bare`/`--safe-mode` en
    Codex** (`codex --help`, `codex exec --help`, `codex app-server --help` no tienen nada
    parecido) — Codex no tiene el problema descripto en 7.4 para Claude Code.
- **Claude Code — mecanismo con una limitación real y aceptada (ver 7.4 y Risks):**
  - El caché OAuth dedicado se monta igual que para Codex, mismo patrón de mount ya confirmado
    funcional.
  - **No se invoca con `--bare`** cuando `authMode === "cli_session"` — `--bare` deshabilita OAuth
    explícitamente (confirmado, ver 7.4). Tampoco se setea `CLAUDE_CODE_SIMPLE=1` (mismo bloqueo,
    confirmado con una cuenta OAuth real, ver Risks).
  - Se agrega `--setting-sources ""` a la invocación cuando `authMode === "cli_session"` — suprime
    hooks y auto-discovery de `CLAUDE.md` (confirmado), pero **no** LSP, plugin sync, ni
    prefetch/bootstrap de red al arranque (confirmado que siguen activos — ver Risks, riesgo
    aceptado conscientemente para esta versión de la Feature).

### 7.4 Mecanismo de "dónde busca cada CLI su sesión" — resuelto, con una limitación aceptada para Claude Code

**Codex: resuelto sin reservas.** `CODEX_HOME` + `type:"chatgpt"`, ambos confirmados con evidencia
reproducible propia (no solo el reporte del DAIA).

**Claude Code: resuelto, pero con un costo que se acepta explícitamente.** La investigación pasó
por tres mecanismos candidatos, los tres descartados o acotados:

1. `--bare` (el que ya usa `runRoleIsolated` hoy): deshabilita OAuth de raíz. Confirmado,
   textual, contra el `--help` real del CLI (`@anthropic-ai/claude-code`) por el Architect: *"Anthropic
   auth is strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings (OAuth and keychain are never
   read)"*. **Reproducido además con la cuenta Pro real del owner** (Architect + owner, no el
   DAIA, y luego reproducido independientemente por el DAIA — ver abajo): invocación normal
   exitosa (`is_error:false`), la misma invocación con `--bare` falla instantáneo
   (`is_error:true`, `"Not logged in · Please run /login"`).
2. `--safe-mode`: preserva auth ("Auth, model selection, built-in tools, and permissions work
   normally", según su propio `--help`), pero **bloquea MCP servers incondicionalmente**, incluso
   con `--strict-mcp-config` + `--mcp-config` + `enabledMcpjsonServers` explícito. Confirmado con
   un servidor MCP de prueba (marker file al spawnear): nunca se invocó, en dos corridas
   repetidas. Descartado — el holder depende enteramente de un servidor MCP
   (`orchestrator_worker`) para que el modelo pueda usar cualquier tool; sin MCP, no hay Feature.
3. `CLAUDE_CODE_SIMPLE=1` (la variable interna que `--bare` setea internamente, ver su propio
   `--help`): suprime hooks, LSP, plugin sync y prefetch/bootstrap desde un único punto — pero
   **también bloquea OAuth**, igual que `--bare`. **Confirmado por el Architect junto con el
   owner con la cuenta Pro real, y reproducido independientemente por el DAIA con la misma
   cuenta** (`asdrubalperez@gmail.com`, plan Pro), corriendo los 3 controles con
   `--output-format json`:

   | Control | `is_error` | `result` | `duration_ms` |
   |---|---|---|---|
   | A — normal, sin flags | `false` | `"OK"` | `3599` |
   | B — `--bare` | `true` | `"Not logged in · Please run /login"` | `74` |
   | C — `CLAUDE_CODE_SIMPLE=1` sin `--bare` | `true` | `"Not logged in · Please run /login"` | `54` |

   B y C fallan de forma idéntica (mismo mensaje, mismo orden de magnitud de tiempo) — confirma
   que `CLAUDE_CODE_SIMPLE=1` no es separable del bloqueo de OAuth: está atado a `--bare`, no es
   una alternativa más fina.

**Conclusión, la única combinación viable hoy:** correr sin `--bare` y sin `CLAUDE_CODE_SIMPLE`,
con `--setting-sources ""` como mitigación parcial (hooks y `CLAUDE.md`, confirmado). LSP, plugin
sync y el prefetch/bootstrap de red al arranque quedan activos — ver Risks para el riesgo real que
esto implica y por qué se acepta para esta versión.

### 7.5 CLI

- `runStart.ts`: agregar flag `--auth-mode api_key|cli_session`, mismo mecanismo que ya usa
  `getFlag(args, "--executor")`.
- Resolución de precedencia (Regla 2) implementada en `runStart.ts`, antes de construir el
  Executor: si hay flag(s) de CLI, ganan ambos (agente y authMode juntos); si no, se llama a
  `resolveAgentConfig(user.id, role)` por cada fase del pipeline.

### 7.6 Dependencias y riesgos de arquitectura

- Prerequisito FEATURE-015 (015A+015B): **completo y aceptado** — no es una dependencia
  pendiente, es la base ya construida sobre la que se apoya esta Feature.
- No hay ninguna dependencia con el ítem Tentativo de egress/allowlist — ese ítem ya no existe
  como tal, fue reemplazado por FEATURE-015 (ver ROADMAP.md real).

---

## 8. Validation Criteria

| Escenario | Input | Salida esperada |
|---|---|---|
| Sin config en DB | Usuario sin fila en `user_agent_config` | Comportamiento idéntico al actual (`claude` + `api_key`) |
| Solo config global | Fila `role IS NULL` con `codex`/`api_key` | Los 5 roles usan `codex`/`api_key` |
| Global + override de un rol | Global `claude`/`api_key`, override `developer` → `codex`/`cli_session` | Developer usa `codex`/`cli_session`; el resto usa la global |
| Flag de CLI presente | `--executor codex --auth-mode cli_session` con cualquier config en DB | Gana el flag para toda la invocación, sin tocar ni leer la config de DB para esa corrida |
| `cli_session` con caché válido (Claude Code, sin `--bare`, con `--setting-sources ""`) | Caché dedicado con credenciales OAuth válidas | Invocación headless exitosa, sin intervención humana. **Precondición ya confirmada** con cuenta real: la misma invocación sin `--bare` funciona (`is_error:false`) |
| `cli_session` con caché vencido/ausente | Caché vacío o vencido | Falla explícita con el mensaje de la Regla 6, sin fallback. **Ya confirmado** el caso equivalente sin caché: `"Not logged in · Please run /login"` |
| `cli_session` en Codex | `type:"chatgpt"` en `account/login/start`, `CODEX_HOME` apuntando al caché, caché válido | Login aceptado, invocación headless exitosa |
| `cli_session` + rol Developer (o cualquier otro) | Sin ninguna Feature de egress adicional activa | Permitido igual que los demás roles — sin gate especial (Regla 7) |
| Variables de entorno no filtradas | Invocación en `cli_session` | El proceso holder no hereda `DATABASE_URL_DEV` ni otras variables del Orquestador (mismo criterio de H14) |
| Mount de credencial en contenedor | Archivo de prueba montado `-v origen:destino:ro` | **Ya confirmado**, dos veces independientes (Architect + DAIA), con la imagen real del holder |
| `--bare` con OAuth | Invocación con `--bare` y sesión OAuth real | **Ya confirmado, dos veces independientes** (Architect+owner, y luego DAIA) |
| `--safe-mode` + MCP explícito | `--safe-mode --strict-mcp-config --mcp-config ... --settings enabledMcpjsonServers` | **Ya confirmado por Architect y por DAIA de forma independiente**: el servidor MCP nunca se invoca — descartado como mecanismo |
| `CLAUDE_CODE_SIMPLE=1` con OAuth | Invocación con esa variable y sesión OAuth real | **Ya confirmado, dos veces independientes** (Architect+owner, y luego DAIA) — mismo resultado que `--bare` |
| `--setting-sources ""`: hooks y `CLAUDE.md` | Hook `SessionStart` configurado + `CLAUDE.md` con marker | **Ya confirmado**: ambos se suprimen |
| `--setting-sources ""`: LSP/plugin sync/prefetch | Mismo flag, `HOME` fresco | **Ya confirmado**: los tres siguen activos — riesgo aceptado (ver Risks), no requiere nueva validación |

### Validation Evidence

Evidencia real esperada: al menos una invocación headless exitosa end-to-end con `cli_session`
para Claude Code **y** para Codex, dentro de contenedor (no solo el mount aislado ya probado),
usando una sesión de cuenta personal real, sin intervención humana durante la invocación. Además,
confirmación de que la resolución de precedencia (flag > rol > global > default) se comporta según
la tabla de arriba con al menos un caso de cada fila, documentado con salida real de comandos.

**Estado tras la implementación (2026-07-25)**: el mecanismo de precedencia, la persistencia y la
rama condicional de los Executors están implementados y cubiertos por `npm run build` (typecheck)
y `npm test` (55 tests, 53 pass / 2 skipped por falta de Docker CLI en este entorno — mismo skip
preexistente, no introducido por esta Feature). La invocación headless end-to-end dentro de
contenedor con una sesión OAuth real montada como caché **queda pendiente** — no se ejecutó como
parte de esta implementación (requiere una sesión OAuth persistida en un directorio dedicado del
Orquestador, no solo la sesión interactiva local usada para las pruebas puntuales de la sección
7.4). Ver Risks para el seguimiento de este punto.

---

## 9. Risks

- **La v1 de este diseño (previa a FEATURE-015) tenía dos premisas ya invalidadas**, corregidas en
  esta v2:
  - Bloqueaba `cli_session` para Developer detrás de una Feature de "egress con allowlist fino"
    que el propio Roadmap real confirma que ya no existe como ítem separado — fue absorbida por
    FEATURE-015.
  - Asumía que Architect/Functional/Planning/QA no necesitaban gate por no tener Bash — el
    hallazgo del "canal de respuesta" de FEATURE-015 (ver `docs/ROADMAP.md`) ya demostró que ese
    riesgo es transversal a los 5 roles, con o sin Bash. Esta v2 no tiene asimetría (Regla 7).
- **Radio de exposición de una cuenta personal**: sigue siendo mayor que una API key si algo sale
  mal — no es trivialmente rotable/revocable sin afectar al usuario en otros contextos (fuera del
  Orquestador). Esto no cambia con FEATURE-015; sigue siendo un riesgo real, solo que ya no
  requiere un gate de bloqueo adicional porque la mitigación estructural (holder/worker) ya está.
- **Límites de uso de un plan personal** bajo el patrón de invocación repetida de un Orquestador
  (run tras run) no están caracterizados — riesgo operativo, no de seguridad.
- **Tensión con "Concurrencia de runs simultáneos"** (ítem Tentativo separado) — una sesión de
  cuenta personal puede no soportar paralelismo igual que API keys independientes; no bloquea esta
  Feature (hoy no hay concurrencia real), reevaluar si esa Feature avanza.
- **Riesgo aceptado explícitamente por el owner, específico de Claude Code**: con
  `authMode=cli_session`, el holder de Claude Code corre sin `--bare`/`CLAUDE_CODE_SIMPLE` (única
  combinación que preserva OAuth — ver 7.4). Esto deja tres cosas activas que hoy, en modo
  `api_key`, están deliberadamente apagadas dentro del contenedor aislado:
  - **Tráfico de red al arranque no gateado por ninguna tool** (`[Bootstrap] Fetching` — fast-mode
    flags, estado de org), confirmado con evidencia real (`ANTHROPIC_BASE_URL` a un mock local,
    log de debug). Va hacia el mismo host (`api.anthropic.com`) que el holder ya necesita alcanzar
    para la llamada real al modelo — no es una superficie de red nueva, pero rompe la garantía de
    "todo el tráfico pasa por el catálogo cerrado de tools" que es el punto central de
    FEATURE-015.
  - **LSP y sincronización de plugins arrancan** dentro del contenedor (confirmado, con `HOME`
    fresco, vía debug log) — procesos adicionales corriendo que hoy no corren, sin evidencia de
    que hagan algo dañino, pero sin auditar tampoco.
  - En concreto: no es una fuga de la credencial OAuth en sí (el mecanismo holder/worker que
    protege eso sigue intacto) — es una grieta puntual en el principio de "nada corre sin pasar
    por el catálogo cerrado de tools", acotada a este modo de autenticación en este proveedor.
  - **Decisión del owner (2026-07-25)**: aceptar este riesgo tal cual para esta versión de la
    Feature, sin seguir invirtiendo en encontrar un mecanismo más fino de supresión — no hay
    evidencia de que valga la pena la sobreingeniería de perseguir cada proceso individualmente
    dado lo acotado del riesgo real. Revisar si esto cambia si Anthropic expone en el futuro un
    mecanismo más granular en el CLI.
- **Pendiente de implementación, no de diseño**: cómo se puebla/renueva en la práctica el
  directorio apuntado por `CLAUDE_OAUTH_CACHE_DIR`/`CODEX_OAUTH_CACHE_DIR` (quién corre el login
  interactivo la primera vez, con qué cadencia, en qué máquina) queda fuera de esta Feature —es
  responsabilidad operativa, no de este mecanismo— pero es un prerequisito real para que
  `cli_session` funcione en la práctica. Ver Validation Evidence: la invocación end-to-end con
  sesión real dentro de contenedor todavía no se ejecutó.
- **Mismo riesgo de LSP/plugin-sync/prefetch documentado arriba también aplica potencialmente al
  mount de solo lectura de `CODEX_HOME` completo**: Codex reporta (`codex doctor --json`) que usa
  el mismo directorio (`CODEX_HOME`) también para `log dir` y `sqlite home`, no solo `auth.json`.
  Montar ese directorio íntegramente de solo lectura podría hacer que Codex falle al intentar
  escribir logs/caché de sesión ahí — no se probó un turno real de Codex en `cli_session` dentro
  de contenedor (ver Validation Evidence). Si surge, la corrección es acotada (agregar un tmpfs de
  escritura separado para logs/sqlite, sin tocar el mount de solo lectura de `auth.json`), no un
  cambio de diseño.

---

## 10. Approval Gate

**Aprobado por el owner el 2026-07-25.** El riesgo residual para Claude Code (sección 9) fue
presentado en términos concretos y aceptado explícitamente. La secuencia de 3 controles OAuth de
la sección 7.4 fue reproducida independientemente por el DAIA con una cuenta OAuth real antes de
la validación final.

Implementación realizada en la rama `feature/016-auth-oauth-executors` (no mergeada a `main`).
Pendiente: validación conjunta Architect + owner sobre el diff antes de mergear.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.
