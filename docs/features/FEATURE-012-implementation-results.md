# FEATURE-012 — Implementation Results

## Summary

FEATURE-012 quedó implementada y validada con ciclo real end-to-end sobre Postgres real, sin mocks,
usando Codex CLI real en la VPS del proyecto.

La validación local en Windows quedó bloqueada por una restricción del binario WindowsApps de Codex:
Node no pudo hacer `spawn` del executor (`EPERM`). Por eso el E2E se ejecutó en
`/home/asdru/ai-orchestrator`, el entorno Linux ya usado para validaciones reales de FEATURE-008.

## Implemented

- Migración `0005_escalation_context_persistence.sql`.
- `runs.originated_from_run_id` con índice.
- Nuevo estado operativo `retrying`.
- `recordArtifact` devuelve el artifact insertado, incluyendo `id`.
- Persistencia de `escalationReason` en artifacts de escalamiento.
- Comparación canonical JSON de `outputArtifact`.
- Eventos de escalamiento y respuesta humana.
- Evento adicional `escalation_retry_context_prepared` para validar el contexto exacto en DB.
- `run:respond --solution|--abort`.
- Run hijo con branch/worktree propio, ramificado desde la rama del padre.
- Reconstrucción del pipeline vía `pipeline_definitions`.
- Herencia de `provider`/`model` desde `run_started`.

## E2E Evidence

Carpeta: `docs/features/evidence/FEATURE-012/`

- `case_escalation_repeat.json`: caso mínimo usado para forzar escalamiento real.
- `e2e_setup_remote.json`: usuario/proyecto/sesión temporal de la VPS.
- `run_start_raw.txt`: salida cruda de `run:start`.
- `db_after_run_start.json`: snapshot DB del run padre tras escalamiento terminal.
- `run_respond_raw.txt`: salida cruda de `run:respond --solution`.
- `db_after_run_respond_parent.json`: snapshot DB del padre tras respuesta humana.
- `db_after_run_respond_child.json`: snapshot DB del run hijo.
- `git_branch_worktree_verification.txt`: verificación git de ramas/worktrees y ancestro.

## Runs Validados

- Run padre: `9e142e0f-15c0-4c17-8ac5-2045b721fa9f`.
- Status padre: `escalated`.
- Eventos padre: 3 `escalation_opened`, 2 `escalation_retry_context_prepared`, 1 `escalation_repeated_detected`.
- Run hijo: `b0bf589e-00b2-4b25-9ec9-029cd647a469`.
- Status hijo: `completed`.
- Relación: `originated_from_run_id = 9e142e0f-15c0-4c17-8ac5-2045b721fa9f`.
- Contexto del hijo persistido en DB con `escalationReason`, `rejectedArtifact`, `originAgentRole` y `humanSolution`.

## Branch/Worktree

La evidencia git confirma:

- Padre: `run/9e142e0f-15c0-4c17-8ac5-2045b721fa9f`.
- Hijo: `run/b0bf589e-00b2-4b25-9ec9-029cd647a469`.
- Worktrees distintos.
- `git merge-base --is-ancestor parent child` devolvió exit code `0`.

## Verification Commands

- `npx.cmd tsc --noEmit`
- `npx.cmd tsx --test src\executor\codexExecutor.parser.test.ts src\pipelines\extractTestCommand.test.ts src\cli\escalation.test.ts`
- `npm.cmd run migrate`
- E2E remoto:
  - `npm run cli -- run:start --case docs/features/evidence/FEATURE-012/case_escalation_repeat.json --project 7058aeb5-aa36-4d79-bab7-e317a6ecca6f --pipeline single-phase-architect --executor codex --model gpt-5.6-luna`
  - `npm run cli -- run:respond --run 9e142e0f-15c0-4c17-8ac5-2045b721fa9f --solution "..."`

## Notes

El modelo no mantuvo el `outputArtifact` estable después del primer retry, pese a la instrucción
del caso. Aun así, el circuito ejercitó el comportamiento requerido: reintentó internamente más de
una vez, persistió contexto completo, y terminó por detección de repetición exacta (`null` contra
`null`) antes de `run:respond`.
