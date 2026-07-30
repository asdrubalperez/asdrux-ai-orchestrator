-- FEATURE-031: `canales` se define funcionalmente como texto descriptivo, no como lista
-- estructurada. Verificado antes de este cambio: ninguna fila de `runs.business_case` tiene
-- `canales` persistido como array (`select business_case->'canales' from runs where
-- jsonb_typeof(business_case->'canales') = 'array'` -> 0 filas en dev/VPS), y ni
-- `mapBusinessCase.ts` (parseMappingResponse trata todo campo como `string | null`) ni
-- `ReviewModal.tsx` (renderiza `textarea` y `list` en la misma rama) le dan hoy ningún tratamiento
-- funcional distinto a `list` respecto de `textarea`. No se requiere compatibilidad de lectura
-- para datos históricos ni migración de datos: el cambio es puramente de metadata.
update intake_field_definitions
set field_type = 'textarea',
    updated_at = now()
where field_key = 'canales';
