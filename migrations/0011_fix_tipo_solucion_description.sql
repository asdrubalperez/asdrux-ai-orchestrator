-- FEATURE-017, hallazgo de la prueba end-to-end del owner (2026-07-25): la descripción sembrada
-- de tipo_solucion en 0009 mencionaba el valor técnico "mejora_existente" tal cual, en vez de un
-- texto legible. migrations/0009 ya corrige el texto para instalaciones nuevas — este UPDATE
-- puntual corrige la fila ya sembrada en entornos donde 0009 ya corrió (dev, VPS).
update intake_field_definitions
set description = 'nueva o "mejora de una solución ya existente". No condiciona ningún otro campo en el MVP.',
    updated_at = now()
where field_key = 'tipo_solucion';
