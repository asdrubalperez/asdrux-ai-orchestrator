-- FEATURE-043, hallazgo de prueba manual del owner (2026-08-02): la descripción de
-- `rama_base_trabajo` se inyecta tal cual en el prompt de mapeo (buildMappingPrompt,
-- src/intake/mapBusinessCase.ts) y decía literalmente 'default "main" si no se indica' -- el
-- modelo cumplía al pie de la letra y devolvía "main" en vez de null cuando el texto no mencionaba
-- ninguna rama, lo que dejaba sin efecto la sugerencia automática (`withDefaults` en
-- ReviewModal.tsx solo actúa cuando el campo llega vacío). Se retira la instrucción de default: la
-- Regla 1 general del prompt ("nunca inventes, si no se menciona va en null") ya cubre este campo
-- igual que a cualquier otro; el default visual sigue existiendo, pero como sugerencia editable del
-- frontend, nunca como valor inventado por el modelo.
update intake_field_definitions
set description = 'Rama base sobre la que arranca el trabajo, solo si el texto la menciona explícitamente. Si no se menciona, no la inventes -- se sugiere automáticamente a partir del resto del caso.',
    updated_at = now()
where field_key = 'rama_base_trabajo';
