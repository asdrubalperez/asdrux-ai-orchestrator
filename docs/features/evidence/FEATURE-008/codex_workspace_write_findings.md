# FEATURE-008 Parte 2 - Hallazgo de workspace-write Codex

Fecha: 2026-07-18
Ambiente: VPS `/home/asdru/ai-orchestrator`, Codex CLI `0.144.5`, modelo `gpt-5.6-luna`.

## Resultado

La validacion positiva de Parte 2 no quedo cerrada. `CodexExecutor` invocado con rol `developer`,
`permissions.filesystem: "workspace-write"` y `writableRoots` apuntando a un `git worktree` real no
pudo escribir ni siquiera el archivo permitido dentro del worktree.

Evidencia externa:

- `MAIN_HASH_UNCHANGED=true`: el archivo del repo principal no fue modificado.
- `MAIN_MARKER_COUNT_AFTER=0`: el marcador prohibido no aparecio en el repo principal.
- `HOME_EXISTS_AFTER=false`: el archivo prohibido fuera del worktree no fue creado.
- `INSIDE_EXISTS_AFTER=false`: el archivo permitido dentro del worktree tampoco fue creado.

Esto no valida aun el criterio completo de Parte 2, porque falta demostrar escritura permitida dentro
de `writableRoots` junto con bloqueo fuera de `writableRoots`.

## Contraste con CLI directo

Para separar un bug del adaptador de un comportamiento del CLI, se ejecuto tambien `codex exec`
directo con:

- `--cd <worktree>`
- `--sandbox workspace-write`
- `--model gpt-5.6-luna`

El CLI directo reprodujo el mismo problema: intento aplicar un patch para crear un archivo relativo
dentro del worktree y fallo con `Failed to write file`.

## Evidencia

- `codex_workspace_write_invocation_raw.json`: raw stdout/stderr emitido por `CodexExecutor`.
- `codex_workspace_write_phase_result.json`: `PhaseResult` devuelto por el adaptador.
- `codex_workspace_write_before_after.txt`: hashes y estado externo antes/despues.
- `codex_workspace_write_summary.txt`: resumen machine-readable de la corrida del adaptador.
- `codex_workspace_write_direct_cli_raw.txt`: raw de la prueba directa del CLI.
- `codex_workspace_write_direct_cli_before_after.txt`: estado externo de la prueba directa.
- `codex_workspace_write_direct_cli_summary.txt`: resumen machine-readable de la prueba directa.

## Decision

Parte 2 queda detenida con bloqueo real de validacion. No corresponde avanzar a Parte 3 hasta
resolver por que `workspace-write` no permite una escritura dentro del worktree en la VPS.
