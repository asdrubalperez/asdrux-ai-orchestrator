# FEATURE-004 — Resultados de Implementación (Secuencia de 2 Fases)

Versión: v1.0
Fecha de ejecución: 2026-07-17
Ejecutado por: Claude Code (asistente IA de desarrollo), contra Postgres real de la VPS (túnel SSH)
e invocaciones headless reales a Claude Code CLI — sin mocks.

Este documento es la evidencia de cierre exigida por `FEATURE-004-orchestrator-phase-sequence.md`
(sección 8).

---

## 0. Qué se construyó

- `src/pipelines/definitions.ts`: pipelines como datos versionados —
  `single-phase-architect@1` (FEATURE-003, sin cambios de comportamiento) y
  `two-phase-architect-functional@1` (nuevo: `architect` → `functional`, ambas read-only).
- `src/executor/roles/functional.txt`: roleInstructions productivas del rol Functional.
- `src/db/repository.ts`: generalizado — `ensurePipelineDefinition(spec)` reemplaza el
  hardcodeo de un único pipeline; nueva `updateRunCurrentPhase`.
- `src/cli/commands/runStart.ts`: reescrito para iterar genéricamente sobre
  `pipelineSpec.definition.phases`, con transición automática (`completed` → continúa,
  cualquier otro estado → corta el pipeline) y `--pipeline <nombre>` para elegir cuál correr
  (default `single-phase-architect`, preserva el comportamiento de FEATURE-003 sin cambios).

---

## 1. Validaciones reales

### 1.1 Regresión — pipeline de una sola fase (FEATURE-003) sigue funcionando

```
npm run cli -- run:start --case case_ok.json
[run:start] pipeline=single-phase-architect@1 (1 fase/s)
[run:start] status final: completed
```
Evidencia: `docs/features/evidence/FEATURE-004/run_single_phase_regression_status.json`. Sin
cambios de comportamiento respecto a FEATURE-003.

### 1.2 Transición automática exitosa (escenario principal)

```
npm run cli -- run:start --case case_ok.json --pipeline two-phase-architect-functional
[run:start] pipeline=two-phase-architect-functional@1 (2 fase/s)
[run:start] status final: completed
```

Evidencia: `docs/features/evidence/FEATURE-004/run_two_phase_completed_status.json`. Confirma:
- `run_events`: `run_started`, `phase_started:architect`, `phase_finished:architect`,
  `phase_started:functional`, `phase_finished:functional` — 2 fases persistidas de forma
  independiente y distinguible, en el orden real de ejecución.
- `artifacts`: una fila `architect/design` y una `functional/design`, cada una con su propio
  `outputArtifact` real (la de `functional` deriva de la propuesta de `architect`, recibida como
  `context`, tal como pide la Regla Funcional/Functional Goal).
- `runs.status: "completed"`, `runs.current_phase: "functional"` (la última fase ejecutada).

### 1.3 Corte por escalamiento — `functional` NO se invoca (escenario crítico)

```
npm run cli -- run:start --case case_ambiguo.json --pipeline two-phase-architect-functional
[run:start] fase "architect" terminó con status "escalated" — pipeline detenido, no se invoca la siguiente fase.
[run:start] status final: escalated
```

Evidencia: `docs/features/evidence/FEATURE-004/run_two_phase_escalated_cut_status.json`. La
Feature exige explícitamente confirmar **ausencia de invocación**, no solo de persistencia —
verificado así: `run_events` contiene únicamente `run_started`, `phase_started:architect`,
`phase_finished:architect`. **No existe ningún evento con `agentRole: "functional"`**, ni siquiera
`phase_started` — ese evento se registra en el código inmediatamente antes de invocar al Executor,
así que su ausencia total es evidencia directa de que la invocación a Claude Code para `functional`
nunca se ejecutó (no que "no se ve el resultado"). `runs.status: "escalated"`,
`runs.current_phase: "architect"` (nunca avanzó).

### 1.4 Aislamiento de código real

`docs/features/evidence/FEATURE-004/worktree_list_before_cleanup.txt` — los 3 runs de prueba
crearon cada uno su propia rama/worktree real. Worktrees y ramas eliminados al cierre, evidencia ya
capturada (mismo criterio que FEATURE-002/003).

---

## 2. Validation Criteria — verificación cruzada

| Escenario | Resultado |
|---|---|
| Transición automática exitosa | ✅ `functional` se invocó automáticamente, ambas fases persistidas |
| Corte por escalamiento en fase 1 | ✅ `functional` NO se invocó — confirmado por ausencia total de evento, no solo de artifact |
| Persistencia independiente por fase | ✅ 2 sets de eventos + 2 artifacts, distinguibles por `phase` |
| Consulta de progreso multi-fase | ✅ `run:status` lista los eventos/artifacts de ambas fases en orden |

---

## 3. Riesgos de la sección 9 — resultado

- **Riesgo de schema**: no requirió ajustes — `definition: { phases: [...] }` como JSONB alcanzó
  sin cambios de tipo/constraint.
- **Riesgo de corte real**: se comportó igual de limpio que el escalamiento de una sola fase
  (FEATURE-003) — mismo mecanismo de persistencia, sin casos especiales.
- **Supuesto validado**: encadenar 2 invocaciones reales al binario de Claude Code dentro del
  mismo proceso `run:start` **no reintrodujo H8** (FEATURE-003: resolución de `.exe` real vs. shim
  `.cmd` en Windows) — el binario se resuelve una vez por instancia de `ClaudeCodeExecutor` y
  ambas invocaciones (`architect` y `functional`) lo reutilizaron sin fricción.

---

## 4. Lecciones Aprendidas (06-DELIVERY-WORKFLOW.md, Stage 6)

**Específico de esta implementación:**
- La transición automática y el corte por escalamiento se comportaron exactamente como diseñado,
  sin sorpresas — no hay hallazgo nuevo tipo H10 que reportar en este incremento.
- El riesgo H9 (concurrencia de procesos, FEATURE-003) **sigue sin validar** — este incremento
  encadena 2 invocaciones **secuenciales** dentro de un mismo proceso corto, no invocaciones
  **concurrentes** desde un proceso persistente. No se fuerza ninguna conclusión al respecto; sigue
  abierto para cuando exista un Orquestador de larga duración (probablemente Incremento 3 o una
  Feature de UI/tiempo real).

**Decisiones de arquitectura del proyecto:**
- Ninguna ADR nueva en `02-ARCHITECTURE.md`. El diseño de `pipeline_definitions.definition` como
  arreglo de fases con transición "solo si completed" se sostuvo sin necesitar ajustes — no hay
  nada que corregir en la arquitectura a partir de este incremento.

**Candidato a conocimiento reusable del AI-Playbook Base:**
- Ninguno identificado en este incremento. A diferencia de FEATURE-003 (H8), no surgió ningún
  hallazgo de integración generalizable más allá de este proyecto.

---

## 5. Conclusión

El segundo incremento de Milestone 1 funciona end-to-end: transición automática entre fases
condicionada estrictamente al `status` de la fase anterior, sin loops, con corte verificado por
ausencia explícita de invocación (no solo de persistencia) ante escalamiento. No se encontraron
hallazgos nuevos que obliguen a ajustar el contrato o la arquitectura. El riesgo de concurrencia de
procesos (H9) permanece abierto y explícitamente no resuelto por este incremento.
