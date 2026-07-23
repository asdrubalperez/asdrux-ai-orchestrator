# Evaluación técnica — FEATURE-015A Arquitectura holder/worker genérica

Fecha: 2026-07-22
Documento evaluado:
`docs/features/FEATURE-015-egress-aislamiento-oauth-parte-015a-arquitectura-holder-worker.md`
Resultado: **no aprobable todavía — Approval Gate pendiente**

## Resumen

La separación holder/worker es una dirección técnicamente viable y la Regla 5 corrige la
contradicción de filesystem encontrada en el diseño descartado de FEATURE-016A. Un canary en la
VPS confirmó que el holder puede escribir en un caché propio RW mientras el worker no recibe
ningún mount del caché.

Sin embargo, el documento todavía no define una frontera ejecutable completa. El protocolo se
describe solo como “nombre de tool + argumentos + resultado”; no se especifican autenticación,
correlación, límites, cancelación, idempotencia ni política de errores. Tampoco se demostró el
inventario efectivo de tools presentado al modelo, que es la propiedad de seguridad principal.

## Resultado por punto solicitado

### 1. Regla 5 — caché RW propio del holder

**Resultado: fundamentada, con validación parcial positiva.**

Spike con canary, sin credenciales:

- holder: bind mount `/oauth:rw`;
- escritura simulada `OLD_TOKEN` → `NEW_TOKEN`: exitosa;
- worker: sin mounts, `/oauth/session.canary` ausente;
- ambos contenedores: `--cap-drop ALL`, `no-new-privileges`;
- Docker socket ausente en ambos;
- red Docker separada con `Internal=true`.

Esto resuelve el error `Read-only file system`. No valida todavía refresh nativo del CLI ni
demuestra que ningún log o error incluya material sensible.

### 2. Spike Claude Code

**Resultado: incompleto; bloquea el Approval Gate.**

La imagen contiene Claude Code `2.1.212` y acepta `--tools ""`, `--mcp-config` y
`--strict-mcp-config`. Se levantó un worker HTTP MCP mínimo en un contenedor separado y un holder
sin credenciales. Claude abortó con `Not logged in` antes de inicializar el servidor MCP; el
worker no recibió requests.

Una tool call punta a punta y el inventario runtime necesitan una invocación autenticada. No puede
cumplirse esa evidencia bajo la prohibición de usar credenciales reales de esta sesión. Debe
programarse una validación credential-bearing posterior, controlada y autorizada.

Además, al no poder usarse `--bare` con OAuth, `--tools ""` no basta para afirmar que el holder
carece de customizaciones locales. El diseño debe fijar explícitamente settings sources, hooks,
plugins, skills, descubrimiento de `CLAUDE.md`, cwd, persistencia de sesiones y contenido del home
mínimo.

### 3. Spike Codex app-server

**Resultado: viabilidad parcial confirmada; bloquea el inventario runtime.**

En la imagen se completaron, sin login:

1. `initialize` con `capabilities.experimentalApi=true`;
2. `initialized`;
3. `thread/start` con workspace vacío RO;
4. registro de una `dynamicTool` sintética `echo_probe`.

No se inició un turn porque eso requiere autenticación. Por tanto, no se confirmó que el modelo
reciba solo la dynamic tool ni que pueda invocarla punta a punta.

Se encontró además una inconsistencia de pinning:

- `npm ls` informa `@openai/codex@0.144.5`;
- el binario efectivo responde `codex-cli 0.144.6`.

Antes de considerar cumplida la Regla 8 debe definirse qué artefacto se fija y verificar que el
package declarado y el binario ejecutado coincidan.

### 4. Inventario efectivo de tools

**Resultado: no demostrado; bloqueante.**

Registrar una MCP tool o `dynamicTool` no demuestra exclusividad. Para Claude la autenticación
falló antes del handshake MCP; para Codex se registró la tool, pero no hubo turn autenticado.

En Codex, `experimentalApi` habilita también métodos administrativos potentes del app-server,
incluidos `command/exec`, `process/spawn` y operaciones `fs/*`. El diseño confía en que el
controlador “nunca los invoque”, pero no define una allowlist estructural ni un cliente reducido
que haga imposible esa invocación.

Debe distinguirse con evidencia:

- tools visibles/invocables por el modelo;
- métodos aceptados por el cliente/controlador;
- filesystem y procesos disponibles al app-server;
- métodos que el worker puede alcanzar.

### 5. Topología Docker

**Resultado: viable con una omisión de diseño.**

La VPS usa Docker rootful `29.6.2`; dos contenedores separados pudieron ejecutarse en una red
`--internal`, sin Docker socket y con capabilities eliminadas. No se necesita `unshare -n`.

Pero una red solamente `--internal` impide que el holder alcance al proveedor de IA. La topología
real debe especificar redes separadas:

- canal privado holder↔worker;
- egress del holder exclusivamente al proveedor;
- egress del worker según política de 015B;
- ausencia de rutas desde el worker hacia cualquier control plane del holder.

No alcanza con indicar “socket Unix o red Docker `--internal`”.

### 6. Fronteras obligatorias

**Resultado: parcialmente demostradas; bloqueante.**

Confirmado en el spike:

- holder sin Docker socket;
- worker sin Docker socket;
- worker sin mount del caché;
- contenedores y namespaces separados.

No demostrado:

- autenticación del canal holder↔worker;
- imposibilidad estructural de que el worker alcance app-server;
- ausencia de puertos administrativos expuestos;
- redacción de logs, errores y system prompt;
- protección contra otro contenedor de la misma red invocando el MCP worker;
- cierre fail-closed ante caída a mitad de una tool call.

Para Codex se recomienda app-server por `stdio` entre Orquestador y holder, nunca un listener
compartido con el worker. El canal separado hacia el worker debe tener autenticación efímera por
invocación.

### 7. Política de concurrencia

**Resultado: concepto nuevo; requiere decisión del owner.**

El código actual no tiene una identidad OAuth canónica ni un registro de holders activos.
“Misma identidad OAuth” no es implementable sin definir:

- identificador estable y no secreto: cuenta, credential slot o cache id;
- alcance del lock: proceso, host o base de datos;
- adquisición atómica;
- lease/heartbeat y recuperación de locks huérfanos;
- comportamiento entre proveedores y cuentas distintas.

No debería derivarse la identidad leyendo o registrando access/refresh tokens. La opción mínima es
un `credentialSlotId` explícito administrado por el Orquestador y un lock con lease.

### 8. Otras inconsistencias

#### Protocolo insuficientemente definido

El “contrato estrecho” todavía no es un protocolo documentado. Faltan al menos:

- autenticación y autorización del canal;
- versionado y negociación de capacidades;
- request/call id y protección contra replay;
- límites de tamaño, tiempo y cantidad de resultados;
- cancelación;
- errores tipados;
- idempotencia/reintentos;
- encoding permitido;
- cierre del canal y limpieza ante crash.

Por ello el punto 1 del Approval Gate no está cumplido.

#### Circularidad/proceso de validación

El gate exige un refresh real y un inventario runtime antes de aprobar, mientras esta sesión
prohíbe credenciales reales. No es una contradicción técnica del mecanismo, pero sí un bloqueo de
proceso. Deben separarse:

1. aprobación del diseño y de los spikes sin secretos;
2. validación credential-bearing controlada;
3. aceptación de implementación.

#### Garantía sobre schemas sobredimensionada

El documento afirma que el schema de tools es el control central. El namespace separado es la
garantía primaria para que `read(path)` no alcance el caché; el schema limita capacidades del
worker, pero no reemplaza mounts, namespaces, red privada y control del canal.

## Bloqueantes para aprobación

1. Definir el protocolo holder↔worker completo y autenticado.
2. Demostrar inventario efectivo de tools en ambos proveedores con un turn autenticado
   controlado.
3. Especificar y probar una allowlist estructural del controlador Codex; “nunca invoca” no es una
   frontera.
4. Cerrar la superficie de customizaciones de Claude Code al no poder usar `--bare`.
5. Definir la topología de redes real, incluyendo egress del holder y aislamiento del control
   plane.
6. Resolver la identidad OAuth y el lock distribuido/de proceso de la Regla 7.
7. Corregir el pinning Codex para que package y binario efectivo coincidan.
8. Separar el Approval Gate de diseño de las pruebas que obligatoriamente requieren credenciales.

## Decisiones requeridas del owner

- Adoptar `credentialSlotId` explícito como identidad de concurrencia o definir otra identidad.
- Elegir alcance del lock y política de recuperación de holders huérfanos.
- Autorizar posteriormente una prueba con credencial dedicada/no productiva para inventario y
  refresh reales.
- Confirmar que app-server se limitará a `stdio` privado y que el worker nunca recibirá acceso a
  ese canal.

## Aspectos que pueden quedar

- Separación holder/worker como dirección arquitectónica.
- Caché RW exclusivo del holder; nunca montado en worker.
- Worker neutral respecto a política de red de 015B.
- Contenedores separados sobre Docker rootful.
- `dynamicTools` con version pin y contract tests, una vez corregido el pin efectivo.
- Fallo explícito y sin fallback directo a credenciales.
- Wiring de roles y paridad funcional completa diferidos a 015B.

## Dictamen

Mantener **Status: Draft — pendiente de Approval Gate**. La factibilidad base está parcialmente
confirmada, pero las propiedades de seguridad centrales todavía no están demostradas ni
especificadas con precisión suficiente para implementar.

## Re-evaluación — v1.1 (post-cierre de los 8 bloqueantes)

Fecha: 2026-07-23

### Resumen del dictamen actualizado

La v1.1 corrige la dirección de los ocho bloqueantes y convierte varias afirmaciones informales en
controles verificables. Sin embargo, **ninguno de los ocho puede considerarse completamente
cerrado para autorizar la Etapa 2**: en algunos casos falta precisión de contrato; en otros, el
texto propone un control viable pero todavía describe de forma incorrecta o incompleta su
mecánica; y dos requisitos de la Etapa 1 siguen dependiendo de credenciales reales.

Resultado actualizado: **mantener Status: Draft — no lista todavía para Etapa 2**.

No se repitieron los tres spikes anteriores. Sus conclusiones no cambiaron y esta re-evaluación no
usó credenciales OAuth. Los spikes adicionales necesarios se identifican explícitamente en cada
punto.

### 1. Protocolo holder↔worker

**Resultado: cierre parcial; continúa bloqueando la Etapa 1.**

La v1.1 enumera correctamente las dimensiones que antes faltaban: autenticación, versión,
correlación, límites, cancelación, errores, idempotencia, encoding y limpieza. Esto ya define la
intención arquitectónica, pero no constituye todavía un contrato wire implementable ni apto para
contract tests.

Falta concretar, como mínimo:

- schemas exactos de request, response, error y cancelación para cada transporte;
- ubicación y formato del token de canal, entropía mínima, TTL, comparación constante y
  tratamiento en logs;
- valores máximos efectivos de payload, timeout y cantidad de calls, no solo indicar que serán
  configurables;
- semántica de compatibilidad de `protocolVersion`;
- estados y carreras de cancelación frente a una respuesta tardía;
- política de rechazo de ids duplicados.

Un UUID correlaciona requests, pero **no protege por sí solo contra replay**. Para sostener esa
propiedad el worker debe recordar ids ya aceptados durante la vida de la invocación, rechazar
duplicados y acotar ese registro.

No hace falta un spike con credenciales para cerrar este punto. Hace falta un schema versionado y
tests de contrato sin secretos antes de marcar como cumplido el punto 1 de la Etapa 1.

### 2. Inventario efectivo de tools y separación Etapa 1/Etapa 2

**Resultado: cierre parcial; la separación conceptual es correcta, pero el gate sigue siendo
ambiguo.**

Es correcto reservar para la Etapa 2 el inventario observado durante un turn autenticado. La
Etapa 1 sí puede verificar estáticamente argumentos, configuración, schemas y aislamiento del
proceso, además de registrar hasta dónde llega cada CLI sin login.

Sin embargo:

- “lo que se pueda verificar sin login” no es un criterio binario de aprobación;
- el punto 2 de Etapa 1 exige un spike Claude Code con worker MCP/tool, aunque el spike anterior ya
  demostró que Claude aborta con `Not logged in` antes del handshake MCP;
- registrar una tool sin iniciar un turn no demuestra qué inventario recibió el modelo.

La Etapa 1 debe exigir evidencia determinista que no dependa de login: flags efectivos, MCP config
única, ausencia de tools integradas en la configuración, HOME/cwd/env controlados y el bloqueo
exacto previo al handshake. La exclusividad del inventario presentado al modelo debe quedar
solamente en Etapa 2.

No se requiere repetir ahora el spike sin login: ya produjo la evidencia relevante. Sí se requiere
el spike autenticado de Etapa 2 con una cuenta desechable.

### 3. Cliente mínimo y proxy allowlist de Codex app-server

**Resultado: técnicamente viable, pero cierre parcial por definición incorrecta/incompleta del
filtro.**

Existe un punto real de interposición: `app-server` usa JSONL bidireccional sobre `stdio`; el
Orquestador puede lanzar un proxy como proceso padre, conectar el stdin/stdout de `app-server` como
proceso hijo y validar cada frame antes de reenviarlo. Esto coincide con la interfaz pública de
[Codex app-server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) y con
el spike previo de la versión efectiva `0.144.6`.

La allowlist descrita en la v1.1 todavía mezcla direcciones y tipos JSON-RPC:

- `turn/start` es necesario para ejecutar un turn y no figura en la lista ilustrativa;
- `item/tool/call` es un request **server→client**;
- la contestación del cliente a `item/tool/call` es una response con `id` y `result`/`error`, no un
  método que pueda incluirse en una allowlist de métodos;
- una allowlist de nombres no basta: también debe validar params sensibles de `thread/start` y
  `turn/start` (`cwd`, sandbox, tools/dynamic tools y cualquier campo experimental);
- el proxy debe rechazar o terminar ante requests server→client inesperados, no solo filtrar el
  tráfico client→server.

Por tanto, el proxy es implementable, pero el contrato debe definir dos allowlists direccionales,
correlación de ids pendientes, schemas de params y comportamiento fail-closed. Se necesita el spike
sin credenciales ya pedido en Etapa 1 para comprobar el proxy contra el schema generado por el
binario fijado; no se necesita login para esa parte. El turn y la tool call punta a punta quedan en
Etapa 2.

### 4. Superficie de customización de Claude Code

**Resultado: cierre parcial; HOME limpio es necesario pero no suficiente.**

Un HOME y cwd nuevos por invocación eliminan settings, skills, plugins y `CLAUDE.md` de los scopes
user/project. No cubren todas las fuentes que Claude Code documenta:

- `CLAUDE_CONFIG_DIR` reemplaza el directorio `~/.claude`;
- variables como `CLAUDE_CODE_PLUGIN_CACHE_DIR` y `CLAUDE_CODE_PLUGIN_SEED_DIR` pueden introducir
  contenido desde otras rutas;
- settings administrados pueden venir de `/etc/claude-code/managed-settings.json` en Linux o del
  servidor y tienen precedencia sobre HOME y flags;
- otras variables heredadas pueden cambiar proveedor, hooks, certificados, MCP o comportamiento
  del CLI.

Fuentes: [Environment variables](https://code.claude.com/docs/en/env-vars),
[Settings precedence](https://code.claude.com/docs/en/configuration) y
[`.claude` directory](https://code.claude.com/docs/en/claude-directory).

El diseño debe fijar `CLAUDE_CONFIG_DIR` al directorio controlado, construir el env del holder desde
una allowlist, verificar que la imagen no contenga managed settings/plugins y definir una política
fail-closed si `/status` o evidencia equivalente reporta una fuente administrada inesperada. Para
una cuenta organizacional también debe contemplar settings server-managed; una cuenta Pro personal
desechable reduce ese riesgo en el spike, pero no corrige el diseño general.

Se necesita un nuevo spike sin credenciales con configuraciones canary fuera del HOME, overrides
de env y managed settings de prueba para demostrar qué fuentes quedan bloqueadas.

### 5. Topología de red

**Resultado: cierre parcial; los segmentos están identificados, pero el egress fino no tiene
mecanismo.**

Docker rootful permite crear una red `--internal` exclusiva por invocación y conectar el holder
además a otra red de salida. `stdio` evita exponer el control plane de `app-server` como puerto, y
un worker que sea el único peer de su red no puede alcanzar otros holders/workers por routing
Docker normal.

La tabla, sin embargo, afirma “solo hacia el proveedor” sin definir cómo se impone. Conectar el
holder a un bridge Docker con salida le concede internet general; Docker no ofrece por sí solo una
allowlist por dominio. Deben definirse y probarse:

- gateway/proxy de egress o reglas nftables/iptables equivalentes;
- resolución DNS y los hosts reales requeridos para login, inferencia y refresh;
- política ante IPs/CDNs cambiantes y redirects;
- membresía exclusiva de la red y limpieza tras crash;
- ausencia de listeners del holder, además de la ausencia de ruta declarada.

El daemon rootful y el host siguen siendo parte confiable del TCB: un actor con acceso al daemon
puede conectar otro contenedor a la red. Esa limitación debe declararse, aunque no invalida la
topología para el modelo de amenaza actual.

Hace falta un spike nuevo sin credenciales que demuestre conexión holder↔worker, denegación hacia
un destino canary no permitido y acceso únicamente a destinos de prueba allowlisted. La conectividad
real con Anthropic/OpenAI puede confirmarse posteriormente en Etapa 2.

### 6. Identidad y lock de concurrencia

**Resultado: implementable con una migración acotada, pero el algoritmo propuesto no recupera
leases vencidos y carece de fencing.**

El schema actual ya tiene `users.id` UUID y `runs.id` UUID. Una tabla con `user_id`, `provider`,
`run_id`, timestamps y `UNIQUE (user_id, provider)` encaja sin una migración mayor. `sessions` no
es un registro de credenciales OAuth — representa sesiones web — pero demuestra el patrón básico
de tablas relacionadas con `users`.

`INSERT ... ON CONFLICT DO NOTHING` no permite que un nuevo run tome un lock cuya fila sigue
existiendo aunque `lease_expires_at` haya vencido. Para cumplir “vence solo, sin cleanup” la
adquisición debe ser un upsert atómico condicionado por `lease_expires_at <= now()` usando tiempo
de Postgres.

Además hacen falta:

- heartbeat y release condicionados por `credential_slot_id`, `run_id` y generación/fencing token;
- abortar y terminar el holder si pierde el lease o no puede renovarlo antes del vencimiento;
- impedir que un holder pausado recupere actividad después de que otro run haya adquirido el slot;
- FK de `run_id`, índices y política de borrado;
- declarar que `(user_id, provider)` admite una sola cuenta por proveedor; si se permiten varias,
  debe existir un credential-slot persistente independiente.

No hace falta un spike con credenciales. El algoritmo corregido puede validarse con tests de
concurrencia Postgres y reloj controlado durante Etapa 1.

### 7. Pinning del binario Codex

**Resultado: la regla correcta está escrita, pero el bloqueo operativo continúa abierto.**

Verificar el binario efectivo, generar schemas desde ese mismo ejecutable y correr contract tests
contra esos schemas previene repetir el desfase conceptual. No obstante, el Dockerfile actual
todavía ejecuta `npm install -g @openai/codex` sin versión, por lo que cada build puede resolver un
artefacto distinto.

Debe definirse un único artefacto autoritativo: versión exacta del paquete, digest de imagen y
versión reportada por el ejecutable. El build/CI debe fallar si el ejecutable no coincide con el
valor esperado, y los schemas/contract tests deben generarse dentro de esa misma imagen. Si el
paquete publicado y el binario embebido reportan versiones distintas, no debe asumirse que la
igualdad textual es alcanzable: hay que fijar ambos valores observados y tratar al binario/schema
efectivo como contrato.

No hace falta repetir el spike anterior. Sí hace falta corregir el pin y ejecutar el check de build
antes de marcar el punto 9 de Etapa 1.

### 8. Approval Gate en tres etapas

**Resultado: cierre parcial; la estructura resuelve la circularidad general, pero Etapa 1 todavía
contiene dos dependencias credential-bearing.**

Separar diseño, validación con credenciales y aceptación de implementación es la estructura
correcta. La Etapa 2 ya identifica adecuadamente la cuenta Pro desechable y prohíbe usar la sesión
real de la VPS.

Persisten dos requisitos mal ubicados:

1. el spike Claude de Etapa 1 no puede demostrar una tool MCP punta a punta porque el CLI aborta
   antes del handshake sin login;
2. el “refresh validado” de Etapa 1 solo puede comprobar escritura RW con un canary. Un refresh
   OAuth nativo requiere una credencial y pertenece a Etapa 2.

Etapa 1 debe pedir “canary de mutabilidad y aislamiento del caché” y reservar “refresh nativo” para
Etapa 2. También debe convertir los puntos vagos en checks binarios, especialmente inventario sin
login y fronteras “implementadas en los spikes”.

### Bloqueantes vigentes antes de Etapa 2

1. Publicar el schema wire completo del protocolo, incluidos token de canal, límites y replay.
2. Corregir el gate sin credenciales: no exigir handshake/tool call Claude ni refresh OAuth real.
3. Definir el proxy Codex por dirección, tipo de mensaje, ids y schemas de params; validar
   fail-closed en un spike.
4. Cerrar env, `CLAUDE_CONFIG_DIR` y settings administrados de Claude Code.
5. Elegir e implementar en spike el mecanismo real de egress allowlisted y DNS.
6. Corregir takeover de lease, heartbeat condicional y fencing.
7. Fijar el artefacto Codex efectivo y hacer fallar build/CI ante drift.

### Dictamen

La v1.1 **no está todavía lista para Etapa 2**. Mantener **Status: Draft — pendiente de completar
Etapa 1**.

No se encontraron razones para descartar la arquitectura holder/worker: el proxy `stdio`, los
contenedores separados y la tabla de locks son implementables. Los bloqueantes restantes son
concretos y resolubles sin credenciales reales, salvo el inventario runtime, el refresh nativo y la
conectividad real con proveedores, que deben permanecer explícitamente en Etapa 2.

## Confirmación v1.3 — auditoría de consistencia

Fecha: 2026-07-23

### Alcance de la auditoría

Se releyó la v1.3 completa, se cruzaron referencias a reglas e ítems, se verificó la existencia de
los archivos citados y se compararon las descripciones repetidas de protocolo, proxy Codex,
superficies auxiliares, lock, pinning y egress entre Scope, Functional Rules, Technical
Considerations, Validation y Approval Gate.

No se implementó código, no se ejecutaron spikes y no se usaron credenciales OAuth.

### Confirmación de las cinco correcciones declaradas

1. **Header/versionado: aplicado, con una inconsistencia residual en el historial.**
   El header ahora dice v1.3 y enumera v1.0/v1.1/v1.2/v1.3. Sin embargo, describe v1.3 como
   “4 contradicciones internas + 4 referencias cruzadas”, mientras el handoff de esta ronda
   identifica cinco problemas adicionales: dos inconsistencias documentales y tres referencias
   numéricas. El conteo/historial no permite reconstruir inequívocamente qué ocho correcciones
   pretende resumir.
2. **Pinning en Scope: aplicado correctamente.** Scope punto 8, Functional Rule 9 y Approval Gate
   punto 9 coinciden en versión exacta del paquete, imagen por digest, versión efectiva verificada
   dentro de la imagen y schemas/contract tests generados allí.
3. **Referencia desde Scope al `read(path)`: corregida.** Scope punto 1 referencia Regla 5, que es
   efectivamente la regla sobre resolución de paths dentro del namespace del worker.
4. **Referencia de concurrencia en Validation Criteria: corregida.** La segunda invocación para la
   misma identidad referencia Regla 8, que define el rechazo por holder activo.
5. **Referencia de concurrencia en Risks: corregida.** El riesgo multi-tenant referencia Regla 8,
   no la Regla 6 del caché RW.

Las cuatro últimas correcciones están aplicadas de forma consistente. La primera necesita ajustar
el resumen histórico, aunque el número de versión actual sí es correcto.

### Inconsistencias adicionales encontradas

#### 1. El “schema wire concreto” sigue siendo un ejemplo, no un schema verificable

El bloque está etiquetado como `json`, pero contiene comentarios `//`, cuatro documentos
consecutivos y placeholders como `"uuid-v4"` y `{ "...": "..." }`; no es JSON válido ni JSON
Schema. No define `required`, tipos cerrados, `additionalProperties`, longitudes, pattern de
base64url/UUID, exclusión mutua `result`/`error` ni límites por campo. Por tanto no permite generar
contract tests sin reinterpretar la prosa.

Además:

- se afirma que cada request incluye `protocolVersion` y `channelToken`, pero la cancelación solo
  contiene `callId` y `type`;
- la cancelación reutiliza el `callId` ya visto, mientras replay dice que todo duplicado se rechaza;
- no existe response/ack de cancelación ni error tipado `CANCELLED`;
- `protocolVersion` se llama “semver” pero usa `"1.0"` — SemVer requiere tres componentes — y el
  Gate alterna las expresiones “v1” y coincidencia exacta;
- faltan errores normativos para token inválido, versión no soportada, JSON malformado y límite de
  500 calls;
- “payload máximo 10MB” no aclara si aplica a request, response, frame o cada uno, ni si MB es
  decimal o MiB.

También hay una contradicción de actores: el bloque dice que el mismo shape es
`holder → worker` para ambos adaptadores, mientras Technical Considerations establece que en Codex
es el controlador confiable del Orquestador — no el holder — quien delega `item/tool/call` al
worker.

#### 2. Scope conserva la definición vieja y unidireccional del proxy Codex

Scope punto 3 todavía:

- habla de validar “cada método JSON-RPC saliente”;
- omite `turn/start`;
- trata la response a `item/tool/call` como si fuera un método;
- termina con “y poco más”.

Approval Gate punto 3 sí define dos direcciones, responses correlacionadas, params sensibles y
terminación ante mensajes inesperados. Son dos contratos distintos del mismo proxy.

La nota de egress agrava el cruce: atribuye a la Regla 2 un “proxy bidireccional que rechaza
cualquier mensaje no esperado en cualquier dirección”, pero la Regla 2 solo menciona métodos no
autorizados y no define direcciones, responses ni notifications.

#### 3. La justificación de egress no es uniforme

Technical Considerations usa la premisa correcta: ninguna superficie controlable por el modelo
puede elegir un destino arbitrario y acceder al secreto. Future ideas, en cambio, vuelve a describir
el allowlist como defensa únicamente ante supply-chain. La nota técnica reconoce también bugs del
CLI y telemetría; ambas secciones no expresan el mismo alcance residual.

Functional Rule 4 tampoco sostiene por sí sola todo lo que la nota le atribuye:

- enumera controles mayormente de Claude Code, no las superficies equivalentes de Codex
  (apps/connectors, MCP adicionales, web/browser/realtime, analytics/OTLP y overrides de base URL);
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` se presenta como si desactivara por sí solo
  telemetry, updater y error reporting; la documentación oficial expone controles específicos
  adicionales como `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING` y
  `ENABLE_CLAUDEAI_MCP_SERVERS=false`;
- prohibir un MCP externo no impide que el worker interno emita elicitation, OAuth discovery u
  otro mensaje server→client inesperado. Ese rechazo debe estar en el contrato del cliente/proxy,
  no inferirse de la URL configurada.

#### 4. El lock mejoró, pero fencing/release aún admiten implementaciones incompatibles

El acquire condicionado y los tiempos 30s/90s están documentados. Persisten ambigüedades:

- `fencing_token` puede ser “autoincremental o secuencia”, dos diseños con semántica distinta;
- no se define el valor inicial en INSERT;
- heartbeat y release no tienen predicado normativo por
  `(credential_slot_id, run_id, fencing_token)`;
- “se libera explícitamente” no aclara si se borra la fila o se vence el lease. Si se borra y el
  token vuelve a empezar, se pierde la monotonía necesaria para fencing;
- no se define qué componente rechaza los efectos de un holder zombie usando el fencing token;
- no se fija conducta fail-closed durante una caída de Postgres antes del vencimiento.

Scope, Gate y Risks ya apuntan al mismo mecanismo general, pero todavía no a un algoritmo único.

#### 5. El pinning es consistente entre secciones, pero no completamente reproducible

Las tres secciones ya coinciden. Aun así, el mecanismo usa valores ilustrativos:

- `@openai/codex@0.144.6` aparece como ejemplo, no como versión aprobada;
- no se fija el string esperado del binario;
- no se fija digest de imagen ni digest de imagen base;
- no se define un manifest/archivo autoritativo del que CI lea los valores;
- no se registra hash de los schemas generados.

Además, el desfase observado paquete `0.144.5` / binario `0.144.6` demuestra que “coincidir” no debe
significar necesariamente igualdad entre ambos strings. CI debe comparar cada valor con la tupla
aprobada, no comparar package version contra binary version.

#### 6. Una referencia de archivo está rota

El header cita:

`docs/research/investigacion-egress-proteccion-exfiltracion.md`

Ese archivo no existe en el árbol actual. `docs/research/` solo contiene
`H14-command-confinement.md` e `investigacion-auth-cuenta-personal-executors.md`. Los demás archivos
citados y comprobados sí existen:

- `docs/playbook/07-FEATURE-TEMPLATE.md` y su versión v2.1;
- `docs/ROADMAP.md`;
- `docs/features/FEATURE-012-implementation-results.md`;
- `docs/features/FEATURE-014-implementation-results.md`.

Debe agregarse el insumo faltante o corregirse la referencia a su ubicación real.

#### 7. El Approval Gate aún no está satisfecho

Los nueve ítems de Etapa 1 permanecen sin marcar y esta ronda no ejecutó sus spikes/tests. Aunque
se corrigieran todas las inconsistencias documentales, “documento consistente, listo para
continuar con Etapa 1” no equivale a “Etapa 1 aprobada”. La aprobación requiere ejecutar y
conservar la evidencia que el propio Gate exige.

### Referencias cruzadas verificadas sin error

- Scope punto 2 → Regla 6: caché RW del holder.
- Scope punto 1 → Regla 5: resolución de `read(path)` en el namespace worker.
- Scope Excluido punto 6 → Scope Incluido punto 6: concurrencia por identidad.
- Validation Criteria → Regla 8: segunda invocación.
- Risks → Regla 8: lock por `credential_slot_id`.
- Approval Gate punto 4 → Regla 4: superficies auxiliares.
- Dependencias 015A → 015B → FEATURE-016: coinciden con `docs/ROADMAP.md`.
- Template v2.1 y documentos de evidencia FEATURE-012/014: nombres y paths válidos.

### Dictamen

**v1.3 tiene inconsistencias adicionales, listadas arriba. No está todavía en condiciones de ser
declarada consistente ni de comenzar la ejecución formal de Etapa 1 sobre un contrato congelado.**

Las cinco correcciones de esta ronda mejoran el documento y cuatro están plenamente aplicadas; la
auditoría independiente encontró contradicciones restantes en protocolo, proxy, egress,
fencing/pinning y una referencia de archivo rota. Debe publicarse una siguiente revisión
documental que unifique esas definiciones antes de ejecutar los spikes de Etapa 1.

## Confirmación v1.4 — corrección técnica y auditoría cruzada final

Fecha: 2026-07-23

### Alcance

Codex reescribió la definición técnica de los seis bloqueantes de v1.3 y luego auditó la v1.4
completa contra el documento, el schema separado, los paths del repo y las fuentes oficiales de
configuración de Claude Code y Codex.

No se implementó código de producción, no se ejecutaron los spikes del Approval Gate y no se
usaron credenciales OAuth. “Lista para iniciar Etapa 1” significa que el contrato de diseño ya es
consistente para construir los spikes; no significa que Etapa 1 esté aprobada.

### Resolución de los seis bloqueantes

1. **Schema wire real: resuelto.**
   Se agregó
   `docs/features/schemas/FEATURE-015A-holder-worker-protocol.schema.json`, Draft 2020-12,
   parseable y con cinco envelopes cerrados y mutuamente excluyentes. Define UUID v4 lowercase,
   base64url canónico de 32 bytes, versión exacta `"1"`, cancel/ack, `CANCELLED` y el conjunto
   normativo de errores. Scope fija 10 MiB binarios por frame en cada dirección, 120.000 ms, 500
   calls, replay y carrera de cancelación.

   Durante esta misma auditoría se detectó y corrigió un error en el primer pattern propuesto para
   `channelToken`: para 32 bytes el carácter base64url final puede ser uno de 16 valores
   canónicos (`[AEIMQUYcgkosw048]`), no uno de 4. Se verificó el pattern contra 10.000 tokens
   generados con `randomBytes(32).toString("base64url")`.

   La contradicción de actores se eliminó con el término **endpoint confiable**: adaptador MCP
   mínimo en Claude y controlador del Orquestador en Codex. Se eligió que el worker no sea un
   servidor MCP. El adaptador Claude traduce MCP `stdio` al protocolo canónico, lo que permite
   aplicar la misma autenticación, límites y cancelación y evita mensajes MCP server→client
   originados por el worker.

2. **Proxy Codex único: resuelto.**
   Scope punto 4 es la definición autoritativa y Regla 2, Validation y Gate sólo la referencian.
   Enumera por separado requests, notifications y responses en ambas direcciones; incluye
   `turn/start` y `turn/interrupt`; correlaciona IDs en ambos sentidos; valida params cerrados; y
   termina `app-server` ante cualquier mensaje no enumerado. La response a `item/tool/call` ya no
   se describe como método.

3. **Egress y superficies auxiliares: resuelto.**
   Technical Considerations y Future ideas expresan la misma conclusión: el allowlist puede dar
   defensa en profundidad/detección ante superficies omitidas, bugs o supply chain, pero no es
   bloqueante del modelo de amenaza de prompt injection y tampoco evita exfiltración hacia un
   destino permitido.

   Regla 4 cubre ambos CLIs. Para Claude enumera, entre otros,
   `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`,
   `DISABLE_ERROR_REPORTING`, `DISABLE_UPDATES`,
   `ENABLE_CLAUDEAI_MCP_SERVERS=false` y el bloqueo de marketplace. Para Codex define
   `CODEX_HOME` mínimo, update/search/apps/MCP/browser desactivados, analytics y los tres
   exporters OTel en `none`, ausencia de overrides/provider helpers y `--strict-config`.
   El rechazo de MCP elicitation/OAuth y de mensajes Codex inesperados vive en los proxies, no se
   infiere de una URL.

4. **Lock/fencing único: resuelto.**
   Se eligió una secuencia Postgres global `bigint`, inicialmente 1, y un acquire UPSERT único con
   `nextval()`. Heartbeat y release tienen predicates exactos sobre
   `(credential_slot_id, run_id, fencing_token)`; release vence la fila y no la borra.

   La decisión crítica es que el holder trabaja sobre una copia RW privada y nunca monta el slot
   canónico. El Orquestador es el único que puede promoverla: prepara y hace fsync del temporal,
   bloquea la fila con `SELECT ... FOR UPDATE`, verifica tripleta + lease, hace rename atómico y
   libera antes de commit. Así un zombie con token viejo sólo puede modificar su volumen
   desechable. El documento reconoce explícitamente que no existe atomicidad distribuida
   filesystem/Postgres y define la recuperación si la falla ocurre después del rename. Ante error
   de heartbeat o DB se aborta de inmediato, sin período de gracia ni promoción.

5. **Pinning reproducible: resuelto como mecanismo de Gate.**
   Scope punto 7 define `docker/codex-pin.json` como futuro artefacto autoritativo de Etapa 1 con
   paquete/versión npm, base+digest, salida exacta de `codex --version` y tree hash de schemas.
   Cada observado se compara de forma independiente con el manifest; package y binary no se
   comparan entre sí. También fija un tree hash determinista y el registro del digest final.
   `0.144.6` queda marcado sólo como evidencia ilustrativa. El manifest no se creó con placeholders
   para evitar que un artefacto incompleto pudiera confundirse con una tupla aprobada: su creación
   y aprobación por el owner es el ítem 8 de Etapa 1.

6. **Referencia de investigación: resuelta.**
   Se eligió la opción (a): copiar
   `docs/research/investigacion-egress-proteccion-exfiltracion.md` desde
   `origin/feature/015-egress-investigacion` a esta rama. El header documenta el origen y el path
   ahora existe en el mismo árbol.

### Auditoría independiente de consistencia

Se revisaron de punta a punta Problem, Goal, Scope, Rules, Technical Considerations, Validation,
Risks y Approval Gate.

- **Versionado e historial:** el header dice v1.4 y describe una corrección documental de cinco
  problemas en v1.3 y seis bloqueantes técnicos en v1.4. Ya no conserva el conteo ambiguo
  “4 + 4”.
- **Referencias numéricas:** Regla 2 es el contrato de endpoints/proxies; Regla 4 son superficies
  auxiliares; Scope puntos 5/6 son caché y lock; Scope punto 7 es pinning. Todas las menciones de
  esos números apuntan al contenido correcto. Los nueve ítems de Etapa 1 corresponden a schema,
  Claude, Codex, config, topología, caché, lock, pin y fail-closed.
- **Definiciones repetidas:** protocolo, proxy, lock y pinning tienen una sola definición
  normativa en Scope. Rules, Validation y Gate remiten a ella sin introducir algoritmos
  alternativos. La justificación de egress es sustancialmente idéntica en Future ideas y
  Technical Considerations.
- **Actores y transportes:** el endpoint confiable cubre los dos proveedores sin afirmar que el
  holder Codex habla directamente con el worker. Claude usa MCP sólo entre CLI y adaptador local;
  el worker recibe únicamente el protocolo canónico.
- **Fencing:** no queda una escritura directa del holder sobre el slot canónico, que habría hecho
  imposible aplicar fencing al refresh nativo. Acquire, heartbeat, promoción y release forman un
  lifecycle único.
- **Schemas:** el archivo JSON parsea correctamente; los envelopes requieren sus campos, cierran
  propiedades adicionales y se discriminan por `messageType`. El límite de bytes queda en el
  transporte porque JSON Schema no puede expresar el tamaño de la serialización UTF-8.
- **Paths existentes verificados:** template v2.1, ROADMAP, investigación, evaluación, schema,
  `src/auth/sessionCore.ts` y resultados FEATURE-012/014 existen. `docker/codex-pin.json` está
  identificado expresamente como output futuro del Gate, no como insumo presente.
- **Archivos fuera de alcance:** no se modificaron ROADMAP, FEATURE-016 ni el archivo histórico
  016A.

No se encontraron inconsistencias adicionales después de corregir el pattern base64url y precisar
la semántica de falla alrededor del rename. Permanece trabajo deliberadamente abierto de
**validación**, no de diseño: aprobar la tupla Codex y ejecutar los nueve ítems de Etapa 1.

### Dictamen

**v1.4 consistente y lista para iniciar los spikes de Etapa 1.**

Este dictamen no aprueba producción, Etapa 2 ni el uso de credenciales reales. Congela una base de
diseño suficientemente concreta para que los spikes fallen o demuestren cada propiedad sin tener
que elegir nuevamente protocolo, proxy, lock, fencing, egress o pinning durante la implementación.
