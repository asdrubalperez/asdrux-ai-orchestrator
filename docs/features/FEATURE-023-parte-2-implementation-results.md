# FEATURE-023 Parte 2 — Resultados de implementación

Fecha: 2026-07-28

Rama: `codex/feature-023-runbook-runtime-part-2`

Estado: implementada y validada en suites local y VPS. La validación E2E conjunta de
FEATURE-022, FEATURE-023 Parte 1 y FEATURE-023 Parte 2 permanece pendiente de ejecución y de
validación final por el owner.

## 1. Resultado

El Runbook se distribuye como assets read-only versionados dentro de `assets/runbook/`. El runtime
los resuelve exclusivamente mediante `RunbookProvider`, desde una raíz absoluta derivada de la
instalación y sin depender del `cwd` ni del repositorio gestionado.

El servidor valida antes de quedar operativo el catálogo obligatorio vigente: `VERSION` y
`07-FEATURE-TEMPLATE.md`. La persistencia Functional vuelve a leer el template antes de registrar
la fase como completada y antes de abrir la transacción documental.

## 2. Contratos implementados

- Versión inicial explícita `v1.0`.
- Hash SHA-256 calculado sobre los bytes efectivamente leídos.
- Rechazo de paths absolutos, traversal normalizado o codificado y escapes mediante symlink.
- Errores controlados para raíz inválida, versión ausente/no soportada y asset ausente/ilegible.
- Catálogo cerrado limitado a funcionalidades actualmente habilitadas.
- Paridad automatizada entre `docs/runbook/*.md` y los assets distribuidos.
- Persistencia de versión, hash y snapshot del template consumido por FEATURE-023 Parte 1.
- Rutas canónicas y separación entre baseline del Orquestador y documentos del producto
  documentadas en `docs/runbook/BOOTSTRAP.md`.

## 3. Validación automatizada

Local Windows:

```text
npm test: 152 tests; 143 pass; 0 fail; 9 skips dependientes de Linux/Docker/PostgreSQL
npm run build: pass
git diff --check: pass
```

VPS Linux, sobre el commit de implementación `dc6a2fa`, en el worktree temporal aislado
`/tmp/asdrux-f23p2-WS6iKM`:

```text
npm test: 152 tests; 152 pass; 0 fail; 0 skipped
npm run build: pass
HEAD: dc6a2fa7202d27b8408426f1adcf0611964e7d56
```

La suite VPS cubrió PostgreSQL real, Docker, workers aislados, proxy de artifacts, acceso universal
de FEATURE-022 y las pruebas Linux específicas de symlink e ilegibilidad. El worktree temporal fue
eliminado después de validar. El checkout principal de la VPS y sus cambios locales no fueron
modificados.

## 4. Validación conjunta pendiente

No se reanudó el E2E real suspendido. La siguiente validación funcional debe comprobar en un único
circuito:

- FEATURE-022 — lectura universal de artifacts;
- FEATURE-023 Parte 1 — lifecycle canónico de Features;
- FEATURE-023 Parte 2 — disponibilidad propia del Runbook;
- repositorio gestionado sin copia del Runbook;
- persistencia, materialización, commit, push y SHA remoto de la Feature;
- lectura del artifact desde otro rol, recuperación UI y continuidad según modo `manual` o `auto`.

## 5. Alcance preservado

No se modificó la base de datos ni el Roadmap. No se implementaron los lifecycles de Project Brief,
Architecture o Release Plan, ni las capacidades reservadas a FEATURE-028, FEATURE-030,
FEATURE-033, FEATURE-034 o FEATURE-035. No se hizo merge ni push de `main`.
