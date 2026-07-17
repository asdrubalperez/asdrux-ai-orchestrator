# 01-PROJECT-CHARTER.md

# Project Charter — ai-orchestrator

Versión: v1.0
Basado en: AI Playbook Base (Standard Mode)

## Propósito

Este documento define la identidad, objetivos, alcance y límites del proyecto **ai-orchestrator**: un orquestador de workflow con agentes de IA que automatiza el ciclo completo de trabajo hoy realizado manualmente con el playbook (00-README a 08-CODE-SYSTEM-PROMPT), desde un caso de negocio ya relevado hasta una PR probada y lista para mergear.

---

# 🔒 BASELINE — Definición Core del Proyecto

---

# 1. Project Identity

## Nombre del Proyecto

ai-orchestrator

## Tipo de Proyecto

Automation / Internal Tool — orquestador de agentes de IA sobre un pipeline de delivery de software.

## Owner / Sponsor

Asdru — Agile Coach en Santex Group, embebido en Swiss Medical Group como cliente principal. Proyecto de iniciativa propia, no cliente-facing en esta etapa.

## Estado

**Design.** Arquitectura, modelo de datos, contrato de Executor y decisiones de infraestructura ya definidos y validados. Implementación de código todavía no iniciada (repositorio creado y vacío).

---

# 2. Problem Statement

## Problema a Resolver

El ciclo completo del playbook — desde un caso de negocio relevado hasta una PR lista para mergear — se ejecuta hoy **manualmente**, fase por fase, invocando cada agente a mano. Esto implica:

* fricción operativa entre fases;
* falta de visibilidad centralizada y en tiempo real del progreso;
* dependencia de que una persona esté disponible para secuenciar cada paso;
* sin trazabilidad auditable del proceso completo.

La oportunidad es automatizar esa secuencia preservando los puntos donde la intervención humana es genuinamente necesaria (ambigüedad real), no eliminándola.

Principio respetado: entender el problema antes que anticipar tecnología.

---

# 3. Objectives

## Objetivos del Proyecto

* Automatizar el pipeline **Architect → Functional → Planning → Developer ↔ QA → Finalización** sin intervención manual salvo en gates de escalamiento.
* Reducir el tiempo de ciclo entre caso de negocio relevado y PR mergeable.
* Garantizar trazabilidad completa y auditable de cada corrida (run).
* Soportar múltiples usuarios del equipo en paralelo sin fuga de contexto entre runs.
* Mantener el sistema intercambiable a nivel de motor de ejecución (Claude Code, Codex u otro futuro) sin rediseñar Orquestador ni UI.

---

# 4. Scope In

## Incluye

* Orquestador (máquina de estados) que invoca activamente cada fase — modelo de orquestación, no de coreografía.
* Executor como adaptador intercambiable hacia herramientas reales de código (Claude Code, Codex).
* 5 agentes de pipeline: Architect, Functional, Planning, Developer, QA.
* Protocolo de escalamiento humano (Governor) embebido en cada rol, no como agente separado.
* Persistencia de 4 tablas: `pipeline_definitions`, `runs`, `run_events`, `artifacts`.
* Aislamiento por run vía `git worktree` + contenedor para fases de escritura (Developer, QA).
* UI con tres pantallas: disparo, run en curso, historial/admin.
* Tiempo real vía Server-Sent Events (snapshot inicial + stream de deltas, reconexión sin pérdida vía `Last-Event-ID`).
* Modelo multiusuario: dueño por run, visibilidad admin sobre todos los runs.

---

# 5. Scope Out

## No Incluye

* Autonomía total sin supervisión humana — el sistema es un pipeline con gates humanos obligatorios, no un agente autónomo.
* Reintentos QA ↔ Developer ilimitados — tope duro de 3, luego escala a humano.
* Lógica de negocio en la capa UI — la UI solo refleja estado.
* WebSockets — descartado explícitamente a favor de SSE por tráfico asimétrico.
* Cualquier alcance no descripto explícitamente arriba (a definir a futuro, si aplica).

---

# 6. Success Criteria

## Criterios de Éxito

* Un caso de negocio ya relevado llega a PR mergeable sin intervención manual, salvo en los puntos de escalamiento definidos.
* El sistema soporta más de un usuario simultáneo sin fuga de contexto ni interferencia entre runs.
* Runs escalados y no retomados se limpian automáticamente a los 21 días.
* La reconexión SSE no pierde eventos (verificable vía `Last-Event-ID`).
* El primer flujo end-to-end se valida con un caso de negocio real antes de sumar al resto del equipo.

---

# 7. Constraints

## Restricciones

* **Infraestructura ya contratada y operativa**: Hostinger VPS KVM2 (2 vCPU AMD EPYC, 8 GB RAM, 100 GB NVMe, ~USD 24,49/mes). No migrar sin una razón de peso.
* **Motores de ejecución**: Claude Code y Codex, ambos verificados (julio 2026) con soporte de invocación headless, streaming de progreso, permisos configurables por invocación y system prompt/rol distinto por invocación.
* **Seguridad de acceso**: SSH solo por clave, root deshabilitado remotamente (`PermitRootLogin no`, `PasswordAuthentication no`), plan B vía consola web de hPanel.
* **Aislamiento obligatorio**: cada run debe tener su propio `git worktree`; Developer y QA corren en contenedor limitado a ese worktree.
* **Límite de reintentos QA ↔ Developer**: 3, no configurable sin decisión explícita.
* **Retención de runs escalados sin retomar**: 21 días.

---

# 8. Design Principles

## Principios del Proyecto

* Orquestación explícita — un único componente conoce y controla la secuencia completa; los agentes nunca se autoconvocan.
* "Solo lectura" no puede depender solo del prompt de rol — se impone combinando prompt + herramientas habilitadas + sandbox de filesystem + política de comandos.
* Git como única fuente de verdad para el código — no duplicar contenido versionado en la base de datos.
* El Executor debe ser intercambiable sin tocar Orquestador ni UI.
* Auditabilidad primero: todo evento relevante queda en un log append-only (`run_events`).

---

# ⚙️ PROJECT CONFIGURATION — Configuración Editable

---

## Stakeholders

* **Owner**: Asdru (Agile Coach, Santex Group / Swiss Medical Group).
* **Futuro equipo**: se suma una vez validado el flujo end-to-end con un caso de negocio real. Sin stakeholders adicionales confirmados todavía.

---

## Risks & Assumptions

* **Supuesto**: Claude Code y Codex mantienen soporte de invocación headless con permisos configurables (verificado julio 2026); puede cambiar con evoluciones de producto de cada proveedor.
* **Resuelto**: alcance del primer incremento concreto. Milestone 1 se descompuso en 3 incrementos: (1) una fase real persistida — FEATURE-003, cerrada; (2) secuencia de 2+ fases con transición automática — en curso, FEATURE-004; (3) pipeline completo con loop Developer↔QA — pendiente.
* **Resuelto**: stack técnico del Orquestador — Node.js + TypeScript, PostgreSQL. Ver `02-ARCHITECTURE.md`, secciones 4 y 5.
* **Resuelto**: mecanismo exacto de invocación headless — **Claude Code CLI** (`claude -p`), no Agent SDK. Confirmado por el owner y validado empíricamente en el spike de FEATURE-001 (2026-07-16).
* **Resuelto**: autenticación headless de producción. El spike de FEATURE-001 (2026-07-16) confirmó, con una invocación real y sin ningún paso interactivo, que `ANTHROPIC_API_KEY` como variable de entorno (junto con `--bare`, que fuerza ese mecanismo e ignora OAuth/keychain) autentica al CLI correctamente y sostiene el mismo comportamiento de permisos read-only ya validado con OAuth. Esto sí es viable para el Executor corriendo headless en la VPS de producción, sin persona disponible. Detalle y evidencia: `docs/features/FEATURE-001-spike-results.md` (hallazgo H4, actualización 2026-07-16). Queda como nota operativa no bloqueante: definir el mecanismo de aprovisionamiento seguro de esa variable en la VPS (fuera del alcance de este spike).
* **Riesgo abierto**: política de limpieza automática de worktrees/branches vencidos (21 días) sin diseñar.
* **Riesgo abierto**: sistema sin validar todavía con un caso de negocio real end-to-end.
* **Riesgo abierto (derivado de FEATURE-003, hallazgo H9)**: comportamiento bajo invocaciones concurrentes de múltiples runs simultáneos, desde un proceso Node persistente, todavía no validado — solo se probaron invocaciones secuenciales.
* **Pendiente de diseño (roadmap, no bloqueante)**: evaluar si el pipeline necesita un segundo mecanismo de loop entre Architect↔Functional (además del ya definido Developer↔QA), para los casos donde Functional necesite que Architect revise o ajuste el diseño. Surgió en discusión durante el diseño del Incremento 2 (FEATURE-004) — deliberadamente no implementado ahí; de decidirse necesario, requeriría su propio límite de reintentos y condición de corte propia, no se asume por defecto ni por analogía con Developer↔QA.
* **Riesgo BLOQUEANTE (H14, FEATURE-005)**: los permisos híbridos de QA (`read-only` + `allowedCommands`) no confinan realmente qué comando de Bash se ejecuta — verificado con un intento de escape real (`git log -1` no autorizado, se ejecutó igual). No correr ningún caso de negocio real (fuera de pruebas descartables) a través del pipeline completo hasta resolver esto. Candidatos a investigar: wrapper de shell que valide el comando antes de ejecutarlo, o sandboxing a nivel de contenedor en vez de flags del CLI.
* **Pendiente de diseño (roadmap, no bloqueante) — selección de modelo por rol**: evaluar con evidencia real de FEATURE-005 si conviene asignar modelos distintos por rol del pipeline (ej. Haiku para QA, Sonnet para Developer/Architect/Functional/Planning) en vez de un único modelo fijo. Motivado por H12 (Haiku no siempre respeta convenciones de formato estrictas).
* **Pendiente de diseño (roadmap, no bloqueante) — Approval Model por Release**: evaluar agregar una cuarta configuración a "Approval Model" en `06-DELIVERY-WORKFLOW.md` — aprobación humana obligatoria al cierre de una Release, con autonomía del Orquestador para encadenar Features dentro de ella sin gate individual. Aplica al Orquestador ya construido operando sobre proyectos externos, no al proceso actual de construcción de este repositorio.

---

## Timeline / Milestones

* **Milestone 0 — cumplido**: VPS operativa, Docker Engine instalado, git configurado con deploy key de escritura, repositorio `ai-orchestrator` creado (vacío).
* **Milestone 1 — en curso**: descompuesto en 3 incrementos (ver Risks & Assumptions). Incremento 1 (schema completo de las 4 tablas + una fase real persistida) cumplido — FEATURE-003. Incremento 2 (secuencia de 2+ fases, transición automática) en curso — FEATURE-004.
* **Milestone futuro**: validación end-to-end con un caso de negocio real, previo a sumar al resto del equipo.

---

# 🧩 OPTIONAL EXTENSIONS — Extensiones Opcionales

Sin activar por el momento. Se podría considerar **Governance Mode** más adelante si el proyecto pasa a tener ownership compartido con Swiss Medical Group o Santex Group formalmente — hoy es iniciativa individual de Asdru.

---

# Principios del Charter

Orden de prioridad:

1. Problema
2. Objetivo
3. Alcance
4. Restricciones
5. Solución

La tecnología nunca debe definir el problema.
