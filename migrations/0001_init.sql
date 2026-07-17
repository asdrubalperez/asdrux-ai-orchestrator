-- FEATURE-003: schema inicial de las 4 tablas definidas en docs/playbook/02-ARCHITECTURE.md, sección 5.
-- Columnas técnicas (id, timestamps, status, branch_name, worktree_path) agregadas como parte de la
-- traducción a un schema real — no estaban en la descripción conceptual, documentadas como hallazgo
-- en docs/features/FEATURE-003-implementation-results.md en vez de forzarse en silencio.

create extension if not exists "pgcrypto";

create table pipeline_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version integer not null,
  definition jsonb not null, -- secuencia de fases y reglas de transición
  created_at timestamptz not null default now(),
  unique (name, version)
);

create table runs (
  id uuid primary key default gen_random_uuid(),
  pipeline_definition_id uuid not null references pipeline_definitions (id),
  owner_id text not null,
  current_phase text,
  status text not null default 'running',
  branch_name text,
  worktree_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index runs_owner_id_idx on runs (owner_id);
create index runs_status_idx on runs (status);

create table run_events (
  id bigserial primary key, -- monotonic, sirve como Last-Event-ID para reconexión SSE futura
  run_id uuid not null references runs (id),
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index run_events_run_id_idx on run_events (run_id);

create table artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs (id),
  phase text not null, -- agentRole que lo produjo
  kind text not null, -- 'design' | 'code_ref' | etc.
  content jsonb, -- texto/JSON directo (diseño); null si es referencia a código
  commit_ref text, -- referencia a commit/PR; git es la fuente de verdad, no se duplica el código
  created_at timestamptz not null default now()
);

create index artifacts_run_id_idx on artifacts (run_id);
