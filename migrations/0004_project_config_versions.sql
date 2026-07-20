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
