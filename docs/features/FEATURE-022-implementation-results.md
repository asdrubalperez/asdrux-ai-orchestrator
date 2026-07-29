# FEATURE-022 — Resultados de implementación

Fecha: 2026-07-28

Rama: `codex/feature-022-artifact-read`

Estado: implementada, validada y mergeada a `main` (`4e4f209`). La validación funcional conjunta
continuará con FEATURE-023 Parte 1 y FEATURE-023 Parte 2.

## 1. Resultado

Se incorporaron `artifact_list` y `artifact_read` al catálogo cerrado de los cinco roles para
Claude Code y Codex. El run solicitante queda ligado por el Orquestador al crear cada Executor y
no forma parte de los argumentos controlables por el agente.

El worker aislado accede a artifacts mediante un proxy host confiable por Unix socket. Socket y
token son efímeros por invocación; el worker no recibe credenciales PostgreSQL, `project_id` ni
`requestingRunId`.

## 2. Contratos implementados

- Aislamiento por el proyecto del run solicitante.
- `ARTIFACT_NOT_FOUND` indistinguible para artifact inexistente o de otro proyecto.
- Listado ordenado por `(created_at DESC, id DESC)`, cursor opaco, límite default 20 y máximo 100.
- Filtros v1 por `runId`, `kind`, `phase`, `createdAfter` y `createdBefore`.
- Metadata sin Feature/Release; `producerRole` derivado de `phase` cuando representa un rol válido.
- Resumen limitado a 2 KiB UTF-8, con `summaryTruncated`.
- Lectura completa hasta 64 KiB de JSON UTF-8; por encima devuelve `content: null`,
  `complete: false` y `reason: "CONTENT_TOO_LARGE"`.
- Logs técnicos estructurados sin contenido, resumen ni filtros.
- Sin migraciones, tablas, columnas, índices, auditoría persistida ni `run_event` por lectura.

## 3. Validación automatizada

Local Windows:

```text
npm test: 132 tests; 125 pass; 0 fail; 7 skips dependientes de Linux/Docker/PostgreSQL
npm run build: pass
```

VPS Linux con PostgreSQL y Docker reales:

```text
npm test: 132 tests; 132 pass; 0 fail; 0 skipped
npm run build: pass
```

La suite VPS verificó, entre otros casos:

- aislamiento por proyecto y filtro `runId` externo;
- mismo error para artifact inexistente y externo;
- run solicitante inexistente o sin proyecto;
- empate temporal y paginación por cursor;
- límite de resumen y límite de contenido;
- artifacts históricos con `phase` no reconocido;
- logs sin contenido ni resumen;
- catálogo parametrizado de los cinco roles en ambos providers;
- los cinco workers Docker leyendo PostgreSQL sólo mediante el proxy;
- QA operativo con `--network none`;
- ausencia de credenciales DB en el worker.

## 4. Smokes reales por provider

Se ejecutó una invocación real de Architect por provider contra un run existente del proyecto.
La evidencia se tomó de eventos efectivos del worker, no de lo declarado por el modelo:

```text
Claude: completed; calls = artifact_list, artifact_read
Codex:  completed; calls = artifact_list, artifact_list, artifact_read
```

Ambos providers recibieron el catálogo universal y completaron una lectura real. Los logs del
proxy registraron operación, run, rol, resultado, cantidad o artifact ID y duración, sin contenido
ni resumen.

## 5. Plan SQL

Se revisó la consulta de listado con `EXPLAIN (ANALYZE, BUFFERS)` sobre la base real de la VPS:

```text
Execution Time: 9.197 ms
artifacts: 189 filas
runs: 70 filas
orden: top-N heapsort
```

El plan usa scans secuenciales sobre el volumen actual y mantiene un costo acotado. La evidencia
no contradice la decisión aprobada de evitar un índice nuevo en v1; el plan deberá reevaluarse si
el volumen real crece materialmente.

## 6. Roadmap y consistencia

`docs/ROADMAP.md` incorpora FEATURE-022 y desplaza las Features posteriores:

- Lifecycle canónico de Features: FEATURE-023.
- Milestone 2 E2E: FEATURE-024.
- Selección de provider/modelo/credenciales: FEATURE-025.
- Credenciales git por usuario: FEATURE-026.

También se corrigieron las referencias históricas afectadas en FEATURE-019. No quedaron IDs
duplicados, enlaces a nombres renumerados ni contradicciones adicionales sin resolver.

## 7. Alcance preservado

No se implementó lifecycle documental, lectura parcial, filtros por Feature/Release ni cambios de
escritura. No se modificó la base de datos y no se amplió el alcance hacia otras Features.
