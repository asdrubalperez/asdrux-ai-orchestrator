-- FEATURE-033: identidad documental estable y única por proyecto para el Project Brief.
-- A diferencia de FEATURE-023 (features/feature_revisions), no hay evidencia de contribución
-- incremental multi-rol: un solo productor (Architect), sin revisiones append-only. Historial
-- de contenido se conserva vía las filas inmutables de `artifacts` (kind = 'project_brief_document');
-- `project_briefs.canonical_artifact_id` sólo apunta a la vigente, mismo patrón de puntero mutable
-- que `features.canonical_artifact_id`.
create table project_briefs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id),
  source_event_key text not null,
  template_key text not null,
  template_version text not null,
  template_hash text not null,
  template_snapshot jsonb not null,
  canonical_artifact_id uuid references artifacts (id),
  final_document_path text not null default 'docs/project/PROJECT-BRIEF.md',
  document_hash text,
  created_in_run_id uuid not null references runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);
