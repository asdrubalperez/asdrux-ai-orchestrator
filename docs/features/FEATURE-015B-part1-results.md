# FEATURE-015B — Resultados Parte 1: runtime base

Fecha: 2026-07-24

Rama: `feature/015b-wiring-real-por-rol`

## 1. Alcance implementado

Se productizó un runtime base bajo `src/executor/isolated-tools/`, todavía sin wiring de roles:

- `contracts.ts`: matriz de policies sintéticas, catálogo cerrado de ocho tools, schemas cerrados
  de args/results y límites de protocolo.
- `channel.ts`: canal worker autenticado, comparación constant-time, límite de frame, replay
  protection y envelopes terminales `tool_result`/`tool_error`.
- `security.ts`: resolución canónica de paths, rechazo de rutas absolutas/traversal/symlink escape
  y validación SSRF para HTTPS público.
- `worker.ts`: implementación de `fs_read`, `fs_search`, `fs_glob`, `fs_write`, `fs_edit`,
  `command_exec`, `web_search` y `web_fetch`; doble comprobación de catálogo y rechazo de
  credenciales OAuth/Tavily en el entorno del worker.
- `tavily.ts`: search proxy con `TAVILY_API_KEY`, request cerrado `basic`, normalizador
  `results[].content`→`snippet` y fail-closed.
- `bridges.ts`: bridge MCP de Claude y proxy de `dynamicTools`/`item/tool/call` para Codex.
- `supervisor.ts` y `processComponent.ts`: readiness, cancelación, cleanup inverso en `finally`,
  procesos hijos reales y fail-closed.

No se modificaron `ClaudeCodeExecutor.resolveTools()`, `CodexExecutor.shouldDisableShellTool()`,
prompts ni ningún pipeline. La matriz no contiene roles reales; Parte 2 hará el primer wiring.

## 2. Evidencia de tests

Comando:

```text
npm.cmd test
```

Resultado:

```text
tests 40
pass 40
fail 0
cancelled 0
skipped 0
todo 0
```

De esos 40 tests del repo, 16 pertenecen al runtime base de 015B:

- 3 de policy/schemas;
- 2 de paths y SSRF;
- 3 del request, normalizador y proxy Tavily;
- 2 del worker y ausencia de secretos;
- 1 del canal autenticado/replay;
- 2 contract tests de Claude MCP y Codex `item/tool/call`;
- 1 lifecycle/fail-closed;
- 1 E2E multiproceso sintético;
- 1 verificación de la tupla fijada en `docker/codex-pin.json`.

Build:

```text
npm.cmd run build
tsc --noEmit: pass
tsc -p web/tsconfig.json --noEmit: pass
vite build: pass (1883 módulos)
```

## 3. E2E sintético

`processComponent.test.ts` levantó holder y worker como procesos Node separados bajo
`IsolatedToolsSupervisor`:

- holder recibió únicamente el canary OAuth sintético y reportó `tools: []`;
- worker recibió un entorno construido explícitamente sin `OAUTH_CANARY` ni `TAVILY_API_KEY`;
- worker reportó `secrets: []` y devolvió `SYNTHETIC_OK`;
- el supervisor esperó readiness y detuvo componentes en orden inverso;
- una falla de readiness produjo `WORKER_UNAVAILABLE` y cleanup, sin fallback.

No se usaron credenciales reales, red Tavily real ni sesiones OAuth. El test prueba separación
de procesos y construcción de entornos; la topología Docker/VPS y los CLIs autenticados quedan
para la integración de Partes 2/3, cuando exista un rol real cableado.

## 4. Contratos

- Claude MCP acepta exclusivamente `initialize`, notificaciones de inicialización/cancelación,
  `tools/list` y `tools/call`; cualquier otra superficie devuelve `method denied`.
- Codex genera `thread/start` con `cwd=/holder-empty`, `sandbox=read-only`, catálogo
  `dynamicTools` cerrado, procesa exclusivamente `item/tool/call` y rechaza replay.
- El contract test fija la implementación a Codex `0.145.0`, CLI `codex-cli 0.145.0` y hash de
  schema `bd3888e9fbdd115552d2847f3f5b343f5d2ecc30912b48d8ead399b6a2b4d329`.
- Tavily envía explícitamente `search_depth:"basic"`, `include_answer:false`,
  `include_raw_content:false`, `include_images:false` y `auto_parameters:false`; no existe ruta a
  `/extract`.

## 5. Ajustes de diseño

No fue necesario cambiar el contrato técnico v4. Se actualiza únicamente su estado para registrar
la aprobación explícita del owner recibida antes de este handoff; no se crea v5.

## 6. Dictamen

La Parte 1 queda implementada como runtime base no cableado. No se considera lista para producción
ni autoriza merge a `main`: requiere Parte 2 (QA piloto), Parte 3 (resto de roles) y revisión
conjunta del Architect + owner.
