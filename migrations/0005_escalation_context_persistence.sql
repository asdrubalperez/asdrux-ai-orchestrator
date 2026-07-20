alter table runs
  add column originated_from_run_id uuid references runs (id);

create index runs_originated_from_run_id_idx
  on runs (originated_from_run_id);
