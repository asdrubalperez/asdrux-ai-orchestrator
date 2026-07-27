-- FEATURE-020, sección 6.1: root_run_id se resuelve una única vez al crear el run (createRun /
-- createRunPendingStart) — self si es raíz, heredado del padre si no. Sin backfill para runs
-- preexistentes (Regla 13, decisión explícita del owner): quedan en NULL.
alter table runs
  add column root_run_id uuid references runs (id);

create index runs_root_run_id_idx
  on runs (root_run_id);
