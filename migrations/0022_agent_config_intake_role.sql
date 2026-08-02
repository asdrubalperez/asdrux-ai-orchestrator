-- FEATURE-025-Parte-1 (ampliación, 2026-08-02): el mapeo de intake (texto libre -> campos del
-- caso de negocio, src/intake/mapBusinessCase.ts) hasta ahora llamaba directo a la API de
-- Anthropic con la clave global del host -- justo el mecanismo que esta Feature retira para los
-- 5 roles reales del pipeline. Decisión del owner: tratarlo con exactamente el mismo mecanismo,
-- como un sexto "rol" configurable más (override propio o herencia de la config global), en vez
-- de inventar un concepto de configuración aparte.
alter table user_agent_config
  drop constraint user_agent_config_role_check;

alter table user_agent_config
  add constraint user_agent_config_role_check
    check (role is null or role in ('architect', 'functional', 'planning', 'developer', 'qa', 'intake'));
