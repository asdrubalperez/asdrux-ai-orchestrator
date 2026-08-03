-- FEATURE-025-Parte-2: conexiones OAuth personales por usuario y proveedor de IA, reemplazando el
-- caché global compartido de cli_session (CLAUDE_OAUTH_CACHE_DIR/CODEX_OAUTH_CACHE_DIR).
-- Diseño aprobado en docs/features/FEATURE-025-Parte-2-OAuth-Personal-por-Proveedor-de-IA.md,
-- sección 7.1.

create table user_ai_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  provider text not null,
  -- Envelope cifrado completo (version/provider/ciphertext/iv/authTag empaquetados como JSON,
  -- ver src/auth/aiOAuthSessionEnvelope.ts) -- opaco, nunca se extraen tokens a columnas propias
  -- (Regla 5.8.6).
  encrypted_session text not null,
  -- Regla 5.4: connected | reauth_required. La ausencia de fila representa not_connected -- nunca
  -- un tercer valor persistido para eso.
  status text not null default 'connected',
  -- Regla 7.3: toda actualización condiciona por (id, session_version) -- compare-and-swap.
  session_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_validated_at timestamptz,
  reauth_required_at timestamptz,

  constraint user_ai_oauth_connections_provider_check
    check (provider in ('claude', 'codex')),
  constraint user_ai_oauth_connections_status_check
    check (status in ('connected', 'reauth_required')),
  constraint user_ai_oauth_connections_session_version_check
    check (session_version > 0)
);

-- Regla 5.1.3: como máximo una conexión vigente por (user_id, provider).
create unique index one_ai_oauth_connection_per_user_provider
  on user_ai_oauth_connections(user_id, provider);
