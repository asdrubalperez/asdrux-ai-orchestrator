# FEATURE-013 — Capa de UI "Run en curso" — Parte 013C: Implementation Results

## Scope implementado

- Refactor de `run:respond` a un servicio compartido:
  - `src/cli/respondService.ts`
  - `src/cli/commands/runRespond.ts`
- Endpoint web autenticado:
  - `POST /runs/:id/respond`
  - `{ abort: true }` -> `202 { status: "aborted" }`
  - `{ solution: string }` -> `202 { childRunId }`
- Transición atómica del run padre:
  - `escalated` -> `aborted`
  - `escalated` -> `resolved`
  - `UPDATE ... WHERE status = 'escalated' RETURNING *` para evitar doble respuesta concurrente.
- Ejecución background del run hijo desde HTTP, sin bloquear el request.
- Extensión del view model de escalamiento:
  - `motive`
  - `outputArtifact`
- UI:
  - botón "Validar Ahora"
  - modal de respuesta con motivo, `reason` y artifact rechazado
  - flujo "No" para abortar
  - flujo "Sí" con texto obligatorio
  - navegación automática al run hijo cuando la respuesta crea uno.

## Decisiones de implementación

- El servicio compartido conserva el comportamiento CLI existente de esperar la ejecución completa
  cuando se responde con `--solution`.
- El endpoint HTTP responde rápido y luego ejecuta `executePipelineRun(...)` en background.
- El `.catch()` del background solo loguea operacionalmente: `executePipelineRun` ya registra
  `run_error` antes de relanzar.
- No se agregó migración para `aborted`/`resolved` porque `runs.status` es `text` sin constraint.
- No se modificó el proxy de Vite: `"/runs"` ya cubre `POST /runs/:id/respond`.

## Validación local

- `npm.cmd test`: 16/16 tests pasan.
- `npm.cmd run build`: pasa `tsc --noEmit`, typecheck de `web/`, y `vite build`.
- `git diff --check`: sin errores.

## Validación real en VPS/Postgres dev

Ambiente:
- backend + frontend corriendo en la VPS
- UI observada desde Windows vía túnel SSH
- base de datos real de desarrollo

Escalamiento real forzado en Architect:
- caso: `case_escalate_architect.json`
- intención: caso deliberadamente ambiguo para forzar escalamiento

Run padre:
- `e0312e07-72aa-49a2-bf63-920930245c37`
- Secuencia observada:
  - `escalation_opened` intento 1
  - `escalation_retry_context_prepared` con `humanSolution = null`
  - `escalation_opened` intento 2
  - `escalation_repeated_detected`
  - `runs.status = "escalated"`
- UI:
  - el nodo `User` quedó esperando validación humana.
  - el modal "Validar Ahora" mostró el motivo correcto: resultado repetido.
  - mostró el `escalationReason` completo.
  - mostró "Sin artifact rechazado disponible", correcto para este caso porque Architect escaló
    con `ARTEFACTO: null`.

Respuesta humana:
- camino validado: "Sí" con solución humana.
- Resultado confirmado:
  - el padre pasó a `runs.status = "resolved"`.
  - se registró `escalation_human_response` con `newRunId`.
  - se creó el run hijo `1abe5bfa-90ce-4b92-8a56-7886a85c924d`.
  - el frontend navegó automáticamente al run hijo.
  - el avance del hijo se siguió por SSE hasta `completed`.

## Cobertura no bloqueante

Esta validación real cubrió:
- camino `{ solution }`
- motivo `escalation_repeated_detected`
- transición del padre a `resolved`
- creación y seguimiento SSE del run hijo.

No se volvió a probar en vivo en esta ronda:
- camino `{ abort: true }`
- motivo `escalation_exhausted`

Se consideran no bloqueantes para el cierre de 013C porque la lógica es simétrica, está cubierta
por diseño y por validaciones automatizadas proporcionales. Quedan como evidencia E2E opcional si
se quiere ampliar la cobertura empírica en una ronda futura.
