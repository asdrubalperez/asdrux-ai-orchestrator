# FEATURE-015A — Resultados de Etapa 1

Fecha: 2026-07-23

Rama: `feature/015a-holder-worker-architecture`

Entorno real: VPS Linux del proyecto, Docker 29.6.2, Postgres 16 Alpine efímero, Claude Code
2.1.212 y Codex CLI 0.144.6. La candidata de pin se construyó y probó por separado con Codex
0.145.0.

No se montó, leyó ni utilizó ninguna credencial OAuth. Todos los tokens/canaries de los spikes
fueron sintéticos.

## 1. Estado del Approval Gate

| Ítem | Estado | Resultado |
|---|---|---|
| 1 — Schema/protocolo | ☑ | 11/11 tests; Ajv Draft 2020-12, token, byte limit, replay, cancel y allowlists |
| 2 — Claude Code | ☑ | Holder pre-auth aislado + adaptador MCP mínimo/allowlist contractual |
| 3 — Codex | ☑ | Proxy contractual + handshake real `initialize/initialized/thread/start` con `dynamicTools` |
| 4 — Superficies auxiliares | ☑ | Env/config efectivos cerrados; Codex `--strict-config` aceptó la configuración |
| 5 — Topología Docker | ☑ | Red interna exclusiva; worker sin egress, caché ni control-plane |
| 6 — Copia RW/promoción | ☑ | Copia sintética RW; promoción válida aplicada y zombie rechazado |
| 7 — Lock/concurrencia | ☑ | 12 contenders, 1 winner; heartbeat/release/fencing y caída DB |
| 8 — Pinning | ☐ | Tupla completa propuesta abajo; requiere aprobación explícita del owner |
| 9 — Fail-closed | ☑ | Holder, worker, canal, supervisor y Postgres fallaron sin fallback |

Resultado: **8 de 9 ítems cerrados. El único pendiente es la aprobación del owner sobre la tupla
del ítem 8.**

## 2. Evidencia por ítem

### Ítem 1 — Schema y protocolo

Código de spike:

- `spikes/feature-015a/schema.test.ts`
- `spikes/feature-015a/protocol.ts`
- `spikes/feature-015a/protocol.test.ts`

Evidencia: `docs/features/evidence/FEATURE-015A/schema_protocol_raw.txt`.

Resultado en VPS: **11 tests, 11 pass, 0 fail**.

La suite:

- compila el schema real con Ajv en modo Draft 2020-12/strict;
- acepta exactamente los cinco envelopes;
- rechaza campos extra, campos requeridos ausentes, discriminadores desconocidos, version
  `"1.0"`, UUID no canónico y token base64url de longitud/canonicalización incorrecta;
- verifica comparación de token con `timingSafeEqual`;
- verifica 10 MiB por frame UTF-8;
- verifica replay, call 501 y carrera cancel/result;
- verifica las allowlists direccionales Claude/Codex y correlación de IDs.

### Ítem 7 — Lock/concurrencia

Código de spike: `spikes/feature-015a/lock.integration.ts`.

Evidencia:

- `docs/features/evidence/FEATURE-015A/lock_cache_db_raw.txt`
- `docs/features/evidence/FEATURE-015A/db_shutdown_raw.txt`

Se levantó `postgres:16-alpine` en un contenedor dedicado, sin tocar la DB del proyecto. El spike
creó un schema aislado con la secuencia y tabla del diseño, y lo eliminó al finalizar.

Resultados:

- 12 acquires concurrentes para el mismo slot: **1 winner**;
- primer fencing token: `1`;
- takeover posterior: `13`, demostrando que los gaps por intentos rechazados no rompen monotonía;
- heartbeat/release con tripleta incorrecta: 0 filas;
- backend Postgres terminado administrativamente: detectado;
- contenedor Postgres apagado por completo: watcher emitió `FAIL_CLOSED`, sin promoción ni
  fallback.

### Ítem 6 — Copia privada RW y promoción

El mismo integration spike usó exclusivamente:

- `SYNTHETIC_V1` como caché canónico inicial;
- `SYNTHETIC_V2` como refresh escrito en la copia privada.

La promoción con el fencing viejo fue rechazada y el canónico permaneció en V1. La promoción del
owner vigente pasó por `SELECT ... FOR UPDATE`, fsync/rename y release, dejando V2 completo.

Resultado: `stalePromotionRejected=true`, `validPromotionApplied=true`.

### Ítem 2 — Claude Code

Código de spike:

- `spikes/feature-015a/claude-mcp-adapter.mjs`
- allowlist en `spikes/feature-015a/protocol.ts`.

Evidencia: `docs/features/evidence/FEATURE-015A/runtime_cli_topology_raw.txt`.

El contenedor real 2.1.212 se creó con rootfs read-only, `HOME`/`CLAUDE_CONFIG_DIR` temporales,
sin caché OAuth y con:

- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`
- `DISABLE_TELEMETRY=1`
- `DISABLE_ERROR_REPORTING=1`
- `DISABLE_UPDATES=1`
- `ENABLE_CLAUDEAI_MCP_SERVERS=false`
- `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1`

El comando incluyó `--tools ""`, `--mcp-config`, `--strict-mcp-config` y
`--no-session-persistence`. Terminó de forma esperada con `Not logged in`, exit 1; nunca se intentó
login. La suite contractual aceptó sólo initialize/tools/cancel y rechazó sampling, elicitation,
resources y OAuth.

El handshake MCP/tool call autenticado permanece correctamente en Etapa 2: Claude aborta antes sin
login.

### Ítem 3 — Codex app-server/proxy

Código de spike:

- `spikes/feature-015a/protocol.ts`
- `spikes/feature-015a/codex-app-server-smoke.mjs`.

Evidencia:

- `docs/features/evidence/FEATURE-015A/schema_protocol_raw.txt`
- `docs/features/evidence/FEATURE-015A/codex_schema_contract_raw.txt`
- `docs/features/evidence/FEATURE-015A/codex_app_server_smoke_raw.txt`
- `docs/features/evidence/FEATURE-015A/codex_01450_smoke_raw.txt`

La suite simuló requests/responses en ambas direcciones, IDs correlacionados, `item/tool/call`,
params sensibles y rechazo de `command/exec`, OAuth/MCP y responses no correlacionadas. Además,
la allowlist completa se cruzó contra `ClientRequest`, `ClientNotification`, `ServerRequest` y
`ServerNotification` generados por Codex 0.145.0: todos los métodos permitidos existen en el
schema fijado y las superficies reales `command/exec` y `mcpServer/oauthLogin/completed`
permanecen fuera de la allowlist.

Contra el binario real 0.144.6, sin auth:

1. `initialize` respondió correctamente.
2. `initialized` fue aceptado.
3. `thread/start` con cwd `/holder-empty`, sandbox read-only, thread efímero y una
   `dynamicTool` sintética respondió correctamente.
4. `thread/started` fue la notification esperada.

El mismo smoke pasó en la candidata 0.145.0. La tool call/turn real requiere autenticación y por
eso no se ejecutó en esta etapa.

Fuente primaria del flujo y `dynamicTools`:
[OpenAI Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).

### Ítem 4 — Superficies auxiliares

Evidencia: `docs/features/evidence/FEATURE-015A/runtime_cli_topology_raw.txt`.

Claude quedó con las variables anteriores, único MCP local y sin config heredada.

Codex arrancó con `CODEX_HOME` nuevo, `[mcp_servers]` vacío, apps/browser/computer-use/search
desactivados, analytics false y exporters OTel en `none`. `--strict-config` no rechazó ninguna
clave. No existían `openai_base_url`, `chatgpt_base_url`, `model_providers`, realtime override,
notify, plugins ni auth helper. El contenedor no montó una credencial.

Fuentes:
[Claude Code environment variables](https://code.claude.com/docs/en/env-vars) y
[Codex configuration](https://developers.openai.com/codex/config-reference/).

### Ítem 5 — Topología Docker

Evidencia: `docs/features/evidence/FEATURE-015A/runtime_cli_topology_raw.txt`.

Se crearon recursos efímeros con nombres `feature015a-*`:

- red egress normal para holder;
- red `--internal` exclusiva con exactamente holder + worker;
- volumen privado montado sólo en holder;
- worker read-only, non-root, sin mounts.

Resultados:

- holder obtuvo HTTP 200 desde `example.com`;
- worker no obtuvo egress;
- conexión worker→puerto 8080 del holder falló;
- búsqueda del canary `SYNTHETIC_CREDENTIAL_CANARY` desde el worker falló;
- `docker inspect` confirmó que el worker no tenía el volumen privado.

La red, contenedores y volumen se destruyeron mediante el trap del script.

### Ítem 9 — Fail-closed

Evidencia:

- `docs/features/evidence/FEATURE-015A/schema_protocol_raw.txt`
- `docs/features/evidence/FEATURE-015A/supervisor_shutdown_raw.txt`
- `docs/features/evidence/FEATURE-015A/db_shutdown_raw.txt`

Se apagaron procesos holder/worker reales de prueba, se cortó un socket TCP real, se abortó el
supervisor y se detuvo el contenedor Postgres. En todos los casos el estado terminal fue el motivo
original y no `FALLBACK`.

Al recibir SIGTERM, el supervisor terminó holder y worker antes de salir. Al desaparecer
Postgres, el watcher registró `FAIL_CLOSED`, `promotionAllowed=false` y
`fallbackAllowed=false`.

## 3. Hallazgos que corrigieron el diseño (v1.5)

Los spikes encontraron dos supuestos incorrectos de v1.4:

1. En Codex 0.144.6 y 0.145.0, `--analytics-default-enabled` es un switch de activación; la forma
   `--analytics-default-enabled=false` no existe. La corrección es omitir el flag —el default de
   app-server ya es false— y mantener `[analytics].enabled=false`.
2. El handshake real emitió `configWarning` por el fallback de bubblewrap. La allowlist v1.4 sólo
   tenía `warning`. v1.5 agrega `configWarning` como notification exacta, validada contra el
   schema fijado y redactada antes de persistir.

No se forzó el spike contra el contrato incorrecto. Ambas correcciones quedaron aplicadas al
diseño antes de marcar los ítems 3/4.

El warning de bubblewrap no invalida el aislamiento de este spike: app-server estaba dentro de un
contenedor read-only, sin worktree escribible, y reportó que usaría su bubblewrap bundled. Sí debe
permanecer visible; no se silenció.

## 4. Ítem 8 — propuesta de tupla pendiente de aprobación

Propuesta:

```json
{
  "schemaVersion": 1,
  "platform": "linux/amd64",
  "npmPackage": "@openai/codex",
  "npmVersion": "0.145.0",
  "npmIntegrity": "sha512-/PSPSFujjjmiyVFvG2yu/grOFhsWdokTH8t2KGWhXSo/M5n/dIDsnbsnO82/7bLtIoDuzQf7ATBUMWqPWQINlQ==",
  "baseImage": "node:22-alpine",
  "baseImageDigest": "sha256:b74031e546d7f4faf561d797ac1b76beccac856a042815ca77db4fd047581605",
  "expectedCliVersion": "codex-cli 0.145.0",
  "appServerSchemaTreeSha256": "bd3888e9fbdd115552d2847f3f5b343f5d2ecc30912b48d8ead399b6a2b4d329"
}
```

Justificación:

- 0.145.0 es el release estable más reciente publicado al momento de la investigación:
  [release oficial](https://github.com/openai/codex/releases/tag/rust-v0.145.0).
- Incluye cambios relevantes para este diseño, entre ellos reaping de hijos de app-server,
  mejoras de lifecycle/MCP y límites de decodificación JSON-RPC.
- El smoke sin credenciales pasó `initialize` y `thread/start` con `dynamicTools`.
- El paquete observado fue `0.145.0` y la salida independiente fue `codex-cli 0.145.0`.
- La base es el manifest **linux/amd64** específico, no el índice multiarch mutable.
- El build de CI debe ejecutarse explícitamente con `--platform=linux/amd64`; el Dockerfile
  candidato no codifica un `FROM --platform` constante.
- Los schemas cambiaron materialmente frente a 0.144.6: 337 archivos/hash
  `ad7393bd...` frente a 347 archivos/hash `bd3888e9...`. Esto confirma que el tree hash debe ser
  parte del pin y que los contract tests deben regenerarse al actualizar.

Evidencia:

- `docs/features/evidence/FEATURE-015A/item8_candidate_raw.txt`
- `docs/features/evidence/FEATURE-015A/codex_01450_smoke_raw.txt`
- `spikes/feature-015a/codex-pin-candidate.Dockerfile`
- `spikes/feature-015a/compute-schema-tree-hash.mjs`

El image ID local del build candidato fue
`sha256:8b55038ea8d74ea086cb50446d51ddd0f4a22b4c5d5d6a520beac8bdff15d415`.
No se propone usarlo como digest de deployment: el pipeline definitivo debe publicar la imagen y
registrar su digest de registry como output.

**Decisión requerida del owner:** “Apruebo la tupla Codex 0.145.0 anterior” o indicar el valor a
ajustar. Hasta esa respuesta no se crea `docker/codex-pin.json` y el ítem 8 permanece ☐.

## 5. Clasificación del código

- `spikes/feature-015a/*`: descartable/experimental; demuestra contratos y runtime, no se conecta a
  Executors reales.
- `docs/features/schemas/FEATURE-015A-holder-worker-protocol.schema.json`: contrato de diseño,
  candidato a conservar.
- `ajv` en `devDependencies`: infraestructura reproducible de tests, no dependencia de runtime.
- No se agregó migración productiva ni wiring de Executors.

## 6. Dictamen

**Etapa 1 queda técnicamente validada en 8/9 ítems.** No apareció un bloqueo de arquitectura. Los
dos desajustes de app-server se corrigieron como v1.5 y se volvieron a probar.

La única acción pendiente para cerrar formalmente Etapa 1 es la aprobación explícita de la tupla
del ítem 8; no requiere repetir los otros ocho spikes.
