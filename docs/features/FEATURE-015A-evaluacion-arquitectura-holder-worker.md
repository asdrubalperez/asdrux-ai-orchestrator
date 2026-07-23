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
