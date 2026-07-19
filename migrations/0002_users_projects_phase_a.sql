create table users (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique,
  password_hash text,
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  repo_path text not null,
  owner_id uuid not null references users (id),
  created_at timestamptz not null default now()
);

alter table runs add column owner_id_new uuid references users (id);
alter table runs add column project_id uuid references projects (id);

create index projects_owner_id_idx on projects (owner_id);
create index runs_project_id_idx on runs (project_id);
