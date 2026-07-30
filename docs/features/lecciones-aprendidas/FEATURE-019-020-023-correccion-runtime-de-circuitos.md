# Lecciones aprendidas — Corrección de runtime de circuitos (2026-07-29)

## Estado

Correctivo de runtime, no Feature de producto. Restituye garantías de FEATURE-019 y FEATURE-020
(y, por extensión, habilita la validación real de FEATURE-022, FEATURE-023 Parte 1/2 y FEATURE-024)
que el código no cumplía punta a punta. No agrega roles, circuitos ni capacidades de negocio.

Rama: `fix/circuit-escalation-context-and-gates` (commits `7267653` y siguientes). Mergeada a
`main` como parte de este cierre.

## Origen

Un handoff de triangulación independiente (`docs/research/HANDOFF-triangulacion-independiente-del-runtime-de-circuitos.md`)
pidió revisar, contra código, un diagnóstico previo (`docs/research/FEATURE-023-diagnostico-integral-de-circuitos-contexto-escalamientos-y-releases.md`)
sobre por qué una prueba E2E real fallaba después de aprobar el merge de una Feature. Ese
diagnóstico y su cruce con el Roadmap (`docs/research/cruce-del-diagnostico-integral-con-el-roadmap-del-orquestador.md`)
fueron el punto de partida; el alcance final de este bloque se acotó durante la conversación con
el owner a lo mínimo verificable sin arriesgar el E2E.

## Hallazgos confirmados contra código (no solo reportados)

1. **`featureJustCompleted` se envolvía en `functionalArtifact`.** `withRoleContext`
   (`src/cli/commands/runStart.ts`) envolvía cualquier contexto que no fuera un `ReentryContext`
   dentro de `{ functionalArtifact: incomingContext, ...shared }` — incluida la continuación
   natural de Feature `{ featureJustCompleted }`, que el prompt de Planning (`planning.txt`,
   Regla 5) exige recibir a nivel raíz. Confirmado leyendo ambos archivos directamente.

2. **Approval Gates entraban primero al retry automático.** `executePipelineRun` enviaba
   cualquier resultado `escalated` (incluida una propuesta de Roadmap de Architect o un
   `RELEASE_COMPLETO` de Planning) a `handleLinearEscalation` antes de que existiera ninguna
   clasificación de "esto es una decisión humana esperada, no un error". Esto producía hasta 3
   reinvocaciones automáticas del mismo rol antes de mostrar el Gate al humano.

3. **El retry automático no podía volver a Architect fuera de Circuito 1.** `handleLinearEscalation`
   reinicia el pipeline en curso desde `phaseIndex = 0`. Eso equivale a "volver a Architect" solo
   en `FULL_PIPELINE` (donde Architect es la fase 0) — pero `PLANNING_TO_QA` (Circuito 2/3, la
   continuación Feature→Feature dentro de un Release) no incluye a Architect como fase. Un
   escalamiento de Planning ahí se reintentaba contra sí mismo, sin poder alcanzar Architect, y
   terminaba escalando directo a Usuario sin haber consultado a Architect — contradiciendo el
   diagrama TO BE del owner (todo reintento vuelve a Architect por el conector "R").

4. **Los extractores de Gate rechazaban la forma real de Codex.** `extractRoadmapApproval`,
   `extractReleasePlanDeclaration` e `isReleaseCompletionEscalation` (`src/cli/escalation.ts`)
   exigían `typeof outputArtifact === "object"`. Codex está forzado por su propio
   `PHASE_RESULT_SCHEMA` (`src/executor/codexExecutor.ts`) a que `outputArtifact` sea siempre
   `string | null` — nunca objeto. Con Codex, estas tres funciones devolvían siempre
   `null`/`false`, sin importar lo que el rol hubiera declarado. Esto hacía que el fix del punto 2
   no funcionara para runs con Codex.

## Corrección aplicada

- **Fix 1** — `shapeRoleContext` (nuevo, puro, testeado) distingue `FeatureContinuationContext`
  (`isFeatureContinuationContext`, nuevo en `escalation.ts`) de un artifact real de Functional.
  `featureJustCompleted` viaja a nivel raíz, igual que un `ReentryContext`.
- **Fix 2** — `classifyGateEscalation` (nuevo en `escalation.ts`) clasifica `roadmap_approval` y
  `release_completion` antes de `handleLinearEscalation`. Ambos abren Gate humano de inmediato,
  sin retry automático previo. `merge_approval` no necesitaba este cambio: nunca pasa por el loop
  de fases de `executePipelineRun` (se construye aparte, en `continueReleaseAfterFeatureApproved`).
- **Fix 3** — `decideLinearEscalationKind` (nuevo, puro, testeado) distingue si el pipeline en
  curso incluye Architect. Cuando no lo incluye, `handleLinearEscalation` ya no reintenta en el
  lugar: resuelve el run actual (`updateRunStatus(..., "resolved")`, valor nuevo agregado al tipo)
  y crea/ejecuta automáticamente (sin esperar humano) un run hijo `FULL_PIPELINE` que arranca en
  Architect (`createArchitectReentryChildRun`), con el mismo `ReentryContext` que ya usa el
  reingreso humano de `respondService.ts`.
- **Fix 4** — `extractTaggedField` (nuevo en `escalation.ts`) permite a los 3 extractores de Gate
  leer tanto la forma objeto de Claude como la forma string real de Codex (misma convención
  "ETIQUETA: valor en su propia línea" que ya usa `extractStructuredValue` en
  `features/contracts.ts`).

## Qué quedó explícitamente fuera de este bloque (deuda conocida)

- **Contrato único de reentrada**: el retry en el lugar (cuando Architect sí está en el pipeline)
  sigue emitiendo `EscalationContext` (sin `targetAgentRole`/`attempt`/`originalVersionRef`); solo
  el caso de cruce de pipeline emite `ReentryContext`. Siguen coexistiendo dos formas — ver nota en
  FEATURE-012 del Roadmap.
- **Paridad de test para FEATURES/QA_RESULT/READINESS**: `features/contracts.ts` soporta ambas
  formas en código, pero ningún test ejercita la rama string real de Codex para esos tres
  contratos — deuda de cobertura, no de comportamiento. Ver nota en FEATURE-008 del Roadmap.
- **Transición a un Release siguiente**: la prueba E2E cerró un proyecto sin release siguiente; no
  se validó la transición a un Release siguiente real (contexto para Functional, aislamiento del
  Release Plan — FEATURE-028).
- **Release activo nominal tras cierre**: `activeReleaseId` del Roadmap queda apuntando al Release
  ya completado cuando se cierra un proyecto sin release siguiente — nuevo FEATURE-036.
- Todo lo demás fuera de este bloque y ya identificado por el diagnóstico original (paridad
  semántica exhaustiva Claude/Codex, transición durable Approval→Git→DB→run hijo, decisiones
  humanas estructuradas, detalle de error en UI, lifecycle de clone/worktree) permanece como estaba
  en el Roadmap — no se tocó a propósito.

## Validación

- `npx tsc --noEmit`: limpio.
- Suite completa (`npx tsx --test "src/**/*.test.ts"`): 173 tests, 164 pass, 9 skip (específicos de
  plataforma, esperados en Windows), 0 fail.
- **E2E real del owner (2026-07-29, proyecto `tempo-auto-planner`)**: primera corrida falló antes
  de este bloque (exactamente por los hallazgos 1-3); repetida después del fix, corrió de punta a
  punta — merge de Feature en Modo Manual → run hijo `PLANNING_TO_QA` → Planning recibió
  `featureJustCompleted` en raíz → `RELEASE_COMPLETO` reconocido como Gate sin retry automático
  previo (evento `escalation_gate_recognized`) → aprobación humana → `project_closed`. Validó de
  hecho, en el mismo recorrido, FEATURE-022, FEATURE-023 Parte 1, FEATURE-023 Parte 2 y
  FEATURE-024.

## Referencias

- `docs/research/HANDOFF-triangulacion-independiente-del-runtime-de-circuitos.md`
- `docs/research/FEATURE-023-diagnostico-integral-de-circuitos-contexto-escalamientos-y-releases.md`
- `docs/research/cruce-del-diagnostico-integral-con-el-roadmap-del-orquestador.md`
- `docs/ROADMAP.md` — FEATURE-008, 012, 019, 020, 022, 023 (Parte 1 y 2), 024, 028, 036
