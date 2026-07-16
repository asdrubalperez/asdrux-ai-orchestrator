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
* **Riesgo abierto**: alcance del primer incremento concreto todavía no definido.
* **Riesgo abierto**: stack técnico del Orquestador sin elegir (lenguaje/framework, SQLite vs Postgres para arrancar).
* **Riesgo abierto**: mecanismo exacto de invocación headless sin definir (Agent SDK vs CLI para Claude Code).
* **Riesgo abierto**: política de limpieza automática de worktrees/branches vencidos (21 días) sin diseñar.
* **Riesgo abierto**: sistema sin validar todavía con un caso de negocio real end-to-end.

---

## Timeline / Milestones

* **Milestone 0 — cumplido**: VPS operativa, Docker Engine instalado, git configurado con deploy key de escritura, repositorio `ai-orchestrator` creado (vacío).
* **Milestone 1 — próximo, alcance pendiente de definir**: probablemente schema de las 4 tablas + ciclo básico de invocación con un solo adaptador (Claude Code), sin UI todavía.
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
