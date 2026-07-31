# FEATURE-028 — Release Plan asociado inequívocamente al Release activo

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: diseño original de ARIA (AI Product Architect), revisado y validado
> técnicamente contra el código real antes de aprobar la implementación. Aprobado con dos ajustes
> incorporados al documento antes del handoff: (1) la garantía de "como máximo un `release_roadmap`
> pinneado por run" depende de la disciplina del código llamador (`recordRunConfigVersions` se
> invoca una única vez por run + índice único parcial), no de una constraint de base de datos —
> documentado explícitamente; (2) la comparación final (¿coincide el release y el ciclo de negocio?)
> se implementa como función pura y exportada, separada de la consulta SQL, mismo criterio que
> `validateFinalReleasePlanTransition` de FEATURE-038.

---

## 1. Feature Identity

- **Name**: Release Plan asociado inequívocamente al Release activo
- **Type**: Lifecycle Consistency / Context Integrity
- **Owner**: asdru
- **Status**: Implementada — pendiente de validación E2E real en VPS antes de merge a `main`
- **Priority**: P1
- **Origin**: Hallazgo de la validación E2E de FEATURE-036, Discovery cerrado durante FEATURE-038
- **Related Features**: FEATURE-018, FEATURE-019, FEATURE-020, FEATURE-036, FEATURE-038

---

## 2. Problem Statement

`withRoleContext` (el runtime que arma el contexto de Planning) obtenía el `release_roadmap` vigente
y el `release_plan` vigente de forma independiente y los combinaba sin verificar que el plan
perteneciera al mismo release que el roadmap activo. Al cerrar un release y activar el siguiente
(FEATURE-036/038 ya corrigen el cierre en sí), el `release_plan` final del release recién cerrado
seguía siendo la única versión vigente hasta que Planning produjera el primer plan del release
nuevo — así que la primera invocación de Planning en el release nuevo podía recibir el
`activeRelease` correcto junto con el plan completo del release anterior, y reaparecían Features ya
cerradas bajo el release siguiente.

---

## 3. Functional Goal

Planning solo recibe un `releasePlan` no nulo cuando el Orquestador puede demostrar, con datos ya
persistidos y auditables, que ese plan fue escrito bajo el mismo release que está activo ahora — sin
inferencias por nombre, orden o timestamp. Cuando no coincide (o no puede resolverse la asociación),
recibe `releasePlan: null` y trata esa invocación como la primera del release, sin heredar ninguna
Feature del anterior. El historial de planes de releases cerrados no se borra ni se altera.

---

## 4. Scope

### Included

- Nueva función de repositorio `getReleasePlanAssociationCandidate(projectId)` que resuelve, en una
  sola consulta, el `release_plan` vigente junto con el `activeReleaseId` que tenía pinneado el
  roadmap del run que lo escribió y el `root_run_id` de ese run y del ciclo de negocio vigente
  (mismo patrón `current_epoch` que `getReleasePlansByRelease`, FEATURE-036).
- Nueva función pura `resolveReleasePlanForActiveRelease` que decide, sin I/O, si ese candidato
  corresponde al release activo actual: exige coincidencia de `activeReleaseId` **y** de
  `root_run_id`/ciclo de negocio.
- `withRoleContext` usa ambas piezas en vez de leer `release_plan` vigente a secas.
- Refuerzo mínimo de `planning.txt`: `releasePlan: null` tras un cambio de release se trata como
  primera invocación, nunca como pérdida de datos.

### Excluded

Agregar `releaseId` a `ReleasePlanPayload`, cambiar el contrato/parser de Planning, borrar o
sobrescribir el plan del release anterior, crear tablas o migraciones SQL, modificar FEATURE-038 o
`release_roadmap`, reparar automáticamente planes históricos ya contaminados, resolver FEATURE-030.

---

## 5. Functional Rules

Ver diseño completo (18 reglas) — resumen de las determinantes: el release activo se resuelve
exclusivamente desde `release_roadmap` vigente vía `activeReleaseFromRoadmap` (Regla 1); el release
del plan se resuelve desde el `release_roadmap` pinneado al run que lo escribió, nunca por
inferencia (Reglas 2-4); coincidencia exacta de ambos IDs, `null` si difieren o no puede resolverse
(Reglas 5-8); no se borra ni fusiona ningún plan — la decisión es binaria, entregar completo o `null`
(Reglas 9-10); primera invocación de un release nuevo recibe `null` y arranca desde
`functionalArtifact` (Regla 11); continuaciones del mismo release reciben el plan normalmente una
vez que Planning ya escribió el primero (Regla 12); el cierre de FEATURE-038 sigue asociado al
release que se cerraba, deja de entregarse al activar el siguiente (Reglas 13-14); proyecto cerrado
(`activeReleaseId: null`) nunca entrega un plan histórico (Regla 15); sin corrección/migración
automática de datos históricos (Reglas 16-17); sin cambio de contrato de Planning (Regla 18).

---

## 6. Technical Considerations

- `src/db/repository.ts`: nueva función `getReleasePlanAssociationCandidate(projectId)` —
  reutiliza el mismo CTE `current_epoch` que `getReleasePlansByRelease` (FEATURE-036), pero resuelve
  un único candidato (el plan vigente) en vez de historial agrupado. Devuelve
  `{ value, pinnedActiveReleaseId, writerRootRunId, currentEpochRootRunId } | null`.
- `src/cli/commands/runStart.ts`: nueva función pura exportada `resolveReleasePlanForActiveRelease`
  — sin I/O, testeable sin DB — decide si el candidato corresponde al release activo (mismo
  `activeReleaseId` **y** mismo `root_run_id`). `withRoleContext` la usa junto con
  `getReleasePlanAssociationCandidate` en vez de la lectura directa anterior.
- `planning.txt`: una aclaración — `releasePlan: null` tras un cambio de release es la primera
  invocación de ese release, nunca una pérdida de datos; Planning no debe copiar Features del
  release anterior.
- Nota documentada explícitamente (ajuste de aprobación): la garantía de "como máximo un
  `release_roadmap` vigente pinneado por run" depende de que `recordRunConfigVersions` se invoque
  exactamente una vez por run (confirmado: 4 call sites, todos justo tras `createRun`) combinado con
  el índice único parcial `one_current_project_config` — no hay una constraint de base de datos que
  lo garantice estructuralmente; un futuro call site adicional podría romper este supuesto.

---

## 7. Validation Criteria

16 escenarios según el diseño original (plan del mismo release, plan del release anterior, primer
plan del nuevo release, cierre de FEATURE-038 seguido de activación del siguiente, continuación
dentro del mismo release, proyecto sin release activo, plan sin `changed_in_run_id`/roadmap
pinneado/payload inválido, mismo ID literal con ciclo distinto, UI conserva historial, no
contaminación de Features entre releases, regresión de FEATURE-038, reingreso/run hijo, consulta sin
duplicados).

### Validation Evidence

**Automatizada**: 7 tests nuevos, función pura sin mocks —
`resolveReleasePlanForActiveRelease`: mismo release y ciclo → entrega el plan; release distinto →
`null`; sin release activo → `null`; sin plan resoluble → `null`; roadmap pinneado sin release
activo → `null`; mismo ID literal con `root_run_id` distinto (colisión entre ciclos de negocio) →
`null`; mismo ciclo y mismo ID → entrega el plan. Suite completa: 234 tests, 224 pass, 10 skip
(específicos de plataforma en Windows), 0 fail. `tsc --noEmit` limpio.

**Pendiente antes de merge a `main`**: evidencia E2E real en VPS con un Roadmap de al menos dos
releases — confirmar que, al activar el segundo release, la primera invocación de Planning recibe
`releasePlan: null` (no el plan del release anterior) y que el primer `RELEASE_PLAN` que declara
contiene únicamente Features del release nuevo, sin arrastrar las del anterior. Confirmar además,
vía la UI o consulta directa a `project_config_versions`, que el historial del release anterior
sigue disponible y sin alterar.

---

## 8. Risks

Ver diseño original (10 riesgos) — los más relevantes: IDs de release reutilizados entre ciclos de
negocio no relacionados (mitigado exigiendo coincidencia de `root_run_id` además del ID literal);
planes históricos sin `changed_in_run_id` resoluble (mitigado con `releasePlan: null`, sin migrar
datos); consulta compleja de mantener (mitigado reutilizando el patrón ya probado de
`getReleasePlansByRelease`); falso reset dentro del mismo release (mitigado con tests de
continuación y evidencia E2E de varias Features); dependencia de que `run_config_versions` registre
correctamente el pineo — ya confirmado como parte del modelo vigente, no introducido por esta
Feature.

---

## 9. Approval Gate

Aprobado por el owner, con los dos ajustes de la nota de proceso incorporados al documento antes del
handoff de implementación. Pendiente de validación E2E real en VPS antes de mergear a `main`.

---

## Estado de la implementación

**Implementada** en rama `feature/028-release-plan-asociado-al-release-activo` — pendiente de
validación real en VPS antes de mergear a `main`. `tsc --noEmit` y suite completa (234 tests)
verificados en la rama.
