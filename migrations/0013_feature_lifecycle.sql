-- FEATURE-023: identidad documental estable, revisiones append-only y correlación con el run.
create table features (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id),
  release_key text not null,
  source_key text not null,
  feature_code text not null,
  name text not null,
  priority text not null,
  template_key text not null,
  template_version text not null,
  template_hash text not null,
  template_snapshot jsonb not null,
  canonical_artifact_id uuid references artifacts (id),
  final_document_path text not null,
  activated_at timestamptz,
  document_hash text,
  final_commit_sha text,
  pushed_branch text,
  pushed_at timestamptz,
  created_in_run_id uuid not null references runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, release_key, source_key),
  unique (project_id, feature_code)
);

create table feature_revisions (
  id uuid primary key default gen_random_uuid(),
  feature_id uuid not null references features (id),
  sequence bigint not null,
  contribution_id text not null,
  source_event_key text not null,
  section_key text not null,
  operation text not null,
  content jsonb not null,
  producer_role text not null,
  producer_run_id uuid not null references runs (id),
  attempt integer,
  created_at timestamptz not null default now(),
  unique (feature_id, sequence),
  unique (feature_id, source_event_key),
  check (attempt is null or attempt >= 1),
  check (producer_role in ('functional', 'planning', 'developer', 'qa')),
  check (operation in ('replace_section', 'append_entry', 'record_qa_result', 'record_readiness'))
);

alter table runs
  add column active_feature_id uuid references features (id);

create index runs_active_feature_id_idx on runs (active_feature_id);
