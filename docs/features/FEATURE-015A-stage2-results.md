# FEATURE-015A — Resultados de Etapa 2

Fecha: 2026-07-23

Rama: `feature/015a-holder-worker-architecture`

Cuenta autorizada: `asdrubalperez@gmail.com`, plan Pro, sesión desechable. Nunca se montó, leyó
ni modificó la sesión Santex.

La evidencia conserva únicamente estado, nombres de métodos, hashes unidireccionales y metadata.
No contiene access tokens, refresh tokens, headers de autorización ni archivos de credenciales.

## 1. Estado del Approval Gate

| Ítem | Estado | Resultado |
|---|---|---|
| 1 — Login aislado | ☑ | Cuenta y plan correctos bajo `CLAUDE_CONFIG_DIR` aislado |
| 2 — E2E e inventario | ☑ | Una tool efectiva; MCP conectado; llamada llegó al worker y volvió |
| 3 — Refresh/promoción | ☑ | Refresh real sólo en copia privada; promoción con fencing vigente |
| 4 — Copia/reuso/revocación | ☑ | Access y refresh funcionaron antes; ambos fallaron tras logout |
| 5 — Revocación/destrucción | ☑ | CLI + Settings; directorio, volumen, redes, contenedores y logs destruidos |

Resultado: **Etapa 2 cerrada en 5/5 ítems.**

## 2. Login aislado

`claude auth status` confirmó:

- `loggedIn=true`;
- `authMethod=claude.ai`;
- `email=asdrubalperez@gmail.com`;
- `subscriptionType=pro`.

Evidencia: `docs/features/evidence/FEATURE-015A-stage2/item1_auth_status.json`.

La consulta se ejecutó montando `/tmp/feature015a-etapa2-cred` read-only. No se imprimió el
contenido de `.credentials.json`.

## 3. Handshake y tool call E2E

El holder usó una copia privada en un volumen Docker. El worker:

- estaba únicamente en la red interna;
- no tenía mounts;
- no recibió variables ni archivos OAuth;
- aceptó sólo `synthetic_read({key:"stage2"})` con token de canal efímero.

Resultado real de Claude Code 2.1.212:

- MCP `feature015a`: `connected`;
- inventario `initTools`: exactamente `mcp__feature015a__synthetic_read`;
- eventos `tool_use` y `tool_result` observados;
- worker registró `worker_call=synthetic_read`;
- resultado final: `TOOL_OK`;
- `secretLeakDetected=false`.

Evidencia: `docs/features/evidence/FEATURE-015A-stage2/item2_claude_e2e.txt`.

### Corrección necesaria del contrato Claude

El primer intento con `--tools ""` produjo inventario vacío y MCP `pending`. En Claude Code
2.1.212 ese flag no preserva la tool MCP como asumía v1.5.

El E2E pasó al usar conjuntamente:

- `--tools mcp__feature015a__synthetic_read`;
- `--allowedTools mcp__feature015a__synthetic_read`;
- `--strict-mcp-config`;
- settings `enabledMcpjsonServers=["feature015a"]`;
- `alwaysLoad: true` en el único servidor MCP.

`alwaysLoad` fuerza que la conexión termine antes de construir el prompt y evita la carrera
observada con estado `pending`. Referencia oficial:
[Claude Code MCP](https://code.claude.com/docs/en/mcp).

### Codex

No existía una sesión OAuth desechable de OpenAI autorizada para esta ronda. No se reutilizó
ninguna sesión Codex real ni se forzó un turn con consumo. La parte no autenticada ya cubierta en
Etapa 1 —`initialize`, `thread/start`, `dynamicTools` y contract tests contra schemas— permanece
válida. El turn/tool call autenticado de Codex queda explícitamente **no ejecutado por ausencia de
una credencial desechable autorizada**, conforme a la excepción del handoff.

## 4. Refresh real y promoción con fencing

La copia inicial y el canónico tenían el mismo hash. El probe `refresh-only` puso únicamente en la
copia privada el access token en estado inválido y `expiresAt=0`, preservando el refresh token.

El turn autenticado pasó y Claude rotó:

- access token;
- refresh token;
- expiración.

Después del refresh:

- el hash del canónico seguía sin cambios;
- el hash de la copia privada había cambiado;
- `secretLeakDetected=false`.

La promoción adquirió el lock Postgres con fencing token `1`, verificó
`(credential_slot_id, run_id, fencing_token)` bajo `SELECT ... FOR UPDATE`, hizo fsync/rename y
liberó el lease. Canónico y privado quedaron byte a byte con el mismo hash posterior.

Evidencia:

- `docs/features/evidence/FEATURE-015A-stage2/item3_refresh.txt`
- `docs/features/evidence/FEATURE-015A-stage2/item3_hashes.txt`
- `docs/features/evidence/FEATURE-015A-stage2/item3_promotion.txt`

## 5. Copia, reuso y revocación

| Momento | Access copiado | Refresh copiado |
|---|---|---|
| Antes de logout | Funciona | Funciona y rota ambos tokens |
| Después de `claude auth logout` | Rechazado | Rechazado |
| Después de revocación en Settings | Rechazado | Rechazado |

Para aislar cada capacidad:

- access: se reemplazó temporalmente sólo el refresh token por un valor sintético inválido;
- refresh: se reemplazó temporalmente sólo el access token y se venció `expiresAt`;
- en ningún caso se imprimió el valor real.

Antes del logout, ambos probes completaron el turn y la llamada al worker.

Tras `claude auth logout`, el canónico quedó `loggedIn=false`. Aunque la copia privada conservaba
un `expiresAt` futuro, tanto el probe access-only como refresh-only devolvieron:
`Failed to authenticate: OAuth session expired and could not be refreshed`.

**Hallazgo empírico:** en Claude Code 2.1.212 y esta sesión Pro, `claude auth logout` no se limitó
a borrar el archivo local; invalidó server-side las copias del access y refresh token probadas.
Esto describe esta versión y esta prueba, no una garantía contractual para futuras versiones.

Settings → Claude Code todavía mostraba el registro de autorización después del logout CLI. Se
revocó manualmente el registro específico y, tras recargar, la UI mostró:
`No hay instancias de Claude Code conectadas`. Los dos probes continuaron fallando.

Evidencia:

- `docs/features/evidence/FEATURE-015A-stage2/item4_prelogout_access.txt`
- `docs/features/evidence/FEATURE-015A-stage2/item4_prelogout_refresh.txt`
- `docs/features/evidence/FEATURE-015A-stage2/item4_cli_logout.txt`
- `docs/features/evidence/FEATURE-015A-stage2/item4_postlogout_access.txt`
- `docs/features/evidence/FEATURE-015A-stage2/item4_postlogout_refresh.txt`
- `docs/features/evidence/FEATURE-015A-stage2/item4_web_revoke.txt`
- `docs/features/evidence/FEATURE-015A-stage2/item4_postsettings_access.txt`
- `docs/features/evidence/FEATURE-015A-stage2/item4_postsettings_refresh.txt`

Nota de instrumentación: los logs de probes fallidos conservan `toolUseSeen=true` porque la
primera versión del resumen confundía la presencia de la tool en el catálogo con una invocación.
Los campos autoritativos son la ausencia de `tool_use` en `eventTypes`,
`workerResultSeen=false` y la ausencia de una nueva llamada en el log del worker. El script quedó
corregido para futuras ejecuciones.

## 6. Cierre obligatorio

Se ejecutó:

1. logout CLI sobre el canónico;
2. revocación del registro en Settings;
3. logout CLI sobre la copia privada;
4. cierre de la sesión web desechable;
5. destrucción de todos los holders, worker y Postgres;
6. destrucción del volumen privado y las tres redes;
7. eliminación de `/tmp/feature015a-etapa2-cred`;
8. eliminación de los logs/scripts temporales `/tmp/feature015a-stage2`.

Verificación posterior:

- directorio canónico ausente;
- logs temporales ausentes;
- 0 contenedores con prefijo `feature015a-etapa2-`;
- 0 volúmenes privados;
- 0 redes de Etapa 2;
- 0 matches de filesystem bajo `/tmp` y el repo de la VPS;
- navegador en `https://claude.ai/login?from=logout`.

Evidencia:

- `docs/features/evidence/FEATURE-015A-stage2/item5_private_logout.txt`
- `docs/features/evidence/FEATURE-015A-stage2/item5_cleanup_verification.txt`

## 7. Dictamen

**Etapa 2 queda validada y cerrada en 5/5 ítems.**

La arquitectura holder/worker, refresh privado y promoción con fencing son implementables con una
sesión OAuth real. La v1.5 sí requería una corrección concreta en la forma de registrar/cargar la
única tool MCP de Claude; queda incorporada como v1.6.

Este resultado no autoriza implementación de producción, wiring de FEATURE-015B ni uso de otra
credencial real.
