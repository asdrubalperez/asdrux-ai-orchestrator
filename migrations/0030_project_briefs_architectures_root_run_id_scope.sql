-- FEATURE-047: scoping por Caso de negocio (`root_run_id`) en `project_briefs` y `architectures`.
-- Mismo patrón exacto que FEATURE-046 (alcance A, `release_plans`/`features`): sin esto, dos Casos
-- de negocio distintos del mismo proyecto colisionan sobre la única fila permitida por
-- `unique(project_id)` -- sobrescritura silenciosa del Project Brief/Architecture del primer Caso al
-- completar la fase de Architect del segundo. `root_run_id` se resuelve una única vez, al crear la
-- fila, como `coalesce(runs.root_run_id, runs.id)` del run que la crea -- mismo patrón ya usado por
-- `created_in_run_id`.

alter table project_briefs add column root_run_id uuid references runs (id);
alter table architectures add column root_run_id uuid references runs (id);

-- Backfill determinístico: created_in_run_id es `not null` en ambas tablas, así que todo run
-- referenciado existe y tiene (posiblemente NULL) root_run_id propio.
update project_briefs pb
set root_run_id = coalesce(r.root_run_id, r.id)
from runs r
where r.id = pb.created_in_run_id;

update architectures a
set root_run_id = coalesce(r.root_run_id, r.id)
from runs r
where r.id = a.created_in_run_id;

alter table project_briefs alter column root_run_id set not null;
alter table architectures alter column root_run_id set not null;

alter table project_briefs drop constraint project_briefs_project_id_key;
alter table project_briefs
  add constraint project_briefs_project_id_root_run_id_key
  unique (project_id, root_run_id);

alter table architectures drop constraint architectures_project_id_key;
alter table architectures
  add constraint architectures_project_id_root_run_id_key
  unique (project_id, root_run_id);
