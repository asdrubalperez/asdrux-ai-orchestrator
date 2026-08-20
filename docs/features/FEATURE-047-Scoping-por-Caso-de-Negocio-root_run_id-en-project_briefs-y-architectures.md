# FEATURE-047 — Scoping por Caso de Negocio (`root_run_id`) en `project_briefs` y `architectures`

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: mismo diagnóstico y mismo patrón de fix que FEATURE-046 (`root_run_id` en
> `release_plans`/`features`/`project_config_versions`, ya implementada y mergeada a `main`, commit
> `a92c8de`), aplicado a las dos tablas que quedaron explícitamente fuera de su alcance:
> `project_briefs` y `architectures`. **Reproducido en vivo el 2026-08-20**, durante la validación
> E2E de FEATURE-046 (ver sección 2 y evidencia real referenciada ahí). La prueba se frenó antes de
> aprobar el Gate que hubiera disparado la sobrescritura real, así que el bug quedó confirmado contra
> la DB del VPS pero sin pérdida de datos real. Documentado como hallazgo de seguimiento en
> `docs/ROADMAP.md` (commit `472d027`) el mismo día.

---

## 1. Feature Identity

- **Name**: Scoping por Caso de Negocio (`root_run_id`) en `project_briefs` y `architectures`
- **Type**: Data Integrity / Lifecycle Consistency
- **Owner**: asdru
- **Status**: 🟢 Implementado y validado end-to-end en producción real (VPS) — listo para mergear a
  `main`
- **Priority**: Propuesta **P0** — mismo criterio que FEATURE-046: hoy el sistema no soporta más de
  un Caso de negocio activo por proyecto a la vez, y en este caso concreto la consecuencia no es solo
  una lectura confusa sino **pérdida silenciosa de contenido** (el segundo Caso sobrescribe el
  Project Brief/Architecture del primero al completar la fase de Architect)
- **Origin**: Hallazgo en vivo durante la validación E2E de FEATURE-046, 2026-08-20 (mismo mecanismo,
  documentado en `docs/ROADMAP.md` commit `472d027`)
- **Related Features**: FEATURE-033 (`project_briefs`), FEATURE-034 (`architectures`), FEATURE-046
  (mismo bug, mismo fix, en `release_plans`/`features`/`project_config_versions` — precedente de
  diseño directo para esta Feature), FEATURE-045 (Vista jerárquica de Casos de Negocio, origen
  indirecto de ambos hallazgos), FEATURE-020 (introduce `root_run_id` en `runs`)

---

## 2. Problem Statement

`project_briefs` (`migrations/0025_project_brief_lifecycle.sql`) y `architectures`
(`migrations/0026_architecture_lifecycle.sql`) tienen `unique(project_id)` — literalmente **una sola
fila por proyecto**, sin ninguna columna de ciclo/Caso de negocio, pese a tener `created_in_run_id
not null` (igual que `release_plans`/`features` antes del fix de FEATURE-046).

`persistProjectBrief` (`src/features/projectBriefLifecycle.ts:58-64`) busca la fila existente con
`where project_briefs.project_id = $1` (sin ningún filtro de Caso):

```sql
select project_briefs.*, artifacts.content -> 'payload' as last_payload
from project_briefs
left join artifacts on artifacts.id = project_briefs.canonical_artifact_id
where project_briefs.project_id = $1
for update of project_briefs
```

Si encuentra una fila y el payload difiere del último que la escribió, la actualiza **en el
lugar** (`update project_briefs set canonical_artifact_id = ... where id = $6`, líneas 118-132) —
sobrescritura silenciosa, sin ningún error ni escalación, del documento que pertenecía a otro Caso.
`persistArchitecture` (`src/features/architectureLifecycle.ts:72-154`) tiene exactamente el mismo
patrón sobre `architectures`, con el mismo `where architectures.project_id = $1` (línea 76) y el
mismo `update ... where id = $6` (líneas 140-154). A diferencia de `features`
(`FeatureLifecycleEscalationError` si la fila ya está `activated_at != null`), acá **no existe ningún
mecanismo de escalación** — ambas funciones asumen sin condición que la única fila del proyecto les
pertenece.

Los tres read-paths de cada tabla tienen el mismo patrón sin scoping de Caso:
`materializeProjectBriefDocument`/`materializeArchitectureDocument` (`where ...project_id = $1`,
sin `runId`) y `getProjectBriefDocumentForRun`/`getArchitectureDocumentForRun` (`join ... on
project_briefs.project_id = runs.project_id`, es decir: cualquier run del proyecto ve la única fila
existente, sin importar a qué Caso pertenece).

A diferencia de `release_plans`/`features` (FEATURE-046 sección A) y de `project_config_versions`
(FEATURE-046 sección B), estas dos tablas son **de producción única**: no hay acumulación
(`mergeFeaturePlan`) ni revisiones append-only en v1 — cada tabla tiene exactamente un productor
(Architect) y un solo puntero canónico vigente por fila. Esto simplifica el fix: no hay casos de
merge/acumulación que auditar dentro del mismo Caso, solo aislamiento entre Casos distintos.

### Reproducción real (2026-08-20)

Durante la validación E2E de FEATURE-046, en el mismo proyecto **"Proyecto de Prueba"**
(`project_id 0145ec09-46f4-43bf-ac19-f28a2ea1c0cd`):

- El primer Caso de negocio (`root_run_id 2c7b42d9-82f6-48f6-b507-425afba45948`) ya tenía su Project
  Brief y su Architecture materializados, con `created_in_run_id 9d0f301e-...` (un run de ese mismo
  Caso).
- Se creó un segundo Caso de negocio real sobre el mismo proyecto (`root_run_id
  7059ce2e-0100-4e89-a4ea-85e2a10cee56`).
- La pantalla de detalle del run del segundo Caso (`RunDetailPage`, vía `GET /runs/:id` →
  `getProjectBriefDocumentForRun`/`getArchitectureDocumentForRun`) mostró como **"materializados"**
  el Project Brief y la Architecture del **primer** Caso.
- Confirmado contra la DB real del VPS: solo existe una fila de cada tabla para ese `project_id`,
  perteneciente al primer Caso.
- La prueba se frenó **antes** de aprobar el Gate de Roadmap del segundo Caso, precisamente porque
  Architect materializa estos documentos al completar su fase — aprobar el Gate habría disparado la
  sobrescritura real y perdido el contenido del primer Caso.

Estos IDs reales (`project_id`, ambos `root_run_id`) quedan documentados acá para poder re-verificar
contra la DB del VPS si hace falta, con el mismo criterio que usó FEATURE-046 sección 7 para su
propia reproducción.

---

## 3. Functional Goal

Un proyecto con **N** Casos de negocio, concurrentes o no, mantiene su Project Brief y su
Architecture completamente aislados por Caso:

- Cada Caso obtiene su propia fila en `project_briefs` y en `architectures`, sin importar si otro
  Caso del mismo proyecto ya tiene la suya — aislamiento garantizado por constraint `unique` en la
  base, no solo por lógica de aplicación.
- Un run de un Caso nunca lee ni sobrescribe el Project Brief/Architecture de otro Caso del mismo
  proyecto — ni al persistir (Architect), ni al materializar en el worktree, ni al leer desde la
  vista de detalle de run.
- La pantalla de detalle de run de un Caso muestra únicamente el Project Brief/Architecture de **ese
  Caso** (materializado o no), nunca el de un Caso ajeno del mismo proyecto.

---

## 4. Scope

### Included

- Columna nueva `root_run_id uuid references runs(id)` en `project_briefs` y en `architectures`,
  calculada **una sola vez**, en el momento de creación de la fila, a partir del run que la crea:
  `coalesce(runs.root_run_id, runs.id)` — mismo patrón, mismo helper (`getRunRootRunId`, ya existente
  en `src/db/repository.ts:305-313` desde FEATURE-046) y misma expresión ya usada por
  `created_in_run_id` (columna hermana) en ambas tablas.
- Backfill determinístico vía `created_in_run_id` (columna `not null` en ambas tablas hoy) +
  `alter column root_run_id set not null` — sin ambigüedad posible, igual que el alcance A de
  FEATURE-046 (a diferencia de `project_config_versions`, que sí necesitó `root_run_id` nullable).
- Constraint `unique(project_id)` de ambas tablas → `unique(project_id, root_run_id)`.
- Lookups de escritura scoped por `root_run_id`: `persistProjectBrief`, `persistArchitecture` —
  agregan el predicado `and root_run_id = $n` a su `select ... for update`, y resuelven el
  `root_run_id` del run en contexto vía `getRunRootRunId` antes del `select`/`insert` (mismo criterio
  ya usado por `persistArchitecture` para `currentApprovedRoadmap`, líneas 62-65 de
  `architectureLifecycle.ts` — este archivo ya resuelve y usa `rootRunId` en esta misma función, solo
  falta propagarlo también al lookup/insert de `architectures`).
- Read-paths scoped por `root_run_id`: `materializeProjectBriefDocument`/
  `materializeArchitectureDocument` ganan un parámetro `runId` (para poder resolver `root_run_id` del
  Caso en curso — hoy ambas reciben `projectId` pero no `runId`; sus dos call-sites en `runStart.ts`
  ya tienen `runId` en scope, así que el cambio es agregar el argumento, no conseguir el dato).
  `getProjectBriefDocumentForRun`/`getArchitectureDocumentForRun` ya reciben `runId` — su `join`
  agrega `and project_briefs.root_run_id = ...` resolviendo `root_run_id` del propio `runId` (vía un
  `join` a `runs` que la consulta ya hace, sin necesitar una consulta separada).
- Auditoría de datos reales (solo lectura, sin reparación automática) antes de desplegar — mismo
  criterio que FEATURE-046 sección 7.

### Excluded

- Cambiar el contrato de generación del Project Brief o de la Architecture (Runbook, templates,
  Architect) — el scoping se resuelve enteramente del lado del Orquestador, igual que FEATURE-046.
- Reparar retroactivamente contenido ya sobrescrito en filas contaminadas — no aplica hoy: la
  reproducción real de la sección 2 se frenó antes de que ocurriera la sobrescritura, así que no hay
  evidencia de datos reales corrompidos que reparar. Si la auditoría de la sección 7 encuentra algún
  caso histórico real, se documenta como Feature de seguimiento independiente (mismo precedente que
  FEATURE-038 saliendo de FEATURE-036, y que este mismo documento saliendo de FEATURE-046).
- Introducir acumulación o revisiones append-only dentro del mismo Caso para Project Brief/
  Architecture — siguen siendo de único productor sin historial versionado en v1, sin cambios de
  ese comportamiento; el historial de contenido se sigue conservando únicamente vía las filas
  inmutables de `artifacts` (mismo diseño ya documentado en el comentario de cabecera de
  `migrations/0025`/`0026`).
- Cualquier mecanismo de escalación tipo `FeatureLifecycleEscalationError` — no aplica: a diferencia
  de `features`, acá no existe hoy ningún escenario legítimo de "redefinición dentro del mismo Caso"
  que debiera escalar; una vez scoped por `root_run_id`, la única fila del Caso simplemente se
  actualiza in-place como ya hace hoy (comportamiento sin cambios dentro de un mismo Caso).
- Runs con `root_run_id` legado en `NULL` (anteriores a la migración 0012/FEATURE-020) no reciben
  tratamiento especial — `coalesce(root_run_id, id)` ya los trata como su propio epoch, igual que en
  FEATURE-046.
- Soporte de UI para que un usuario elija/cambie entre Casos concurrentes de un mismo proyecto — eso
  sigue siendo decisión de producto de FEATURE-045; esta Feature solo garantiza que la capa de
  persistencia debajo no los mezcle.

---

## 5. Functional Rules

1. `root_run_id` de una fila de `project_briefs`/`architectures` se fija una única vez, al crearla,
   como `coalesce(runs.root_run_id, runs.id)` del run que la crea — igual que `created_in_run_id` —,
   y nunca se actualiza después.
2. Dos runs de epochs (`root_run_id`) distintos nunca pueden matchear la misma fila de
   `project_briefs` ni la misma fila de `architectures`, aunque pertenezcan al mismo `project_id` —
   garantizado por constraint `unique(project_id, root_run_id)` en la base.
3. Dentro del mismo epoch (mismo Caso), el comportamiento existente no cambia: la fila se actualiza
   in-place en cada fase de Architect que produzca contenido distinto, sin escalación ni error.
4. El backfill asigna `root_run_id` de forma determinística a partir del `created_in_run_id` propio
   de cada fila; ninguna fila queda en `NULL` después de la migración.
5. `materializeProjectBriefDocument`/`materializeArchitectureDocument` materializan siempre el
   documento del Caso del `runId` que las invoca, nunca el de otro Caso del mismo proyecto.
6. `getProjectBriefDocumentForRun`/`getArchitectureDocumentForRun` devuelven siempre el documento del
   Caso al que pertenece el `runId` consultado (o `null`/no materializado si ese Caso todavía no
   generó el suyo), nunca el de otro Caso del mismo proyecto.

---

## 6. Technical Considerations

### Migraciones

`migrations/0030_project_briefs_architectures_root_run_id_scope.sql` (siguiente número disponible
tras `0029_project_config_versions_root_run_id_scope.sql`):

1. `alter table project_briefs add column root_run_id uuid references runs (id);`
   `alter table architectures add column root_run_id uuid references runs (id);`
2. Backfill (idéntico patrón que FEATURE-046, sección 6):
   ```sql
   update project_briefs pb
   set root_run_id = coalesce(r.root_run_id, r.id)
   from runs r
   where r.id = pb.created_in_run_id;

   update architectures a
   set root_run_id = coalesce(r.root_run_id, r.id)
   from runs r
   where r.id = a.created_in_run_id;
   ```
3. `alter table project_briefs alter column root_run_id set not null;`
   `alter table architectures alter column root_run_id set not null;`
4. `alter table project_briefs drop constraint project_briefs_project_id_key, add constraint
   project_briefs_project_id_root_run_id_key unique (project_id, root_run_id);` (nombre real de
   constraint a confirmar con `\d project_briefs` al implementar — Postgres nombra automáticamente el
   `unique(project_id)` original al crear la tabla). Mismo patrón para `architectures`.

### Código de aplicación

- `src/db/repository.ts`: sin cambios de fondo — reutiliza `getRunRootRunId(client, runId)`, ya
  existente desde FEATURE-046 (líneas 305-313).
- `src/features/projectBriefLifecycle.ts`:
  - `ProjectBriefRow` gana `root_run_id: string`.
  - `persistProjectBrief`: resuelve `const rootRunId = await getRunRootRunId(client, params.runId)`
    justo después de validar que el run pertenece al proyecto (línea 54-56); el `select ... for
    update of project_briefs` (líneas 58-64) agrega `and project_briefs.root_run_id = $2`; el
    `insert` (líneas 82-99) agrega la columna `root_run_id`.
  - `materializeProjectBriefDocument`: gana parámetro `runId: string`; resuelve `rootRunId` y agrega
    `and project_briefs.root_run_id = $2` a su `select` (línea 153-159).
  - `getProjectBriefDocumentForRun`: su `join` ya parte de `runs` (línea 199) — agrega `and
    project_briefs.root_run_id = coalesce(runs.root_run_id, runs.id)` directamente en el `join`
    (línea 200), sin necesitar una consulta separada a `runs`.
- `src/features/architectureLifecycle.ts`: mismos cuatro cambios, en espejo exacto, sobre
  `ArchitectureRow`/`persistArchitecture`/`materializeArchitectureDocument`/
  `getArchitectureDocumentForRun`. `persistArchitecture` ya resuelve `rootRunId` en su línea 64 (para
  `currentApprovedRoadmap`) — se reutiliza la misma variable para el `select`/`insert` de
  `architectures`, sin resolverla dos veces.
- `src/cli/commands/runStart.ts`: los dos call-sites de materialización (líneas 600 y 613) agregan
  `runId` al llamado — ambos ya tienen `runId` en scope en la misma función (usado inmediatamente
  antes en `persistProjectBrief`/`persistArchitecture`, líneas 591/606).
- `src/server/app.ts`: `getProjectBriefDocumentForRun(runId)`/`getArchitectureDocumentForRun(runId)`
  (líneas 1057-1058) — sin cambio de firma en el call-site, ya reciben `runId`; el scoping ocurre
  dentro de la función misma (ver arriba).

---

## 7. Validation Criteria

1. Dos Casos (`root_run_id` A y B) del mismo proyecto corren Architect y producen cada uno su propio
   Project Brief/Architecture → dos filas por tabla, sin sobrescritura cruzada.
2. Dentro del mismo Caso, una segunda fase de Architect con contenido distinto sigue actualizando la
   misma fila in-place, sin cambios de comportamiento (regresión contra tests de FEATURE-033/034).
3. `materializeProjectBriefDocument`/`materializeArchitectureDocument` materializan siempre el
   documento del `runId` invocante, nunca el de otro Caso del mismo proyecto.
4. `getProjectBriefDocumentForRun`/`getArchitectureDocumentForRun` — el Caso B, antes de que Architect
   complete su propia fase, ven `materialized: false`/documento propio ausente, **no** el del Caso A,
   aunque A ya tenga el suyo materializado.
5. Reproduce el escenario exacto de la reproducción real de 2026-08-20 (dos Casos del mismo proyecto,
   uno con Project Brief/Architecture ya materializados, otro nuevo) y confirma que la vista de
   detalle de run del segundo Caso deja de mostrar los documentos del primero.
6. Backfill: toda fila preexistente queda con `root_run_id` no nulo y correcto.
7. Constraint nuevo enforced a nivel de base: dos filas del mismo proyecto con `root_run_id`
   distintos coexisten; dos intentos de insertar con el mismo `(project_id, root_run_id)` violan el
   constraint (no debería poder ocurrir en la práctica dado que `persistProjectBrief`/
   `persistArchitecture` primero buscan la fila existente del Caso antes de insertar, pero el
   constraint es la garantía real, no la lógica de aplicación).

### Validation Evidence

**Auditoría de datos reales** (solo lectura, antes de desplegar): comparar epoch de
`created_in_run_id` contra el epoch de la última escritura conocida (`source_event_key`) de cada fila
existente de `project_briefs`/`architectures` — mismo criterio que usó FEATURE-046 sección 7 para
`release_plans`/`features`. Dado que ambas tablas tienen hoy una sola fila por proyecto (constraint
`unique(project_id)` vigente), cualquier proyecto con más de un Caso de negocio que haya llegado a la
fase de Architect es candidato a revisar manualmente si el contenido actual corresponde al Caso más
reciente o a uno anterior ya sobrescrito.

**Automatizada** (a definir en implementación): tests de integración contra DB real (sin mocks) sobre
`persistProjectBrief`/`persistArchitecture`/`materializeProjectBriefDocument`/
`materializeArchitectureDocument`/`getProjectBriefDocumentForRun`/`getArchitectureDocumentForRun` con
dos runs raíz de `root_run_id` distinto sobre el mismo proyecto — mismo criterio que
`src/db/projectConfigScoping.test.ts` (agregado durante la validación de FEATURE-046 precisamente
porque faltaba en el diseño original evidencia de que el fix resuelve el bug, no solo de que no
regresiona).

**E2E real en VPS** (a definir en implementación): repetir el escenario real de la reproducción de
2026-08-20 — proyecto `0145ec09-46f4-43bf-ac19-f28a2ea1c0cd`, Caso A `root_run_id
2c7b42d9-82f6-48f6-b507-425afba45948`, Caso B `root_run_id 7059ce2e-0100-4e89-a4ea-85e2a10cee56` — en
la rama con el fix, llegando esta vez hasta aprobar el Gate de Roadmap del segundo Caso, y confirmar
que el Project Brief/Architecture del primer Caso sobreviven intactos.

---

## 8. Risks

- Mismo riesgo operativo que FEATURE-046 mientras esta Feature no esté implementada: un segundo Caso
  de negocio sobre un proyecto que ya tiene Project Brief/Architecture materializados perderá esos
  documentos en cuanto su propio Architect complete la fase correspondiente — mitigado hoy únicamente
  porque el hallazgo quedó documentado en `docs/ROADMAP.md` (commit `472d027`) como advertencia
  operativa, sin ningún bloqueo real a nivel de aplicación.
- La auditoría de datos reales (sección 7) no puede reconstruir con certeza qué contenido pertenecía
  a qué Caso en filas ya sobrescritas antes de esta Feature — mismo límite que
  `project_config_versions` en FEATURE-046 sección 8: no hay log explícito de "qué Caso pisó a cuál"
  en `project_briefs`/`architectures` (a diferencia de `release_plans`/`features`, que sí tienen
  rastro vía `feature_revisions.producer_run_id`). Best-effort únicamente vía comparación de epochs.
- `root_run_id` no cambia ningún contrato externo (Runbook, payloads de Architect) — el scoping es
  enteramente interno al Orquestador, mismo criterio que FEATURE-046.
- Superficie de cambio acotada (dos tablas gemelas, cuatro funciones por tabla, dos call-sites de
  materialización, un call-site de lectura ya parametrizado por `runId`) — riesgo bajo de dejar algún
  call-site sin actualizar, a diferencia del alcance B de FEATURE-046 (~12 call-sites de lectura
  dispersos en varios archivos).

---

## 9. Approval Gate

**Aprobado por el owner (2026-08-20)**, verificado punto por punto contra el código real
(`select` sin scoping en `persistProjectBrief`/`persistArchitecture`, `persistArchitecture` ya
resolviendo `rootRunId` en su línea 63/64 antes del fix, call-sites de materialización en
`runStart.ts` ya con `runId` en scope) antes de aprobar.

---

## 10. Estado de la implementación

🟢 **Implementado y validado end-to-end en producción real (rama
`feature/047-scoping-caso-negocio-briefs-architectures`, commit `96c3fc6`).**

- Migración `0030` aplicada sin error contra Postgres real (worktree separado en el VPS,
  `~/ai-orchestrator-verify-046`, sin tocar el servicio en producción).
- Agregado `src/features/caseDocumentScoping.test.ts` — faltaba evidencia automatizada de que el fix
  resuelve el bug (el entorno de implementación no tenía `DATABASE_URL_DEV`). Dos vueltas de
  corrección durante la validación: (1) el cleanup del test dejaba filas huérfanas por borrar
  `runs` antes que `artifacts`/`run_events` (violación de FK); (2) la primera versión del test
  esperaba `materialized: true` tras solo `persistProjectBrief`/`persistArchitecture`, pero ese
  campo depende de `document_hash`, que solo setea la materialización real al worktree (no probada
  acá) — corregido a verificar `canonicalArtifactId` distinto entre Casos, que es lo que realmente
  prueba el scoping.
- Suite completa: **367/367** contra Postgres real, 0 fallas.
- **E2E real en producción (2026-08-20)**: desplegada la rama al servicio real del VPS y reiniciado.
  Se creó un Caso de negocio nuevo real (`root_run_id 375ab2fb-65db-438f-90fe-5674a0a381a7`,
  "pruebas-mejoras-ui-casos-feature-047") en el mismo proyecto que ya tenía el Caso de descuentos
  (`root_run_id 2c7b42d9-...`, con Project Brief/Architecture ya materializados). El nuevo Caso
  completó ambos releases sin escalar por "roadmap vigente distinto" (el síntoma original del bug).
  Confirmado contra la DB real: el Caso de descuentos conserva exactamente el mismo
  `canonical_artifact_id` de antes (`bfd1ca64...` en `project_briefs`, `0ed3353d...` en
  `architectures`, sin cambios), y el Caso nuevo obtuvo sus propias filas
  (`c6c034ca...`/`5a63a30f...`) — cero pérdida, cero colisión.

- Migración: `migrations/0030_project_briefs_architectures_root_run_id_scope.sql` — mismo patrón
  exacto que `migrations/0028_release_plans_features_root_run_id_scope.sql` (FEATURE-046, alcance
  A): columna `root_run_id` nueva en ambas tablas, backfill determinístico vía `created_in_run_id`,
  `not null`, y reemplazo de `unique(project_id)` por `unique(project_id, root_run_id)` en ambas.
- Código:
  - `src/features/projectBriefLifecycle.ts` — `ProjectBriefRow` gana `root_run_id`;
    `persistProjectBrief` resuelve `rootRunId` vía `getRunRootRunId` (reutilizado de FEATURE-046,
    `src/db/repository.ts:305-313`) y lo usa en el `select ... for update` y en el `insert`;
    `materializeProjectBriefDocument` gana parámetro `runId` y filtra por `root_run_id`;
    `getProjectBriefDocumentForRun` agrega `and project_briefs.root_run_id = coalesce(runs.root_run_id,
    runs.id)` a su `join`.
  - `src/features/architectureLifecycle.ts` — mismos cuatro cambios en espejo exacto;
    `persistArchitecture` reutiliza el `rootRunId` que ya resolvía en su línea 64 (para
    `currentApprovedRoadmap`, sin resolverlo dos veces) para el `select`/`insert` de `architectures`.
  - `src/cli/commands/runStart.ts` — los dos call-sites de materialización agregan `runId` (ya en
    scope en la función).
  - `src/server/app.ts` — sin cambios de call-site: `getProjectBriefDocumentForRun(runId)`/
    `getArchitectureDocumentForRun(runId)` ya recibían `runId`, el scoping ocurre dentro de la
    función misma.
- `tsc --noEmit` limpio en raíz y en `web/`.
- Suite completa: **257/257 tests ejecutables pasan**; 18 tests fallan únicamente por
  `DATABASE_URL_DEV no está definida` (sin acceso a DB ni SSH en este entorno — mismos archivos que
  ya dependían de DB real antes de este cambio, entre ellos `src/db/projectConfigScoping.test.ts` de
  FEATURE-046; confirmado con una corrida aislada que el error es exactamente ese, no una regresión
  introducida acá); 4 skipped (preexistentes, sin relación con este cambio).
- **Pendiente — a completar en un entorno con `DATABASE_URL_DEV`/acceso SSH al VPS (worktree
  separado, sin tocar el servicio en producción)**:
  1. Aplicar la migración `0030` contra Postgres real.
  2. Correr la suite completa contra DB real (objetivo: mismo criterio que FEATURE-046, sin fallas
     ni skips relevantes).
  3. Agregar, si hace falta, un test de integración sin mocks que reproduzca el escenario de dos
     Casos concurrentes del mismo proyecto escribiendo su propio Project Brief/Architecture — mismo
     patrón que `src/db/projectConfigScoping.test.ts` (FEATURE-046).
  4. E2E real repitiendo el escenario exacto de la reproducción del 2026-08-20 (proyecto
     `0145ec09-46f4-43bf-ac19-f28a2ea1c0cd`, Caso A `root_run_id
     2c7b42d9-82f6-48f6-b507-425afba45948`, Caso B `root_run_id
     7059ce2e-0100-4e89-a4ea-85e2a10cee56`), llegando esta vez hasta aprobar el Gate de Roadmap del
     Caso B, y confirmando que el Project Brief/Architecture del Caso A sobreviven intactos.
