# FEATURE-013 — Capa de UI "Run en curso" — Parte 013A: Implementation Results

## Scope implementado

- Backend Express read-only:
  - `GET /runs/:id`
  - `GET /runs/:id/stream`
  - `GET /health`
- SSE con:
  - snapshot inicial en toda conexión, sin `id:`
  - replay de `run_events` con `id > Last-Event-ID`
  - heartbeat cada 15s
  - listener único de Postgres sobre `run_events_channel`
- Migración `0006_run_events_notify.sql`:
  - trigger `AFTER INSERT` sobre `run_events`
  - trigger `AFTER UPDATE OF status, current_phase` sobre `runs`
  - función `notify_run_observer()`
- UI Vite + React + TypeScript + Tailwind + TanStack Query:
  - timeline fijo de 6 nodos
  - bitácora narrativa
  - banner informativo de escalamiento
  - conexión SSE para refrescar el detalle del run sin polling
- Mapeos testeables en `src/server/runView.ts`.

## Decisiones de implementación

- El backend usa `ORCHESTRATOR_WEB_USER_ID` como auth shim temporal de 013A. Si no está definido,
  responde error y no expone datos.
- El snapshot SSE se emite sin `id:` para no alterar el `Last-Event-ID` recordado por el navegador.
- Las notificaciones por cambios de `runs` disparan un snapshot actualizado; los eventos reales de
  `run_events` se emiten con su `id` persistido.
- El frontend se sirve desde `web/` y puede correr con Vite en desarrollo o como estático desde
  Express si existe `web/dist`.

## Validación local

- `npm test`: 11/11 tests pasan.
- `npm run build`: pasa `tsc --noEmit`, typecheck de `web/`, y `vite build`.
- Smoke de servidor con DB inválida:
  - `ORCHESTRATOR_WEB_USER_ID=00000000-0000-0000-0000-000000000000`
  - `PORT=3999`
  - Resultado: servidor inicia y escucha en `http://127.0.0.1:3999`; timeout esperado por proceso
    persistente.

## Validación real en VPS/Postgres dev

- Ambiente: `srv1834767` / contenedor `postgres-dev-orquestador`.
- Migración aplicada con `psql -f /tmp/0006_run_events_notify.sql`.
- Triggers verificados en catálogo:
  - `run_events_notify_observer`
  - `runs_notify_observer`
- Prueba funcional de `NOTIFY`:
  - Se creó un run temporal controlado.
  - Insert en `run_events` emitió:
    - canal: `run_events_channel`
    - payload source: `run_events`
  - Update de `runs.status` emitió:
    - canal: `run_events_channel`
    - payload source: `runs`
  - Las filas temporales fueron eliminadas al final de la prueba.
- Archivos SQL temporales usados para validar fueron eliminados de `/tmp` del host y del
  contenedor.

## Validación funcional real de UI/SSE

- Ambiente:
  - backend + frontend corriendo en la VPS
  - UI observada desde Windows vía túnel SSH
  - runs disparados por `npm run cli -- run:start` contra la base real de la VPS
- Run real `d8f02930-3b91-418b-b477-fe85a8766127`:
  - pipeline: `single-phase-architect`
  - caso: `case_descuento.json`
  - resultado observado: `Architect` completó; los otros 5 nodos quedaron en `pendiente` de forma
    permanente, como define la Regla Funcional 1 de 013A para pipelines cortos.
  - la bitácora mostró el `summary` real de `PhaseResult`, sin síntesis adicional del lado de la
    UI.
- Run real `e0f37e33-2082-4b86-bca5-b4882bf7d17c`:
  - pipeline: `two-phase-architect-functional`
  - caso: `case_descuento.json`
  - resultado observado: `Architect` y `Functional` pasaron en vivo de `pendiente` a `en_curso` y
    luego a `completado`, sin refresco manual, vía SSE.
- Reconexión a mitad de run:
  - durante `e0f37e33-2082-4b86-bca5-b4882bf7d17c`, el owner recargó el navegador con `Architect`
    todavía `en_curso`.
  - el snapshot inicial de reconexión reconstruyó correctamente timeline y bitácora completa hasta
    ese momento.
  - después de la reconexión, la UI siguió actualizándose sola hasta completar ambas fases, sin
    pérdida observable de eventos ni segundo refresco manual.

## Cierre de 013A

Con la validación funcional real anterior, los pendientes de cierre completo de 013A quedan
cubiertos. La Parte 013A queda validada funcionalmente.
