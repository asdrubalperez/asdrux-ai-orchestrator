# FEATURE-015A — Egress y aislamiento de credenciales OAuth — Parte 015A: Arquitectura holder/worker genérica

Versión: v1.5 (borrador para revisión — no aprobado; historial: v1.0 diseño inicial; v1.1
resolución de los 8 bloqueantes de la primera evaluación; v1.2 ajustes posteriores; v1.3
corrección de 5 inconsistencias documentales; v1.4 resolución técnica de los 6 bloqueantes
encontrados en la auditoría integral de v1.3; v1.5 corrección de dos supuestos de `app-server`
detectados por los spikes de Etapa 1)

Basado en template: `docs/playbook/07-FEATURE-TEMPLATE.md` v2.1

Parte de: FEATURE-015 (desdoblada en 015A/015B, secuencial — ver `docs/ROADMAP.md`)

Insumos:

- `docs/research/investigacion-egress-proteccion-exfiltracion.md` (copiado a esta rama desde
  `feature/015-egress-investigacion` para que la referencia sea autocontenida).
- Evaluación de Codex del diseño descartado de FEATURE-016A (contradicción mount RO/refresh
  escribible y asimetría de Bash entre proveedores).
- `docs/features/FEATURE-015A-evaluacion-arquitectura-holder-worker.md`.

---

# 1. Feature Identity

- **Name**: Egress y aislamiento de credenciales OAuth — Parte 015A: Arquitectura holder/worker
  genérica
- **Type**: Seguridad / Infraestructura de confinamiento de ejecución
- **Owner**: Asdrubal Perez
- **Status**: Draft — pendiente de Approval Gate
- **Priority**: Alta — prerequisito de 015B, que a su vez es prerequisito de FEATURE-016 completo

---

# 2. Problem Statement

Cualquier rol que use `authMode="cli_session"` (FEATURE-016) expone, en el proceso que lo ejecuta,
un archivo de credenciales OAuth portable. Copiarlo puede permitir reutilizar la sesión. Ese
proceso presenta al menos dos canales de fuga:

1. **Canal de respuesta**: un rol con herramientas de lectura puede ser inducido por prompt
   injection a leer el caché y devolverlo en su respuesta al proveedor.
2. **Canal de red**: un rol con shell y egress puede enviar el secreto directamente a un destino
   externo sin incluirlo en la respuesta visible.

Un diseño anterior intentó montar el mismo caché read-only y, a la vez, permitir que el CLI lo
actualizara durante el refresh. Eso es imposible: el proceso que refresca necesita una vista
escribible. Esta Feature debe aislar el secreto del worker sin impedir el refresh nativo del
holder.

El modelo de amenaza principal es un modelo o prompt activamente evasivo. La solución no puede
depender de que el modelo obedezca instrucciones ni puede quitarle al worker el acceso a internet
que FEATURE-015B decida habilitar por rol.

---

# 3. Functional Goal

FEATURE-015A diseña y valida un mecanismo genérico para Claude Code y Codex. Ningún rol real se
migra todavía; ese wiring pertenece a FEATURE-015B. El mecanismo debe:

- Mantener el caché OAuth y sus tokens fuera del filesystem, entorno y red alcanzable por el
  worker.
- Ejecutar inferencia autenticada en un holder sin worktree ni herramientas locales de
  shell/filesystem expuestas al modelo.
- Delegar las herramientas a un worker sin credenciales mediante un contrato cerrado y
  autenticado.
- Permitir refresh en una copia privada escribible y promoverla al slot canónico sólo si la
  invocación conserva un fencing token vigente.
- Fallar cerrado ante caída del holder, worker, canal, supervisor o Postgres.

---

# 4. Scope

## Incluido

1. **Contrato wire canónico v1** entre un **endpoint confiable** y un worker:
   - Para Claude Code, el endpoint confiable es un adaptador MCP `stdio` mínimo que corre en la
     zona del holder. Claude Code habla MCP estándar con ese adaptador; el adaptador traduce cada
     `tools/call` al contrato canónico y se comunica con el worker.
   - Para Codex, el endpoint confiable es el controlador del Orquestador que recibe
     `item/tool/call` desde `codex app-server` y lo traduce al mismo contrato.
   - El worker no es servidor MCP ni cliente de `app-server`. Por lo tanto no puede enviar
     elicitation, OAuth discovery, métodos administrativos ni mensajes arbitrarios a ninguno de
     los CLIs.
   - El schema autoritativo es
     `docs/features/schemas/FEATURE-015A-holder-worker-protocol.schema.json`, JSON Schema Draft
     2020-12. Sus cinco envelopes son mutuamente excluyentes:
     `tool_call`, `tool_result`, `tool_error`, `cancel` y `cancel_ack`.
   - Los envelopes son cerrados (`additionalProperties: false`). `args`, `result` y `details`
     admiten valores JSON recursivos porque son payloads de tools; no son envelopes extensibles.
   - `protocolVersion` es exactamente `"1"`. Es un major de protocolo, no SemVer, no existe
     negociación y cualquier otro valor produce `UNSUPPORTED_VERSION`.
   - `callId` es UUID v4 canónico lowercase. `channelToken` es la codificación base64url sin
     padding, canónica, de exactamente 32 bytes aleatorios. El token aparece en `tool_call` y
     `cancel`; nunca en responses.
   - Cada frame JSON UTF-8 tiene un máximo binario independiente de **10 MiB = 10.485.760 bytes**.
     El receptor mide antes de parsear y el emisor antes de enviar. El límite aplica por separado
     a requests y responses; excederlo produce `PAYLOAD_TOO_LARGE` cuando aún puede responderse.
   - Timeout máximo por tool call: **120.000 ms**. El catálogo de tools puede reducirlo, nunca
     aumentarlo sin una nueva versión del protocolo. No hay retry automático porque una tool
     puede no ser idempotente.
   - Máximo **500 `tool_call` aceptados** por invocación. `cancel` no consume cupo. La llamada 501
     recibe `TOO_MANY_CALLS` y la fase falla.
   - El endpoint confiable genera el `callId`; el worker lo reserva antes de ejecutar. Un segundo
     `tool_call` con el mismo ID recibe `DUPLICATE_ID`, incluso si el primero ya terminó. Los IDs
     permanecen reservados hasta destruir la invocación.
   - Un `cancel` válido recibe siempre `cancel_ack` con `accepted`, `already_terminal` o
     `unknown_call`. Después de `accepted`, el call queda terminal y cualquier resultado tardío
     se descarta y no se entrega al modelo. `CANCELLED` representa la terminación iniciada por el
     worker —por deadline o shutdown— antes de un cancel confirmado.
   - Errores normativos:
     `TIMEOUT`, `TOOL_NOT_FOUND`, `INVALID_ARGS`, `WORKER_UNAVAILABLE`,
     `PAYLOAD_TOO_LARGE`, `DUPLICATE_ID`, `UNAUTHORIZED`, `UNSUPPORTED_VERSION`,
     `MALFORMED_MESSAGE`, `TOO_MANY_CALLS`, `CANCELLED` e `INTERNAL_ERROR`.
     Un JSON parseable con envelope inválido recibe `MALFORMED_MESSAGE` si contiene un `callId`
     válido y correlacionable. Un frame que no es JSON no permite construir una response
     correlacionada: el receptor cierra el canal, falla la fase y registra sólo el código
     `MALFORMED_MESSAGE`, nunca el contenido crudo.
   - Datos binarios se referencian por una ruta dentro del worktree del worker; nunca se embeben
     ni referencian rutas del holder.

2. **Autenticación, framing y lifecycle del canal**:
   - Red Docker `--internal`, exclusiva y dedicada por invocación. Sólo el endpoint confiable y
     el worker se conectan a ella.
   - El Orquestador genera `randomBytes(32).toString("base64url")`, siguiendo el patrón ya usado
     en `src/auth/sessionCore.ts`. Lo entrega a endpoint y worker como un secret file read-only
     (`/run/secrets/asdrux_channel_token`, modo `0400`) respaldado por tmpfs, nunca por argumentos
     ni variables de entorno. Ambos procesos lo leen al arrancar y nunca lo copian a logs,
     errores o respuestas del modelo.
   - El receptor primero valida el pattern y la longitud decodificada. Sólo después compara
     buffers de igual longitud con `timingSafeEqual`. Un fallo produce `UNAUTHORIZED` sin revelar
     qué parte falló.
   - El token vive una invocación. Al finalizar por éxito, error o cancelación se destruyen
     contenedores, red, memoria de replay, token y volúmenes privados.

3. **Adaptador Claude Code**:
   - Holder con `--tools ""`, `--mcp-config`, `--strict-mcp-config` y
     `--no-session-persistence`; `--bare` no se usa porque deshabilita OAuth/keychain.
   - `--mcp-config` contiene un único servidor `stdio`: el adaptador confiable versionado de
     FEATURE-015A. No apunta al worker directamente.
   - El adaptador sólo implementa `initialize`, `notifications/initialized`, `tools/list`,
     `tools/call` y cancelación MCP. Rechaza resources, prompts, sampling, elicitation, OAuth y
     cualquier método o notification no enumerado. La cancelación MCP se convierte en
     `cancel`; el adaptador espera `cancel_ack` antes de cerrar la llamada.
   - `CLAUDE_CONFIG_DIR` y `HOME` se crean desde cero por invocación; no hay repo, `CLAUDE.md`,
     settings heredados, hooks, skills, plugins ni managed settings. El cwd es un directorio
     vacío. El adaptador forma parte del TCB, pero no expone una operación genérica capaz de leer
     el filesystem del holder.

4. **Adaptador Codex y proxy bidireccional único**:
   - El Orquestador inicia un hijo
     `codex app-server --listen stdio:// --strict-config`. No hay listener TCP/Unix. El flag
     `--analytics-default-enabled` **se omite**: en las versiones 0.144.6/0.145.0 verificadas es
     un switch que habilita el default, no acepta `=false`; analytics se fuerza a off mediante
     `[analytics].enabled=false`.
   - Un único guard/proxy posee ambos pipes y el proceso hijo. No existe otra conexión a
     `app-server`.
   - **Cliente → servidor**: sólo requests `initialize`, `thread/start`, `turn/start`,
     `turn/interrupt`; notification `initialized`; y responses cuyos IDs correspondan a un
     request `item/tool/call` pendiente originado por el servidor.
   - **Servidor → cliente**: sólo responses a IDs de requests pendientes del cliente; request
     `item/tool/call`; y notifications `thread/started`, `turn/started`, `item/started`,
     `item/completed`, `item/agentMessage/delta`, `turn/completed`, `configWarning`, `warning` y
     `error`. `configWarning` se agregó tras observarlo en el handshake real 0.144.6/0.145.0; sus
     params se validan contra el schema de la tupla fijada y se redactan antes de loguear.
   - No se permite wildcard, prefijo ni “métodos equivalentes”. Cada nombre anterior se fija en
     el código y en contract tests contra el schema de la tupla Codex aprobada.
   - El proxy valida envelope, dirección, clase JSON-RPC, unicidad/correlación de IDs, tamaño
     máximo de 10 MiB por línea y params cerrados. `thread/start` sólo puede usar el cwd vacío,
     sandbox read-only y el catálogo exacto de `dynamicTools`; `turn/start` sólo puede referenciar
     ese thread y el input/modelo fijados por el pipeline; `turn/interrupt` sólo el turn activo.
   - `item/tool/call` se valida contra el catálogo exacto y se traduce al contrato canónico.
     `command/exec`, `process/spawn`, MCP, apps, browser, realtime, elicitation, login y cualquier
     mensaje no enumerado provocan: rechazo, cierre de pipes, terminación del hijo y falla de la
     fase. `stderr` es un stream separado, acotado y redactado; nunca se parsea como JSON-RPC.

5. **Caché OAuth escribible sin compartir el slot canónico**:
   - El slot canónico vive bajo control del Orquestador y nunca se monta en holder o worker.
   - Tras adquirir el lock, el Orquestador materializa una copia privada del slot en un volumen
     RW por invocación. Sólo el holder ve esa copia. El refresh nativo escribe allí.
   - Al terminar con éxito, el Orquestador promueve la copia privada al slot canónico sólo dentro
     de una operación que verifica la tripleta
     `(credential_slot_id, run_id, fencing_token)` vigente. En falla, cancelación, lease perdido
     o Postgres inaccesible, descarta la copia sin promoción.
   - Esta decisión evita que un holder zombie escriba directamente sobre el caché canónico; una
     simple verificación “antes de escribir” no sería suficiente si el CLI conservara acceso RW
     al mismo directorio compartido.

6. **Concurrencia por identidad OAuth**, con un único algoritmo:
   - Identidad: `credential_slot_id = (user_id, provider)`.
   - Secuencia dedicada:
     `CREATE SEQUENCE oauth_credential_fencing_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE`.
     No existe contador manual por fila.
   - Tabla `oauth_credential_locks`: `credential_slot_id` PK, `run_id`, `fencing_token bigint`,
     `acquired_at timestamptz`, `lease_expires_at timestamptz`.
   - Adquisición atómica:

     ```sql
     WITH candidate AS (
       SELECT nextval('oauth_credential_fencing_seq') AS fencing_token,
              clock_timestamp() AS db_now
     )
     INSERT INTO oauth_credential_locks (
       credential_slot_id, run_id, fencing_token, acquired_at, lease_expires_at
     )
     SELECT $1, $2, fencing_token, db_now, db_now + interval '90 seconds'
     FROM candidate
     ON CONFLICT (credential_slot_id) DO UPDATE
     SET run_id = EXCLUDED.run_id,
         fencing_token = EXCLUDED.fencing_token,
         acquired_at = EXCLUDED.acquired_at,
         lease_expires_at = EXCLUDED.lease_expires_at
     WHERE oauth_credential_locks.lease_expires_at <= EXCLUDED.acquired_at
     RETURNING credential_slot_id, run_id, fencing_token, lease_expires_at;
     ```

     Para una fila nueva el primer token es el primer `nextval()` disponible, inicialmente 1.
     Intentos rechazados pueden consumir números; los gaps son válidos y preservan monotonía.
     Cero filas retornadas significa slot ocupado y el run no arranca.
   - Heartbeat cada 30 s:

     ```sql
     UPDATE oauth_credential_locks
     SET lease_expires_at = clock_timestamp() + interval '90 seconds'
     WHERE credential_slot_id = $1
       AND run_id = $2
       AND fencing_token = $3
       AND lease_expires_at > clock_timestamp()
     RETURNING lease_expires_at;
     ```

   - Release no borra la fila; fuerza expiración, preservando evidencia del último owner:

     ```sql
     UPDATE oauth_credential_locks
     SET lease_expires_at = clock_timestamp()
     WHERE credential_slot_id = $1
       AND run_id = $2
       AND fencing_token = $3
       AND lease_expires_at > clock_timestamp()
     RETURNING fencing_token;
     ```

   - La promoción de caché es una sección crítica única. Abre una transacción y bloquea la fila:

     ```sql
     SELECT fencing_token
     FROM oauth_credential_locks
     WHERE credential_slot_id = $1
       AND run_id = $2
       AND fencing_token = $3
       AND lease_expires_at > clock_timestamp()
     FOR UPDATE;
     ```

     Antes de abrir la transacción, el coordinador prepara y hace `fsync` de un temporal dentro
     del mismo filesystem canónico, sin reemplazar el slot. Sólo si el `SELECT ... FOR UPDATE`
     retorna una fila, ejecuta el rename atómico y el release de arriba antes del `COMMIT`. El row
     lock impide takeover durante ese replace breve. Si no retorna fila o falla antes del rename,
     hace rollback y no toca el slot. Si el proceso o la DB fallan después del rename, el slot
     contiene completa la versión privada que era legítima al adquirir el row lock —nunca un
     archivo parcial— y el lease queda vigente hasta commit o expiración; el run se marca fallido
     y la recuperación parte de una de las dos versiones atómicas. No se afirma atomicidad entre
     Postgres y filesystem. Éste es el punto de enforcement del fencing. El supervisor también
     deja de aceptar nuevas tools, termina holder/worker y destruye su red/volumen al perder el
     lease.
   - Si un heartbeat falla, retorna cero filas o Postgres no responde, el supervisor falla
     cerrado inmediatamente, sin esperar los 90 s. No promueve caché ni permite fallback.

7. **Pinning reproducible de Codex**:
   - Tras la aprobación explícita del owner se crea `docker/codex-pin.json` como única fuente
     autoritativa, con:

     ```json
     {
       "schemaVersion": 1,
       "platform": "linux/amd64",
       "npmPackage": "@openai/codex",
       "npmVersion": "<exacta aprobada>",
       "npmIntegrity": "sha512-<integrity exacta del paquete>",
       "baseImage": "node:22-alpine",
       "baseImageDigest": "sha256:<64-hex>",
       "expectedCliVersion": "<salida exacta de codex --version>",
       "appServerSchemaTreeSha256": "<64-hex>"
     }
     ```

   - `0.144.6` es sólo evidencia histórica/ilustrativa hasta que el owner apruebe la tupla; no es
     un pin aprobado.
   - Dockerfile/CI leen el manifest: el build exige `platform`; `FROM` usa
     `baseImage@baseImageDigest`; npm instala `npmPackage@npmVersion` y verifica
     `npmIntegrity`; dentro de la imagen se compara `npm ls -g --json` con `npmVersion` y, por
     separado, la salida literal de `codex --version` con `expectedCliVersion`. Nunca se comparan
     esas dos versiones entre sí.
   - La imagen genera los schemas de `app-server`. El tree hash se calcula sobre paths ordenados
     y el SHA-256 de cada archivo (`path + NUL + fileSha256 + LF`) y se compara con
     `appServerSchemaTreeSha256`.
   - El digest de la imagen final es una salida del build, se registra en evidencia y deployment,
     y producción consume ese digest, no un tag. Cualquier mismatch aborta el build.

8. **Topología Docker por invocación**, con contenedores separados administrados por el daemon
   rootful, red interna exclusiva, holder sin Docker socket y worker sin interfaz administrativa.

9. **Spikes funcionales** de ambos adaptadores con una tool genérica sintética. No usan tools de
   roles reales ni credenciales reales en Etapa 1.

## Excluido

1. Wiring de Architect, Functional, Planning, QA o Developer; pertenece a FEATURE-015B.
2. Paridad completa con tools reales, streaming específico, patches y exit codes; pertenece a
   FEATURE-015B.
3. Decidir egress amplio o mínimo del worker; FEATURE-015B lo define por rol.
4. Implementar `authMode`; pertenece a FEATURE-016.
5. Usar DLP o logging post-hoc como sustituto del aislamiento estructural.
6. Resolver el aislamiento de otros secretos que legítimamente existan en el worktree del worker.

## Future ideas (opcional)

- **Egress allowlisted del holder**: defensa en profundidad y señal de detección ante una
  superficie saliente omitida, un bug o una alteración de supply chain. No es requisito de esta
  Feature porque Reglas 2 y 4 cierran todas las superficies salientes controlables por el modelo
  dentro del TCB definido. Un allowlist tampoco impide que un binario comprometido module datos
  dentro de tráfico permitido al proveedor. Puede incorporarse después si el costo operativo y
  los falsos positivos justifican esa telemetría adicional.
- Extender el protocolo a otros secretos/casos del Orquestador.
- Logging y alertas como evidencia complementaria, no como control preventivo principal.

---

# 5. Functional Rules

1. El worker nunca recibe el caché OAuth, una copia, variables que lo contengan ni un mount que lo
   exponga.
2. El holder no expone tools locales. Los dos endpoints confiables aplican contratos
   bidireccionales cerrados: adaptador MCP mínimo para Claude y proxy JSON-RPC de Scope punto 4
   para Codex. Cualquier mensaje no enumerado termina la fase.
3. Toda operación de shell/filesystem pedida por el modelo se ejecuta en el worker.
4. **Superficies auxiliares desactivadas explícitamente**:
   - Claude Code: entorno por allowlist; `CLAUDE_CONFIG_DIR` controlado;
     `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_TELEMETRY=1`,
     `DISABLE_ERROR_REPORTING=1`, `DISABLE_UPDATES=1`,
     `ENABLE_CLAUDEAI_MCP_SERVERS=false` y
     `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1`; sin `ANTHROPIC_BASE_URL`,
     `ANTHROPIC_CUSTOM_HEADERS`, proxy/gateway alternativo, OTLP, hooks, plugins, connectors o MCP
     adicional. El único MCP es el adaptador `stdio` y éste rechaza mensajes server→client
     inesperados; una URL interna correcta no constituye por sí sola ese rechazo.
   - Codex: `CODEX_HOME` mínimo generado por invocación; `check_for_update_on_startup=false`,
     `web_search="disabled"`, `[analytics].enabled=false`,
     `[otel].exporter="none"`, `[otel].trace_exporter="none"` y
     `[otel].metrics_exporter="none"`; `[apps._default].enabled=false`; tabla
     `[mcp_servers]` vacía; flags `[features]` `browser_use=false`,
     `browser_use_full_cdp_access=false`, `browser_use_external=false`,
     `in_app_browser=false` y `computer_use=false`; sin `notify`, plugins,
     `openai_base_url`, `chatgpt_base_url`, `model_providers`,
     `experimental_realtime_ws_base_url` ni auth helpers. Se usa el provider OpenAI integrado.
     `--strict-config` hace fallar el arranque si la versión fijada no reconoce un campo. El proxy
     de Scope punto 4 bloquea además MCP/apps/browser/realtime/elicitation aunque una futura
     default cambiara.
   - Fuentes oficiales consultadas: [Claude Code environment variables](https://code.claude.com/docs/en/env-vars),
     [Claude Code MCP](https://code.claude.com/docs/en/mcp) y
     [Codex configuration](https://developers.openai.com/codex/config-reference/).
5. Una tool `read(path)` se resuelve sólo en el namespace del worker. No existe operación de
   protocolo para leer una ruta del holder.
6. El holder recibe una copia privada RW; el slot canónico no se monta. Sólo el Orquestador puede
   promover la copia con la tripleta de fencing vigente (Scope puntos 5 y 6).
7. Cualquier caída del holder, worker, canal, supervisor o Postgres falla cerrado, sin degradar a
   ejecución con credenciales en el worker.
8. Una segunda invocación para el mismo `credential_slot_id` sólo arranca tras adquirir el lock
   con la secuencia, lease y fencing definidos en Scope punto 6.
9. Codex sólo se construye y despliega desde la tupla autoritativa de Scope punto 7; los checks de
   paquete, binario y schemas son independientes.
10. El holder no monta Docker socket ni worktree; el worker no alcanza `app-server`; logs,
    errores, prompts y argumentos nunca contienen tokens ni contenido del caché.
11. La garantía cubre la credencial OAuth, no todo secreto que pudiera existir en el worktree.
12. El protocolo es neutral respecto del egress amplio o mínimo que FEATURE-015B asigne al worker.

---

# 6. Estrategia Algorítmica

La lógica normativa está definida en Scope puntos 1, 4, 5, 6 y 7. No existen alternativas de
lock, proxy, transporte o pinning pendientes de selección en v1.5. La tupla Codex 0.145.0
aprobada está materializada en `docker/codex-pin.json`.

---

# 7. Technical Considerations

## Topología

```text
Orquestador confiable
├── coordinador de slot/lease/fencing
├── endpoint confiable
│   ├── Claude: adaptador MCP stdio mínimo en la zona holder
│   └── Codex: proxy/controlador JSON-RPC de app-server
├── holder OAuth
│   ├── copia privada RW de credenciales
│   └── inferencia, sin worktree ni tools locales
└── worker no confiable
    ├── worktree y tools
    └── red por rol, sin credenciales
```

| Segmento | Diseño |
|---|---|
| Endpoint confiable ↔ worker | Red Docker `--internal` exclusiva por invocación + token efímero |
| Holder → proveedor | Egress necesario para autenticación/inferencia; superficies auxiliares cerradas por Regla 4 |
| Worker → internet | Política de FEATURE-015B |
| Worker → holder/app-server | Sin ruta ni protocolo |
| Otros contenedores/tenants | Sin ruta a la red exclusiva |

## Decisión sobre egress del holder

La garantía no supone que un CLI stock “sólo contacta al proveedor”. La premisa verificable es
que ninguna superficie controlable por el modelo puede elegir un destino arbitrario o leer el
secreto: esto se obtiene con el contrato bidireccional cerrado (Regla 2), el cierre explícito de
superficies auxiliares (Regla 4) y la ausencia de tools locales. Un allowlist de red aportaría
defensa en profundidad y detección de destinos inesperados, especialmente ante bugs o supply
chain, pero no es necesario para cerrar el modelo de amenaza de prompt injection y no detendría
exfiltración encapsulada hacia un host permitido. Por eso permanece como Future idea y no como
bloqueante del Approval Gate.

## Otros puntos

- FEATURE-008 ya comprobó que `unshare -n` no es viable en esta VPS. Se usan contenedores
  separados con daemon rootful.
- `dynamicTools` requiere `experimentalApi: true`; el riesgo se acota con pin manifest, hash de
  schemas y contract tests, pero no desaparece.
- El adaptador MCP de Claude es código confiable adicional. Se elige porque permite autenticar el
  contrato, aplicar límites/cancelación uniformes y evitar que el worker sea un servidor MCP
  capaz de iniciar mensajes server→client.
- La copia privada de caché agrega material secreto temporal. Debe tener permisos mínimos,
  lifecycle por invocación y borrado al destruir el volumen; a cambio hace enforceable el
  fencing sobre la única escritura persistente.

---

# 8. Validation Criteria

| Escenario | Expected Output |
|---|---|
| Validación del schema | Los cinco tipos válidos pasan; campos extra, UUID/token/version inválidos y response con shape ambiguo fallan |
| Frame request/response > 10 MiB | Rechazo antes de parsear/enviar; fase falla |
| Call 501 o `callId` repetido | `TOO_MANY_CALLS` o `DUPLICATE_ID`; sin ejecución |
| Cancel concurrente con resultado | `cancel_ack`; tras `accepted` nunca se entrega resultado tardío |
| Worker intenta leer caché | Ruta inexistente; canary secreto ausente en filesystem, mounts y `/proc/*/environ` |
| Holder intenta tool local | Inventario efectivo no contiene shell/read/write; intento no llega a ningún ejecutor local |
| Mensaje MCP/JSON-RPC inesperado en cualquier dirección | Rechazo, terminación del proceso protegido y falla de fase |
| Refresh en copia privada | Escritura funciona; worker no ve la copia |
| Holder zombie intenta promover caché | La tripleta/fencing viejo afecta cero filas y la copia se descarta |
| Postgres cae antes de vencer lease | Abort inmediato; no nuevas tools ni promoción |
| Dos runs para mismo slot | Uno adquiere; el otro recibe cero filas y no arranca |
| Runs para slots distintos | Locks independientes |
| Config auxiliar Claude/Codex alterada | Verificación de runtime o `--strict-config` falla cerrado |
| Pin de paquete/binario/schema/base | Cada mismatch independiente falla CI |
| Holder, worker o canal caído | Falla explícita sin fallback |

### Validation Evidence

- Tests del schema Draft 2020-12 con casos positivos/negativos y límites de bytes.
- Contract tests de ambos proxies, incluyendo dirección, clase de mensaje, IDs, params,
  backpressure, cancelación y mensajes inesperados.
- `docker inspect`, inspección adversarial desde el worker y canary sintético.
- Inventario efectivo de tools y fuentes de configuración al arrancar.
- Tests Postgres concurrentes y con reloj controlado para acquire/heartbeat/release/promoción.
- Manifest, logs de verificaciones independientes y digest final de imagen.
- Pruebas separadas de fail-closed para cada componente.

La evidencia seguirá el formato de `FEATURE-012-implementation-results.md` y
`FEATURE-014-implementation-results.md`.

---

# 9. Risks

- `dynamicTools` sigue siendo experimental; pinning detecta cambios, no garantiza estabilidad
  futura.
- El adaptador MCP y el proxy pasan a ser TCB y requieren revisión de seguridad y tests
  adversariales.
- La paridad de tools reales se difiere a FEATURE-015B.
- La copia privada RW debe eliminarse aun ante crash; un volumen huérfano es un incidente de
  cleanup, aunque no expone el secreto al worker.
- La Feature protege OAuth, no secretos del worktree.
- Un allowlist de egress podría detectar superficies omitidas, pero agrega mantenimiento y no
  previene tráfico encubierto a destinos permitidos.
- `claude auth logout` intenta revocar el refresh token server-side en versiones inspeccionadas,
  pero es best-effort; no debe considerarse mecanismo de cleanup suficiente para pruebas.

---

# 10. Approval Gate

Implementación de producción prohibida hasta aprobación explícita del owner.

## Etapa 1 — Diseño y spikes sin credenciales reales

1. ☑ Validar el schema de Scope punto 1 con suite positiva/negativa, byte limits, replay,
   cancelación y todos los errores tipados. Evidencia:
   `docs/features/evidence/FEATURE-015A/schema_protocol_raw.txt`.
2. ☑ Spike Claude: comando/config/HOME limpios y adaptador MCP mínimo; comprobar allowlist
   bidireccional sin login. Evidencia:
   `docs/features/evidence/FEATURE-015A/runtime_cli_topology_raw.txt` y suite contractual del
   ítem 1.
3. ☑ Spike Codex: implementar exactamente el proxy de Scope punto 4 y contract tests contra los
   schemas de la versión instalada. Evidencia:
   `docs/features/evidence/FEATURE-015A/schema_protocol_raw.txt` y
   `docs/features/evidence/FEATURE-015A/codex_schema_contract_raw.txt` y
   `docs/features/evidence/FEATURE-015A/codex_app_server_smoke_raw.txt`. El spike originó las
   dos correcciones v1.5 documentadas en Scope punto 4.
4. ☑ Verificar en runtime todas las superficies de Regla 4 para ambos CLIs; cualquier fuente o
   método extra falla cerrado. Evidencia:
   `docs/features/evidence/FEATURE-015A/runtime_cli_topology_raw.txt`.
5. ☑ Validar topología Docker, red interna exclusiva, mounts y ausencia de rutas
   worker→control-plane del holder. Evidencia:
   `docs/features/evidence/FEATURE-015A/runtime_cli_topology_raw.txt`.
6. ☑ Validar copia privada RW y promoción sintética condicionada por fencing, sin token real.
   Evidencia: `docs/features/evidence/FEATURE-015A/lock_cache_db_raw.txt`.
7. ☑ Validar acquire/heartbeat/release/promoción de Scope punto 6 con concurrencia, reloj
   controlado, zombie y caída de Postgres. Evidencia:
   `docs/features/evidence/FEATURE-015A/lock_cache_db_raw.txt` y
   `docs/features/evidence/FEATURE-015A/db_shutdown_raw.txt`.
8. ☑ Obtener aprobación del owner para `docker/codex-pin.json`; validar por separado base,
   paquete, binario, tree hash de schemas y digest OCI del build candidato. El digest de registry
   definitivo permanece como output obligatorio del pipeline de deployment. Propuesta y evidencia:
   `docs/features/FEATURE-015A-stage1-results.md`, sección 4. Aprobación explícita recibida el
   2026-07-23; manifest autoritativo: `docker/codex-pin.json`.
9. ☑ Ejecutar pruebas fail-closed y de cleanup para holder, worker, canal, supervisor y DB.
   Evidencia: `docs/features/evidence/FEATURE-015A/schema_protocol_raw.txt`,
   `docs/features/evidence/FEATURE-015A/supervisor_shutdown_raw.txt` y
   `docs/features/evidence/FEATURE-015A/db_shutdown_raw.txt`.

**Etapa 1 cerrada: 9/9 ítems ☑.** Este cierre no autoriza Etapa 2 ni el uso de credenciales
reales.

## Etapa 2 — Validación con credenciales reales

Requiere cuenta Pro personal desechable pagada para la prueba. Nunca se usa la sesión real
`asdrubal.perez@santexgroup.com`.

1. ☐ Login aislado de la cuenta desechable.
2. ☐ Handshake y tool call end-to-end de Claude; inventario efectivo de tools en ambos
   adaptadores.
3. ☐ Refresh real sobre copia privada y promoción con fencing vigente.
4. ☐ Pruebas controladas de copia/reuso/revocación, sin asumir que logout invalida todo token.
5. ☐ Revocar por CLI y por Settings, documentar resultados y destruir todos los volúmenes.

## Etapa 3 — Aceptación

1. ☐ Tests automatizados y contract tests pasando.
2. ☐ Evidencia real completa en el formato de Features 012/014.
3. ☐ Revisión conjunta Architect + owner y aprobación explícita antes de wiring de FEATURE-015B.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.
