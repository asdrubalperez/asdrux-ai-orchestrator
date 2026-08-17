-- FEATURE-035: identidad documental del Release Plan, uno por release (no uno por proyecto como
-- project_briefs/architectures) -- unique(project_id, release_key). Sin revisions v1: el runtime
-- acumula los bloques de §2 (Enfoque Técnico + Test Plan por Feature) directamente en artifacts
-- inmutables sucesivos, cada uno ya la proyección completa acumulada hasta ese punto.
create table release_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id),
  release_key text not null,
  source_event_key text not null,
  template_key text not null,
  template_version text not null,
  template_hash text not null,
  template_snapshot jsonb not null,
  canonical_artifact_id uuid references artifacts (id),
  final_document_path text not null,
  document_hash text,
  created_in_run_id uuid not null references runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, release_key)
);
