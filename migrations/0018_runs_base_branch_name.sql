-- FEATURE-043, sección 7.1: ubicación persistente propia para la rama base de trabajo del caso,
-- separada de `business_case` (JSON descriptivo) y de `branch_name` (rama efectiva del worktree/
-- checkout del run, ver sección 5.8 del diseño -- son dos conceptos distintos, no se reutiliza la
-- misma columna). Nullable: runs históricos no la tienen; el resolver cae a
-- `business_case.rama_base_trabajo` cuando está vacía (sección 7.5/7.12, sin backfill).
alter table runs
  add column base_branch_name text;
