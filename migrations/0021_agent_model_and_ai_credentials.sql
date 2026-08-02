-- FEATURE-025-Parte-1: modelo por agente + credenciales de IA propias por usuario.
-- Diseño aprobado en docs/features/FEATURE-025-Parte-1-Asistente-Modelo-y-Credenciales-API-por-Agente.md
-- (secciones 7.1/7.2).

-- Cambio aditivo: modelo persistido junto a la configuración de asistente/authMode ya existente
-- (FEATURE-016). Nullable -- filas existentes quedan sin modelo hasta que el usuario configure uno;
-- la resolución en runtime decide qué hacer con un modelo ausente (fuera del alcance de esta
-- migración).
alter table user_agent_config
  add column model text;

-- Misma convención de almacenamiento que user_git_connections (FEATURE-026, migrations/0015):
-- un solo campo de texto con el ciphertext ya empaquetado (formato "v1.<iv>.<authTag>.<ciphertext>",
-- ver src/auth/gitCredentialEncryption.ts) en vez de columnas separadas de iv/authTag -- evita
-- reinventar el formato de almacenamiento que ya está probado en producción.
create table user_ai_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  provider text not null,
  credential_ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_ai_provider_credentials_provider_check
    check (provider in ('claude', 'codex'))
);

-- Sección 7.2: restricción única (user_id, provider) -- una sola credencial vigente por usuario y
-- proveedor; sustituir una API key hace UPDATE in-place (Regla 5.6.7/5.6.9: no se versionan
-- secretos antiguos).
create unique index one_ai_credential_per_user_provider
  on user_ai_provider_credentials(user_id, provider);
