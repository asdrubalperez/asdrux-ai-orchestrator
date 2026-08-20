-- FEATURE-046 (alcance B): scoping por Caso de negocio (`root_run_id`) en `project_config_versions`.
-- El índice `one_current_project_config` garantiza una sola fila vigente por (project_id,
-- config_key) -- sin distinguir a qué Caso de negocio pertenece. `release_roadmap`, `release_plan`
-- y `testing_policy_config` son inherentemente de Caso (siempre escritos con `changed_in_run_id`),
-- pero se leían/escribían como si fueran de proyecto: un segundo Caso concurrente en el mismo
-- proyecto lee y puede llegar a pisar el estado del primero (reproducido en vivo, 2026-08-19).
--
-- A diferencia de `release_plans`/`features` (migración 0028), acá `root_run_id` queda nullable a
-- propósito: `NULL` es un valor con significado explícito ("config de alcance de proyecto,
-- compartida por todos los Casos"), no un vacío legado. El mecanismo sigue siendo agnóstico del
-- `config_key` concreto (FEATURE-011, Regla 6): el alcance lo decide quien escribe, según pase o no
-- `changedInRunId` -- no hay ningún catálogo hardcodeado de claves "de Caso" vs "de proyecto".

alter table project_config_versions add column root_run_id uuid references runs (id);

-- Backfill determinístico: filas con changed_in_run_id conocido heredan el epoch de ese run; filas
-- sin changed_in_run_id (nunca hubo un run detrás de esa escritura) quedan en NULL -- resultado
-- correcto por construcción, sin ambigüedad ni decisión manual (a diferencia de una columna
-- `not null`, acá no hace falta forzar ningún valor).
update project_config_versions pcv
set root_run_id = coalesce(r.root_run_id, r.id)
from runs r
where r.id = pcv.changed_in_run_id;

drop index one_current_project_config;

-- A lo sumo una fila vigente por (proyecto, config_key, Caso) para config de alcance de Caso.
create unique index one_current_caso_scoped_project_config
  on project_config_versions (project_id, config_key, root_run_id)
  where valid_to is null and root_run_id is not null;

-- A lo sumo una fila vigente por (proyecto, config_key) para config de alcance de proyecto,
-- compartida por todos los Casos (hoy ninguna clave activa cae acá, pero el mecanismo lo sigue
-- soportando -- ver FEATURE-011).
create unique index one_current_project_scoped_config
  on project_config_versions (project_id, config_key)
  where valid_to is null and root_run_id is null;
