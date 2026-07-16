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

**[Pendiente]** — lenguaje/framework del Orquestador sin elegir. Uno de los pendientes explícitos a resolver antes del primer incremento.

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

Motor de base de datos: **[Pendiente]** — SQLite vs Postgres para arrancar, decisión explícita todavía abierta.

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
}
```

Mecanismo exacto de invocación headless para Claude Code (Agent SDK vs CLI): **[Pendiente]**.

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
