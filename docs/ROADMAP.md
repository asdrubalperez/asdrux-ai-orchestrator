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
- FEATURE-015 — Egress y aislamiento de credenciales OAuth: 015A y 015B ✅ Ejecutadas,
  aceptadas con tests, evidencia real en VPS y revisión conjunta Architect + owner. Las 10
  combinaciones rol/proveedor usan catálogos cerrados sin tools nativas. Diseños y resultados en
  `docs/features/FEATURE-015-egress-aislamiento-oauth-parte-015a-arquitectura-holder-worker.md` y
  `docs/features/FEATURE-015B-Wiring-real-por-rol-y-por-proveedor.md`.
- FEATURE-016 — Modo de autenticación por cuenta personal (OAuth) para Executors: tabla
  `user_agent_config` (global + override por rol), `authMode` (`api_key`/`cli_session`) en ambos
  Executors, flag de CLI `--auth-mode` y resolución de precedencia en `runStart.ts`. Aprobada por
  el owner, verificada independientemente por el Architect y mergeada a `main` (commits `133509d`
  implementación, `fa42d0e` merge). Diseño y evidencia en
  `docs/features/FEATURE-016-auth-oauth-executors.md`.
- FEATURE-017 — Capa de UI — Disparo (intake de caso de negocio asistido por IA): estado nuevo
  `sin_iniciar` en `runs`, mapeo directo al proveedor sin tools, clonado real y aislado del repo
  del caso de negocio, cancelación real reusando el escalamiento de FEATURE-013C, timeouts finales
  por rol. Aprobada por el owner, validada técnicamente por el DAIA y mergeada a `main` (commit
  `eed5e88` implementación principal, `14693c8` merge). Diseño y evidencia en
  `docs/features/FEATURE-017-Capa-de-UI-Disparo-intake-de-caso-de-negocio-asistido-por-IA.md`.
- FEATURE-018 (antes FEATURE-017, antes FEATURE-015) — Wiring real del ciclo Roadmap de Releases
  (Architect) + Release Plan (Planning): Architect declara siempre un Roadmap de Releases (mínimo
  un release MVP) y escala para aprobación humana reusando el mecanismo de escalamiento existente
  (atomicidad real vía `client` compartido en `setProjectConfig`); Planning recibe el release activo
  como contexto y escala si no hay ninguno aprobado; `ReleasePlanPanel` conectado a datos reales;
  6 documentos de gobernanza del Runbook actualizados. Aprobada por el owner tras 3 rondas de
  validación técnica del DAIA y verificación independiente del Architect, mergeada a `main` (commit
  `458c159` implementación, `411f73d` merge). **Alcance final, ajustado durante el
  cierre**: no incluye el disparo automático de "release completo → Architect propone el
  siguiente" (Functional Goal original de la Feature) — se descubrió que el motor de pipeline no
  tiene hoy ningún concepto de "Feature" como dato rastreable ni de múltiples Features ejecutándose
  en secuencia dentro de un release, lo cual excede el alcance de wiring de esta Feature. Ver
  Lecciones Aprendidas más abajo y FEATURE-019/020. Diseño y evidencia en
  `docs/features/FEATURE-018-Wiring-real-del-ciclo-Roadmap-de-Releases-(Architect)-+-Release-Plan-(Planning).md`.

**🟡 Confirmado**
- FEATURE-019 — Modelo de circuitos anidados para el ciclo de releases: Architect gobierna el
  avance entre releases del Roadmap, Planning gobierna la iteración de Features dentro del release
  activo (Developer siempre vuelve a Planning al terminar una Feature, en vez de autogobernarse —
  resuelve una tensión real con la Regla 10, Ownership de Artefactos, del Runbook). Cada uno de los
  tres circuitos (Roadmap/Architect, Release Plan/Planning, Feature Implementation/Developer↔QA)
  tiene su propia salida natural hacia el circuito contenedor; reintento y escalada al humano se
  mantienen uniformes, sin cambios, para cualquier circuito. Discovery en curso — diagrama base
  acordado con el owner, pendiente Design.
- FEATURE-020 — Adaptación de FEATURE-018 al mecanismo que resulte de FEATURE-019. Depende
  enteramente de que FEATURE-019 cierre su Diseño — no se puede dimensionar ni implementar antes
  (mismo criterio que la dependencia ya documentada de FEATURE-016 respecto de FEATURE-015A/015B).
- FEATURE-021 (antes FEATURE-019, antes FEATURE-018, antes FEATURE-017, antes FEATURE-014) —
  Milestone 2 — Validación end-to-end con caso de negocio real
- FEATURE-022 — Selección de proveedor/modelo/credenciales por rol (promovida de ⚪ Tentativo)
- FEATURE-023 — Credenciales git por usuario para el Orquestador (promovida de ⚪ Tentativo)

**⚪ Tentativo**
- Escalamiento optimizado sin reinicio completo
- Planning valida la Feature de Functional antes de diseñar el Release Plan — hoy Stage 2 de
  `docs/runbook/06-DELIVERY-WORKFLOW.md` dice que Planning "parte de los 3 escenarios que Functional
  entregó — no los redefine desde cero", sin un paso explícito de análisis/validación de lo que
  Functional entregó antes de diseñar el cómo. Propuesta a explorar en Discovery aparte: que
  Planning analice y valide activamente la Feature de Functional (ambigüedades, dependencias entre
  Features del release, huecos) antes de diseñar el Release Plan. Complementa (no reemplaza) al
  ítem "Escalamiento optimizado sin reinicio completo".
- Approval Model por Release
- Concurrencia de runs simultáneos
- Limpieza automática de worktrees/branches vencidos
- `PreToolUse` hooks como defensa en profundidad (QA)
- Creación real de PR vía API de GitHub / merge automático
- Deployment Strategy y separación dev/staging/prod
- Capa de UI — Historial/admin (listado de runs, sin diseñar)
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

### ✅ FEATURE-015 — Egress y aislamiento de credenciales OAuth

Estado: 015A ✅ Ejecutada; 015B ✅ Ejecutada. FEATURE-015 completa y aceptada; el prerequisito de FEATURE-016 está satisfecho.

Reemplaza al ítem Tentativo anterior "Egress de red con allowlist fino (Developer)". Ya no está
acotada a Developer — corrección respecto a la formulación original.

**Hallazgo que motivó la corrección**: el canal de fuga relevante no es solo "Bash + egress sin
restricción" (el que motivó la investigación original). Existe además un **canal de respuesta**:
cualquier rol con herramientas de lectura (`Read`/`Grep`/`Glob`) puede ser inducido, vía prompt
injection, a leer el caché de credenciales OAuth y devolverlo dentro de su propia respuesta de
texto al proveedor — sin que haya tráfico de red de por medio. Este canal aplica a los 5 roles
(Architect, Functional, Planning, QA, Developer) por igual, con o sin Bash.

**Asimetría histórica corregida entre proveedores**: antes de 015B, Codex mantenía
`shell_tool` para Architect/Functional/Planning y Claude Code carecía de tools de red para esos
roles. 015B eliminó ambas discrepancias: todos los roles usan el runtime aislado y ningún
proveedor conserva tools nativas ejecutables.

**Requisito funcional confirmado por el owner**: Architect, Functional y Planning deben poder
investigar en internet como parte de su rol — en los dos proveedores por igual, protegido (vía
holder/worker), no bloqueado.

Desdoblada en dos partes **secuenciales** (015B depende de 015A, a diferencia del intento fallido
de desdoblar FEATURE-016 en partes independientes — ver abajo):

- **✅ 015A — Arquitectura holder/worker genérica — Ejecutada**: protocolo holder↔worker,
  adaptador Claude Code (holder ejecutado con `--tools ""` + MCP remoto expuesto por el worker),
  adaptador Codex (holder vía `codex app-server` + `dynamicTools`, sin
  `command/exec`/`process/spawn`). Validada con spikes acotados, sin credenciales reales. No
  habilita ningún rol real todavía — es la base de la que depende 015B.
- **✅ 015B — Wiring real por rol y por proveedor — Ejecutada**: las 5 combinaciones de rol
  × 2 proveedores usan el catálogo cerrado aprobado. Architect/Functional/Planning disponen de
  `fs_read`, `fs_search`, `fs_glob`, `web_search` y `web_fetch`; QA conserva solo las tres
  tools de lectura; Developer agrega `fs_write`, `fs_edit` y `command_exec`. Validada con 55/55
  tests en VPS, ocho smokes reales con Tavily y pipelines completos Claude/Codex. Ver
  `docs/features/FEATURE-015B-part1-results.md`, `part2-results.md` y `part3-results.md`.

Prerequisito de FEATURE-016 completo: satisfecho. El bloqueo por dependencia de FEATURE-015 queda
levantado — ver detalle de FEATURE-016 más abajo (✅ Ejecutada).

### ✅ FEATURE-016 — Modo de autenticación por cuenta personal (OAuth) para Executors
**Se revierte el desdoblamiento anterior en 016A/016B**: asumía que Architect/Functional/Planning/
QA no tenían el mismo perfil de riesgo que Developer por no tener Bash, y que por eso una parte de
la Feature podía implementarse sin depender de FEATURE-015. Esa premisa era incorrecta (ver
FEATURE-015, arriba: canal de respuesta + asimetría real de Bash entre proveedores). Vuelve a ser
una sola Feature, completa, dependiente de FEATURE-015 (015A+015B) sin excepciones por rol.

La investigación empírica ya confirmó reuso headless entre procesos y portabilidad del archivo de
credenciales desde un `HOME` alternativo. Ver
`docs/research/investigacion-auth-cuenta-personal-executors.md` v1.1.

Forma arquitectónica ya resuelta en el análisis (no reabrir sin motivo): NO crear Executors
nuevos por proveedor — agregar un parámetro `authMode` (`"api_key"` | `"cli_session"`) a las
opciones ya existentes de `ClaudeCodeExecutor`/`CodexExecutor`, default `"api_key"` sin cambiar
nada del comportamiento actual. El contrato `Executor` (`src/contracts/executor.ts`) no cambia.

El diseño formal (v2, aprobado) queda en `docs/features/FEATURE-016-auth-oauth-executors.md` (el
archivo de diseño de 016A generado en una sesión anterior, evaluado y no aprobado, queda como
referencia histórica de un alcance descartado — ver
`docs/features/FEATURE-016-auth-oauth-executors-parte-016a-infraestructura-roles-sin-bash.md`, no
se elimina, pero no representa el alcance vigente). El prerequisito FEATURE-015 (015A+015B) para
`cli_session` ya está satisfecho.

**Estado (2026-07-25): ✅ Ejecutada.** Aprobada por el owner, implementada en la rama
`feature/016-auth-oauth-executors` (commit `133509d`), verificada de forma independiente por el
Architect (migración, repositorio, ambos Executors, `runStart.ts`, typecheck y 53/55 tests
re-corridos, no solo el reporte del DAIA) y mergeada a `main` en `fa42d0e` ("Merge FEATURE-016:
modo de autenticación por cuenta personal (OAuth) para Executors"). La rama se conserva como
referencia histórica, mismo criterio que `feature/015a-*`/`feature/015b-*`.

Qué se implementó: tabla `user_agent_config` (migración `0008_user_agent_config.sql`, global +
override por rol), funciones de repositorio (`resolveAgentConfig` aplica la precedencia), rama
`authMode` en ambos Executors (mount de solo lectura del caché OAuth dedicado, `CODEX_HOME` +
`type:"chatgpt"` para Codex, sin `--bare` + `--setting-sources ""` para Claude Code), flag de CLI
`--auth-mode` y resolución de precedencia (flag > override de rol > global > default) en
`runStart.ts`.

Dos ítems quedan documentados como pendientes en `docs/features/FEATURE-016-auth-oauth-executors.md`
(secciones 8 y 9) — no bloquearon este merge, pero son los primeros a resolver antes de usar
`cli_session` en un run real de producción: (1) todavía no se corrió un turno real end-to-end
dentro de contenedor con una sesión OAuth real montada como caché; (2) `CODEX_HOME` se monta
íntegro de solo lectura y Codex también lo usa para logs/sqlite — riesgo de que falle al intentar
escribir ahí, sin probar todavía con un turno real de Codex en `cli_session`.

### ✅ FEATURE-018 (antes FEATURE-017, antes FEATURE-015) — Wiring real del ciclo Roadmap de Releases + Release Plan
Implementada, validada (3 rondas de validación técnica del DAIA + verificación independiente del
Architect contra el repo real, incluyendo typecheck y suite completa de tests corridos de forma
independiente) y mergeada a `main` (commit `458c159` implementación, `411f73d` merge). Distinto de
"Approval Model por Release" (ese es sobre quién aprueba el avance de etapas; este es sobre qué
contenido de planificación de releases se genera y muestra).

**Alcance final entregado**: Architect declara siempre un Roadmap de Releases (mínimo un release
MVP) como parte de su salida normal, y escala para aprobación humana — reusando el mecanismo de
escalamiento existente, distinguido por contenido (`ROADMAP` presente en `outputArtifact`, mismo
patrón que `comandoTest`) en vez de un tipo de acción nuevo. La aprobación persiste la nueva versión
en `project_config_versions` (`config_key = "release_roadmap"`) y crea el child run en una única
transacción real (`setProjectConfig` acepta `client?: PoolClient`, mismo patrón que
`getCurrentProjectConfigs`/`createRun`). Planning recibe el release activo como contexto
(`activeRelease`) y escala si no hay ninguno aprobado. `ReleasePlanPanel` conectado a datos reales
vía `GET /runs/:id` extendido (sin ruta nueva). 6 documentos de gobernanza del Runbook actualizados
para reflejar que el roadmap ya no es condicional.

**Excluido del alcance final** (ajuste hecho al cierre, no estaba en el documento de Diseño
original): el disparo automático de "release completo → Architect propone el release siguiente"
(Functional Goal original de la Feature). Se descubrió, ya con la implementación validada, que:
- El motor de pipeline (`src/pipelines/definitions.ts`) no tiene ningún concepto de "Feature" como
  dato rastreable — hoy es prosa dentro del artefacto de texto de Planning, no un registro con
  estado.
- El loop de fases (`PipelineSpec.definition.loop`) es deliberadamente de un solo tipo
  (Developer↔QA, decisión de FEATURE-005) — no soporta hoy que Planning itere múltiples Features
  de un release, ni que Architect sea re-invocado automáticamente al cerrar uno.
- El texto de Developer en `08-CODE-SYSTEM-PROMPT.md` ("si hay Feature siguiente, continúa por su
  cuenta") tiene además una tensión real con la Regla 10 (Ownership de Artefactos: el Release Plan
  es propiedad de Planning, no de Developer).

**Lecciones Aprendidas**: este hallazgo, surgido en la revisión de cierre de FEATURE-018, derivó en
dos Features nuevas — FEATURE-019 (rediseño del ciclo de ejecución de releases/Features, con
Planning gobernando la iteración y Architect gobernando el avance entre releases) y FEATURE-020
(adaptar esta Feature al mecanismo que resulte de FEATURE-019). El patrón de reusar mecanismos ya
probados (atomicidad vía `client` compartido, distinción de escalamiento por contenido en vez de
un campo nuevo) siguió dando resultado en esta Feature, igual que en ciclos anteriores.

### 🟡 FEATURE-019 — Modelo de circuitos anidados para el ciclo de Releases y Features
Surge de la revisión de cierre de FEATURE-018 (ver Lecciones Aprendidas ahí). Modelo acordado con
el owner (diagramas AS IS / TO BE, tres circuitos anidados):
- Circuito 1 (Roadmap de Releases): Architect → Functional → Circuito 2. Salida natural (no hay
  más releases) → Usuario (proyecto cerrado). Architect gobierna el avance entre releases.
- Circuito 2 (Release Plan): Planning → Circuito 3, repetido por cada Feature del release activo.
  Salida natural (no hay más Features) → Architect (dispara la propuesta/aprobación del release
  siguiente). Planning gobierna la iteración de Features — Developer nunca se autogobierna entre
  Features, siempre vuelve a Planning (resuelve la tensión con la Regla 10, Ownership de
  Artefactos, que tenía el texto actual de Developer en `08-CODE-SYSTEM-PROMPT.md`).
- Circuito 3 (Feature Implementation): Developer↔QA, sin cambios respecto al loop ya existente.
  Salida natural (QA aprueba, Developer commitea y pushea) → Planning, no termina el run.
- Reintento (hasta 3) y Escalada a humano se mantienen exactamente iguales a hoy (Regla 8.3/8.4),
  aplicando uniformemente sin importar en qué circuito ocurra el problema — no se toca ese
  mecanismo, solo se generaliza su punto de entrada.

Pendiente de Discovery/Design completo: cómo se modela una Feature como dato rastreable (hoy es
prosa), cómo Planning decide "no hay más Features" y Architect decide "no hay más releases", y
cómo interactúa esto con el tope de 3 pasadas del circuito de escalamiento cuando hay múltiples
Features en juego. Buena parte de la mecánica de aprobación de FEATURE-018 (escalamiento
distinguido por contenido, atomicidad vía `client` compartido) es reusable para la salida del
Circuito 2 hacia Architect, sin construir un mecanismo nuevo desde cero.

### 🟡 FEATURE-020 — Adaptación de FEATURE-018 al mecanismo de FEATURE-019
Depende enteramente de que FEATURE-019 cierre su Diseño — no se puede dimensionar antes (mismo
criterio que la dependencia ya documentada de FEATURE-016 respecto de FEATURE-015A/015B). Cubre lo
que haga falta ajustar en `architect.txt`/`planning.txt`/`respondService.ts` (ya construidos en
FEATURE-018) para encajar en el modelo de circuitos anidados de FEATURE-019, en vez de descartar lo
ya implementado.

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

### 🟡 FEATURE-022 — Selección de proveedor/modelo/credenciales por rol
Promovido de ⚪ Tentativo a 🟡 Confirmado.
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
- El paso de mapeo del intake (FEATURE-017, `mapBusinessCase.ts`) hoy usa una llamada directa fija
  (Claude Haiku + API key, sin pasar por `authMode`/`resolveAgentConfig`) — decisión explícita del
  owner de que, a futuro, este paso también debe respetar la misma configuración de agente/authMode
  que el resto de los roles, no quedar como excepción fija. Pendiente de diseño técnico (el mapeo no
  usa Executor/holder-worker hoy, por no necesitar tools — ver FEATURE-017 Regla 5 y Risks).

### 🟡 FEATURE-023 — Credenciales git por usuario para el Orquestador
Promovido de ⚪ Tentativo a 🟡 Confirmado.
Hoy el clonado de repos (FEATURE-017, `cloneRunRepository`) usa una única identidad git fija a
nivel de servidor — la clave SSH del usuario del sistema que corre el proceso del Orquestador.
Funciona porque hoy hay un solo usuario real (el owner) trabajando sobre sus propios repos. Para
que cualquier otro usuario pueda usar sus propios repos privados sin intervención manual (agregar
deploy keys a mano, repo por repo), hace falta un mecanismo de autenticación por usuario — la misma
idea que ya resolvió FEATURE-016 para los modelos de IA (`authMode`: API key vs OAuth, por usuario),
pero aplicada al acceso a Git: cada usuario debería poder autenticar su propia cuenta de GitHub
(patrón tipo GitHub App, o al menos una clave SSH/token por usuario en vez de una fija del
servidor), de forma similar a como ya se pide autenticación de cuenta personal para Claude/Codex.
No diseñado todavía — Discovery pendiente.

### ⚪ Approval Model por Release
Feature 09 (`06-DELIVERY-WORKFLOW.md`, Stage 6) ya diseñó la v1: Modo Manual (default — automático
hasta el push de cada Feature, humano revisa antes del merge a la rama principal) y Modo Auto
(también el merge es automático; solo el deploy a producción requiere humano, sin excepción, por
la Regla 9 de `03-AI-CONSTITUTION.md`).

Lo que queda Tentativo: exponer el rigor (Modo Manual / Modo Auto) como configuración
parametrizable real para el usuario final — hoy es fijo, decidido por quienes operan el
Orquestador. Aplica cuando el Orquestador opere sobre proyectos externos.

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
Stage 6, Modo Manual / Modo Auto) — este ítem es la implementación real, todavía sin código.

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

Disparo (FEATURE-017, ✅ Ejecutada) e Historial/admin quedan fuera de esta Feature — Historial/admin
sigue Tentativo, ver su detalle más abajo.

### ✅ FEATURE-017 — Capa de UI — Disparo (intake de caso de negocio asistido por IA)
Pantalla para crear un run nuevo: el usuario pega texto o carga un archivo con el relevamiento del
caso de negocio, el Orquestador lo mapea (sin inventar, sin diálogo con el usuario) contra una
estructura de 12 campos predeterminados, más Repositorio y Rama Base de Trabajo (ambos siempre
requeridos, Rama Base con default `main`). El usuario confirma o edita en un modal con % de
completitud antes de poder iniciar el run. Introduce, por primera vez en el proyecto, un estado
previo al arranque de un run (`sin_iniciar`) y una cancelación real desde la lista "mis casos",
reusando el mecanismo de escalamiento de FEATURE-013C. Separada de Historial/admin por ser
funcionalmente independiente.

**Estado (2026-07-25): ✅ Ejecutada.** Validada técnicamente por el DAIA (chequeo de cancelación
pre-fase, decisión de fijar `pipeline_definition_id` en la confirmación en vez del arranque),
aprobada por el owner, implementada en la rama `feature/017-ui-disparo-intake` (commit `eed5e88`,
implementación principal) y mergeada a `main` en `14693c8`
("Merge FEATURE-017: intake de caso de negocio asistido por IA"). La rama se conserva como
referencia histórica, mismo criterio que `feature/016-*`.

Qué se implementó: migraciones `0009_intake_field_definitions.sql` (12 campos, seed) y
`0010_runs_sin_iniciar.sql` (`runs.business_case`); mapeo directo al proveedor sin tools
(`src/intake/mapBusinessCase.ts`, Claude Haiku + API key fija — ver ítem Tentativo "Selección de
proveedor/modelo/credenciales por rol" para la excepción pendiente de resolver); orquestación en
`src/cli/intakeService.ts` (confirmar/iniciar/cancelar); clonado real y aislado del repositorio del
caso de negocio (`cloneRunRepository`/`removeRunClone`, normalización HTTPS→SSH para GitHub — ver
ítem Tentativo "Credenciales git por usuario para el Orquestador" para la limitación conocida y
aceptada); chequeo de cancelación pre-fase (`haltIfCancelledExternally`) en `runStart.ts`; timeouts
finales por rol (`ARCHITECT_TIMEOUT_MS`/`FUNCTIONAL_TIMEOUT_MS`/`PLANNING_TIMEOUT_MS` en 600000ms,
`DEVELOPER_TIMEOUT_MS`/`QA_TIMEOUT_MS` en 900000ms, subidos de 300000ms tras una corrida real y una
investigación de timeouts de mercado) y registro de duración real por fase (`durationMs`);
frontend `web/src/intake/` (Disparo, ReviewModal, CasesList), sin router, con `Badge` de color
compartido para el estado (`statusDisplay.ts`, reusado también en la pantalla de detalle de
FEATURE-013A).

Mejoras identificadas para cuando se diseñe Historial/admin, ver detalle de esa Feature abajo.

Diseño y evidencia completos:
`docs/features/FEATURE-017-Capa-de-UI-Disparo-intake-de-caso-de-negocio-asistido-por-IA.md`.

### ⚪ Capa de UI — Historial/admin
Listado de runs propios o del equipo (si admin), con estado/dueño/fase/tiempo transcurrido — dato
que ya existe en `runs`/`run_events`, sin necesidad de ningún mecanismo nuevo de intake. Mencionada
en `02-ARCHITECTURE.md` (Frontend Principles) como fuera del alcance de FEATURE-017 — sin diseño
propio todavía. Mejoras puntuales ya identificadas para
cuando se diseñe (surgidas durante las pruebas reales de FEATURE-017):
- La lista de "mis casos" hoy muestra el Run ID (UUID) como identificador visible — debería mostrar
  el título tentativo del caso (derivado del caso de negocio mapeado, ej. de la sección "Visión" o
  un campo de título dedicado a agregar), con el Run ID como dato secundario/técnico.
- El error de `repo_clone_failed` (corte técnico antes del Architect, FEATURE-017 sección 7.4) se
  muestra hoy como texto plano en rojo pegado arriba de la lista — debería mostrarse en un modal o
  componente de error más prolijo, consistente con el resto de la UI.

### ⚪ Notificación Slack/webhook complementaria
Evaluada en la misma sesión que "Run en curso" como alternativa de monitoreo — se descartó como
primera opción porque, a esfuerzo comparable, una UI mínima de solo lectura daba más valor y era
reusable hacia la Capa de UI completa. Queda como complemento futuro si hace falta alertas push
(fase completada/fallida) fuera de cuando alguien está mirando la UI activamente.

### 🟡 FEATURE-021 (antes FEATURE-019, antes FEATURE-018, antes FEATURE-017, antes FEATURE-014) —
Milestone 2 — Validación end-to-end con caso de negocio real
Necesario y ya decidido antes de sumar al resto del equipo. No es opcional — por eso está
Confirmado y no Tentativo.
