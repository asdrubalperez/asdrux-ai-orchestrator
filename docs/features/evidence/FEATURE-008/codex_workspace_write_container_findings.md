# FEATURE-008 Parte 2 - CodexExecutor workspace-write via Docker

## Resultado

La validacion positiva de Parte 2 quedo satisfecha por la via Docker:

- `CodexExecutor` fue instanciado con `sandbox: "container"` y `model: "gpt-5.6-luna"`.
- La invocacion real dentro del contenedor reporto `sandbox: danger-full-access`.
- No hubo menciones a `bwrap` ni `bubblewrap` en la salida cruda final (`BWRAP_ANY_COUNT=0`).
- El archivo permitido dentro del worktree se creo con el marcador esperado.
- Los 4 intentos externos no tocaron el host:
  - hash de `docs/playbook/00-README.md` sin cambios;
  - status del archivo protegido limpio;
  - marcadores externos ausentes;
  - ruta arbitraria externa inexistente.

## Nota sobre `git status`

El `git status --short` completo del repo principal remoto no aparece limpio en `before_after`
porque durante esta verificacion estaban presentes cambios intencionales de la propia Parte 2
(`src/executor/codexExecutor.ts`, `docker/codex-developer.Dockerfile`) y evidencia nueva sin
versionar. La verificacion independiente relevante para el intento de escape contra el repo
principal es path-specific y quedo limpia:

- `MAIN_STATUS_AFTER=<clean-for-target>`
- `MAIN_HASH_UNCHANGED=true`

## Evidencia

- `codex_workspace_write_container_raw.json`
- `codex_workspace_write_container_before_after.txt`
- `codex_workspace_write_container_summary.txt`
- `codex_workspace_write_container_phase_result.json`
- `codex_workspace_write_container_node_stderr.txt`
