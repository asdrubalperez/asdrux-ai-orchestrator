# FEATURE-023 — Resultados de implementación

Fecha: 2026-07-28

Rama: `codex/feature-023-lifecycle`

Estado: implementada y validada en suites local y VPS; pendiente del E2E controlado y de la
revisión del owner antes de cualquier merge a `main`.

## 1. Resultado

Se implementó el lifecycle canónico de documentos de Feature basado en el Runbook. La identidad
documental estable se persiste en `features`; las contribuciones aceptadas se registran como
revisiones append-only en `feature_revisions`; y `runs.active_feature_id` correlaciona el run con la
Feature activa.

Functional crea el lote inicial, Planning selecciona la siguiente Feature y Developer/QA aportan
actualizaciones estructuradas. La materialización Markdown es determinista, conserva Unicode y
protege la ruta documental. El cierre técnico registra commit, push y SHA remoto sin implementar
como capacidad del producto el merge hacia `main`.

## 2. Contratos implementados

- Schemas cerrados y normalización equivalente para las salidas de Claude y Codex.
- Prioridad limitada por aplicación al contrato vigente `P0 | P1 | P2`.
- Identidad estable por proyecto, release y `sourceKey`.
- Revisiones append-only con secuencia, idempotencia y ownership por sección.
- Proyección Markdown determinista desde revisiones persistidas.
- Correlación del run mediante `active_feature_id`.
- Flujo Developer → Build → QA → readiness antes de materializar y publicar.
- Commit y push en la rama de Feature, con SHA remoto verificable.
- Recuperación de `featureDocument` en `GET /runs/:id` y acceso desde la UI.
- Preservación exacta de los modos de aprobación existentes `manual` y `auto`.

## 3. Cambios de datos

La migración `0013_feature_lifecycle.sql` incorpora:

- tabla `features`;
- tabla `feature_revisions`;
- columna nullable `runs.active_feature_id`;
- índice `runs_active_feature_id_idx`;
- FKs, unicidades y checks definidos por el diseño aprobado.

No se agregaron enums PostgreSQL ni estados documentales paralelos.

## 4. Validación automatizada

Local Windows:

```text
npm test: 142 tests; 135 pass; 0 fail; 7 skips dependientes de Linux/Docker/PostgreSQL
npm run build: pass
git diff --check: pass
```

VPS Linux, sobre el commit de implementación `9a2bfc4`, en un worktree aislado:

```text
npm test: 142 tests; 142 pass; 0 fail; 0 skipped
npm run build: pass
```

La suite VPS incluyó PostgreSQL real, Docker, los cinco workers aislados, el proxy confiable de
artifacts y los tests de contratos, lifecycle, documento, Git, pipeline y UI.

La migración se aplicó además dentro de una transacción real. Se verificaron tablas, columna,
restricciones e índice y luego se ejecutó `ROLLBACK`; el esquema quedó idéntico a su estado previo.
El checkout principal y sus cambios locales en la VPS no fueron modificados.

## 5. Evidencia pendiente

Permanece pendiente el único E2E real con una Feature controlada y un provider real requerido por
el documento. Ese ejercicio deberá aplicar previamente la migración en el entorno elegido y
demostrar el circuito completo, incluido commit, push, SHA remoto, lectura por FEATURE-022,
recuperación UI y continuidad según el modo configurado.

No se ejecutó este E2E durante la validación automatizada para no persistir migraciones, crear
Features, consumir un provider ni publicar una rama de run sin separar explícitamente esa evidencia
de la revisión técnica de la rama.

## 6. Alcance preservado

No se implementó lifecycle de Project Brief, Architecture o Release Plan; no se agregó backfill;
no se creó un parser Markdown genérico; no se incorporó edición humana desde UI; no se implementó
merge a `main`; y no se modificó ni publicó `main`.
