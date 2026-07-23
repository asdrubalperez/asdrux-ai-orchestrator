# Roadmap — asdrux-ai-orchestrator

## Vista rápida

**✅ Ejecutado**
- Milestone 0
- Milestone 1 — Pipeline completo Claude Code (FEATURE-001 a 006)
- Spike Codex — walking skeleton, invocación única read-only (FEATURE-007)
- Construcción de `CodexExecutor` de producción — paridad con Claude Code
- Feature 10 — `users`, `projects` y login del CLI: tablas `users`/`projects` creadas, migración
  de `runs.owner_id`/`project_id` (19/19 backfilleados), comandos `login`/`logout`/`seed:user` con
  `bcryptjs`, sesión local de 30 días
- FEATURE-011 — Configuración vigente por proyecto: migración
  `0004_project_config_versions.sql`, tabla dedicada versionada, funciones de repositorio
  (`getCurrentProjectConfig`, `getCurrentProjectConfigs`, `setProjectConfig`,
  `getProjectConfigHistory`) e integración en `runStart.ts`
- FEATURE-012 — Persistencia de contexto/hallazgos en escalamiento: migración
  `0005_escalation_context_persistence.sql`, `runs.originated_from_run_id`, estado `retrying`,
  comando `run:respond`, worktree hijo ramificado desde la rama del padre y validación E2E real
  documentada en `docs/features/FEATURE-012-implementation-results.md`
- Feature 09 — Runbook para el Orquestador AI automático: 12 archivos en `docs/runbook/`, v1.0,
  marcador `[PENDIENTE-DB-PROJECTS]` reemplazado por la referencia real a
  `project_config_versions` (FEATURE-011), pasada de consistencia cruzada completa
- Evolución del Playbook: declaración de rama/checkout de origen movida de Stage 6 a Stage 3 en
  `06-DELIVERY-WORKFLOW.md` (v1.2), Lessons Learned de Feature 10
- FEATURE-013 — Capa de UI "Run en curso": 013A backend read-only + UI/SSE, 013B sesiones web,
  013C respuesta a escalamiento desde modal, con validación real en navegador/VPS y documentos de
  diseño/resultados en `docs/features/`
- FEATURE-014 — Autenticación unificada CLI + Web: tabla `sessions`, hash SHA-256 y revocación
  server-side compartidos, TTL único de 48 horas y validación real en VPS; resultados en
  `docs/features/FEATURE-014-implementation-results.md`

**🟡 Confirmado**
- FEATURE-015 — Egress con protección de exfiltración de credenciales, sin bloquear investigación
  (Developer). Reemplaza al ítem ⚪ Tentativo anterior "Egress de red con allowlist fino
  (Developer)". Verificado contra el código real (`src/executor/codexExecutor.ts`,
  `spawnCodexInContainer`): hoy no existe ninguna restricción de red en el contenedor de
  Developer — corre con la red default de Docker (`bridge`), egress sin restricción a cualquier
  destino. La intención original de FEATURE-006 ("solo egress al proveedor de IA") nunca se
  implementó así. Un allowlist de dominios simple resolvería la exfiltración pero rompería la
  capacidad real y en uso de Developer de investigar libremente en internet (documentación,
  foros, mejores prácticas) — el problema de diseño real es distinguir "acceso amplio de lectura
  para investigación" de "impedir que un archivo específico y sensible (credenciales OAuth, ver
  FEATURE-016) salga hacia cualquier destino", sin solución obvia todavía. Requiere su propia
  sesión de Discovery antes de poder escribirse como diseño formal. Prerequisito explícito de la
  Regla 6 de FEATURE-016 (gate duro para `authMode=cli_session` + Developer) — mientras este ítem
  no esté resuelto, esa combinación queda rechazada en runtime.
- FEATURE-016 — Modo de autenticación por cuenta personal (OAuth) para
  Executors, alternativo a API Key. Arranca con investigación empírica (ya realizada, ver
  `docs/research/investigacion-auth-cuenta-personal-executors.md` v1.1). Diseño formal en
  `docs/features/FEATURE-016-auth-oauth-executors.md`. Su Regla 6 depende ahora de FEATURE-015
  (arriba) — el resto de la Feature (Architect/Functional/Planning/QA, Regla 7) no depende de
  esto.
- FEATURE-017 (antes FEATURE-015) — Wiring real del ciclo Roadmap de Releases (Architect) +
  Release Plan (Planning): conectar el diseño ya escrito en el Runbook
  (`docs/runbook/02-ARCHITECTURE-TEMPLATE.md` sección 0, y
  `docs/runbook/09-RELEASE-PLAN-TEMPLATE.md`) con los roles reales del Orquestador
  (`architect.txt`, `planning.txt`) y con la UI (placeholder `ReleasePlanPanel` ya reservado en
  FEATURE-013).
- FEATURE-018 (antes FEATURE-017, antes FEATURE-014) — Milestone 2 — Validación end-to-end con
  caso de negocio real

**⚪ Tentativo**
- Escalamiento optimizado sin reinicio completo
- Selección de proveedor/modelo/credenciales por rol
- Approval Model por Release
- Concurrencia de runs simultáneos
- Limpieza automática de worktrees/branches vencidos
- `PreToolUse` hooks como defensa en profundidad (QA)
- Creación real de PR vía API de GitHub / merge automático
- Deployment Strategy y separación dev/staging/prod
- Capa de UI (Disparo, Historial/admin — "Run en curso" ya pasó a Confirmado, ver arriba)
- Notificación Slack/webhook complementaria a la UI de monitoreo (post FEATURE-013, si hace falta
  alertas fuera de cuando se está mirando activamente)
- Limpieza de persistencia de codigo versionado: `artifacts.commit_ref` existe en schema pero no se
  puebla nunca; los commits reales quedan hoy solo en `run_events`.

---

## Detalle

### ✅ Milestone 0
VPS operativa, Docker Engine instalado, deploy key de escritura configurada, repositorio
`ai-orchestrator` creado.

### ✅ Milestone 1 — Pipeline completo Claude Code (FEATURE-001 a 006)
Pipeline de 5 fases (Architect, Functional, Planning, Developer, QA) funcionando end-to-end sobre
Claude Code como Executor. Incluye aislamiento de escritura (FEATURE-002), orquestación de fase
única y secuencia (FEATURE-003, FEATURE-004), pipeline completo (FEATURE-005), y confinamiento
seguro de ejecución — QA sin Bash, Developer en contenedor endurecido (FEATURE-006).

### ✅ Spike Codex — walking skeleton, invocación única read-only (FEATURE-007)
Confirma que el contrato de `Executor` es agnóstico de proveedor: Codex puede integrarse como
segundo motor de ejecución sin rediseñar Orquestador ni UI. Alcance real de lo probado: una
invocación única, rol `architect`, `permissions.filesystem: "read-only"` — equivalente de
FEATURE-001, no de FEATURE-002 (aislamiento de escritura), FEATURE-004/005 (secuencia multi-fase,
pipeline completo) ni FEATURE-006 (confinamiento QA). La paridad completa con Claude Code
(escritura, confinamiento QA, orquestación multi-fase) queda explícitamente en el ítem
✅ Ejecutado "Construcción de `CodexExecutor` de producción — paridad con Claude Code" — eso es
lo que falta, no un extra opcional.

### ✅ FEATURE-011 — Configuración vigente por proyecto
Tabla dedicada versionada por `project_id` + `config_key` para persistir configuraciones editables
por producto, consultar la vigente por índice único parcial y registrar qué versiones estaban
vigentes al iniciar cada run. Implementada con la migración `0004_project_config_versions.sql`,
funciones en `src/db/repository.ts` (`getCurrentProjectConfig`, `getCurrentProjectConfigs`,
`setProjectConfig`, `getProjectConfigHistory`) e integración del snapshot vigente en
`src/cli/commands/runStart.ts`. Ver `docs/features/FEATURE-011-project-config-versions.md`.

### ✅ FEATURE-014 — Autenticación unificada CLI + Web (48h, mecanismo server-side compartido)
CLI y web usan la misma tabla `sessions`, generación/hash de token, validación server-side y TTL
de 48 horas. El CLI conserva el secreto en `~/.orquestador/session.json`, pero la identidad y
vigencia se determinan desde DB. Validado con 24/24 tests, build completo y flujo real en VPS:
login, `run:status`, logout y rechazo de una copia restaurada del archivo después de revocar la
fila. Ver `docs/features/FEATURE-014-implementation-results.md`.

### 🟡 FEATURE-015 — Egress con protección de exfiltración de credenciales, sin bloquear
investigación (Developer)
Reemplaza al ítem Tentativo anterior "Egress de red con allowlist fino (Developer)". Verificado
contra el código real (`src/executor/codexExecutor.ts`, `spawnCodexInContainer`): hoy no existe
ninguna restricción de red en el contenedor de Developer — corre con la red default de Docker
(`bridge`), egress sin restricción a cualquier destino. La intención original de FEATURE-006
("solo egress al proveedor de IA") nunca se implementó así.

Un allowlist de dominios simple resolvería la exfiltración pero rompería la capacidad real y
actualmente en uso de Developer de investigar libremente en internet (documentación, foros,
mejores prácticas) — el owner explícitamente no quiere sacrificar eso. El problema de diseño real
es distinguir "acceso amplio de lectura para investigación" de "impedir que un archivo específico
y sensible (credenciales OAuth, ver FEATURE-016) salga hacia cualquier destino" — sin solución
obvia todavía, requiere su propia sesión de Discovery antes de poder escribirse como Feature
formal.

Prerequisito explícito de la Regla 6 de FEATURE-016 (gate duro para `authMode=cli_session` +
Developer) — mientras este ítem no esté resuelto, esa combinación queda rechazada en runtime,
aunque el resto de FEATURE-016 (Architect/Functional/Planning/QA, Regla 7) no depende de esto.

### 🟡 FEATURE-016 — Modo de autenticación por cuenta personal (OAuth) para Executors
La investigación empírica ya confirmó reuso headless entre procesos y portabilidad del archivo de
credenciales desde un `HOME` alternativo. Ver
`docs/research/investigacion-auth-cuenta-personal-executors.md` v1.1.

Forma arquitectónica ya resuelta en el análisis (no reabrir sin motivo): NO crear Executors
nuevos por proveedor — agregar un parámetro `authMode` (`"api_key"` | `"cli_session"`) a las
opciones ya existentes de `ClaudeCodeExecutor`/`CodexExecutor`, default `"api_key"` sin cambiar
nada del comportamiento actual. El contrato `Executor` (`src/contracts/executor.ts`) no cambia.

El diseño formal queda en `docs/features/FEATURE-016-auth-oauth-executors.md`. Para Developer,
`cli_session` queda condicionado por un gate duro: no puede habilitarse hasta que se resuelva
FEATURE-015 (egress con protección de exfiltración de credenciales, sin bloquear investigación).
La Feature mantiene Approval Gate pendiente; no implementa `authMode` todavía.

### 🟡 FEATURE-017 (antes FEATURE-015) — Wiring real del ciclo Roadmap de Releases + Release Plan
Promovido de ⚪ Tentativo a 🟡 Confirmado. El diseño ya existe en el Runbook
(`docs/runbook/02-ARCHITECTURE-TEMPLATE.md` sección 0, y `docs/runbook/09-RELEASE-PLAN-TEMPLATE.md`)
pero no está implementado en los roles reales del Orquestador (`src/executor/roles/architect.txt`,
`planning.txt`) ni conectado a la UI. La UI ya reservó el espacio visual (placeholder
`ReleasePlanPanel`, sin datos reales) en FEATURE-013. Distinto de "Approval Model por Release"
(ese es sobre quién aprueba el avance de etapas; este es sobre qué contenido de planificación de
releases se genera y muestra).

### ✅ Feature 09 — Runbook para el Orquestador AI automático
Diseño completo y cerrado: 12 archivos en `docs/runbook/` (equivalente al `docs/playbook/` actual
de este mismo repo, pero pensado para que el Orquestador AI automático los consuma y opere sobre
ellos sin loop humano, salvo en los 6 puntos taxativos definidos en `00-README.md`). El marcador
`[PENDIENTE-DB-PROJECTS]` (9 apariciones en 7 archivos) fue reemplazado por la referencia real al
mecanismo de persistencia de configuración por producto (`project_config_versions`, FEATURE-011).
Pasada de consistencia cruzada de los 12 archivos completada — corrigió una referencia cruzada
real (`BOOTSTRAP.md` y `08-CODE-SYSTEM-PROMPT.md` mencionaban erróneamente que las secciones
"Editable por producto" incluían `07-FEATURE-TEMPLATE.md`, que no tiene ninguna). Bump de versión
a `v1.0` en los 12 archivos.

### ✅ Feature 10 — `users`, `projects` y login del CLI
Implementada y mergeada en `main`. Tablas `users` (con `password_hash` vía `bcryptjs`) y `projects`
creadas; `runs.owner_id`/`project_id` migrados a FK real, 19/19 filas backfilleadas. Comandos
`login`/`logout`/`seed:user`, sesión local de 30 días en `~/.orquestador/session.json`.

- **Sesiones/usuarios**: resuelto — `users` con `password_hash` real, validado por invocación.
  Validación server-side del token CLI y unificación con sesión web: ver FEATURE-014.
- **Proyectos**: resuelto — tabla `projects` con `repo_path`, `owner_id` FK a `users`. El marcador
  `[PENDIENTE-DB-PROJECTS]` de `docs/runbook/` quedó reemplazado por la referencia real a
  `project_config_versions` en FEATURE-011.
- **Proceso por proyecto**: sin cambios respecto al diseño original — la tabla `artifacts`
  existente (JSONB, `commit_ref`) sigue cubriendo esto, ahora conectada a `projects` vía `runs`.

El diseño de la tabla `projects` (y su relación con `runs`/`artifacts`) se hace recién con el
resultado de la investigación de Codex, no antes.

### ✅ FEATURE-012 — Persistencia de contexto/hallazgos en el circuito de escalamiento
Implementada y mergeada en `main`. El circuito de escalamiento de `06-DELIVERY-WORKFLOW.md`
(Stage 3) ya distingue reintento interno de escalamiento terminal mediante el estado `retrying`,
persiste la continuidad entre runs con `runs.originated_from_run_id`, conserva el contexto del
hallazgo en `run_events`/`artifacts`, y agrega `run:respond --solution|--abort` para la respuesta
humana. El run hijo usa worktree/branch propio ramificado desde la rama del padre.

Implementación principal: migración `0005_escalation_context_persistence.sql`, cambios en
`src/db/repository.ts`, `src/cli/commands/runStart.ts`, `src/cli/commands/runRespond.ts` y
`src/isolation/worktree.ts`. Validación E2E real con Postgres, Codex CLI y worktrees reales
documentada en `docs/features/FEATURE-012-implementation-results.md`.

### ✅ Construcción de `CodexExecutor` de producción — paridad con Claude Code
Cerrado en FEATURE-008 (ver `docs/features/FEATURE-008-implementation-results.md`). Se replicó
para Codex el equivalente de FEATURE-002 (aislamiento de escritura, resuelto vía Docker con
`--sandbox danger-full-access`, no con el sandbox nativo de Codex — bloqueado en esta VPS por un
problema de privilegio de red del kernel), FEATURE-004/005 (secuencia multi-fase, pipeline
completo) y FEATURE-006 (confinamiento QA, vía `--config features.shell_tool=false`). Paridad
completa alcanzada y validada con evidencia real contra la VPS.

### ⚪ Escalamiento optimizado sin reinicio completo
La v1 ya diseñada en Feature 09 (`03-AI-CONSTITUTION.md`, Reglas 8 y 10) resuelve el escalamiento
con una vía única: todo hallazgo entra por Architect y avanza en el orden normal del pipeline
hasta llegar al dueño real, llevando el contexto acumulado — no reinicia todo desde cero, pero sí
recorre secuencialmente los pasos intermedios aunque no tengan nada que resolver. Este ítem es la
optimización futura: permitir que el circuito llegue directo al dueño real sin recorrer los pasos
intermedios, cuando el costo de la v1 secuencial resulte un problema real en la práctica.

### ⚪ Selección de proveedor/modelo/credenciales por rol
Ítem ampliado en la sesión de FEATURE-007, cubre tres superficies de configuración, todas parte de
la misma pantalla de Disparo de la UI:
- Selección de proveedor (Claude Code / Codex / futuro) por rol.
- Selección de modelo dentro de ese proveedor, por rol (motivado por H12: Haiku no siempre
  respeta convenciones de formato estrictas).
- Configuración de credenciales/API token por agente o global. Hoy resuelto a mano vía
  `.env.local` (`ANTHROPIC_API_KEY`, `CODEX_API_KEY`) porque el Orquestador todavía se construye a
  sí mismo; cuando exista la UI real, cada usuario va a necesitar cargar sus propias credenciales,
  no las de desarrollo. Sin diseño todavía de dónde/cómo se almacenan (relacionado con el ítem
  "Approval Model por Release", para cuando el Orquestador opere sobre proyectos externos).
- El mismo toggle "misma configuración para todos los agentes" vs "una configuración por agente"
  aplica a los tres puntos — proveedor, modelo y credenciales — no solo a proveedor/modelo.

### ⚪ Approval Model por Release
Feature 09 (`06-DELIVERY-WORKFLOW.md`, Stage 6) ya diseñó la v1: Modo A (default — automático
hasta el push de cada Feature, humano revisa antes del merge a la rama principal) y Modo Auto
(también el merge es automático; solo el deploy a producción requiere humano, sin excepción, por
la Regla 9 de `03-AI-CONSTITUTION.md`).

Lo que queda Tentativo: exponer el rigor (Modo A / Modo Auto) como configuración parametrizable
real para el usuario final — hoy es fijo, decidido por quienes operan el Orquestador. Aplica
cuando el Orquestador opere sobre proyectos externos.

### ⚪ Concurrencia de runs simultáneos
H9 (FEATURE-003): solo se probaron invocaciones secuenciales; comportamiento bajo múltiples runs
concurrentes desde un proceso Node persistente no está validado.

### ⚪ Limpieza automática de worktrees/branches vencidos
Política de retención a 21 días para runs escalados y no retomados — sin diseñar todavía.

### ⚪ `PreToolUse` hooks como defensa en profundidad (QA)
Prioridad muy baja, no descartado del todo. Dependen de una API específica de Claude Code — no
portan a Codex.

### ⚪ Creación real de PR vía API de GitHub / merge automático
Hoy el flujo termina en rama lista, sin apertura de PR ni merge automatizado a `main`. La política
que este código futuro debería seguir ya quedó diseñada en Feature 09 (`06-DELIVERY-WORKFLOW.md`,
Stage 6, Modo A / Modo Auto) — este ítem es la implementación real, todavía sin código.

### ⚪ Deployment Strategy y separación dev/staging/prod
Sin diseñar.

### ✅ FEATURE-013 — Capa de UI — "Run en curso"
Cerrada en tres incrementos:
- 013A: backend read-only, UI básica y SSE.
- 013B: sesiones web reales.
- 013C: respuesta a escalamiento desde modal, con navegación al run hijo por SSE.

Documentos de diseño:
- `docs/features/Feature-013-interfaz-ui-parte-013a-backend-read-only-ui-sse-basico.md`
- `docs/features/Feature-013-interfaz-ui-parte-013b-sesiones-web.md`
- `docs/features/Feature-013-interfaz-ui-parte-013c-respuesta-escalamiento.md`

Documentos de resultados:
- `docs/features/Feature-013-interfaz-ui-parte-013a-implementation-results.md`
- `docs/features/Feature-013-interfaz-ui-parte-013b-implementation-results.md`
- `docs/features/Feature-013-interfaz-ui-parte-013c-implementation-results.md`

Disparo e Historial/admin quedan fuera de esta Feature, ver ítem Tentativo "Capa de UI" abajo.

### ⚪ Capa de UI (Disparo, Historial/admin)
Dos pantallas — Disparo (crear un run nuevo desde la UI) e Historial/admin (listado de runs
propios o del equipo) — siguen `[Pendiente]` en `02-ARCHITECTURE.md`. "Run en curso" ya se
promovió a Confirmado (FEATURE-013, ver arriba) — este ítem es solo el resto.

### ⚪ Notificación Slack/webhook complementaria
Evaluada en la misma sesión que "Run en curso" como alternativa de monitoreo — se descartó como
primera opción porque, a esfuerzo comparable, una UI mínima de solo lectura daba más valor y era
reusable hacia la Capa de UI completa. Queda como complemento futuro si hace falta alertas push
(fase completada/fallida) fuera de cuando alguien está mirando la UI activamente.

### 🟡 FEATURE-018 (antes FEATURE-017, antes FEATURE-014) — Milestone 2 — Validación end-to-end con
caso de negocio real
Necesario y ya decidido antes de sumar al resto del equipo. No es opcional — por eso está
Confirmado y no Tentativo.
