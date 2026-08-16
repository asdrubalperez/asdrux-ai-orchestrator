-- FEATURE-034: identidad documental estable y única por proyecto para Architecture. Mismo patrón
-- que `project_briefs` (FEATURE-033): un solo productor (Architect), sin revisiones append-only en
-- v1 -- el historial se conserva vía las filas inmutables de `artifacts` (kind = 'architecture_document')
-- y `architectures.canonical_artifact_id` apunta sólo a la vigente.
create table architectures (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id),
  source_event_key text not null,
  template_key text not null,
  template_version text not null,
  template_hash text not null,
  template_snapshot jsonb not null,
  canonical_artifact_id uuid references artifacts (id),
  final_document_path text not null default 'docs/architecture/ARCHITECTURE.md',
  document_hash text,
  created_in_run_id uuid not null references runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);
