# FEATURE-011 — Resultados de implementación: Configuración vigente por proyecto

Fecha de implementación: 2026-07-19
Rama: `codex/feature-011-project-config-versions`

## Resumen

Se implementó la persistencia versionada de configuración por proyecto con una tabla dedicada
append-only por `project_id` + `config_key`, un índice único parcial para garantizar una sola
versión vigente, y una tabla puente para registrar qué versiones estaban vigentes al iniciar un
run.

## Qué se implementó

- `migrations/0004_project_config_versions.sql`: tablas `project_config_versions` y
  `run_config_versions`, índice único `one_current_project_config` e índice de historial
  `project_config_history_lookup`.
- `src/db/repository.ts`: funciones `getCurrentProjectConfig`, `getCurrentProjectConfigs`,
  `setProjectConfig`, `getProjectConfigHistory` y `recordRunConfigVersions`.
- `src/cli/commands/runStart.ts`: creación del run, snapshot de configuración y evento
  `run_started` dentro de una misma transacción.
- `docs/features/FEATURE-011-project-config-versions.md`: documento aprobado registrado en el
  repo.
- `docs/ROADMAP.md`: renumeración confirmada de FEATURE-012 y FEATURE-013.
- `docs/runbook/`: reemplazo del marcador `[PENDIENTE-DB-PROJECTS]` por la referencia real a
  `project_config_versions`.

## Validación

- `npx.cmd tsc --noEmit`: compila sin errores.
- `node --test --import tsx src\executor\codexExecutor.parser.test.ts src\pipelines\extractTestCommand.test.ts`:
  4/4 tests pasan.
- `npm.cmd run migrate`: aplicó `0004_project_config_versions.sql` en la DB dev configurada.
- Validación real con datos temporales:
  - primera escritura y actualización de `approval_model`;
  - lectura vigente con `getCurrentProjectConfig`;
  - lectura bulk con `getCurrentProjectConfigs`;
  - historial con dos versiones y una sola vigente;
  - intento manual de doble vigente rechazado por `unique_violation`;
  - `recordRunConfigVersions` registra las dos configuraciones vigentes de un run;
  - el snapshot del run conserva la versión histórica aunque luego cambie la vigente;
  - run con `project_id = null` registra cero filas y no falla.

## Lecciones aprendidas

- Para este tipo de feature, la evidencia mínima útil no es solo compilación: hace falta probar la
  restricción real de Postgres y la lectura posterior del snapshot.
- `recordRunConfigVersions` depende de ser invocado una sola vez al inicio del run; la Feature lo
  define como regla de invocación, no como constraint adicional.
