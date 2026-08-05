-- FEATURE-041: creación y gestión de cuentas de usuario (self-service).
-- Diseño aprobado en
-- docs/features/FEATURE-041-Creacion-y-gestion-de-cuentas-de-usuario-self-service.md.
--
-- Nota de diseño (Regla 5.4): el login existente sigue siendo por `users.handle` (columna ya
-- existente, sin tocar) -- no se migra la cuenta ya existente del owner a un handle basado en
-- email, para no romper su login actual. Las cuentas nuevas de self-service usan el email
-- normalizado (minusculas) como `handle` (aplicado en el servicio de registro, no en esta
-- migración), reutilizando la unicidad y el flujo de login por handle ya existentes
-- (src/auth/webSession.ts:createWebLoginSession -> findUserByHandle). `email` es la columna nueva
-- que preserva el valor mostrado al usuario tal cual lo escribió.

alter table users
  add column email text,
  add column display_name text,
  add column role text not null default 'user',
  add column status text not null default 'pending_verification',
  add column email_verified_at timestamptz,
  add column last_login_at timestamptz,
  -- Regla 5.8/revalidación 7: marca técnica estable de protección del superadmin -- nunca
  -- expuesta como editable por ningún endpoint, nunca condicionada por nombre visible o email.
  add column is_protected_superadmin boolean not null default false;

alter table users
  add constraint users_role_check check (role in ('user', 'admin', 'superadmin')),
  add constraint users_status_check
    check (status in ('pending_verification', 'active', 'suspended'));

-- Email único solo cuando está presente -- las cuentas admin-preexistentes sin email (hoy
-- ninguna, ver backfill más abajo) no entran en conflicto entre sí.
create unique index users_email_unique_idx on users (email) where email is not null;

-- Tokens de un solo uso para verificación de email, recuperación de contraseña y activación de
-- cuentas creadas por un administrador. Mismas propiedades de seguridad para las tres (Regla 5.5):
-- aleatorios, hash únicamente, expiración, uso único, revocables por reenvío.
create table account_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  token_hash text not null,
  purpose text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,

  constraint account_tokens_purpose_check
    check (purpose in ('email_verification', 'password_reset', 'account_activation'))
);

create unique index account_tokens_token_hash_idx on account_tokens (token_hash);
create index account_tokens_user_purpose_idx on account_tokens (user_id, purpose);

-- Perfiles de configuración de agente por cuenta (hasta 3, límite validado en el servicio de
-- aplicación, no en la base -- Regla 5.10). "Global" no es una fila de esta tabla: es la fila
-- existente de user_agent_config con role IS NULL, que ya representaba la config de cuenta.
create table agent_config_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- user_agent_config pasa a tener 2 formas válidas (Regla 5.10):
--   role IS NULL,     profile_id IS NULL     -> Global (config de cuenta, ya existía)
--   role IS NOT NULL, profile_id IS NOT NULL -> override de un agente dentro de un perfil
-- La forma antigua (role IS NOT NULL, profile_id IS NULL: "override suelto sin perfil") deja de
-- ser válida -- los overrides por rol ahora solo existen dentro de un perfil.
alter table user_agent_config
  add column profile_id uuid references agent_config_profiles (id) on delete cascade;

alter table user_agent_config
  add constraint user_agent_config_role_profile_check
    check ((role is null and profile_id is null) or (role is not null and profile_id is not null));

drop index if exists one_role_agent_config_per_user;

create unique index one_role_agent_config_per_profile
  on user_agent_config (user_id, profile_id, role)
  where role is not null and profile_id is not null;

-- Selección de configuración por proyecto (Regla 5.3/5.10): null = Global, no-null = un perfil del
-- mismo dueño del proyecto (verificado en el servicio, Regla 5.7 -- nunca solo en la base).
alter table projects
  add column agent_config_profile_id uuid references agent_config_profiles (id) on delete set null;

-- Backfill de datos reales (confirmado contra el VPS el 2026-08-04: un solo usuario, `asdru`,
-- sin overrides por rol -- solo la fila global). Ver Riesgo 15: los overrides por rol existentes
-- se eliminan sin migrarse a Global ni a ningún perfil, decisión explícita del owner.
delete from user_agent_config where role is not null and profile_id is null;

update users
set
  email = 'asdrubalperez@gmail.com',
  display_name = 'Asdrúbal Pérez',
  role = 'superadmin',
  status = 'active',
  email_verified_at = now(),
  is_protected_superadmin = true
where handle = 'asdru';

-- Cualquier otra cuenta preexistente (no debería haber ninguna hoy fuera de 'asdru') queda activa
-- y verificada de forma retroactiva, para no invalidar accesos existentes (sección "Migración").
update users
set status = 'active', email_verified_at = now()
where handle <> 'asdru' and status = 'pending_verification';
