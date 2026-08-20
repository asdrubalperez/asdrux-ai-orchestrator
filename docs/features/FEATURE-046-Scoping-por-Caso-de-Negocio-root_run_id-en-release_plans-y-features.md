# FEATURE-046 — Scoping por Caso de Negocio (`root_run_id`) en la persistencia canónica y en la
config vigente del proyecto

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: diseño elaborado a partir de un hallazgo real detectado durante la validación
> adversarial de FEATURE-045 (Vista jerárquica de Casos de Negocio), y **ampliado el 2026-08-19**
> tras una reproducción real en vivo que mostró que el problema no se limita a `release_plans`/
> `features`: el mecanismo de "config vigente del proyecto" (`project_config_versions`) también es
> por proyecto, no por Caso, y lo usa el pipeline real en producción — no solo una proyección de
> lectura. **Aprobado por el owner el 2026-08-19**, con el alcance ampliado y prioridad P0, y con
> una corrección de conteo del hallazgo adversarial (seis call-sites reales de escritura, no
> cuatro — sección 2.2). Implementado en rama `feature/046-scoping-caso-negocio`, pendiente de
> validación (migraciones + suite completa contra DB real + E2E en VPS) antes de mergear.

---

## 1. Feature Identity

- **Name**: Scoping por Caso de Negocio (`root_run_id`) en `release_plans`, `features` y
  `project_config_versions`
- **Type**: Data Integrity / Lifecycle Consistency
- **Owner**: asdru
- **Status**: 🟢 Implementado en rama `feature/046-scoping-caso-negocio` — pendiente de validación
  (migraciones + suite completa + E2E en VPS) antes de mergear a `main`
- **Priority**: Por definir (propuesta: **P0** tras la ampliación — el mecanismo de config vigente
  es parte del camino crítico del pipeline en vivo, no solo de una vista de lectura; confirmado que
  hoy el sistema **no soporta más de un Caso de negocio activo por proyecto a la vez**)
- **Origin**: Hallazgo de la validación adversarial de FEATURE-045 (Vista jerárquica de Casos de
  Negocio), 2026-08-19. Ampliado el mismo día tras reproducción real en vivo del bug en el pipeline
  (no solo en la proyección de lectura).
- **Related Features**: FEATURE-011 (`project_config_versions`), FEATURE-018/FEATURE-019 (roadmap/
  release plan sobre ese mecanismo), FEATURE-020 (introduce `root_run_id` en `runs`), FEATURE-023
  (`features`/`feature_revisions`), FEATURE-028, FEATURE-035 (`release_plans`), FEATURE-036
  (precedente ya resuelto del mismo bug en el mecanismo legado de lectura), FEATURE-038, FEATURE-045

---

## 2. Problem Statement

### 2.1 — `release_plans` y `features` (alcance original)

`release_plans` tiene `unique(project_id, release_key)` sin ninguna columna de ciclo/Caso de
negocio. `persistReleasePlanDocument` (`src/features/releasePlanLifecycle.ts:76-141`) busca la fila
existente con `where project_id = $1 and release_key = $2`, sin acotar por Caso. Architect/Planning
nombran los releases con IDs genéricos (`"r1"`, `"r2"`, …) como comportamiento normal del Runbook —
no hay ninguna garantía de que `release_key` sea único entre Casos de negocio distintos del mismo
proyecto. Si dos Casos reutilizan el mismo `release_key`, el segundo Caso en escribir no crea una
fila nueva: actualiza la fila del primero, y `mergeFeaturePlan` (línea 94) acumula el contenido de
ambos Casos en un único documento. `created_in_run_id` solo se setea una vez, en el insert (línea
137), y nunca se actualiza después — queda apuntando al primer Caso aunque el contenido ya esté
mezclado con el del segundo.

`features` tiene el mismo patrón de lookup sin scoping (`where project_id=$1 and release_key=$2 and
source_key=$3`, `src/features/lifecycle.ts:98-103`). Si la Feature encontrada ya está
`activated_at != null`, un segundo Caso que intente redefinirla lanza `FeatureLifecycleEscalationError`
(líneas 142-146) — evita la mezcla silenciosa de contenido, pero produce una escalación confusa entre
Casos no relacionados. Si **todavía no** está activada, el segundo Caso la sobrescribe en el bloque
`if (currentFunctional !== null)` (líneas 147-163) sin ningún error — mismo patrón de mezcla
silenciosa que en `release_plans`.

Precedente ya resuelto para el mecanismo legado de **lectura**: `getReleasePlansByRelease`/
`getReleasePlanAssociationCandidate` (`src/db/repository.ts:564-652`) filtran por
`coalesce(root_run_id, id)` vía un CTE `current_epoch` (fix del hallazgo E2E de FEATURE-036,
2026-07-30). El mecanismo canónico nuevo (`release_plans`/`features`, de FEATURE-035/FEATURE-023)
nunca recibió la misma protección.

### 2.2 — `project_config_versions` (alcance ampliado, 2026-08-19)

El mecanismo de "config vigente del proyecto" es más fundamental que 2.1 y **está en el camino
crítico real del pipeline**, no solo en una proyección de lectura. `project_config_versions` versiona
cualquier `config_key` por `project_id`, con un índice único que garantiza **una sola fila vigente
por `(project_id, config_key)`** (`migrations/0004_project_config_versions.sql`, índice
`one_current_project_config`), sin ninguna columna de Caso/ciclo. `writeProjectConfigVersion`
(`src/db/repository.ts:501-534`) cierra la fila vigente anterior (`valid_to = now()`) buscándola
únicamente por `(project_id, config_key)`, sin importar a qué Caso pertenecía esa fila ni a qué Caso
pertenece la nueva. `getCurrentProjectConfig`/`getCurrentProjectConfigs`
(`repository.ts:441-466`) leen exactamente lo mismo: "la fila vigente del proyecto", sin ningún
parámetro de Caso/run.

Los tres `config_key` realmente usados hoy por el pipeline (`release_roadmap`, `release_plan`,
`testing_policy_config`) son inherentemente **de Caso**, no de proyecto: los escribe siempre Architect
o Planning dentro de un run concreto (`changedInRunId` siempre presente en los seis call-sites reales
de escritura: `respondService.ts:194,312,323`, `lifecycle.ts:231`, `runStart.ts:1340,1396`), y los lee
el pipeline (y la UI) para decidir el estado del release/Feature activos de ese Caso puntual. Sin
embargo, se leen y escriben como si fueran de proyecto:

- `src/features/architectureLifecycle.ts:247-249` — Architect lee `release_roadmap` filtrando
  únicamente por `project_id`, sin ningún filtro de Caso, para decidir si ya existe un Roadmap vigente
  al arrancar.
- `src/cli/respondService.ts:177` — al responder un Approval Gate, se relee `release_roadmap`
  filtrando únicamente por `project_id` para decidir cómo cerrar el release.
- `recordRunConfigVersions` (`repository.ts:1012-1027`) — al crear **cualquier** run del proyecto, se
  "pinnea" (`run_config_versions`) el conjunto completo de config vigente del proyecto vía
  `getCurrentProjectConfigs(projectId)`, sin distinguir a qué Caso pertenece cada `config_key`
  vigente.
- Múltiples lecturas puntuales adicionales del mismo patrón: `runStart.ts` (líneas 526, 566, 684,
  1053, 1100, 1124, 1329, 1349, 1515), `server/app.ts:1815` y `server/sse.ts:20` (ambas vía
  `resolveReleaseRoadmap(projectId)`, duplicada en los dos archivos para evitar un import circular).

**Reproducción real (2026-08-19)**: dos Casos de negocio distintos sobre el mismo proyecto. El
segundo Caso, al correr Architect, leyó como "vigente" el `release_roadmap` que había dejado el
primer Caso (`architectureLifecycle.ts:248`), escaló pidiendo aprobación humana sobre un Roadmap que
no le correspondía, y Functional chocó con una Feature ya activada por el primer Caso (mismo síntoma
de colisión ya descrito en 2.1, mostrando que ambos problemas se disparan juntos en un escenario
real). **Conclusión verificada en vivo**: hoy el sistema no soporta más de un Caso de negocio activo
por proyecto a la vez — un segundo Caso concurrente lee y puede llegar a escribir sobre el estado del
primero.

---

## 3. Functional Goal

Un proyecto con **N** Casos de negocio, concurrentes o no, mantiene el estado de cada Caso
completamente aislado:

- `release_plans`/`features`: cada Caso obtiene su propia fila aunque reutilice `release_key`/
  `source_key`, sin importar el orden de escritura — aislamiento garantizado por constraint `unique`
  en la base, no solo por lógica de aplicación (alcance 2.1, sin cambios respecto de la versión
  anterior de este documento).
- `project_config_versions`: cada `config_key` de Caso (`release_roadmap`, `release_plan`,
  `testing_policy_config`) tiene una fila vigente **por Caso**, no una única fila vigente por
  proyecto. Un run de un Caso nunca lee, pinnea (`run_config_versions`) ni sobrescribe la config
  vigente de otro Caso del mismo proyecto. Un `config_key` genuinamente de proyecto (sin
  `changedInRunId` — ninguno existe hoy en uso activo, pero el mecanismo lo sigue soportando) se
  sigue comportando exactamente igual que hoy: una única fila vigente compartida por todos los Casos.

La escalación confusa de `FeatureLifecycleEscalationError` entre Casos no relacionados deja de
ocurrir, porque deja de haber colisión real que la dispare — tanto en `features` como en la lectura
del Roadmap que dispara el flujo de Architect/Approval Gate.

---

## 4. Scope

### Included

**A. `release_plans` / `features`** (sin cambios respecto del diseño original):

- Columna nueva `root_run_id uuid references runs(id)` en `release_plans` y en `features`, calculada
  **una sola vez**, en el momento de creación de la fila, a partir del run que la crea:
  `coalesce(runs.root_run_id, runs.id)` — mismo patrón, mismo ciclo de vida y misma expresión ya
  usada por `created_in_run_id` (columna hermana) y por el CTE `current_epoch` de
  `repository.ts:566-567`.
- Backfill determinístico vía `created_in_run_id` (columna `not null` en ambas tablas) +
  `alter column root_run_id set not null`.
- Constraint `unique(project_id, release_key)` de `release_plans` → `unique(project_id, release_key,
  root_run_id)`. Constraint `unique(project_id, release_key, source_key)` de `features` →
  `unique(project_id, release_key, source_key, root_run_id)`. `unique(project_id, feature_code)`
  **sin cambios**.
- Lookups de escritura scoped por `root_run_id`: `persistReleasePlanDocument`,
  `persistFunctionalFeatureBatch`, `persistPlanningFeatureSelection`.
- Read-paths scoped por `root_run_id`: `getReleasePlanDocumentForRun`, `materializeReleasePlanDocument`
  (gana `runId`), `getActivatedFeatureIdentities` (gana `runId`, propagado desde
  `withFunctionalRoleContext`, que gana `runId`).

**B. `project_config_versions`** (alcance nuevo, 2026-08-19):

- Columna nueva `root_run_id uuid references runs(id)`, **nullable** — a diferencia de A, acá `NULL`
  es un valor con significado propio, no un vacío legado: representa explícitamente "config de
  proyecto, no de Caso" (ver Regla 8).
- `writeProjectConfigVersion` resuelve `root_run_id` a partir de `changedInRunId` cuando está
  presente (`coalesce(runs.root_run_id, runs.id)`; hoy los seis call-sites reales siempre lo pasan)
  y lo deja `NULL` cuando `changedInRunId` está ausente. El cierre de la fila vigente anterior deja de
  buscar solo por `(project_id, config_key)`: agrega `and root_run_id is not distinct from $3` (el
  operador correcto para que `NULL` matchee con `NULL`, a diferencia de `=`).
- Índice único `one_current_project_config` reemplazado por dos índices únicos parciales (Postgres
  soporta predicados con listas literales en índices parciales, son inmutables en tiempo de
  creación):
  - `unique (project_id, config_key, root_run_id) where valid_to is null and root_run_id is not null`
    — a lo sumo una fila vigente por `(proyecto, config_key, Caso)`.
  - `unique (project_id, config_key) where valid_to is null and root_run_id is null` — a lo sumo una
    fila vigente por `(proyecto, config_key)` entre las de alcance de proyecto.
- `getCurrentProjectConfig(projectId, configKey, rootRunId)` — firma gana un tercer parámetro
  **obligatorio** `rootRunId: string | null`, con matching exacto (`is not distinct from`, sin
  fallback ni `OR`): el caller decide explícitamente si quiere la config de un Caso puntual (pasa el
  `root_run_id` resuelto de su run) o la config de alcance de proyecto (pasa `null` explícitamente).
  Sin fallback automático entre ambos alcances — evita ambigüedad si algún `config_key` llegara a
  mezclar escrituras con y sin `changedInRunId` (ver Riesgos).
- `getCurrentProjectConfigs(projectId, rootRunId)` (bulk, usada por `recordRunConfigVersions`) —
  devuelve la **unión** de las filas vigentes de alcance de proyecto (`root_run_id is null`) y las
  del Caso puntual (`root_run_id = $2`) — semántica deliberada distinta de `getCurrentProjectConfig`,
  porque el pinneo de un run nuevo sí necesita ambos alcances a la vez.
- `recordRunConfigVersions(runId)` resuelve el `root_run_id` del propio run (ya disponible en
  `runs.root_run_id`/`runs.id` al momento en que se llama, después de `createRun`) y lo pasa a
  `getCurrentProjectConfigs`.
- Actualizar todos los call-sites reales enumerados en la sección 2.2 para resolver y pasar el
  `root_run_id` del run en contexto: `architectureLifecycle.ts:247-249`, `respondService.ts:177` (y
  los otros usos de `getCurrentProjectConfig` en ese archivo si los hay), `runStart.ts` (líneas 526,
  566, 684, 1053, 1100, 1124, 1329, 1349, 1515), `resolveReleaseRoadmap` en `server/app.ts:1812` y
  `server/sse.ts:17` (ambas ganan un parámetro `rootRunId`, resuelto por sus callers — que ya operan
  sobre el detalle de un run puntual, `detail.run.*`).
- Mitigación inmediata mientras esta Feature no esté implementada (ver sección 9): documentar
  explícitamente, en el Roadmap y de cara al owner, que **un proyecto solo soporta un Caso de
  negocio activo por vez** hasta que este fix se implemente — evita que el hallazgo quede solo
  documentado sin ninguna señal operativa hacia quien dispara Casos nuevos.

**Ambos alcances comparten**: auditoría de datos reales (solo lectura, sin reparación automática)
antes de desplegar — sección 7.

### Excluded

- Cambiar la generación o el contrato de `release_key`/`source_key`/`feature_code` entre Architect,
  Functional y Planning (Runbook) — el scoping se resuelve enteramente del lado del Orquestador.
- Reparar retroactivamente contenido ya mezclado en filas contaminadas — decisión manual del owner si
  la auditoría de la sección 7 encuentra casos reales; si aparecen, se documentan como Feature de
  seguimiento independiente (mismo precedente que FEATURE-038 saliendo del discovery de FEATURE-036).
- Simplificar `getReleasePlansByRelease`/`getReleasePlanAssociationCandidate`
  (`repository.ts:564-652`) para usar la columna nueva en vez del CTE actual — sigue funcionando y no
  es el origen de este bug; idea de limpieza futura.
- El mecanismo de FEATURE-028 (asociar el `release_plan` vigente al release **activo dentro del mismo
  Caso**, cuando un Caso tiene varios releases `r1`, `r2`, …) — es un problema ortogonal, dentro de
  un mismo Caso, y sigue siendo necesario tal como está después de este fix.
- Catálogo/enum formal de `config_key` válidos, o validación de esquema por `config_key` — fuera de
  alcance desde el diseño original de FEATURE-011, sin relación con este bug.
- Soporte de UI para que un usuario elija/cambie entre Casos concurrentes de un mismo proyecto — eso
  es una decisión de producto de FEATURE-045, esta Feature solo garantiza que la capa de persistencia
  debajo no los mezcle.
- Reconstrucción forense completa de colisiones históricas ya ocurridas en
  `project_config_versions` — a diferencia de `release_plans`/`features` (que sí tienen rastro
  suficiente vía `source_event_key`/`feature_revisions.producer_run_id`), `project_config_versions`
  sobrescribe (`valid_to`) sin dejar un log explícito de "qué Caso pisó a cuál"; el mejor esfuerzo
  posible de auditoría se describe en la sección 7 y es necesariamente parcial.
- Cualquier cambio al contenido de `approval_mode` u otro `config_key` de alcance de proyecto — sigue
  compartido entre todos los Casos, sin cambios de comportamiento.
- Runs con `root_run_id` legado en `NULL` (anteriores a la migración 0012/FEATURE-020) no reciben
  tratamiento especial — `coalesce(root_run_id, id)` ya los trata como su propio epoch.

---

## 5. Functional Rules

**`release_plans` / `features`:**

1. `root_run_id` de una fila de `release_plans`/`features` se fija una única vez, al crearla, como
   `coalesce(runs.root_run_id, runs.id)` del run que la crea — igual que `created_in_run_id` —, y
   nunca se actualiza después.
2. Dos runs de epochs (`root_run_id`) distintos nunca pueden matchear la misma fila de
   `release_plans` ni la misma fila de `features`, aunque declaren `release_key`/`source_key`
   idénticos — garantizado por constraint `unique` en la base.
3. Dentro del mismo epoch, la semántica de acumulación existente no cambia (`mergeFeaturePlan`,
   `feature_revisions` append-only).
4. `unique(project_id, feature_code)` en `features` no cambia — la numeración de Features sigue
   siendo continua por proyecto, no por Caso.
5. La escalación `FeatureLifecycleEscalationError` de "ya fue activada" solo puede dispararse ahora
   por una redefinición real dentro del **mismo** Caso; la reutilización de `source_key` entre Casos
   distintos crea una fila nueva en vez de colisionar.
6. El backfill asigna `root_run_id` de forma determinística a partir del `created_in_run_id` propio
   de cada fila; ninguna fila queda en `NULL` después de la migración.

**`project_config_versions`:**

7. `root_run_id` se resuelve en cada escritura a partir de `changedInRunId`: presente →
   `coalesce(runs.root_run_id, runs.id)`; ausente → `NULL`.
8. `root_run_id = NULL` en `project_config_versions` es un valor con significado explícito ("config
   de alcance de proyecto"), no un vacío por falta de dato — a diferencia de `runs.root_run_id`
   legado (FEATURE-020) o de la columna nueva en A (ambas siempre `not null` tras el backfill).
9. Un mismo `config_key` no debería mezclar escrituras con y sin `changedInRunId` a lo largo del
   tiempo (sería ambiguo qué alcance corresponde) — los seis call-sites de escritura reales hoy
   (`release_roadmap`, `release_plan`, `testing_policy_config`) siempre pasan `changedInRunId`, así
   que en la práctica actual esto no ocurre; se valida como parte de la implementación (ver Riesgos).
10. `getCurrentProjectConfig` nunca hace fallback automático entre alcance de Caso y alcance de
    proyecto — el caller elige explícitamente pasando `rootRunId` o `null`.
11. `getCurrentProjectConfigs`/`recordRunConfigVersions` sí combinan ambos alcances a propósito: un
    run nuevo hereda tanto la config de su propio Caso como la config de proyecto vigente.
12. Un run cuyo propio `root_run_id` es `NULL` (legado, pre-migración 0012) se trata como epoch
    propio (`coalesce(.., id)`), consistente con el resto del sistema.

---

## 6. Technical Considerations

### Migraciones

`migrations/0028_release_plans_features_root_run_id_scope.sql` (siguiente número disponible tras
`0027_release_plan_lifecycle.sql`) — alcance A:

1. `alter table release_plans add column root_run_id uuid references runs (id);`
   `alter table features add column root_run_id uuid references runs (id);`
2. Backfill vía `created_in_run_id` (ver query completa en el diseño original de esta sección, sin
   cambios).
3. `alter column root_run_id set not null` en ambas tablas.
4. `release_plans`: reemplazar `unique(project_id, release_key)` por `unique(project_id, release_key,
   root_run_id)`. `features`: reemplazar `unique(project_id, release_key, source_key)` por
   `unique(project_id, release_key, source_key, root_run_id)`. `unique(project_id, feature_code)` sin
   cambios.

`migrations/0029_project_config_versions_root_run_id_scope.sql` — alcance B (nueva):

1. `alter table project_config_versions add column root_run_id uuid references runs (id);` (nullable,
   sin backfill forzado a `not null`).
2. Backfill:
   ```sql
   update project_config_versions pcv
   set root_run_id = coalesce(r.root_run_id, r.id)
   from runs r
   where r.id = pcv.changed_in_run_id;
   ```
   Filas con `changed_in_run_id is null` quedan con `root_run_id is null` — resultado correcto por
   construcción (sin Caso conocido → alcance de proyecto), sin ambigüedad ni decisión manual.
3. `drop index one_current_project_config;`
4. ```sql
   create unique index one_current_caso_scoped_project_config
     on project_config_versions (project_id, config_key, root_run_id)
     where valid_to is null and root_run_id is not null;

   create unique index one_current_project_scoped_config
     on project_config_versions (project_id, config_key)
     where valid_to is null and root_run_id is null;
   ```

El índice único de A cubre exactamente el patrón de lookup usado en cada write-path de esa capa, sin
necesitar un índice adicional.

### Código de aplicación — alcance A

Sin cambios respecto del diseño original: `ReleasePlanRow`/`FeatureRow` ganan `root_run_id`;
`persistReleasePlanDocument`, `materializeReleasePlanDocument` (+`runId`), `getReleasePlanDocumentForRun`
en `releasePlanLifecycle.ts`; `persistFunctionalFeatureBatch`, `persistPlanningFeatureSelection`,
`getActivatedFeatureIdentities` (+`runId`) en `lifecycle.ts`; `withFunctionalRoleContext` (+`runId`) y
el call-site de `materializeReleasePlanDocument` en `runStart.ts`.

### Código de aplicación — alcance B

- `src/db/repository.ts`:
  - `writeProjectConfigVersion`: resuelve `root_run_id` desde `params.changedInRunId` (nueva consulta
    a `runs`, o reutiliza una consulta ya hecha por el caller si está disponible en la misma
    transacción); el `update ... set valid_to = now() where project_id = $1 and config_key = $2 and
    valid_to is null` (línea 512-517) gana `and root_run_id is not distinct from $3`; el `insert`
    (línea 518-533) gana la columna `root_run_id`.
  - `getCurrentProjectConfig(projectId, configKey, rootRunId: string | null)`: el `where` (línea
    445-450) agrega `and root_run_id is not distinct from $3`.
  - `getCurrentProjectConfigs(projectId, rootRunId: string | null)`: el `where` (línea 459-464) pasa
    de `project_id = $1 and valid_to is null` a `project_id = $1 and valid_to is null and
    (root_run_id = $2 or root_run_id is null)`.
  - `recordRunConfigVersions(runId, client?)` (línea 1012-1027): resuelve `coalesce(runs.root_run_id,
    runs.id)` del propio `runId` (ya tiene `runs.project_id` en la misma consulta de la línea 1014,
    se amplía para traer también `root_run_id`) y lo pasa a `getCurrentProjectConfigs`.
- `src/features/architectureLifecycle.ts:247-249`: la consulta directa a `project_config_versions`
  agrega el predicado de `root_run_id`, resuelto del `runId` en contexto de esa función.
- `src/cli/respondService.ts:177` (y los demás usos de `getCurrentProjectConfig` en ese archivo):
  pasan el `rootRunId` resuelto de `params.parentRunId`/`params.runId` según corresponda al call-site.
- `src/cli/commands/runStart.ts` (líneas 526, 566, 684, 1053, 1100, 1124, 1329, 1349, 1515): cada
  lectura ya tiene `runId`/`params.runId` en scope en su función contenedora — se resuelve
  `root_run_id` una vez por función (o se reutiliza si ya se consultó `runs` en el mismo bloque) y se
  pasa a `getCurrentProjectConfig`.
- `src/server/app.ts:1812` / `src/server/sse.ts:17` (`resolveReleaseRoadmap`, duplicada en ambos
  archivos): gana un parámetro `rootRunId: string | null`; sus tres callers (`app.ts:1055`,
  `sse.ts:68`, `sse.ts:163`) ya operan sobre `detail.run.*` de un run puntual — se agrega
  `detail.run.root_run_id ?? detail.run.id` (o el campo equivalente ya expuesto por
  `getRunDetailForUser`) al llamado.
- Helper compartido `resolveRootRunId(db, runId)` reutilizado por ambos alcances (A y B) — evita
  duplicar la expresión `coalesce(root_run_id, id)` en cada archivo.

---

## 7. Validation Criteria

**Alcance A** (sin cambios respecto del diseño original):

1. Dos Casos (`root_run_id` A y B) del mismo proyecto planifican ambos un release `"r1"` → dos filas
   de `release_plans`, sin mezcla de `featurePlans`.
2. Mismo escenario para `features` con `source_key = "f1"` → dos filas, sin colisión, sin
   `FeatureLifecycleEscalationError`, sin sobrescritura silenciosa.
3. Dentro del mismo Caso, entre runs que comparten `root_run_id` — acumulación/append-only sin
   cambios (regresión contra tests de FEATURE-023/FEATURE-035).
4. Read-paths siguen devolviendo la fila correcta cuando existe un único Caso por proyecto.
5. Backfill: toda fila preexistente queda con `root_run_id` no nulo y correcto.
6. Constraint nuevo enforced a nivel de base.

**Alcance B** (nuevo):

7. Dos Casos del mismo proyecto corren Architect en paralelo (o secuencialmente sin cerrar el
   primero) → cada uno lee `release_roadmap is null` para su propio Caso (no ve el Roadmap del otro),
   sin importar cuál escribió primero — reproduce exactamente el escenario de la reproducción real de
   2026-08-19, pero con el resultado correcto.
8. El Caso A aprueba y escribe su `release_roadmap`/`release_plan`/`testing_policy_config` — el Caso B
   sigue sin verlos (`getCurrentProjectConfig` con el `rootRunId` de B devuelve `null` para esas
   claves) hasta que B escriba las suyas propias.
9. Un run hijo/reingreso dentro del **mismo** Caso A sigue viendo la config vigente de A sin cambios
   de comportamiento (regresión).
10. `recordRunConfigVersions` al crear un run nuevo de un Caso nuevo pinnea únicamente config de
    alcance de proyecto (si existe alguna) — nunca la de un Caso ajeno.
11. Un `config_key` de alcance de proyecto (escrito sin `changedInRunId`) sigue siendo una única fila
    vigente compartida por todos los Casos, sin fragmentarse — regresión explícita del comportamiento
    actual para ese caso.
12. Constraint nuevo enforced a nivel de base: dos escrituras concurrentes al mismo `config_key` desde
    el mismo Caso siguen serializando correctamente (una cierra la vigente de ese Caso, la otra la
    reemplaza); dos escrituras de Casos distintos nunca pisan la fila vigente ajena.

### Validation Evidence

**Auditoría de datos reales — `release_plans`/`features`** (sin cambios respecto del diseño
original): comparar epoch de `created_in_run_id` contra el epoch de la última escritura
(`source_event_key` / `feature_revisions.producer_run_id`); mismo criterio que el paso previo de
FEATURE-036 sección 8.

**Auditoría de datos reales — `project_config_versions`** (nueva, necesariamente parcial — ver
Excluded): no hay un rastro explícito de "qué Caso pisó a cuál" en el esquema actual, así que la
reconstrucción forense completa no es posible. Mejor esfuerzo antes de desplegar:

- Contar, por proyecto, cuántos runs raíz (`root_run_id is null and originated_from_run_id is null`,
  o su propio `id` como raíz) tuvieron ventanas de tiempo solapadas en estado `running` — evidencia
  indirecta de concurrencia real entre Casos (reutilización *secuencial* de un proyecto entre Casos,
  ya documentada como patrón normal en FEATURE-030/FEATURE-036, no es en sí misma evidencia de bug;
  el solapamiento temporal sí lo es).
- Reportar el resultado al owner como contexto, no como bloqueante — a diferencia de A, acá no hay
  forma de "detener la migración sobre filas puntuales": el backfill de B siempre es determinístico
  (sección 6), la migración no falla ni necesita decisión previa para poder aplicarse.

**Automatizada** (a definir en implementación): alcance A sin cambios; alcance B — tests sobre
`writeProjectConfigVersion`/`getCurrentProjectConfig`/`getCurrentProjectConfigs`/
`recordRunConfigVersions` con dos runs raíz de `root_run_id` distinto escribiendo el mismo
`config_key`, sin mocks sobre el código real de producción.

**E2E real en VPS** (a definir en implementación): repetir exactamente el escenario de la
reproducción real de 2026-08-19 (dos Casos de negocio concurrentes sobre el mismo proyecto) en la
rama con el fix — confirmar que el segundo Caso no lee el Roadmap del primero y que ambos progresan
de forma independiente.

---

## 8. Risks

- **Alcance ampliado respecto de la versión anterior de este documento** — el owner ya había
  empezado a revisar el diseño original (solo A); este documento necesita una nueva pasada de
  revisión completa antes de aprobarse.
- La auditoría de `project_config_versions` es necesariamente parcial (sin rastro explícito de
  colisiones pasadas) — puede haber corrupción histórica no detectable con los datos disponibles.
- Riesgo de ambigüedad si algún `config_key` llegara a escribirse alguna vez con y sin
  `changedInRunId` (Regla 9) — mitigado hoy porque los seis call-sites reales de escritura siempre
  pasan `changedInRunId`; a validar explícitamente como parte de la implementación (grep exhaustivo
  de `setProjectConfig(` antes de mergear).
- Superficie de cambio más grande de lo estimado originalmente: alcance B toca ~12 call-sites de
  lectura además de los 3-4 de escritura, repartidos en `repository.ts`, `architectureLifecycle.ts`,
  `respondService.ts`, `runStart.ts`, `app.ts` y `sse.ts` — mayor riesgo de dejar algún call-site sin
  actualizar; el inventario de la sección 6 se armó por búsqueda exhaustiva sobre el código actual,
  pero debe reverificarse al implementar.
- Mientras esta Feature no esté implementada, el sistema sigue sin soportar más de un Caso de negocio
  activo por proyecto a la vez — riesgo operativo inmediato, mitigado únicamente por la documentación
  explícita de esta limitación (sección 4, "mitigación inmediata") hasta que se apruebe e implemente
  el fix real.
- `root_run_id` no cambia ningún contrato externo (Runbook, payloads de Architect/Functional/
  Planning/Roadmap) — el scoping es enteramente interno al Orquestador.

---

## 9. Approval Gate

**Aprobado por el owner (2026-08-19)**, con el alcance ampliado a `project_config_versions` y
prioridad P0, incluyendo la corrección de conteo señalada en la revisión adversarial (sección 2.2:
seis call-sites reales de escritura, no cuatro — la Regla 9 seguía siendo cierta, era solo un error
de conteo en el texto).

---

## 10. Estado de la implementación

**🟢 Implementado en rama `feature/046-scoping-caso-negocio`, pendiente de validación.**

- Migraciones: `migrations/0028_release_plans_features_root_run_id_scope.sql` (alcance A) y
  `migrations/0029_project_config_versions_root_run_id_scope.sql` (alcance B).
- Código: `src/db/repository.ts` (`getRunRootRunId`, `getCurrentProjectConfig`/
  `getCurrentProjectConfigs`/`writeProjectConfigVersion`/`recordRunConfigVersions` scoped por
  `root_run_id`; `getReleasePlansByRelease`/`getReleasePlanAssociationCandidate` simplificadas para
  filtrar directamente por `root_run_id` en vez del CTE `current_epoch` — necesario para
  corrección, no solo limpieza: con múltiples Casos concurrentes el CTE original ya no podía
  garantizar una única fila vigente por proyecto), `src/features/releasePlanLifecycle.ts`,
  `src/features/lifecycle.ts`, `src/features/architectureLifecycle.ts`,
  `src/cli/commands/runStart.ts`, `src/cli/respondService.ts`, `src/server/app.ts`,
  `src/server/sse.ts`.
- `tsc --noEmit` limpio en raíz y en `web/`.
- Suite completa: no se pudo correr contra una base real desde este entorno (sin
  `DATABASE_URL_DEV` configurada, sin acceso SSH a la VPS) — los 17 tests que dependen de conexión
  a DB fallan por esa razón (confirmado que fallan igual en la rama base, sin estos cambios, por lo
  que no es una regresión introducida acá). **Pendiente**: aplicar las dos migraciones, correr la
  suite completa contra una base real, y repetir el escenario de la reproducción real del
  2026-08-19 (dos Casos de negocio concurrentes en el mismo proyecto) como E2E en VPS antes de
  mergear a `main`.
