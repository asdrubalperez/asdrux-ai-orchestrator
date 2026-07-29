# FEATURE-023 — Resultados de implementación

Fecha: 2026-07-28

Rama: `codex/feature-023-lifecycle`

Estado: implementada y validada en suites local y VPS. La primera prueba E2E real fue suspendida
por decisión del owner; continuará después de FEATURE-023 Parte 2.

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

## 5. E2E suspendido y validación conjunta pendiente

La primera prueba E2E real comenzó con el run
`f1cd4011-4c0d-4b00-be92-28c516cbd7b7`. Architect y Functional completaron, pero el
postprocesamiento falló porque FEATURE-023 intentó leer
`docs/runbook/07-FEATURE-TEMPLATE.md` desde el worktree de `tempo-auto-planner`.

El Runbook es un activo del Orquestador y no puede exigirse al repositorio gestionado. El owner
suspendió las pruebas de FEATURE-023 Parte 1 y creó FEATURE-023 Parte 2 para diseñar e implementar
su distribución, versionado y disponibilidad en runtime.

Al finalizar la Parte 2 se ejecutará una única validación conjunta de:

- FEATURE-022 — lectura universal de artifacts;
- FEATURE-023 Parte 1 — lifecycle canónico de Features;
- FEATURE-023 Parte 2 — disponibilidad propia del Runbook.

La evidencia deberá demostrar el circuito completo, incluido commit, push, SHA remoto, lectura por
FEATURE-022, recuperación UI y continuidad según el modo configurado.

## 6. Alcance preservado

No se implementó lifecycle de Project Brief, Architecture o Release Plan; no se agregó backfill;
no se creó un parser Markdown genérico; no se incorporó edición humana desde UI; no se implementó
como capacidad del producto el merge a `main`. El merge de entrega de esta implementación fue
autorizado separadamente por el owner.
