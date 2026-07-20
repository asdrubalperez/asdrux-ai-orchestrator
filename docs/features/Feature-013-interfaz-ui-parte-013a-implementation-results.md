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

## Validación real pendiente para cierre completo de 013A

- Ejecutar un run real por CLI y observar la UI por túnel SSH.
- Probar reconexión con `Last-Event-ID`.
