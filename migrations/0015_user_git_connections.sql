-- FEATURE-026: autenticación GitHub por usuario para operaciones Git.
-- Modelo de datos aprobado, secciones 7.1 (user_git_connections) y 7.2 (oauth_states).

create table user_git_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  provider text not null,
  external_user_id text not null,
  external_login text not null,
  access_token_ciphertext text not null,
  granted_scopes text[] not null default '{}',
  status text not null default 'connected',
  connected_at timestamptz not null default now(),
  last_validated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_git_connections_provider_check
    check (provider = 'github'),

  constraint user_git_connections_status_check
    check (status in ('connected', 'invalid', 'revoked'))
);

-- Regla 2: una conexión activa por usuario y proveedor.
create unique index one_git_connection_per_user_provider
  on user_git_connections(user_id, provider);

-- Regla 3: una identidad externa de GitHub no puede vincularse a dos usuarios del Orquestador.
create unique index one_orchestrator_user_per_external_git_identity
  on user_git_connections(provider, external_user_id);

-- Regla 11 / sección 7.2: estados OAuth de vida corta, un solo uso, asociados a usuario y sesión.
create table oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  session_id uuid not null references sessions(id),
  provider text not null,
  state_hash text not null,
  return_path text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint oauth_states_provider_check
    check (provider = 'github')
);

create unique index oauth_states_state_hash_unique
  on oauth_states(state_hash);
