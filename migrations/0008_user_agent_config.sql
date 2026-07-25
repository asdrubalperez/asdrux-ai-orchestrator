create table user_agent_config (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  role text,
  executor_provider text not null,
  auth_mode text not null default 'api_key',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_agent_config_role_check
    check (role is null or role in ('architect', 'functional', 'planning', 'developer', 'qa')),
  constraint user_agent_config_provider_check
    check (executor_provider in ('claude', 'codex')),
  constraint user_agent_config_auth_mode_check
    check (auth_mode in ('api_key', 'cli_session'))
);

-- Una sola fila global (role IS NULL) por usuario.
create unique index one_global_agent_config_per_user
  on user_agent_config (user_id)
  where role is null;

-- Una sola fila de override por (usuario, rol) cuando role no es null.
create unique index one_role_agent_config_per_user
  on user_agent_config (user_id, role)
  where role is not null;
