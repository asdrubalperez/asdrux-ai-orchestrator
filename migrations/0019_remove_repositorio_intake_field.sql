-- FEATURE-043, sección 5.1/7.2: `repositorio` quedó como campo fantasma tras FEATURE-042 -- el
-- mapeo por IA lo seguía pidiendo y el modelo lo seguía extrayendo del texto libre, pero
-- `confirmIntakeForProject` lo descartaba antes de persistir (el repositorio operativo siempre
-- sale de `project.repository_clone_url`). Se elimina la fila para que deje de formar parte del
-- prompt de mapeo de casos nuevos. No afecta runs históricos: su `business_case.repositorio` ya
-- persistido sigue intacto y sigue funcionando como fallback legacy en `startPendingRun` (sección
-- 5.2, no depende de esta tabla de definiciones).
delete from intake_field_definitions where field_key = 'repositorio';
