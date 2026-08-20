# FEATURE-045 — Vista jerárquica y semántica de Casos de Negocio

**Versión de diseño:** v2 — incorpora validación adversarial contra código real (DAIA) y el ajuste
de Escenario 11/12 + Riesgos R1/R2 acordado con el owner antes de implementar.

**Estado:** ✅ Implementada (rama `feature/045-vista-jerarquica-casos`).

## 1. Feature Identity

- Name: Vista jerárquica y semántica de Casos de Negocio
- Type: Backend projection + Web UI
- Owner: asdru
- Priority: Media/Alta — precedente UX y estructural de la futura limpieza/purga de Casos.

Esta Feature no implementa eliminación.

## 2. Problem Statement

La pantalla `Casos` mostraba una lista plana de Runs, exponiendo UUID/status/fase/fecha como
información primaria, aunque el dominio ya tiene una estructura jerárquica real: Caso de Negocio →
Release → Feature → Run → Reingreso, identificable mediante `root_run_id`,
`originated_from_run_id`, identidad de Release (Roadmap) y lifecycle canónico de Feature.

## 3. Functional Goal

`GET /projects/:projectId/cases` proyecta esa estructura ya resuelta; el frontend
(`CasesList.tsx`) solo la representa (expandir/contraer, indentación, badges), sin reconstruir
ninguna relación de dominio.

La identidad técnica del Caso es `coalesce(root_run_id, id)`. El display name es
`rootRun.base_branch_name`, nunca la identidad de agrupación.

**Corrección de atribución (v2):** `root_run_id` es de FEATURE-020 (`migrations/0012_root_run_id.sql`,
2026-07-27); FEATURE-043 aportó `base_branch_name` (`migrations/0018_runs_base_branch_name.sql`).

## 4. Reglas funcionales (implementadas en `src/cases/caseTree.ts`)

1. `caseKey = coalesce(root_run_id, id)` — identidad del Caso.
2. `base_branch_name` es display name, nunca criterio de agrupación (dos Casos pueden llamarse `main`).
3. El Release visible se resuelve por contexto histórico del Caso (última versión de
   `release_roadmap` escrita por un run del mismo `caseKey`), nunca "el vigente hoy" del proyecto.
4. **Ownership explícito de Release** (hallazgo DAIA, cerrado en v2): un Release solo pertenece al
   Caso si `release_roadmap.changed_in_run_id → runs → coalesce(root_run_id, id) = caseKey`. La
   coincidencia de `project_id` no es suficiente. Implementado en
   `getReleaseRoadmapsForProjectAndUser` (`src/db/repository.ts`).
5. **Ownership explícito de Feature** (hallazgo DAIA, cerrado en v2): una Feature solo pertenece al
   Caso si `features.created_in_run_id → runs → caseKey` coincide. Solo dentro de ese subconjunto se
   usa `release_key` para asociarla a un Release. Implementado en `getFeaturesForProjectAndUser`.
6. `active_feature_id` explícito (P1) es autoritativo.
7. **Herencia determinística (P2)** — hallazgo DAIA, regla cerrada en v2: un Run con
   `active_feature_id = null` hereda la Feature del primer ancestro (`originated_from_run_id`) con
   `active_feature_id` no nulo, sin cruzar `caseKey`. Implementado en `resolveRunAssociations`.
8. Sin ancestro con Feature → sube de nivel (Release si se conoce, si no Caso). Nunca se inventa
   asociación por heurística de texto/summary/nombre de branch.
9. `originated_from_run_id` conserva causalidad local, pero nunca fuerza anidamiento cruzando
   Feature/Release/Caso (Regla 9/11) — implementado en `buildLocalForest`, que solo anida un Run bajo
   su padre técnico cuando ambos resolvieron al mismo bucket semántico.
10. Continuación normal (`PLANNING_TO_QA`) ≠ Reingreso. Reingreso a Architect (automático o manual)
    sí se etiqueta — ver `classifyRunKind`.
11. Un nuevo Release rompe la subordinación visual al Release anterior (garantizado por construcción:
    cada Release solo agrupa los Runs que resolvieron a él, sin importar el padre técnico).
12. Approval Gates (Roadmap, cierre de Release) no son nodos nuevos ni se etiquetan como Reingreso.
13. Backend resuelve (`src/cases/caseTree.ts`, función pura + repositorio), frontend solo representa
    (`web/src/intake/CasesList.tsx`).

## 5. Clasificación de Reingreso (`classifyRunKind`)

Hallazgo durante la implementación: **todo** child run creado por `respondEscalation`
(`src/cli/respondService.ts`) escribe el mismo evento `escalation_retry_context_prepared` en sí
mismo, sea una aprobación de Gate (Roadmap/cierre de Release) o una escalación real — no son
distinguibles por ese evento solo. La señal estructural que sí distingue ambos casos es
`escalation_gate_recognized` (evento discreto, campo `artifactId`, escrito en el run padre ANTES de
que el humano responda, vía `classifyGateEscalation`), correlacionado con el `parentArtifactId` que
el child guarda en su propio `escalation_retry_context_prepared`.

Regla implementada:
- Reingreso automático (`createArchitectReentryChildRun`): el padre tiene
  `escalation_cross_pipeline_reentry_prepared`.
- Reingreso manual: el child tiene `escalation_retry_context_prepared`, y el padre **no** tiene un
  `escalation_gate_recognized` con el mismo `artifactId` que el `parentArtifactId` del child.
- Si el padre sí cerró un Gate con ese `artifactId` → continuación normal, no Reingreso.

Sin texto de summary/artifact involucrado — solo `event_type` y campos discretos del payload,
conforme a la prohibición explícita de heurísticas de texto del diseño original.

## 6. Riesgos conocidos, fuera de este alcance (Escenario 11/12, R1/R2 — texto final acordado)

**R1/R2 — `release_key` no es identidad global del ciclo, y el write path no lo protege.**
Confirmado: ni `release_plans` ni `features` tienen `root_run_id`; sus rutinas de escritura
(`persistReleasePlanDocument`, `src/features/lifecycle.ts`) no filtran por ciclo al buscar la fila
existente. Si dos Casos del mismo proyecto reutilizan el mismo `release_key`, el write path puede
fusionar contenido de Release Plan entre Casos (mezcla silenciosa) o disparar una escalada cruzada al
redefinir una Feature ya activada de otro Caso (`FeatureLifecycleEscalationError`).

Esta Feature **no corrige la causa raíz** (bug de persistencia preexistente, no introducido acá).
Mitiga en lectura: la proyección nunca atribuye por error un Release/Feature a un Caso distinto del
que realmente lo creó (`created_in_run_id`/`changed_in_run_id → caseKey`), y decidió además no
depender de `release_plans` para la identidad de Release (usa `release_roadmap`, que sí está
correctamente scopeado por `root_run_id` desde FEATURE-036/legado) — reduce la exposición al bug de
escritura de `release_plans` en esta pantalla específica, aunque no lo elimina para `features`.

La corrección de fondo queda trackeada como **FEATURE-046** en `docs/ROADMAP.md` (⚪ Tentativo), con
una tarea de diseño separada ya lanzada.

**Escenario 11/12 actualizados:** la proyección atribuye correctamente cuando existen filas
separadas; si el write path ya fusionó/colisionó contenido antes de que exista algo que proyectar,
esta Feature no puede recuperar ni separar ese contenido — eso queda en FEATURE-046.

## 7. Decisión de implementación: identidad de Release vía Roadmap, no vía `release_plans`

El diseño original (Paso 4) sugería resolver Releases desde `release_plans`. Se decidió en
implementación usar `release_roadmap` (`project_config_versions`) como fuente de identidad
(`id`/`nombre`/`estado`/`alcanceResumen`) porque:

1. Ya tiene protección por ciclo (`root_run_id`) desde el fix de FEATURE-036 — no hereda el
   problema de R1.
2. Es la fuente donde el diseño original (§4.C) ya decía que vive la identidad/nombre de Release.
3. Evita acoplar la vista de Casos a la corrección pendiente de FEATURE-046.

`release_plans` no se consulta en esta Feature — su contenido (documento técnico) no forma parte del
alcance de esta pantalla.

## 8. Contrato del endpoint

`GET /projects/:projectId/cases` — evolucionado (no duplicado). Único consumidor detectado:
`web/src/intake/CasesList.tsx`. Antes: `{ runs: RunRow[] }`. Ahora:

```
{ cases: CaseTree[] }

CaseTree = { caseKey, displayName, createdAt, releases: CaseTreeRelease[], runs: CaseTreeRun[] }
CaseTreeRelease = { id, nombre, estado, alcanceResumen, features: CaseTreeFeature[], runs: CaseTreeRun[] }
CaseTreeFeature = { id, featureCode, name, runs: CaseTreeRun[] }
CaseTreeRun = { id, status, currentPhase, createdAt, kind: "run"|"reentry", children: CaseTreeRun[] }
```

## 9. Excluido (sin cambios respecto al diseño original)

Eliminación de Casos/Runs/artifacts, limpieza de DB/worktrees/branches, política de 21 días, cambios
al lifecycle de Features/Releases, tabla `cases` nueva, `runs.release_id`, `runs.semantic_feature_id`,
migración de Runs históricos, nuevo status agregado de Caso, búsqueda/filtros avanzados.

## 10. Validación técnica

12 tests unitarios en `src/cases/caseTree.test.ts` cubren Escenarios 1, 3, 5, 6, 9, 10, 11, 13 del
diseño original más la clasificación de `classifyRunKind` (reingreso automático, Gate ≠ reingreso,
escalación manual real = reingreso, continuación sin padre = run). 348/348 tests del repo pasan
(17 skips de plataforma, no relacionados). Typecheck limpio en backend y frontend.

Pendiente: validación E2E real contra la VPS con un Caso que recorra Release → Feature → Reingreso →
Feature resuelta → Feature 2, comparando el árbol visual contra la historia real (criterio ya
definido en el diseño original, sección 8, "Evidencia funcional esperada").
