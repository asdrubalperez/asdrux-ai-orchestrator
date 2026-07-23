# FEATURE-015A — Egress y aislamiento de credenciales OAuth — Parte 015A: Arquitectura holder/worker genérica

Versión: v1.3 (borrador para revisión — no aprobado; historial: v1.0 diseño inicial, v1.1
resolución de los 8 bloqueantes de la primera evaluación, v1.2 ajustes tras la re-evaluación,
v1.3 corrección de 4 contradicciones internas + 4 referencias cruzadas rotas encontradas en
auditoría completa)
Basado en template: `docs/playbook/07-FEATURE-TEMPLATE.md` v2.1
Parte de: FEATURE-015 (desdoblada en 015A/015B, secuencial — ver `docs/ROADMAP.md`)
Insumos: `docs/research/investigacion-egress-proteccion-exfiltracion.md` (v1.0 + Anexo de
factibilidad), evaluación de Codex sobre el diseño descartado de FEATURE-016A (contradicción
mount RO / refresh escribible, asimetría de Bash entre proveedores)

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
un archivo de credenciales OAuth portable — copiarlo alcanza para reusar la sesión completa
(confirmado empíricamente). Ese proceso presenta al menos dos canales de fuga distintos:

1. **Canal de respuesta**: cualquier rol con herramientas de lectura (`Read`/`Grep`/`Glob`), con o
   sin Bash, puede ser inducido vía prompt injection a leer el caché de credenciales y devolverlo
   dentro de su propia respuesta de texto al proveedor — sin que exista tráfico de red de por
   medio. Este canal aplica a los 5 roles del Orquestador (Architect, Functional, Planning, QA,
   Developer) por igual.
2. **Canal de red**: con Bash y egress sin restricción, el secreto puede salir directo a un
   destino externo — cifrado, fragmentado, por DNS — sin pasar por la respuesta visible del
   modelo. Aplica hoy a Developer, y —verificado contra el código real— también a
   Architect/Functional/Planning en Codex (`shouldDisableShellTool` solo excluye a `"qa"`), aunque
   no a esos mismos roles en Claude Code (`resolveTools()` no les da Bash).

Una evaluación técnica sobre un diseño anterior descartado (FEATURE-016A) encontró además una
contradicción de diseño real, no solo teórica: un mismo mount **no puede ser simultáneamente
read-only para el proceso que lo usa y escribible para el refresh de token** — se verificó en la
VPS con un archivo señuelo que el intento de escritura sobre un mount RO falla con
`Read-only file system`. Esta Feature debe resolver esa contradicción de raíz, no repetirla.

El criterio de diseño ya definido por el owner: la protección debe sostenerse frente a un modelo
comprometido o manipulado activamente (prompt injection), no solo frente a fugas accidentales — y
no puede resolverse a costa de bloquear la investigación real en internet que varios roles
necesitan (eso se decide por rol en FEATURE-015B; esta Feature solo construye el mecanismo que
debe soportar ambos casos).

---

# 3. Functional Goal

Después de FEATURE-015A, existe y queda validado un mecanismo genérico de aislamiento
holder/worker, para los dos proveedores (Claude Code y Codex), que **ningún rol real usa
todavía** — eso es responsabilidad de FEATURE-015B. El mecanismo debe:

- Garantizar que el **worker** (proceso que ejecuta las herramientas que el modelo solicita) nunca
  reciba el archivo de credenciales, sus tokens, ni ninguna variable/mount que lo exponga — bajo
  ninguna configuración de red del worker (amplia o mínima).
- Garantizar que el **holder** (proceso que posee la credencial y hace la llamada autenticada al
  modelo) nunca ejecute herramientas de shell/filesystem sobre su propio entorno.
- Resolver el refresh de token sin contradicción de mount: el holder posee su caché de forma
  escribible de manera directa (no un mount read-only sobre el que después se espera escritura).
- Fallar explícitamente (fail-closed) ante caída del holder, del worker o del canal entre ambos,
  evaluado por separado para cada componente.

---

# 4. Scope

## Incluido

1. **Protocolo holder↔worker**, definido en detalle (no solo nombrado):
   - **Autenticación del canal**: red Docker `--internal` exclusiva y dedicada por invocación
     (capa principal — ningún otro contenedor de la VPS, de otra invocación o de otro tenant
     puede rutear hacia ella) + token efímero de canal generado por invocación, incluido en cada
     request (capa adicional de aplicación, defensa en profundidad si la capa de red fallara por
     un error de configuración).
   - **Transporte**: Claude Code — HTTP sobre la red interna (MCP remoto estándar). Codex —
     `stdio`/JSON-RPC entre Orquestador↔holder; canal separado y autenticado hacia el worker (ver
     Rule de controlador mínimo, más abajo).
   - **Versionado**: cada request incluye `protocolVersion` (semver simple); el worker rechaza
     explícitamente versiones que no reconoce, nunca intenta interpretarlas.
   - **Request/call id**: UUID por request, generado por el holder, devuelto en la respuesta —
     permite correlación y protección básica contra replay.
   - **Límites**: tamaño máximo de payload, timeout por tool call (configurable por tipo de
     operación), límite de tool calls por invocación completa.
   - **Cancelación**: propagación explícita de un mensaje de cancelación al worker cuando la
     invocación completa se cancela (`AbortSignal` del pipeline existente) — no basta con cerrar
     el socket.
   - **Errores tipados**: `TIMEOUT`, `TOOL_NOT_FOUND`, `INVALID_ARGS`, `WORKER_UNAVAILABLE`,
     `PAYLOAD_TOO_LARGE` — nunca un string libre.
   - **Idempotencia**: las tool calls no se consideran idempotentes por default (Bash no lo es) —
     no hay reintento automático de una tool call fallida; falla la fase completa (consistente con
     fail-closed).
   - **Encoding**: JSON UTF-8 para control; datos binarios se referencian por path dentro del
     worktree del worker, nunca embebidos en el payload.
   - **Cierre/limpieza**: al terminar la invocación (éxito, falla o cancelación), se destruyen la
     red Docker y ambos contenedores — nunca se reutiliza una red o un holder entre invocaciones
     distintas.
   - Sin una operación genérica de "leer cualquier ruta" del holder expuesta al worker (ver Regla
     5 de Functional Rules).
   - **Schema wire concreto** (mismo shape para los dos transportes, adaptando el envelope):
     ```json
     // Request (holder -> worker)
     {
       "protocolVersion": "1.0",
       "callId": "uuid-v4",
       "channelToken": "base64url-32-bytes",
       "toolName": "string",
       "args": { "...": "..." }
     }
     // Response de éxito (worker -> holder)
     { "callId": "uuid-v4", "result": { "...": "..." } }
     // Response de error (worker -> holder)
     {
       "callId": "uuid-v4",
       "error": {
         "code": "TIMEOUT | TOOL_NOT_FOUND | INVALID_ARGS | WORKER_UNAVAILABLE | PAYLOAD_TOO_LARGE | DUPLICATE_ID",
         "message": "string"
       }
     }
     // Cancelación (holder -> worker)
     { "callId": "uuid-v4", "type": "cancel" }
     ```
     Límites concretos (default, ajustable por tipo de operación si hace falta): payload máximo
     10MB; timeout por tool call 120s; máximo 500 tool calls por invocación. Replay: el worker
     mantiene en memoria el set de `callId` vistos durante la vida de la invocación, rechaza
     duplicados con `DUPLICATE_ID`. Carrera de cancelación: una respuesta que llega después de
     que el holder ya envió `cancel` para ese `callId` se descarta silenciosamente (no se
     procesa, no se re-envía error).
2. **Adaptador Claude Code**: holder ejecutado con `--tools ""` (deshabilita herramientas
   integradas) + `--mcp-config`/`--strict-mcp-config` apuntando a un servidor MCP remoto expuesto
   por el worker. `--bare` descartado (deshabilita OAuth/keychain). Dado que sin `--bare` Claude
   Code puede buscar configuración local (`~/.claude/settings.json`, hooks, plugins, skills,
   descubrimiento de `CLAUDE.md`), el `HOME` del holder se crea **desde cero por invocación**,
   conteniendo únicamente el caché de credenciales (Regla 6 de Functional Rules) — sin
   `settings.json`, sin directorio de skills, sin ningún worktree/proyecto montado (por lo tanto
   sin `CLAUDE.md` real que descubrir), reusando `--no-session-persistence` (ya presente en el
   código actual del Orquestador) para no dejar estado de sesión entre invocaciones. El `cwd` del
   holder es ese mismo `HOME` vacío, nunca un repo real.
3. **Adaptador Codex**: holder ejecutado vía `codex app-server` (`experimentalApi: true`)
   distinguiendo explícitamente 4 superficies: métodos JSON-RPC permitidos al controlador
   confiable, tools presentadas al modelo, sandbox/filesystem del holder (sin worktree,
   read-only, home mínimo), y dynamic tools delegadas al worker. El controlador confiable (parte
   del Orquestador, no el holder mismo) se protege con dos capas, no con la promesa de "nunca
   invoca `command/exec`/`process/spawn`": (a) un **cliente JSON-RPC mínimo**, cuyo código no
   tiene ningún camino para construir esos métodos, y (b) un **proxy con allowlist explícita**
   delante de `app-server` que valida cada método JSON-RPC saliente contra una lista permitida
   (`initialize`, `initialized`, `thread/start`, respuesta a `item/tool/call`, y poco más) —
   cualquier otro método se rechaza ahí, incluso si el cliente tuviera un bug. `app-server` corre
   por `stdio`, nunca como listener compartido con el worker.
4. **Resolución de la contradicción RO/refresh**: el holder posee su caché de credenciales en un
   directorio/volumen propio, con acceso de lectura y escritura directo (no un bind mount
   read-only). El refresh nativo/reactivo dentro del ciclo de invocación está permitido y
   esperado; si falla, la fase falla explícitamente. Esta regla existe específicamente para no
   repetir la contradicción que encontró la evaluación de FEATURE-016A.
5. **El worker nunca recibe el caché de credenciales**, bajo ninguna configuración de red
   (amplia o mínima) — la política de red específica del worker por rol es responsabilidad de
   FEATURE-015B, no de esta Feature.
6. **Política de concurrencia**: identidad = `credentialSlotId` = `(user_id, proveedor)` — no solo
   `user_id`, porque un mismo usuario puede tener sesiones OAuth independientes de Claude y de
   Codex simultáneamente. Lock implementado en una tabla nueva `oauth_credential_locks`
   (`credential_slot_id` único, `run_id`, `fencing_token` (entero autoincremental o secuencia),
   `acquired_at`, `lease_expires_at`), siguiendo el mismo patrón de Postgres ya usado por
   `sessions` (FEATURE-014). **Adquisición**: `INSERT ... ON CONFLICT (credential_slot_id) DO
   UPDATE SET run_id = EXCLUDED.run_id, fencing_token = oauth_credential_locks.fencing_token + 1,
   acquired_at = now(), lease_expires_at = now() + interval '90 seconds' WHERE
   oauth_credential_locks.lease_expires_at <= now()` — un upsert condicionado por el vencimiento
   del lease, no un `INSERT` simple que se trabaría para siempre con una fila vencida. Si la
   condición `WHERE` no matchea (lease todavía vigente de otro run), la fila no se actualiza y el
   sistema detecta 0 filas afectadas → rechaza el nuevo run explícitamente. El `fencing_token`
   devuelto se usa para que, si un holder viejo (que perdió su lease sin saberlo) intenta escribir
   de vuelta, su fencing token desactualizado sea rechazado — evita que un holder zombie
   reactivado pise el trabajo del holder que legítimamente tomó el slot después. El holder
   renueva el lease periódicamente (heartbeat, cada ~30s, lease de 90s — 3x margen) mientras vive,
   verificando su propio `fencing_token`; si pierde el lease o no puede renovarlo, aborta la
   invocación en curso. Se libera explícitamente al terminar el run (éxito, falla o cancelación).
   **El lock es por `credential_slot_id`, nunca global** — un cliente/tenant nunca bloquea a otro
   (ver Risks, nota de multi-tenant futuro).
7. Fronteras obligatorias: el holder no monta el Docker socket; el worker no puede abrir una
   sesión administrativa contra `app-server`; el holder no escucha puertos accesibles desde el
   worker salvo autenticación y necesidad explícita; configuración, logs, errores y system prompt
   del holder nunca incluyen contenido del caché.
8. **Pinning de Codex — artefacto único autoritativo**, no solo "fijar una versión": el Dockerfile
   instala una versión exacta y verificable (ej. `npm install -g @openai/codex@0.144.6`, nunca sin
   versión), la imagen final se referencia por **digest** (`sha256:...`, no por tag mutable), y el
   build/CI ejecuta `codex-cli --version` (o equivalente) dentro de la imagen construida,
   **fallando el build** si no coincide con el valor esperado — el desfase real que encontró la
   evaluación anterior (paquete `0.144.5` declarado vs binario efectivo `0.144.6`) es precisamente
   el caso que este check debe capturar. Los contract tests contra el schema de `dynamicTools` se
   generan dentro de esa misma imagen fijada por digest, nunca contra una instalación distinta.
9. Topología de referencia (contenedores Docker separados, administrados por el daemon rootful —
   no namespaces sin privilegios, dado el límite de kernel ya conocido en FEATURE-008).
10. Un spike funcional por adaptador con al menos una tool genérica de prueba (no las tools reales
    de ningún rol todavía) para demostrar que el mecanismo funciona de punta a punta.

## Excluido

1. **Wiring real de cualquier rol** (Architect, Functional, Planning, QA, Developer) sobre este
   mecanismo — eso es FEATURE-015B completo.
2. **Paridad funcional completa** con las tools reales de cada rol (streaming, cancelación, cwd,
   patches, exit codes específicos de cada caso de uso) — se valida por rol en FEATURE-015B, no
   acá. Esta Feature solo prueba que el mecanismo transporta una tool genérica de punta a punta.
3. Decisión de qué roles tienen worker de internet amplio vs mínimo — eso es una decisión de
   FEATURE-015B, esta Feature construye el mecanismo neutral a esa decisión.
4. Implementar `authMode` en sí — eso es FEATURE-016, que depende de esta Feature (015A) y de
   015B, no al revés.
5. Enfoque 1 (proxy DLP) y Enfoque 3 (logging post-hoc) como controles preventivos principales —
   siguen descartados como sustituto del holder/worker, por no ofrecer garantía estructural frente
   a un modelo activamente evasivo.
6. Validar concurrencia con múltiples holders activos simultáneamente para identidades OAuth
   distintas — no es necesario resolverlo acá, la política del punto 6 de Incluido ya lo acota a
   una identidad a la vez.

## Future ideas (opcional)

- **Egress allowlisted del holder (proxy con lista fija de hosts permitidos)**: defensa en
  profundidad de baja prioridad contra un escenario de supply chain (binario del CLI
  comprometido), no contra el modelo de amenaza principal de esta Feature. Retirado del Approval
  Gate tras discusión explícita con el owner — no es una garantía de esta Feature, se anota como
  mejora futura opcional si en algún momento se decide invertir en ese escenario específico.

- Extender el protocolo holder/worker a otros casos de uso del Orquestador que en el futuro
  necesiten aislar un secreto de un proceso con tools de lectura/ejecución.
- Logging/auditoría (Enfoque 3) como capa complementaria de evidencia sobre el mecanismo ya
  implementado, no como sustituto.

---

# 5. Functional Rules

1. El worker nunca recibe el archivo/caché de credenciales OAuth, variables de entorno que lo
   referencien, ni un mount que lo exponga, bajo ninguna configuración de red del worker.
2. El holder no expone ninguna herramienta integrada de ejecución de comandos ni edición de
   archivos sobre su propio filesystem. Para Codex, el controlador confiable usa un **cliente
   JSON-RPC mínimo** (sin código capaz de construir `command/exec`/`process/spawn`) **más** un
   **proxy con allowlist explícita** que rechaza cualquier método no autorizado — la promesa de
   "nunca los invoca" no es, por sí sola, una frontera (Scope → Incluido punto 3).
3. Toda operación de shell/filesystem que el modelo solicite se ejecuta en el worker — nunca en
   el holder.
4. **Superficies auxiliares del holder desactivadas explícitamente** (hallazgo de la
   re-evaluación de Codex sobre el retiro del egress allowlisted — no son parte del canal
   principal, pero deben cerrarse para sostener la premisa de que el holder no puede seleccionar
   destinos arbitrarios): `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` (telemetría/updater/error
   reporting no esenciales); sin exporters OTLP configurados (ni env ni managed settings); config
   MCP generada exclusivamente por el Orquestador, apuntando solo al worker interno — nunca un
   servidor MCP externo que pudiera iniciar "URL elicitation" (abrir URL en navegador) o "MCP
   OAuth discovery" hacia un host de terceros; connectors de claude.ai deshabilitados
   explícitamente en la config del holder.
5. El canal holder↔worker no necesita rechazar por schema una tool `read(path)` genérica: si el
   worker la resuelve dentro de su propio namespace, una ruta que apunte al filesystem del holder
   simplemente no existe ahí. La propiedad garantizada es que ninguna ruta cruza hacia el
   filesystem del holder.
6. **El holder posee su caché de credenciales en un directorio/volumen propio con acceso de
   lectura y escritura directo — nunca un bind mount read-only sobre el que se espera escritura de
   refresh.** Refresh nativo/reactivo dentro del ciclo de invocación permitido y esperado; si ese
   refresh falla, la fase falla explícitamente. Esta regla resuelve de raíz la contradicción que
   encontró la evaluación del diseño descartado de FEATURE-016A.
7. Ante falla del holder o del canal, la invocación falla explícitamente (fail-closed), evaluado
   por separado para cada componente (holder caído, worker caído, canal caído).
8. El sistema rechaza iniciar una nueva invocación con `cli_session` si ya existe un holder activo
   para la misma identidad OAuth.
9. Para Codex: **artefacto único autoritativo**, no solo "fijar una versión". El Dockerfile debe
   instalar una versión exacta y verificable (ej. `npm install -g @openai/codex@0.144.6`, nunca
   sin versión), y la imagen final se referencia por **digest** (`sha256:...`), no por tag mutable.
   El build/CI corre un check que ejecuta `codex-cli --version` (o equivalente) dentro de la
   imagen construida y **falla el build** si el valor reportado no coincide exactamente con el
   valor esperado — el desfase real encontrado en la evaluación anterior (paquete `0.144.5`
   declarado vs binario efectivo `0.144.6`) es precisamente el caso que este check debe capturar
   antes de que llegue a producción. Los contract tests contra el schema de `dynamicTools` se
   generan dentro de esa misma imagen fijada por digest, nunca contra una instalación distinta.
10. Fronteras obligatorias: el holder no monta el Docker socket; el worker no abre sesión
   administrativa contra `app-server`; el holder no escucha puertos accesibles desde el worker
   salvo autenticación y necesidad explícita; configuración, logs, errores y system prompt del
   holder nunca incluyen contenido del caché de credenciales.
11. Esta Feature protege específicamente la credencial OAuth — no todos los secretos posibles del
    worktree. El worker conserva la capacidad de exfiltrar otros datos si el modelo así lo decide;
    eso queda fuera de esta garantía.
12. El mecanismo debe ser neutral respecto a la política de red del worker (amplia o mínima) — esa
    decisión se configura por rol en FEATURE-015B, sin requerir cambios al protocolo de esta
    Feature.

---

# 6. Estrategia Algorítmica (Opcional)

No aplica. Esta Feature no introduce lógica de decisión/optimización — es arquitectura de
aislamiento y confinamiento de ejecución.

---

# 7. Technical Considerations

## Topología (tres zonas)

```
Orquestador confiable
├── holder OAuth
│   ├── credencial y refresh (caché propio, lectura/escritura directa)
│   └── inferencia, sin worktree ni tools locales
└── worker no confiable
    ├── worktree y Bash (si el rol lo requiere — decisión de 015B)
    └── política de red (amplia o mínima — decisión de 015B), sin credencial
```

- **Claude Code**: el holder actúa directamente como cliente del servidor MCP remoto expuesto por
  el worker.
- **Codex**: `app-server` habla con un cliente/controlador confiable (parte del Orquestador), que
  delega el `item/tool/call` al worker — no es el holder mismo quien se comunica directamente con
  el worker.

## Topología de red (completa, por invocación)

| Segmento | Diseño |
|---|---|
| Red holder↔worker | Docker `--internal` exclusiva, creada y destruida por invocación |
| Egress del holder | Sin restricción de allowlist — no es parte de la garantía central de esta Feature (ver nota abajo y Future ideas) |
| Egress del worker | Según política que defina FEATURE-015B por rol — 015A solo deja el mecanismo neutral a esa decisión |
| Worker → control plane del holder | Sin ruta — el worker no alcanza la interfaz de administración de `app-server` ni ningún puerto de control del holder |
| Otros contenedores de la VPS (otra invocación u otro tenant) | Sin ruta hacia la red interna de esa invocación, al ser exclusiva y `--internal` |

**Nota — por qué el egress del holder no es un requisito de esta Feature**: la garantía central de
esta arquitectura es que el worker nunca tiene el secreto — eso ya cierra tanto el canal de
respuesta como el canal de red, sin importar qué tools o qué acceso a internet tenga el worker. La
premisa correcta para el holder **no** es "el holder solo contacta al proveedor" (falso para los
binarios stock — Claude Code documenta conexiones a telemetría, error reporting, updater,
changelog y connectors MCP; Codex tiene exporters OTLP configurables) — la premisa correcta,
confirmada tras un análisis crítico dedicado de Codex, es: **ninguna superficie controlable por el
modelo dentro del holder puede seleccionar un destino de red arbitrario ni acceder al secreto**.
Esa propiedad se sostiene por la combinación de controles ya cerrados en Functional Rules,
no por un allowlist de red: entorno del holder por allowlist explícita, ausencia de
`managed-settings.json`/plugins, telemetría/updater/connectors/MCP externo desactivados
explícitamente (Regla 4), y el proxy bidireccional de Codex que rechaza cualquier mensaje no
esperado en cualquier dirección (Regla 2). Un allowlist de egress agregaría valor solo contra un
escenario distinto y de menor prioridad — un ataque de supply chain al binario oficial mismo, o un
bug del CLI que filtrara datos por telemetría — categoría de riesgo ajena al modelo de amenaza
principal de esta Feature (modelo/prompt injection activamente evasivo). Por eso se retira del
Approval Gate como requisito bloqueante y se anota en Future ideas como defensa en profundidad de
baja prioridad, no eliminada por descarte sino por análisis explícito y documentado.

## Otros puntos técnicos

- **Dependencia de infraestructura conocida**: FEATURE-008 documentó que `unshare -n` falla por
  falta de privilegio de red del kernel en esta VPS. La separación holder/worker se resuelve con
  contenedores Docker distintos administrados por el daemon rootful, no con namespaces sin
  privilegios dentro de un único contenedor.
- **Estabilidad de `dynamicTools` (Codex)**: interfaz marcada `experimentalApi: true` por OpenAI —
  mitigado con version pin + contract tests, no eliminado como riesgo.
- Reutiliza el precedente de confinamiento ya validado en este repo para QA
  (`features.shell_tool=false`), aunque esta Feature va más allá al separar también las tools
  presentadas al modelo del holder de los métodos JSON-RPC del controlador.
- El diseño de los schemas de tools del worker es el control de seguridad central de esta
  Feature — un dynamic tool o MCP demasiado expresivo (ej. "ejecutar comando arbitrario") en el
  holder reintroduciría el secreto indirectamente.

---

# 8. Validation Criteria

| Escenario | Input | Expected Output |
|---|---|---|
| Worker intenta leer el secreto | Comando de lectura sobre la ruta del caché OAuth, ejecutado en el proceso worker | El archivo no existe en el filesystem del worker; falla con "no existe", nunca con datos reales |
| Prompt injection pide leer el secreto vía tool genérica | Instrucción maliciosa dirigida a pedir lectura de una ruta que apunta al caché del holder, usando una tool `read(path)` del worker | La ruta se resuelve dentro del namespace del worker y no existe ahí; ninguna ruta cruza al filesystem del holder |
| Refresh sobre caché propio del holder (no RO) | Token con expiración forzada durante una invocación de prueba | El holder escribe el token renovado en su propio caché sin error de filesystem read-only; la fase continúa |
| Holder caído (fail-closed) | Invocación de prueba con el holder no disponible | La invocación falla explícitamente; el worker no recibe fallback con acceso directo a credenciales |
| Worker caído (fail-closed) | Invocación de prueba con el worker no disponible | La invocación falla explícitamente, sin degradar el aislamiento |
| Canal holder↔worker caído (fail-closed) | Transporte interrumpido a mitad de una tool call de prueba | La invocación falla explícitamente |
| Segunda invocación, misma identidad OAuth | Un holder ya activo para esa identidad, se intenta iniciar otro | Rechazado explícitamente (Regla 8) |
| Upgrade de `codex app-server` rompe `dynamicTools` | Contract tests corridos contra la nueva versión antes de actualizar en producción | El contract test detecta la ruptura antes del despliegue |
| HOME del holder sin customizaciones (Claude Code) | Arrancar el holder con `HOME` limpio desde cero, en presencia de un `settings.json`/hook de prueba colocado deliberadamente fuera de ese `HOME` | El holder no carga ningún hook/plugin/skill — se verifica en runtime, no se asume por configuración |
| Controlador Codex intenta un método no permitido | Simular (en el proxy) un intento de invocar `command/exec` desde el controlador | El proxy rechaza el método antes de que llegue a `app-server`, incluso simulando un bug del cliente |
| Copia de credencial tras logout (Etapa 2, con cuenta desechable) | Copia de prueba del token, luego `claude auth logout`, luego intento de reuso de la copia | Documentar si la copia sigue funcionando o no — no asumir que el logout la invalida (ver Risks) |

### Validation Evidence

- `docker inspect` real de mounts, variables de entorno, redes y capabilities del contenedor
  worker, confirmando ausencia del caché OAuth.
- Inspección adversarial ejecutada desde dentro del worker: filesystem, `/proc/*/environ`, mounts
  activos y rutas conocidas del caché.
- Búsqueda de un canary sintético (nunca el token real) para verificar que ninguna ruta de
  exfiltración lo hace llegar al worker.
- Verificación de que el holder no tiene worktree montado ni tools locales de lectura/ejecución.
- Inventario efectivo de tools presentado al modelo en runtime — distinto del schema declarado
  (los contract tests de Codex validan el schema, no qué tools recibió el modelo realmente).
- Al menos un ciclo de refresh real (con el holder escribiendo en su propio caché, no un mount RO)
  documentado con evidencia.
- Prueba de fail-closed para holder, worker y canal caídos por separado.

Esta evidencia sigue el mismo patrón de validación real documentada usado en
`FEATURE-012-implementation-results.md` y `FEATURE-014-implementation-results.md`.

---

# 9. Risks

- **Fragilidad de `dynamicTools` (Codex)**: interfaz marcada experimental por OpenAI; mitigado
  pero no eliminado por version pin + contract tests.
- **Paridad funcional diferida a 015B**: esta Feature solo prueba una tool genérica de punta a
  punta, no las tools reales de cada rol — el riesgo de que la paridad completa resulte más
  costosa de lo esperado se hereda a 015B, no se resuelve acá.
- **Costo arquitectónico real**: introduce un proceso/contenedor adicional (holder) por invocación
  con `cli_session`, para cualquier rol que lo use — impacto en performance/latencia no
  cuantificado todavía.
- **Diseño de schemas como punto crítico de seguridad**: un MCP/dynamicTool mal diseñado
  reintroduciría el secreto indirectamente — no es un detalle de implementación menor.
- **Dependencia de decisión futura sobre Codex**: si OpenAI retira o cambia radicalmente
  `dynamicTools`, podría requerir migrar a integración directa con Responses API — cambiando el
  modelo de autenticación/facturación de ese proveedor (fallback, no plan por defecto).
- **Multi-tenant futuro, ya contemplado en el diseño**: el owner confirmó que hoy el uso es
  interno (él/su equipo), pero a futuro habrá clientes externos sin confianza mutua entre sí (tipo
  SaaS). El aislamiento de red por invocación (exclusiva, `--internal`) y el lock de concurrencia
  por `credential_slot_id` (Regla 8) ya son neutrales a esto — no requieren rediseño cuando
  aparezca el primer cliente externo. Riesgo residual a vigilar: si en el futuro se comparte
  infraestructura entre tenants de forma más agresiva (ej. mismo host físico sin aislamiento
  adicional), revisar si el aislamiento a nivel de red Docker sigue siendo suficiente o si hace
  falta una capa más (namespaces de kernel, VMs separadas) — no es necesario resolverlo ahora.
- **Revocación de sesión OAuth no es una garantía absoluta**: verificado contra el código
  distribuido de Claude Code 2.1.212, `claude auth logout` intenta revocar el `refreshToken`
  server-side (`POST .../revoke`) pero es best-effort con timeout de 5s — si falla, solo limpia
  localmente sin avisar. El `accessToken` ya emitido no tiene revocación inmediata documentada.
  Esto no afecta el diseño de esta Feature en sí (el mecanismo holder/worker no depende de poder
  revocar sesiones), pero sí condiciona cómo se ejecuta la Etapa de validación con credenciales
  reales del Approval Gate (ver abajo) — no asumir que un logout post-prueba neutraliza cualquier
  copia que pudiera haberse generado por un defecto de implementación.

---

# 10. Approval Gate

Implementación prohibida hasta aprobación explícita del owner. El gate se divide en tres etapas
secuenciales — resuelve la circularidad que encontró la evaluación anterior (exigir evidencia con
credenciales reales en el mismo gate que las prohíbe).

## Etapa 1 — Gate de diseño (sin credenciales reales)

1. ☐ Contrato wire completo del protocolo holder↔worker: schemas exactos de request/response/
   error/cancelación, formato y manejo del token de canal (32 bytes `randomBytes`, base64url,
   comparación `timingSafeEqual`, nunca logueado completo), límites concretos (10MB payload, 120s
   timeout por tool call configurable, 500 tool calls por invocación), semántica de
   `protocolVersion` (v1: coincidencia exacta, rechazo si no coincide), y protección contra replay
   (registro en memoria de `callId` vistos durante la invocación, rechazo de duplicados).
2. ☐ Spike Claude Code, dividido en lo verificable sin login: (a) test unitario que confirma el
   comando construido (`--tools ""`, `--mcp-config`, `--strict-mcp-config`,
   `--no-session-persistence`, `CLAUDE_CONFIG_DIR` fijado al directorio controlado); (b)
   inspección de la imagen del holder confirmando ausencia de `managed-settings.json`, directorios
   de plugins y cualquier `CLAUDE.md`; (c) instrumentación del arranque (pre-auth) confirmando que
   no se tocan rutas fuera de `CLAUDE_CONFIG_DIR` antes del fallo esperado por `Not logged in`. El
   handshake MCP completo y la tool call de punta a punta quedan en Etapa 2 (no son alcanzables
   sin login).
3. ☐ Spike Codex: proxy bidireccional delante de `app-server` con las dos allowlists direccionales
   (cliente→servidor: `initialize`/`initialized`/`thread/start`/`turn/start`/respuestas
   correlacionadas a `item/tool/call`; servidor→cliente: solo lo esperado, terminación del proceso
   ante cualquier otro tipo), validación de params sensibles de `thread/start`/`turn/start` contra
   schema fijo (`cwd`, `sandbox`, `tools`/`dynamicTools`), y correlación de ids pendientes en
   ambas direcciones — validado sin credenciales reales.
4. ☐ Verificación en runtime de fuentes de configuración de Claude Code cerradas:
   `CLAUDE_CONFIG_DIR` fijado explícitamente, entorno del holder construido por allowlist (sin
   variables de plugin cache/seed), ausencia verificada de `managed-settings.json` en la imagen, y
   chequeo de `claude /status` (o equivalente) al arrancar el holder — fail-closed si reporta
   cualquier fuente administrada o setting inesperado. **Incluye además** (Regla 4 de Functional
   Rules): `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` seteado, sin exporters OTLP configurados,
   config MCP apuntando exclusivamente al worker interno (sin servidor MCP externo que pueda
   iniciar "URL elicitation" u "OAuth discovery"), y connectors de claude.ai deshabilitados
   explícitamente — verificado en la imagen/config, no asumido.
5. ☐ Topología Docker (contenedores separados, daemon rootful, red `--internal` exclusiva por
   invocación, aislamiento entre invocaciones/tenants) validada en la VPS. El egress del holder no
   requiere allowlist como parte de este gate (ver Technical Considerations, nota de alcance —
   retirado como Future idea de baja prioridad).
6. ☐ Refresh validado con el holder escribiendo en su propio caché (no mount RO) mediante canary
   de mutabilidad y aislamiento — no un refresh OAuth nativo real, que requiere credenciales y
   queda en Etapa 2.
7. ☐ Fronteras obligatorias (Docker socket, sesión administrativa, puertos, redacción de logs)
   implementadas y verificadas en los spikes, como checks binarios concretos.
8. ☐ Política de concurrencia: algoritmo de lock corregido (upsert atómico condicionado por
   `lease_expires_at <= now()`, fencing token, heartbeat con abort si se pierde el lease,
   protección contra reactivación de holder zombie) validado con tests de concurrencia Postgres y
   reloj controlado — sin necesidad de credenciales.
9. ☐ Pin de `codex app-server` corregido: artefacto único autoritativo (versión exacta de
   paquete, digest de imagen, versión reportada por el binario), build/CI que falla ante
   discrepancia, schemas/contract tests generados dentro de esa misma imagen.

## Etapa 2 — Validación con credenciales reales

Requiere una **cuenta Pro personal desechable, pagada específicamente para esta prueba** — nunca
la cuenta organizacional real de la VPS (`asdrubal.perez@santexgroup.com`, org Santex), decisión
explícita del owner tras evaluar el riesgo de usar una cuenta de terceros para esto. Confirmado
que Claude Code requiere plan Pro/Max — una cuenta free no permite el login.

1. ☐ Login real (`claude auth login`) con la cuenta Pro desechable, en un entorno de prueba
   aislado — nunca en la sesión activa de la VPS.
2. ☐ Handshake MCP completo de Claude Code (imposible de validar en Etapa 1 sin login) + tool
   call de punta a punta contra el worker genérico de prueba. Inventario efectivo de tools con un
   turn autenticado real, confirmando que el holder no expone ninguna tool de lectura/ejecución
   local en ninguno de los dos adaptadores.
3. ☐ Al menos un ciclo de refresh real documentado.
4. ☐ Verificación específica, no asumida: uso del access token copiado (si se genera alguna copia
   de prueba controlada), renovación mediante el refresh token copiado, comportamiento después de
   `claude auth logout`, y comportamiento después de revocar desde
   `Settings → Claude Code` en claude.ai — no asumir que el logout por sí solo neutraliza una
   copia (ver Risks).
5. ☐ Al finalizar la prueba, revocar la sesión de la cuenta desechable por las dos vías (logout +
   revocación desde Settings → Claude Code) y documentar el resultado de cada una.

## Etapa 3 — Aceptación de implementación

1. ☐ Pruebas automatizadas (contract tests de Codex, tests unitarios de la rama condicional en los
   Executors) pasando.
2. ☐ Evidencia real documentada siguiendo el patrón de
   `FEATURE-012-implementation-results.md`/`FEATURE-014-implementation-results.md`.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.