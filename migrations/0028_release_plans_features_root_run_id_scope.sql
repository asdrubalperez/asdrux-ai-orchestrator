-- FEATURE-046 (alcance A): scoping por Caso de negocio (`root_run_id`) en `release_plans` y
-- `features`. Sin esto, dos Casos de negocio distintos del mismo proyecto que reutilizan el mismo
-- `release_key`/`source_key` (comportamiento normal: Architect/Planning nombran los releases con
-- IDs genéricos tipo "r1") colisionan sobre la misma fila -- mezcla silenciosa de contenido en
-- `release_plans` (`mergeFeaturePlan`) y sobrescritura silenciosa o escalación confusa en
-- `features`. Mismo patrón ya usado por `created_in_run_id`: `root_run_id` se resuelve una única
-- vez, al crear la fila, como `coalesce(runs.root_run_id, runs.id)` del run que la crea.

alter table release_plans add column root_run_id uuid references runs (id);
alter table features add column root_run_id uuid references runs (id);

-- Backfill determinístico: created_in_run_id es `not null` en ambas tablas, así que todo run
-- referenciado existe y tiene (posiblemente NULL) root_run_id propio.
update release_plans rp
set root_run_id = coalesce(r.root_run_id, r.id)
from runs r
where r.id = rp.created_in_run_id;

update features f
set root_run_id = coalesce(r.root_run_id, r.id)
from runs r
where r.id = f.created_in_run_id;

alter table release_plans alter column root_run_id set not null;
alter table features alter column root_run_id set not null;

alter table release_plans drop constraint release_plans_project_id_release_key_key;
alter table release_plans
  add constraint release_plans_project_id_release_key_root_run_id_key
  unique (project_id, release_key, root_run_id);

alter table features drop constraint features_project_id_release_key_source_key_key;
alter table features
  add constraint features_project_id_release_key_source_key_root_run_id_key
  unique (project_id, release_key, source_key, root_run_id);

-- unique(project_id, feature_code) sin cambios -- la numeración de FEATURE-XXX sigue siendo
-- continua por proyecto, no por Caso.
