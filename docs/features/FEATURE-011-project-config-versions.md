# FEATURE-011 — Configuración vigente por proyecto (tabla dedicada versionada)

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso — origen de este diseño**: la primera versión de este documento asumía, sin
> evidencia, que la solución era reutilizar la tabla `artifacts` existente (agregando un `kind`
> nuevo). Antes de aprobar esa hipótesis, se le pidió a Codex una investigación sin sesgo —sin
> mencionarle esa opción de entrada— para que evaluara el problema desde cero contra el schema
> real. Codex propuso y evaluó 4 opciones, incluyendo la de `artifacts` (agregada como desafío
> explícito al final de su investigación, no omitida). Su conclusión: `artifacts` se descarta como
> store canónico — no tiene `project_id` directo (hay que inferirlo vía `runs`, que es obligatorio
> en esa tabla), no hay forma de garantizar "una sola vigente" a nivel de constraint, y mezcla
> semánticamente "output de una fase de un agente" con "estado operativo de un proyecto", que son
> ciclos de vida distintos. Este documento reemplaza la hipótesis original por la opción que Codex
> recomendó (Opción A de su investigación: tabla dedicada append-only por clave de configuración).
>
> **Nota de numeración**: esta Feature toma el número 011 porque "Feature 11" (Capa de UI — "Run
> en curso") y "Feature 12" (Milestone 2 — E2E real) ya estaban reservadas informalmente en
> `docs/ROADMAP.md`. Se decidió renumerar en vez de usar un sufijo, para no romper el patrón
> `FEATURE-0XX` estrictamente secuencial de `docs/features/`. Como consecuencia: "Run en curso"
> pasa a ser **FEATURE-012**, y "Milestone 2/E2E real" pasa a ser **FEATURE-013**. Este corrimiento
> se incluye en el Scope (sección 4) para que quede escrito en el Roadmap, no solo mencionado en
> conversación.

---

## 1. Feature Identity

- **Name**: Configuración vigente por proyecto — tabla dedicada versionada por clave
- **Type**: Modelo de datos / infraestructura de configuración
- **Owner**: asdru
- **Status**: **Aprobada** — Go explícito del owner, condicionado a los 3 ajustes menores
  incorporados en esta versión (ver historial de la sección 10)
- **Priority**: Alta — bloquea el cierre real del marcador `[PENDIENTE-DB-PROJECTS]` en Feature 09

## 2. Problem Statement

Feature 09 (Runbook) define una serie de configuraciones "Editables por producto" — Approval
Model, Áreas Sensibles, Nivel de Rigor, Default Test Level, Framework Conventions, Release
Strategy, entre otras (`docs/runbook/03` a `06`) — que hoy no tienen ningún mecanismo real de
persistencia. Estas configuraciones cambian a lo largo del tiempo, importa poder reconstruir su
historial, y el uso normal del sistema necesita consultar "cuál es la vigente ahora" para un
proyecto dado, no todo el historial en cada lectura.

La investigación de Codex confirmó que ni `artifacts` (la tabla existente más cercana) ni ninguna
otra tabla actual resuelven esto hoy: no existe tabla de configuración vigente, versiones de
configuración, settings por proyecto ni snapshots. Hace falta modelo de datos nuevo.

## 3. Functional Goal

Dado un `project_id` y un `config_key`, el sistema debe poder:
1. Leer el valor vigente mediante lookup indexado directo por el índice único parcial, sin
   recorrer el historial.
2. Escribir un valor nuevo, cerrando automáticamente la versión anterior — nunca dos vigentes
   simultáneas para la misma clave y proyecto.
3. Consultar el historial completo de una clave para un proyecto.
4. Saber qué versión de configuración regía cuando corrió un `run` puntual, incluso después de
   que la vigente haya cambiado.

## 4. Scope

**Included**

- Migración `0004_project_config_versions.sql`:
  ```sql
  create table project_config_versions (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects (id),
    config_key text not null,
    value jsonb not null,
    valid_from timestamptz not null default now(),
    valid_to timestamptz,
    changed_by_user_id uuid references users (id),
    changed_in_run_id uuid references runs (id),
    change_reason text
  );

  create unique index one_current_project_config
    on project_config_versions (project_id, config_key)
    where valid_to is null;

  create index project_config_history_lookup
    on project_config_versions (project_id, config_key, valid_from desc);

  create table run_config_versions (
    run_id uuid not null references runs (id),
    config_version_id uuid not null references project_config_versions (id),
    primary key (run_id, config_version_id)
  );
  ```
- Funciones nuevas en `src/db/repository.ts`, consistentes con el estilo ya usado
  (`recordRunEvent` acepta `client?: PoolClient` para transacciones — mismo patrón acá):
  - `getCurrentProjectConfig(projectId, configKey)` → lee por el índice único directo (`where
    project_id = $1 and config_key = $2 and valid_to is null`), sin `order by`/`limit`.
  - `getCurrentProjectConfigs(projectId, client?)` → lectura bulk de **todas** las configuraciones
    vigentes de un proyecto (`select id, project_id, config_key, value, valid_from, valid_to from
    project_config_versions where project_id = $1 and valid_to is null`). Necesaria para que
    `runStart.ts` no tenga que conocer de antemano una lista de claves ni hacer N llamadas por
    clave — se apoya en el mismo índice único parcial, sin `order by`/`limit`. Acepta
    `client?: PoolClient` para poder correr dentro de la misma transacción que
    `recordRunConfigVersions` cuando se invoca desde ahí.
  - `setProjectConfig(params)` → dentro de una transacción: cierra la versión vigente anterior
    (`valid_to = now()`) e inserta la nueva, atómicamente.
  - `getProjectConfigHistory(projectId, configKey)` → historial completo, `order by valid_from
    desc`.
  - `recordRunConfigVersions(runId, client?)` → llama internamente a
    `getCurrentProjectConfigs(projectId, client)`, pasando el mismo `client` recibido, y puebla
    `run_config_versions` con los `id` de todas las filas devueltas — no recibe una lista de
    `configVersionIds` armada afuera, para no duplicar la lógica de "cuáles son las vigentes" en
    dos lugares distintos.
- Aplicación de este mecanismo a las configuraciones "Editable por producto" del Runbook — cada
  una vive como una fila con su propio `config_key` (p. ej. `approval_model`, `areas_sensibles`,
  `default_test_level`, etc.), reemplazando el marcador `[PENDIENTE-DB-PROJECTS]`.
- Actualización explícita de `docs/ROADMAP.md`: "Run en curso" pasa de "Feature 11" a
  **FEATURE-012**, y "Milestone 2/E2E real" pasa de "Feature 12" a **FEATURE-013**.

**Excluded**
- UI para editar configuración (queda para una Feature de UI futura, fuera de FEATURE-012).
- Validación de esquema por `config_key` (hoy `value` es JSONB libre, sin schema por clave) —
  ver Risks.
- Catálogo formal/enum de `config_key` válidos — hoy es `text` libre, sin constraint contra typos.

**Future ideas**
- Validación JSON Schema por `config_key`, si en el futuro se necesita garantizar forma.
- Enum o tabla de catálogo de `config_key` si los typos se vuelven un problema real en la
  práctica.

## 5. Functional Rules

1. Nunca puede haber dos filas con `valid_to is null` para el mismo `(project_id, config_key)` —
   garantizado por el índice único parcial, no por convención de aplicación.
2. Escribir una configuración nueva implica, en la misma transacción: cerrar la vigente anterior
   (`valid_to = now()`) e insertar la nueva con `valid_from = now()`. Nunca se hace en dos pasos
   sueltos. **Comportamiento explícito ante concurrencia**: si dos escrituras concurrentes intentan
   setear la misma clave del mismo proyecto casi al mismo tiempo, el índice único parcial
   garantiza que como máximo una quede con `valid_to is null` — la segunda transacción en cerrar
   puede chocar contra la primera (`unique_violation` al intentar insertar antes de que la
   anterior se haya cerrado, o una lectura obsoleta de "cuál es la vigente a cerrar"). Este riesgo
   se acepta para esta etapa (no hay múltiples usuarios editando configuración simultáneamente
   hoy) — no se implementa retry ni locking explícito (`select ... for update`) en esta Feature,
   pero queda documentado como decisión consciente, no como omisión.
3. La lectura de "vigente" nunca usa `order by ... limit 1` — usa el índice único directo. Si en
   algún momento esa lectura necesita `order by`/`limit`, es señal de que el índice único se rompió
   o no se está respetando la regla 1.
4. `getCurrentProjectConfig` devuelve `null` si no existe ninguna versión para esa clave/proyecto
   — no lanza excepción, no inventa un default.
5. Al iniciar un `run`, el sistema registra en `run_config_versions` **todas** las configuraciones
   vigentes del proyecto en ese momento (`select id from project_config_versions where project_id
   = $1 and valid_to is null`) — no una lista de claves "relevantes" curada a mano. Se elige esta
   regla en vez de un catálogo de claves relevantes porque hoy no existe catálogo formal de
   `config_key` (ver Excluded/Risks); depender de una lista curada dejaría un hueco real en
   `runStart.ts` (¿quién la mantiene? ¿qué pasa si se agrega una clave nueva y se olvida
   incluirla?). Registrar todas las vigentes es más simple y no requiere que el código sepa de
   antemano qué claves existen — si en el futuro aparece un catálogo formal, esta regla puede
   filtrarse por él sin cambiar la mecánica de fondo.
6. Las funciones son agnósticas del `config_key` concreto — no hardcodean `approval_model` ni
   ningún otro nombre, lo reciben como parámetro (mismo principio ya aplicado en
   `ensurePipelineDefinition`, agnóstico de pipeline).
7. `recordRunConfigVersions(runId)` resuelve el `project_id` del run internamente. Si ese run
   tiene `project_id is null` (posible en runs históricos/anómalos, ya que `runs.project_id` no
   tiene constraint `not null` a nivel de schema — ver `FEATURE-010-users-projects-login.md`,
   sección 7), la función no debe fallar: registra cero filas en `run_config_versions` para ese
   run y continúa — un run sin proyecto simplemente no tiene trazabilidad de configuración, lo
   cual es consistente con que tampoco tiene proyecto.
8. `recordRunConfigVersions(runId)` se llama **una sola vez**, al iniciar el run, dentro de la
   misma transacción que su creación. `run_config_versions.primary key (run_id,
   config_version_id)` evita duplicar la misma versión exacta, pero no impide por sí solo que un
   run termine asociado a dos versiones distintas de la misma `config_key` si la función se
   invocara más de una vez para el mismo run (ver Risks) — la garantía de que eso no pase depende
   de esta regla de invocación única, no de un constraint adicional en esta Feature.

## 6. Estrategia Algorítmica

No aplica — no hay lógica de decisión ni desempate, es persistencia versionada por clave con
garantía de unicidad vía constraint de base de datos.

## 7. Technical Considerations

- El índice único parcial (`where valid_to is null`) traslada la garantía de "una sola vigente" al
  motor de base de datos, en vez de depender de disciplina de aplicación — esto es explícitamente
  mejor que lo que hoy existe para `artifacts kind: 'design'`, donde no hay ninguna garantía
  equivalente.
- `changed_by_user_id` y `changed_in_run_id` son opcionales (`references`, no `not null`) — una
  configuración puede setearse fuera del contexto de un run (p. ej. desde una futura UI de admin).
- `run_config_versions` requiere que, al iniciar un run, se resuelvan **todas** las
  configuraciones vigentes de ese proyecto (vía `getCurrentProjectConfigs`, no una lista curada de
  claves) y se registren antes de arrancar el pipeline — esto toca `src/cli/commands/runStart.ts`,
  que hoy no tiene ningún paso equivalente.
- No se valida el contenido de `value` (JSONB libre) por `config_key` — queda como Future idea si
  hace falta más adelante.
- Consistencia con el estilo del repo: transacciones ya se manejan pasando `client?: PoolClient`
  opcional (ver `recordRunEvent`) — `setProjectConfig` debe seguir el mismo patrón, no inventar
  uno nuevo.

## 8. Validation Criteria

| Escenario | Input | Resultado esperado |
|---|---|---|
| Primera escritura | Proyecto sin configuración previa para `config_key` | Se inserta una fila con `valid_to = null`, sin necesidad de cerrar nada |
| Actualización | Proyecto con configuración vigente para `config_key` | La fila anterior queda con `valid_to = now()`, se inserta una nueva con `valid_to = null` — nunca dos vigentes simultáneas |
| Lectura vigente | `config_key` con historial de 3 versiones | Devuelve solo la fila con `valid_to is null`, sin recorrer las otras 2 |
| Lectura sin configuración | `config_key` nunca seteada para ese proyecto | Devuelve `null`, sin excepción |
| Historial | `config_key` con 3 versiones | Devuelve las 3, ordenadas por `valid_from desc` |
| Run con config asociada | Run que arranca con 2 `config_key` vigentes en el proyecto | `run_config_versions` registra las 2 versiones exactas usadas (vía `getCurrentProjectConfigs`), recuperables después aunque la vigente haya cambiado |
| Lectura bulk | Proyecto con 4 `config_key` vigentes distintas | `getCurrentProjectConfigs(projectId)` devuelve las 4 en una sola consulta, sin iterar clave por clave |
| Run sin proyecto | Run histórico/anómalo con `project_id is null` | `recordRunConfigVersions` no falla — registra cero filas y continúa |
| Escritura concurrente | Dos `setProjectConfig` casi simultáneos sobre la misma clave/proyecto | Como máximo una queda con `valid_to is null`; la otra puede fallar por `unique_violation` — comportamiento aceptado, no se implementa retry en esta Feature |
| Intento de doble vigente | Insert manual forzado sin cerrar la anterior | Falla por violación del índice único parcial — la base de datos lo rechaza, no la aplicación |

### Validation Evidence

Verificar contra la base real de la VPS (no solo test aislado): confirmar el rechazo real del
índice único ante un intento de doble vigente, y confirmar que `run_config_versions` recupera
correctamente la config histórica de un run después de que la vigente cambió.

## 9. Risks

- `config_key` es `text` libre sin catálogo — un typo (`aproval_model` vs `approval_model`) crea
  una clave nueva silenciosamente, sin que la base de datos lo rechace. Mitigación futura posible:
  enum o tabla de catálogo (ver Future ideas), no bloqueante hoy.
- `value` sin validación de forma por clave — una escritura con JSON malformado para esa clave no
  se detecta hasta que algo intente leerlo con una forma esperada.
- `run_config_versions` agrega un paso nuevo a `runStart.ts` (resolver y registrar config vigente
  al iniciar) — si se omite en algún camino de creación de run, ese run queda sin trazabilidad de
  qué configuración usó.
- Escrituras concurrentes sobre la misma clave/proyecto pueden fallar con `unique_violation` en
  vez de resolverse con reintento automático — aceptado para esta etapa (ver Functional Rules,
  regla 2), pero si en el futuro hay múltiples usuarios editando configuración a la vez, esto va
  a necesitar revisión.
- Runs con `project_id is null` (posibles por el schema heredado de Feature 10, donde esa columna
  no tiene `not null`) no van a tener trazabilidad de configuración — comportamiento esperado, no
  un bug, pero vale la pena tenerlo presente si aparece un run así en producción.
- `run_config_versions` no tiene constraint que impida que un mismo run quede asociado a dos
  versiones distintas de la misma `config_key` (el `primary key (run_id, config_version_id)` solo
  evita duplicar la misma versión exacta). Esto no es un problema si `recordRunConfigVersions` se
  llama una sola vez por run (ver Functional Rules, regla 8) — pero si en el futuro se llama más
  de una vez para el mismo run por error, el dato quedaría corrupto sin que la base de datos lo
  detecte. No se agrega protección adicional en esta Feature; queda como criterio de
  implementación explícito, no como omisión silenciosa.

## 10. Approval Gate

**Aprobada.** Historial de la aprobación:

- Primera revisión: No-Go menor por 2 huecos de precisión (ambigüedad de "config relevantes" en
  `run_config_versions`, falta de lectura bulk) — resueltos.
- Segunda revisión: Go condicionado a 3 ajustes menores de robustez/claridad — todos incorporados
  en esta versión:
  1. `getCurrentProjectConfigs(projectId, client?)` acepta `client?: PoolClient`, propagado desde
     `recordRunConfigVersions`.
  2. Índice de historial renombrado a `project_config_history_lookup` (ya no se confunde con el
     índice único de "vigente").
  3. Riesgo de doble registro por run documentado explícitamente (Functional Rules regla 8,
     Risks) — mitigado por la regla de invocación única, no por constraint adicional.

Implementación autorizada. Handoff a Codex a cargo del owner.