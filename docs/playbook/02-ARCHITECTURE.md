# 02-ARCHITECTURE.md

# Architecture — ai-orchestrator

Versión: v1.0
Basado en: AI Playbook Base (Standard Mode)

## Propósito

Este documento define la arquitectura técnica del orquestador de workflow con agentes de IA. Refleja las decisiones ya tomadas y validadas; marca explícitamente como **[Pendiente]** las decisiones todavía abiertas para no asumir tecnología sin aprobación humana, conforme a la AI Constitution (03).

---

# 🔒 BASELINE — Arquitectura Core

---

# 1. System Overview

## Descripción General

Un pipeline de 5 agentes de IA (Architect, Functional, Planning, Developer, QA) secuenciados e invocados activamente por un **Orquestador** (máquina de estados). El Orquestador traduce cada invocación hacia herramientas reales de código (Claude Code, Codex) a través de un **Executor** intercambiable. Una **UI** web dispara el pipeline y refleja el progreso en vivo, sin contener lógica de negocio.

Flujo general:

```
Caso de negocio relevado → dispara run
  → Orquestador invoca Architect
  → Functional
  → Planning (arma plan + casos de prueba, gatea el avance)
  → Developer ↔ QA (hasta 3 ciclos; al tercer rechazo, escala a humano)
  → Finalización (push, PR, limpieza de worktree)
```

Ante ambigüedad en cualquier fase, el protocolo de escalamiento (Governor, embebido en cada rol) detiene el flujo y pide intervención humana.

## System Boundaries

**Dentro del sistema:**
* Orquestador, Executor, persistencia (4 tablas), UI.
* Lógica de invocación, evaluación de resultado y transición de fase.
* Aislamiento por run (worktree + contenedor).

**Externo al sistema:**
* La app de business case existente (fuente de los casos ya relevados) — el disparo del pipeline consume de ahí, no lo reemplaza.
* Claude Code y Codex, como motores de ejecución externos.
* GitHub, como fuente de verdad del código (repos, ramas, PRs).

---

# 2. Architecture Style

## Estilo Arquitectónico

**Orquestación** (no coreografía) en **3 capas**:

* **UI** — portal web, sin lógica de negocio, solo refleja estado.
* **Orquestador** — máquina de estados; único componente que conoce la secuencia completa; invoca cada fase, persiste el estado, decide transiciones según una definición de pipeline versionada (datos, no código embebido).
* **Executor** — adaptador que traduce invocaciones del Orquestador hacia la herramienta de código real; intercambiable sin tocar las otras dos capas.

Decisión explícita — evitar mezcla de estilos: los agentes nunca se autoconvocan entre sí; toda transición pasa por el Orquestador.

---

# 3. Frontend

## Frontend Stack

**[Pendiente]** — no definido en el handoff. A decidir antes de iniciar la capa UI (Milestone posterior al primer incremento del Orquestador).

## Frontend Principles

* Sin lógica de negocio — la UI únicamente refleja estado emitido por el Orquestador.
* Tres pantallas: disparo (casos de negocio listos con un click), run en curso (avatar por agente + estado en vivo + narrativa curada + banner de validación al escalar), historial/admin (runs propios o del equipo si admin, con estado/dueño/fase/tiempo transcurrido).
* Consumo de eventos vía SSE: snapshot inicial + stream de deltas.

---

# 4. Backend

## Backend Stack

**Node.js + TypeScript**.
**Justificación**: el contrato de Executor ya está escrito en TypeScript (sección 6); esto da consistencia de tipado end-to-end entre el contrato, el Orquestador y sus adaptadores. Node ofrece un modelo de I/O no bloqueante adecuado para el streaming de progreso vía SSE planeado a futuro (sección 3). Además da continuidad con el stack de desarrollo ya usado por el owner.

## Backend Principles

* Modelo de invocación activa: el Orquestador llama, el Executor ejecuta, el Orquestador evalúa y decide (avanzar o escalar).
* El contrato de Executor es fijo e intercambiable entre proveedores (ver sección 6).
* El timeout de fase completa lo impone el Orquestador/Executor — nunca el proveedor de IA.
* Términos propios de cada proveedor (Claude Code, Codex) quedan encapsulados dentro de su adaptador respectivo; no deben filtrarse al resto del sistema.

---

# 5. Data & Persistence

## Data Strategy

Cuatro tablas:

| Tabla | Propósito |
|---|---|
| `pipeline_definitions` | Secuencia de fases y reglas de transición, versionada. |
| `runs` | Corrida concreta: fase actual, `owner_id`, versión de pipeline usada. |
| `run_events` | Log append-only de todo lo ocurrido — auditoría y reconexión SSE sin pérdida vía `Last-Event-ID`. |
| `artifacts` | Lo que produce cada agente. Texto/JSON directo para diseño; para código, referencia a commit/PR (no duplicado — git es la fuente de verdad). |

Motor de base de datos: **PostgreSQL**.
**Justificación**: Docker Engine ya está operativo en la VPS (sección 7), por lo que correr Postgres en contenedor no agrega infraestructura nueva. Soporta `JSONB`, útil para poder consultar el contenido de `artifacts` más adelante sin tratarlo como texto opaco. El owner tiene experiencia previa con Postgres.

## Data Principles

* Single source of truth: git para código, DB solo para estado y metadatos del pipeline.
* Evitar duplicación de contenido versionado.
* Multiusuario: cada run tiene dueño (`owner_id`); SSE filtrado por run y dueño; rol admin ve todos los runs.

---

# 6. Integrations

## External Integrations

* **Claude Code** y **Codex** — vía el contrato de Executor (ver interfaz abajo). Verificado contra documentación oficial (julio 2026): soportan invocación headless, streaming de progreso, permisos configurables por invocación, y system prompt/rol distinto por invocación.
* **GitHub** — repo del proyecto (`asdrubalperez/ai-orchestrator`), con deploy key propia de la VM con acceso de escritura.
* **App de business case existente** — origen de los casos de negocio ya relevados que disparan un run.

### Contrato de Executor

```typescript
interface Executor {
  runPhase(
    invocation: PhaseInvocation,
    options: { signal?: AbortSignal; onEvent?: (e: ExecutorEvent) => void; timeoutMs?: number }
  ): Promise<PhaseResult>;
}

interface PhaseInvocation {
  agentRole: "architect" | "functional" | "planning" | "developer" | "qa";
  roleInstructions: string;   // system prompt fijo del playbook, por rol
  context: unknown;           // artefactos de fases anteriores que esa fase necesita
  permissions: {
    filesystem: "read-only" | "workspace-write";
    writableRoots?: string[];
    allowedCommands?: string[];
  };
}

interface PhaseResult {
  status: "completed" | "rejected" | "failed" | "interrupted" | "escalated";
  outputArtifact: unknown;
  summary: string;             // narrativa curada, no el log crudo de herramienta
  escalationReason: string | null;
  executorMetadata?: {         // qué proveedor/modelo ejecutó realmente la fase (ver ADR sección 9)
    provider: string;
    model?: string;
  };
}
```

Mecanismo exacto de invocación headless para Claude Code: **Claude Code CLI** (`claude -p`), no Agent SDK — confirmado empíricamente en los spikes de FEATURE-001 (`docs/features/FEATURE-001-spike-results.md`) y FEATURE-002 (`docs/features/FEATURE-002-spike-results.md`).

### Modo de autenticación y selección de agente (FEATURE-016)

Cada usuario tiene una preferencia persistente de **agente** (`claude` | `codex`) y **authMode**
(`api_key` | `cli_session`) en la tabla `user_agent_config`, global y con override opcional por
rol (`architect`/`functional`/`planning`/`developer`/`qa`). Sin ninguna fila configurada, el
comportamiento es exactamente el default histórico (`claude` + `api_key`) — regresión cero.

Precedencia, en este orden: flag de CLI (`--executor`/`--auth-mode`, uso técnico puntual, nunca
persiste) > override de `user_agent_config` para ese rol > fila global del usuario > default. Ver
`src/db/repository.ts` (`resolveAgentConfig`) y `src/cli/commands/runStart.ts`.

`authMode="api_key"` (default) inyecta la key del proveedor como siempre. `authMode="cli_session"`
monta de solo lectura un caché OAuth dedicado del Orquestador (nunca el `HOME` personal del
operador) en el contenedor holder — mismo patrón `-v origen:destino:ro` ya usado para
`roleMcpBridge.mjs`/`mcp.json` — y no inyecta ninguna key. Falla explícito si el caché no existe o
la sesión está vencida, sin fallback silencioso a `api_key`.

Para Codex, `cli_session` apunta `CODEX_HOME` al caché montado y usa `type:"chatgpt"` en
`account/login/start` en vez de `type:"apiKey"`. Para Claude Code, `cli_session` corre **sin**
`--bare` (que deshabilita OAuth/keychain de raíz) y agrega `--setting-sources ""` como mitigación
parcial — suprime hooks y auto-discovery de `CLAUDE.md`, pero no LSP, plugin sync ni el
prefetch/bootstrap de red al arranque del CLI. Ese riesgo residual (tráfico de red al host de
Anthropic no gateado por ninguna tool, LSP/plugin sync corriendo dentro del holder) fue presentado
en términos concretos y aceptado explícitamente por el owner — ver
`docs/features/FEATURE-016-auth-oauth-executors.md`, secciones 7.4 y 9, para el detalle completo
de por qué no hay una alternativa más fina disponible hoy en el CLI de Claude Code.

## Integration Principles

* Documentation first: no asumir comportamiento de Claude Code / Codex sin validar contra documentación oficial vigente.
* "Solo lectura" no puede depender solo del prompt — se impone combinando prompt de rol + herramientas habilitadas + sandbox de filesystem + política de comandos.
* Fallas de integración deben degradar a escalamiento humano, no a reintento silencioso indefinido.

---

# 7. Infrastructure & Deploy

## Infrastructure

* **Hosting**: Hostinger VPS KVM2 — 2 vCPU AMD EPYC, 8 GB RAM, 100 GB NVMe, ~USD 24,49/mes, sin permanencia, garantía de devolución 30 días. Elegido sobre Hetzner e InterServer por mejor relación RAM/precio, backups incluidos y política de CPU transparente (throttling automático solo tras 180 min sostenidos al 100%, no suspensión discrecional).
* **IP**: `179.197.79.99` — Ubuntu 24.04 LTS.
* **Usuario de trabajo**: `asdru` (sudo), acceso SSH solo por clave.
* **Docker Engine**: instalación oficial (repositorio de Docker), usuario `asdru` en grupo `docker` (sin necesidad de `sudo`).
* **Git**: clave SSH propia de la VM, configurada como Deploy Key con acceso de escritura sobre `asdrubalperez/ai-orchestrator`.
* **Postgres de desarrollo**: contenedor separado en la misma VPS (`postgres-dev-orquestador`, imagen `postgres:16-alpine`, puerto atado a `127.0.0.1:5432` — no expuesto públicamente). Acceso desde máquinas de desarrollo vía túnel SSH (`ssh -L 5433:localhost:5432 asdru@179.197.79.99`), nunca conexión directa. Independiente de cualquier Postgres de producción futuro — nombre, volumen y ciclo de vida propios, sin compartir datos.
* **Node.js en la VPS**: instalado (v22 LTS, vía repositorio oficial NodeSource) a partir de FEATURE-006, para poder desarrollar y validar directamente en la VPS el aislamiento por contenedor de Developer/QA (H14) — la máquina de desarrollo local (Windows, sin Docker Desktop) no puede ejecutar contenedores reales, así que ese trabajo se hace por SSH contra la VPS en vez de contra un Docker remoto desde la notebook. Es la primera vez que el propio código del Orquestador corre en la VPS, no solo su infraestructura de soporte (Postgres, deploy key).

## Deployment Strategy

**[Pendiente]** — no definida en el handoff (manual, CI/CD, staged, etc.).

---

# 8. Security & Access

## Security Model

* SSH exclusivamente por clave; `PermitRootLogin no` y `PasswordAuthentication no` en `/etc/ssh/sshd_config` **y** en `/etc/ssh/sshd_config.d/50-cloud-init.conf` (este último tiene precedencia — corregido explícitamente).
* Plan B de acceso: consola web de hPanel, independiente de SSH, con contraseña de root del panel.
* Deploy Key específica de la VM (distinta de la clave del usuario) con acceso de escritura, acotada al repo del proyecto.

## Sensitive Areas

* Credenciales SSH y Deploy Key.
* La VPS en sí (único ambiente existente — no hay separación dev/staging/producción todavía).
* Contenedores donde corren Developer y QA — tienen acceso de escritura al worktree del run.

---

# 9. Architectural Decisions (ADR-lite)

## Decisión: Hosting en Hostinger VPS KVM2
**Motivo**: mejor relación RAM/precio que Hetzner e InterServer; backups incluidos; política de CPU documentada y transparente; sin permanencia.
**Alternativas consideradas**: Hetzner, InterServer.
**Tradeoffs**: menor soporte/prestigio enterprise que alternativas más caras, aceptable para la etapa de validación actual.

## Decisión: Server-Sent Events en vez de WebSockets
**Motivo**: tráfico predominantemente asimétrico (servidor → cliente); snapshot inicial + stream de deltas cubre la necesidad.
**Alternativas consideradas**: WebSockets.
**Tradeoffs**: SSE es unidireccional; si a futuro se necesita comunicación bidireccional en tiempo real desde la UI hacia el Orquestador, esta decisión debería revisarse.

## Decisión: Modelo de orquestación (no coreografía)
**Motivo**: necesidad de un único punto de control, visibilidad total de la secuencia y gates humanos centralizados.
**Alternativas consideradas**: coreografía (agentes autoconvocándose).
**Tradeoffs**: mayor acoplamiento al Orquestador como punto único de control, mitigado por mantener la definición de pipeline como datos versionados en vez de lógica embebida.

## Decisión: Aislamiento por `git worktree` + contenedor por run
**Motivo**: evitar interferencia entre runs concurrentes; acotar los permisos de escritura de Developer/QA a su propio workspace.
**Alternativas consideradas**: ejecución compartida sobre un único checkout.
**Tradeoffs**: overhead de gestión de branches/worktrees vencidos — de ahí el pendiente de política de limpieza automática a 21 días.

## Decisión: `permissions.filesystem: "read-only"` se impone vía restricción de toolset, no vía sandbox de filesystem
**Motivo**: el spike de FEATURE-001 (2026-07-16) confirmó empíricamente, con Claude Code CLI, que no existe un flag de "read-only" a nivel de filesystem del sistema operativo. El mecanismo real y verificado es restringir el toolset de la invocación (`--tools "Read,Grep,Glob"`, excluyendo explícitamente `Write`, `Edit`, `NotebookEdit` y `Bash`). Un intento de escritura bajo esta configuración no generó ni siquiera un evento de "denegado" (`permission_denials: []`) — fue estructuralmente imposible porque el modelo no contaba con ninguna herramienta capaz de escribir. Esto corrige el supuesto original de esta arquitectura (sección 6), que asumía un "sandbox de filesystem" como parte del mecanismo de imposición.
**Alternativas consideradas**: sandbox de filesystem a nivel de OS/contenedor (asumido originalmente, no validado); confiar únicamente en `roleInstructions` de prompt (descartado — no es imposición real).
**Tradeoffs**: la restricción de toolset depende de que el proveedor (Claude Code) no exponga, dentro de las herramientas permitidas, ninguna vía indirecta de escritura (p. ej. un futuro tool builtin con efectos secundarios de escritura). Es suficiente para fases de solo lectura (Architect, Functional, Planning), pero no reemplaza el aislamiento por `git worktree` + contenedor ya decidido para fases de escritura (Developer, QA), donde `Bash` sigue habilitado y el riesgo es mayor.
**Pendiente derivado**: evaluar si conviene sumar una segunda capa de sandbox real a nivel de sistema (OS/contenedor) para fases read-only, en vez de depender únicamente de la restricción de toolset del proveedor — especialmente si en el futuro se cambia de proveedor (Codex) y ese mecanismo de restricción no está disponible o se comporta distinto.

## Decisión: `permissions.filesystem: "workspace-write"` con `writableRoots` se impone vía un sandbox de rutas real del CLI (no solo restricción de toolset)
**Motivo**: el spike de FEATURE-002 (2026-07-16) probó, con `Write`, `Edit` y `Bash` **todos habilitados** dentro de una invocación real sobre un `git worktree` de un run, que 4 intentos explícitos de escritura fuera de `writableRoots` (dos contra el repo principal, dos contra una ruta arbitraria ajena a git, cada par vía herramienta de edición y vía redirección de shell en Bash) fueron bloqueados por el propio Claude Code CLI con el mensaje explícito *"Claude Code may only write to files in the allowed working directories for this session"*. Esto confirma que, a diferencia de read-only (H1, donde el bloqueo es simplemente la ausencia de herramientas de escritura), para fases de escritura sí existe un **sandbox de rutas real** impuesto por el CLI, con alcance = directorio de trabajo (`cwd`) de la invocación — no se necesitó `--add-dir` para lograr el confinamiento, alcanzó con invocar con `cwd` = worktree del run y no ampliar el alcance. Verificado con evidencia independiente (hash SHA-1 del archivo objetivo en el repo principal, idéntico antes/después; listado de la ruta ajena, vacío).
**Alternativas consideradas**: depender únicamente de aislamiento por contenedor (ya decidido, pero más costoso operativamente si el sandbox de CLI ya alcanza para el caso base); confiar solo en `roleInstructions` de prompt (descartado, mismo criterio que H1).
**Tradeoffs**: este sandbox es una garantía del proveedor (Claude Code), no del sistema operativo — sigue siendo recomendable mantener el aislamiento por `git worktree` + contenedor por run ya decidido como defensa en profundidad, especialmente ante un eventual cambio de proveedor (Codex) que podría no ofrecer un mecanismo equivalente. Se detectó además una fricción operativa menor (ver `docs/features/FEATURE-002-spike-results.md`, hallazgo H6): aliasing de rutas cortas de Windows (8.3) causó un falso bloqueo inicial sobre una escritura legítima dentro del propio worktree, antes de tener éxito con la ruta larga — modo de falla "fail closed", no un escape, y específico de desarrollo en Windows (la VPS de producción corre Ubuntu).
**Pendiente derivado**: ninguno bloqueante. Sigue en pie el pendiente ya registrado de sumar contenedor como defensa adicional para Developer/QA.

## Decisión: agregar `executorMetadata` a `PhaseResult`
**Motivo**: el spike de FEATURE-001 detectó que, en una misma invocación, el proveedor (Claude Code) enrutó internamente la ejecución a más de un modelo (`claude-haiku-4-5` para una tarea interna corta y `claude-sonnet-5` para el trabajo real de la fase), sin que el contrato de `PhaseResult` tenga ningún campo donde registrar cuál modelo produjo la respuesta. Esto rompe el compromiso de auditabilidad completa ya asumido en `01-PROJECT-CHARTER.md` (Success Criteria) y en `run_events` como log append-only.
**Alternativas consideradas**: fijar el modelo explícitamente vía `--model` en cada invocación del Executor (mitigaría pero no eliminaría el problema, y no todos los proveedores garantizan que un flag de modelo cubra el 100% del routing interno); no registrar esta información (descartado — contradice el principio de auditabilidad).
**Tradeoffs**: agregar un campo abre la superficie del contrato de Executor; debe mantenerse opcional/intercambiable entre proveedores para no romper el principio de Executor agnóstico de proveedor (`02-ARCHITECTURE.md` sección 2).
**Estado**: **implementada en el contrato** — el campo `executorMetadata` ya está reflejado en la interfaz `PhaseResult` de la sección 6:
```typescript
interface PhaseResult {
  status: "completed" | "rejected" | "failed" | "interrupted" | "escalated";
  outputArtifact: unknown;
  summary: string;
  escalationReason: string | null;
  executorMetadata?: {
    provider: string;
    model?: string;
  };
}
```
Aprobado explícitamente por el owner el 2026-07-16 (03-AI-CONSTITUTION.md, regla 2 — respeto por la arquitectura aprobada).

## Nota: recomendación de `--json-schema` (hallazgo H2) no adoptada todavía
**Motivo**: el spike de FEATURE-001 observó que la respuesta cruda de Claude Code CLI en `--output-format json` no viene en el shape de `PhaseResult` de forma nativa — es texto libre dentro de un campo `result`, mapeado en el spike mediante una convención de formato pedida por prompt. El `--help` del CLI instalado (v2.1.211) muestra un flag `--json-schema` que permitiría forzar salida estructurada validada contra un schema. Esta recomendación **no fue adoptada en el contrato ni en el Executor real** — queda pendiente verificarla contra la documentación oficial vigente del proveedor antes de comprometerse a usarla como mecanismo de mapeo de `PhaseResult`, en línea con el principio "Documentation first" de la sección 6 (Integration Principles).

---

# ⚙️ PROJECT CONFIGURATION — Configuración Editable

---

## Non-Functional Requirements

* Auditabilidad completa (log append-only en `run_events`).
* Multiusuario con aislamiento estricto por dueño de run.
* Reconexión SSE sin pérdida de eventos.
* Timeout de fase controlado internamente, no delegado al proveedor de IA.

## Team Constraints

* Un solo desarrollador/diseñador en esta etapa (Asdru).
* Equipo se suma después de validar el flujo end-to-end con un caso de negocio real.

## Environment Matrix

* **Actual**: un solo ambiente (la VPS), sin separación formal dev/staging/producción todavía. **[Pendiente]** si se necesitará más de un ambiente antes de sumar al equipo.

---

# 🧩 OPTIONAL EXTENSIONS — Extensiones Opcionales

Ninguna activada por el momento. Candidatas a futuro conforme el sistema madure:

* **Observability Mode** — cuando el sistema empiece a correr con más de un usuario real, para logging/monitoring/alerting sobre runs y contenedores.
* **Dependency Governance Mode** — si el proyecto crece en librerías, dado que hoy no hay stack de backend/frontend decidido todavía.

---

# Principios Arquitectónicos

Orden de prioridad:

1. Claridad
2. Cohesión
3. Viabilidad
4. Maintainability
5. Escalabilidad pragmática

La arquitectura debe servir al problema. No al revés.
