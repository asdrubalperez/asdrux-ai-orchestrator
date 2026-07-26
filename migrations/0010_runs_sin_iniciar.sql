-- FEATURE-017: soporte para el estado 'sin_iniciar' en runs. runs.status no tiene CHECK
-- constraint (texto libre, ver migrations/0001_init.sql) — agregar el valor nuevo no requiere
-- tocar el schema. pipeline_definition_id se mantiene NOT NULL: se resuelve en el momento de la
-- confirmación (cuando el caso pasa a sin_iniciar), no en el arranque — decisión DAIA verificada
-- contra el repo real (docs/features/FEATURE-017-*.md, sección 7.2).

alter table runs add column business_case jsonb;
