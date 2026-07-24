# Investigación técnica — Egress con protección de exfiltración de credenciales (FEATURE-015)

Versión: v1.0
Fecha: 2026-07-22
Tipo: Investigación técnica — **sin diseño formal ni implementación**

---

## Resumen del problema

Developer necesita conservar acceso amplio de lectura a internet sin una lista previa de dominios,
pero la futura autenticación `cli_session` de FEATURE-016 introduciría dentro de su circuito una
credencial OAuth bearer portable. El objetivo investigado no es bloquear internet: es impedir que
el contenido de esa credencial salga del límite confiable. Hoy `spawnCodexInContainer` conecta el
contenedor al `bridge` default de Docker y no configura proxy ni filtro de salida; Docker documenta
que ese modo permite conexiones externas mediante masquerading. La dificultad central es que una
vez que un proceso no confiable puede leer un secreto y emitir tráfico arbitrario, un filtro de red
sin seguimiento de flujo de información no puede distinguir de forma general investigación
legítima de una copia transformada, fragmentada o cifrada del secreto.

## Evidencia empírica y entorno observado

La inspección se realizó sin leer ni copiar credenciales y sin modificar firewall, daemon Docker o
imágenes de la VPS.

| Observación en VPS | Resultado |
|---|---|
| Host | Ubuntu, kernel `6.8.0-134-generic`; Docker Engine `29.6.2` |
| Seguridad Docker | AppArmor, seccomp y cgroup namespace reportados por el daemon |
| Imagen probada | `ai-orchestrator-codex-developer:latest`, usuario `node`, workdir `/workspace` |
| Contenedor endurecido | Con `--cap-drop ALL --security-opt no-new-privileges`, `CapEff` fue `0000000000000000` |
| HTTPS saliente | `wget https://example.com` desde ese contenedor devolvió la página esperada |
| DNS saliente | `nslookup feature015-marker.example.com` alcanzó el resolver `153.92.2.6`; el nombre reservado no resolvió, como era esperable |
| Sin red | La misma consulta HTTPS con `--network none` falló en resolución (`bad address`), confirmando que ese control corta también la investigación legítima |
| Secreto ausente | La imagen base no contiene `/home/node/.claude/.credentials.json`; el test de ausencia terminó con exit code 0 |
| Namespace de red | `unshare -n true` falló con `Operation not permitted` tanto en el host como en el contenedor endurecido |
| Kernel | `CONFIG_SECURITY_LANDLOCK=y`, `CONFIG_BPF_SYSCALL=y`; LSM activos: Landlock y AppArmor, entre otros |
| Instrumentación disponible | `tcpdump` presente; `mitmproxy`, `suricata` y `conntrack` no instalados |
| Caso de referencia | `/home/asdru/test-cases/case_escalate_architect.json` existe; no se ejecutó porque no era necesario exponer credenciales ni mutar un run para comprobar la conectividad base |

El checkout de la VPS estaba en `91e1dd52` y contenía cambios locales ajenos; no se actualizó ni se
usó como origen de commits. El checkout de origen de esta investigación es la notebook, rama
`feature/015-egress-investigacion`, creada desde `main` en `954ed9b`.

La falla de `unshare` reproduce la clase de limitación descrita en FEATURE-008: un proceso sin
privilegios no puede crear/configurar el namespace de red requerido por bubblewrap. No demuestra
que el host sea incapaz de filtrar tráfico: el daemon Docker rootful crea bridges y NAT con
privilegios propios. Sin embargo, el usuario operativo no dispone de `sudo` no interactivo, por lo
que en esta sesión no se pudieron instalar interceptores, capturar tráfico ni probar reglas
`iptables`/`nftables` reales.

---

## Enfoque 1 — Proxy de egress transparente con inspección de contenido

### Mecanismo concreto

Crear una red Docker dedicada para Developer y redirigir desde el host todo TCP saliente de esa
red hacia un proxy de intercepción. Para HTTPS, el proxy termina TLS, inspecciona request y body,
y abre una segunda conexión hacia el destino; la imagen Developer debe confiar en la CA privada
del proxy. Un addon DLP calcularía firmas de campos sensibles del archivo (tokens completos,
fragmentos suficientemente largos y hashes donde el protocolo los exponga) y rechazaría requests
coincidentes. La red debe además:

1. forzar DNS hacia un resolver controlado y registrar consultas;
2. bloquear DNS directo a otros resolvers y considerar DoH/DoT;
3. bloquear o interceptar UDP/QUIC, porque el modo transparente TCP no lo cubre;
4. impedir conexiones directas que evadan el proxy;
5. aplicar el mismo control a IPv4 e IPv6.

Mitmproxy documenta que el modo transparente Linux necesita forwarding, reglas `iptables` y una CA
instalada en el cliente; también documenta que su captura local eBPF requiere root, que capturar
contenedores así exige `--network host`, y que el modo transparente actual no cubre UDP. Docker
indica que el lugar soportado para reglas previas a sus cadenas de bridge con backend iptables es
`DOCKER-USER`.

### Compatibilidad con investigación abierta

Alta para HTTP(S) si se permite cualquier destino y el proxy sólo decide por contenido. No requiere
un allowlist de dominios. Puede romper clientes con certificate pinning, almacenes de CA propios,
protocolos no HTTP o transporte no interceptado. Hay que validar específicamente Claude Code y
Codex CLI, incluido streaming, HTTP/2, redirects, actualización del CLI y refresh OAuth.

### Cobertura de exfiltración

- Puede bloquear la credencial literal o codificaciones previstas dentro de HTTP visible.
- Puede observar DNS si todo DNS se fuerza al resolver propio y detectar etiquetas sospechosas.
- No garantiza bloquear el mismo secreto comprimido, cifrado con una clave elegida por el atacante,
  fragmentado en requests pequeños o transformado con un esquema no anticipado.
- Aun con TLS interceptado, un payload cifrado por la aplicación sigue siendo opaco al DLP.
- Sin bloqueo de UDP, DoH/DoT alternativo, IPv6 y conexiones directas, quedan bypasses triviales.

Por eso, “buscar el token en cada request” es una defensa útil pero no una barrera completa frente
a código activamente adversarial que ya leyó el token.

### Costo e impacto

- Cambio de imagen: instalar la CA y posiblemente configurar variables/almacenes de confianza.
- Host: red dedicada, reglas persistentes y privilegios administrativos; coordinación cuidadosa
  con las reglas que Docker administra.
- Servicio adicional: proxy (host o sidecar), resolver controlado, almacenamiento seguro de
  firmas y logs, rotación de CA, health checks y fail-closed.
- Testing: matriz de CLIs/protocolos, DNS, IPv6, QUIC, redirects, upgrades y caída del proxy.

### Falsos positivos, falsos negativos y riesgo residual

Firmas cortas pueden bloquear texto legítimo; firmas largas pierden variantes fragmentadas. El
proxy se vuelve un componente con acceso a todo el HTTP(S) en claro y a material de detección
sensible. Una caída fail-open anula la garantía; una caída fail-closed detiene Developer. La
limitación `RTM_NEWADDR` impide usar el sandbox nativo como atajo, pero no invalida una instalación
host-side administrada. Esa instalación no se validó empíricamente en esta sesión.

---

## Enfoque 2 — Aislar el secreto del proceso con internet amplio

### Mecanismo concreto

Separar dos dominios de confianza:

- **Worker Developer no confiable**: worktree y acceso amplio a internet, pero nunca recibe ni
  monta el archivo OAuth, ni variables equivalentes.
- **Credential holder confiable**: proceso o contenedor separado que posee el caché OAuth y sólo
  expone una interfaz estrecha para invocar al proveedor. Su propia red puede limitarse al
  proveedor de IA porque no necesita investigar.

La comunicación sería por un socket Unix o una red Docker `--internal`, con mensajes autenticados,
límites de tamaño y un contrato que no permita leer archivos arbitrarios del worker. El holder
devuelve únicamente la salida del modelo; no entrega tokens ni un shell genérico. El worker realiza
la investigación y manipulación del repo, mientras el holder conserva la credencial fuera de su
filesystem y namespace de procesos.

### Compatibilidad con investigación abierta

Alta para el worker: conserva internet sin allowlist. Es el enfoque que evita intentar clasificar
destinos o contenido. Pero choca con la arquitectura actual: hoy la CLI autenticada y el proceso
que coordina las herramientas Developer forman un mismo circuito. Montar el archivo `:ro`, usar
`0600` o moverlo a otro path no sirve si ese mismo proceso puede leerlo. Para una separación real
se necesita que el componente que ve el secreto no ejecute comandos controlados por el modelo ni
exponga una API de “ejecutar cualquier CLI/comando”.

Una variante sería un broker que inyecte autenticación en una API explícita sin revelar el secreto.
No se confirmó que los modos OAuth de las CLIs soporten ese patrón; asumir que un proxy puede
inyectar sus bearer tokens internos sería depender de detalles no documentados y posiblemente
inestables.

### Cobertura de exfiltración

Si el secreto nunca entra al worker, éste no puede exfiltrar su contenido por HTTP, DNS, ICMP u
otro canal. La garantía depende de que:

- el holder no acepte requests que lo conviertan en confused deputy;
- respuestas, errores, dumps y logs nunca incluyan tokens;
- no exista un mount compartido o endpoint de debug que revele el caché;
- el holder tenga egress mínimo y no ejecute herramientas no confiables.

No evita que Developer exfiltre otros datos del worktree; resuelve específicamente el secreto
OAuth definido en el alcance.

### Costo e impacto

- Cambio arquitectónico mayor que un proxy: separar inferencia autenticada de ejecución de tools.
- Posible sidecar/servicio local y protocolo nuevo, lifecycle, backpressure, cancelación y streaming.
- Imagen Developer puede simplificarse al no contener el caché; el holder necesita su propia imagen
  endurecida y política de refresh escribible mínima.
- Hay que validar compatibilidad con ambas CLIs o reemplazar su acoplamiento por una integración
  soportada que preserve sus capacidades actuales. Esto podría superar el cambio mínimo previsto
  por FEATURE-016 y requiere diseño formal.

### Falsos positivos, falsos negativos y riesgo residual

No tiene falsos positivos de DLP porque no clasifica contenido. El principal falso supuesto sería
creer que existe aislamiento cuando la CLI autenticada todavía lanza el shell Developer o cuando
el worker puede pedirle al holder leer rutas arbitrarias. El holder se vuelve un límite de
seguridad crítico; una API demasiado expresiva reintroduce el secreto indirectamente.

### Variante kernel/filesystem

Landlock/AppArmor pueden negar lectura de una ruta a un proceso y sus hijos, y están disponibles en
la VPS. Son útiles para afirmar que el worker no ve el caché, pero no resuelven por sí solos el caso
en que la misma CLI debe leerlo para autenticarse: una política heredada que niegue el archivo
también se lo niega a la CLI. Seccomp/capability dropping filtra operaciones, no realiza taint
tracking entre bytes leídos y bytes enviados; la prueba con cero capabilities y egress funcional
lo confirma para el endurecimiento actual.

---

## Enfoque 3 — Logging de egress y detección post-hoc

### Mecanismo concreto

Instrumentar la red dedicada de Developer con logs correlacionables por `run_id`:

- flujos (IP/puerto/protocolo, bytes y tiempos) mediante nftables/conntrack/eBPF o un sensor;
- consultas y respuestas en un resolver DNS obligatorio;
- metadatos TLS como SNI/certificado y HTTP visible cuando exista;
- opcionalmente contenido HTTP(S) mediante el mismo MITM del enfoque 1;
- auditoría de acceso al archivo sensible mediante auditd/eBPF/fanotify, sin registrar su contenido.

Una regla puede alertar cuando el caché se lee y aparece tráfico anómalo, consultas DNS largas o
destinos nuevos. Suricata EVE permite separar y rotar eventos JSON de DNS, TLS, HTTP, alertas y
flows, que luego pueden asociarse al ciclo de vida del contenedor.

### Compatibilidad con investigación abierta

Muy alta: observa sin restringir destinos y por eso casi no rompe investigación. El costo es que no
cumple el objetivo preventivo por sí solo. Sirve como evidencia, detección y mecanismo de tuning
antes de activar bloqueos, o como defensa adicional a otro enfoque.

### Cobertura de exfiltración

- Registra que hubo conexiones, volúmenes, SNI y DNS; no ve payload TLS sin intercepción.
- Un dominio o IP legítimo (GitHub, un paste service, almacenamiento cloud) puede transportar el
  secreto sin destacar en metadata.
- DNS logging deja evidencia del nombre consultado, pero detectar contenido codificado, cifrado o
  fragmentado exige heurísticas y puede ocurrir después de que la credencial salió.
- Auditar la lectura tiene baja señal porque la CLI legítimamente necesita leer su propio caché;
  hace falta distinguir el holder esperado de shells/hijos inesperados.

### Costo e impacto

- Sensor/collector, almacenamiento, retención, alertas y redacción de datos sensibles.
- Acceso privilegiado al tráfico del bridge o integración host-side; `tcpdump` está instalado pero
  el usuario de esta sesión no tuvo privilegios para una captura.
- Sin cambio obligatorio a la imagen si todo se instrumenta en host; un resolver forzado sí exige
  cambios de red y política anti-bypass.

### Falsos positivos, falsos negativos y riesgo residual

Investigación legítima genera destinos nuevos y patrones de tráfico variables, por lo que alertas
por anomalía tendrán ruido. El contenido cifrado produce falsos negativos. Los logs pueden contener
URLs, queries o payloads sensibles y requieren control de acceso. Sobre todo, detectar no revoca
automáticamente una sesión ya copiada ni satisface el gate duro de FEATURE-016 sin un mecanismo
preventivo adicional.

---

## Comparación de tradeoffs

| Criterio | Proxy transparente + DLP | Separación del secreto | Logging post-hoc |
|---|---|---|---|
| Internet amplio sin allowlist | Sí, con compatibilidad parcial por protocolo | Sí, para el worker | Sí |
| Bloqueo en tiempo real | Parcial; fuerte sólo para representaciones observables | Fuerte si el worker nunca recibe el secreto | No |
| DNS y canales no HTTP | Requiere controles adicionales; no viene resuelto | Irrelevante para ese secreto en el worker | Observables en parte, no prevenidos |
| Resistencia a cifrado/fragmentación del secreto | Baja sin taint tracking | Alta | Baja |
| Cambio de imagen | CA/configuración de proxy | Worker sin caché + nueva imagen/servicio confiable | Opcional |
| Cambio host/kernel | Firewall/redirección y posiblemente sidecar | Red interna mínima; depende del despliegue | Sensor/captura privilegiada |
| Impacto arquitectónico | Medio | Alto | Bajo/medio |
| Riesgo de romper CLIs | Medio/alto | Alto hasta definir el límite entre CLI y tools | Bajo |
| Valor como garantía para Regla 6 | Parcial por sí solo | Potencialmente alto | Insuficiente por sí solo |
| Validación real en esta sesión | Sólo conectividad/bypass base; proxy no instalado | Se validó que sin mount no hay secreto, no un flujo OAuth funcional separado | Herramientas/privilegios inspeccionados; no hubo captura |

Ninguna fila constituye una selección. El diseño formal debe decidir qué garantía exacta acepta y
si combina enfoques; por ejemplo, separación como control preventivo más logging como evidencia, o
proxy DLP como defensa adicional y no como frontera única.

---

## Lo que no se pudo validar / queda abierto

1. No se instaló ni ejecutó un proxy transparente en la VPS: requería privilegios para routing y
   firewall que el usuario operativo no tuvo en esta sesión.
2. No se validó confianza de CA, certificate pinning, HTTP/2, streaming, QUIC ni refresh OAuth de
   Claude Code/Codex detrás de MITM.
3. No se capturó tráfico con `tcpdump` ni se instaló Suricata; por lo tanto no se afirma que el
   logging host-side esté operativo.
4. No se probó un broker/sidecar de credenciales porque no existe todavía un contrato que separe
   inferencia autenticada de ejecución de tools sin reducir capacidad Developer.
5. No se usaron credenciales reales ni se intentó exfiltrarlas. La prueba DNS sólo demuestra acceso
   al resolver, no recepción en un servidor autoritativo controlado.
6. No se determinó si las CLIs oficiales ofrecen una interfaz soportada para delegar OAuth sin
   entregar el archivo bearer al proceso principal.
7. Queda por definir el activo exacto a proteger: archivo completo, `accessToken`, `refreshToken`,
   futuras rotaciones y copias temporales/backups. Esa definición condiciona firmas y tests.
8. Queda por definir el modelo adversarial: código accidental, prompt injection o proceso
   deliberadamente evasivo. Un DLP por patrones puede ser razonable para los dos primeros y
   claramente insuficiente para el tercero.
9. La limitación de namespace de FEATURE-008 fue reconfirmada, pero no se debe extrapolar a que el
   host rootful no pueda aplicar netfilter/eBPF. Esa capacidad necesita una ventana administrada de
   prueba y rollback.

---

## Fuentes primarias consultadas

- Docker, [Networking overview](https://docs.docker.com/engine/network/): bridge default, egress y DNS.
- Docker, [Docker with iptables](https://docs.docker.com/engine/network/firewall-iptables/): cadenas
  creadas por Docker y uso de `DOCKER-USER`.
- Docker, [Packet filtering and firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/):
  interacción entre Docker, forwarding y backends de firewall.
- mitmproxy, [Transparent Proxying](https://docs.mitmproxy.org/stable/howto/transparent/): forwarding,
  redirección y CA requeridos.
- mitmproxy, [Proxy Modes](https://docs.mitmproxy.org/stable/concepts/modes/): límites de captura
  local en Linux/contenedores y falta de UDP en modo transparente.
- Linux kernel, [Landlock: unprivileged access control (kernel 6.8)](https://docs.kernel.org/6.8/userspace-api/landlock.html):
  restricciones de filesystem/red y límites de namespaces como control de acceso.
- Suricata, [EVE JSON Output](https://docs.suricata.io/en/suricata-6.0.20/output/eve/eve-json-output.html):
  eventos DNS, TLS, HTTP, alertas y flows.

---

## Anexo — Factibilidad del patrón broker (Enfoque 2)

Fecha de verificación: 2026-07-22

### Pregunta y criterio

Se investigó si el proceso que posee/refresca la sesión OAuth y llama al modelo puede quedar
separado del proceso no confiable que ejecuta Bash y modifica el worktree. La condición de
seguridad no es sólo que exista otro proceso: el credential holder tampoco debe ofrecer una
herramienta integrada que ejecute comandos del modelo en su propio filesystem, y el worker no debe
recibir el caché, tokens, variables de autenticación ni file descriptors que los contengan.

La respuesta corta es distinta por proveedor:

| CLI | Respuesta | Fragilidad | Conclusión operacional |
|---|---|---|---|
| Claude Code | **Sí, documentado** mediante herramientas MCP remotas y desactivación de herramientas integradas | Baja/media | El broker es viable conservando la CLI y OAuth de suscripción |
| Codex | **Sí, pero experimental** mediante `codex app-server` + `dynamicTools` | Media/alta | Viable con versión fijada y tests de contrato; todavía no es una interfaz estable |

No se encontró un flag llamado literalmente “inference-only server”. La separación se construye
con los puntos de extensión oficiales de tools de cada CLI, sin usar hooks internos ni parsear
texto libre del modelo.

### Evidencia empírica acotada

En la VPS se inspeccionaron las CLIs instaladas sin iniciar una conversación autenticada:

- Claude Code `2.1.212`: `claude --help` expone `--tools`, `--mcp-config`,
  `--strict-mcp-config`, `--disallowedTools` y modos JSON/streaming. El help confirma que
  `--tools` controla el conjunto integrado y que una configuración MCP explícita puede cargarse
  de forma aislada.
- Codex CLI `0.144.5`: `codex app-server --help` expone el servidor y la generación de schemas.
  El schema JSON generado por esa misma instalación contiene `DynamicToolSpec`,
  `DynamicToolCallParams`, `DynamicToolCallResponse` y el request `item/tool/call`.

El schema se generó en `/tmp/feature015-codex-schema` sólo como evidencia de interfaz. No se
probaron tools contra el modelo ni se leyó/cargó ningún token OAuth. Por eso esta verificación
demuestra disponibilidad del contrato en las versiones instaladas, no equivalencia funcional
completa con el Developer actual.

---

### Claude Code CLI — sí, mediante MCP remoto

#### Mecanismo documentado

El credential holder puede ejecutar Claude Code con su caché OAuth dedicado y sin worktree, con:

1. herramientas integradas deshabilitadas mediante `--tools ""`;
2. sólo una configuración MCP explícita mediante `--mcp-config` + `--strict-mcp-config`;
3. un MCP remoto HTTP que vive en el worker Developer y expone las operaciones necesarias de
   shell/filesystem;
4. modo no interactivo/streaming para integrar el ciclo con el Orquestador.

La referencia oficial de la CLI dice expresamente que `--tools` restringe las herramientas
integradas, acepta `""` para deshabilitarlas todas y **no afecta las herramientas MCP**. La
documentación MCP recomienda HTTP para servidores remotos y confirma que Claude Code invoca las
tools publicadas por ese servidor. Por lo tanto, el proceso Claude Code conserva autenticación e
inferencia, mientras la implementación real de Bash/Read/Write/Edit puede vivir en otro proceso o
contenedor que nunca monta el caché OAuth.

Esto requiere reemplazar las tools integradas por equivalentes MCP, no reemplazar Claude Code ni
su llamada autenticada al modelo. El holder debe ejecutarse en un filesystem mínimo, sin el
worktree, y su red sólo necesita alcanzar Anthropic y el endpoint privado del worker. El worker
conserva el acceso amplio a internet requerido para investigación.

`--allowedTools` no alcanza para este límite: esa opción controla qué tools ejecutan sin pedir
permiso, no cuáles existen. La opción relevante es `--tools ""`, complementada por una lista MCP
explícita. Tampoco conviene `--bare` para este caso: en la versión inspeccionada deshabilita OAuth
y keychain, contradiciendo el objetivo de FEATURE-016.

#### Garantía y límites

Una prompt injection puede lograr que el modelo solicite comandos maliciosos al MCP worker, pero
el worker no posee la credencial y por eso no puede copiarla. El holder no debe exponer Bash,
Read/Edit ni un MCP local con acceso a su home. El contenido devuelto por el worker sigue siendo
no confiable y puede manipular decisiones posteriores del modelo, pero no crea por sí mismo una
ruta de lectura al archivo OAuth.

La equivalencia funcional queda pendiente: hay que definir schemas MCP que preserven cwd,
streaming, cancelación, límites de output, patches y códigos de salida del Developer actual. Eso es
trabajo de diseño/validación posterior, no una duda sobre la posibilidad de separar procesos.

#### Fragilidad

**Baja/media.** MCP remoto, `--tools`, `--mcp-config` y `--strict-mcp-config` están documentados
públicamente. No dependen de una variable privada ni de interpretar el JSON interno de una versión
concreta. La fragilidad restante está en reproducir con fidelidad la experiencia de las tools
integradas y en cambios normales de compatibilidad/versionado de Claude Code/MCP; se mitiga fijando
versión durante la implementación y validando el inventario efectivo de tools al arrancar.

#### Refresh OAuth

Lo realiza el holder. La documentación de errores de Claude Code describe refresh automático y el
changelog oficial registra que las sesiones OAuth de la CLI refrescan reactivamente ante un `401`.
Si el token vence mientras el worker ejecuta una tool larga, no hay una llamada al proveedor que
refrescar durante ese intervalo: al devolver el `tool_result`, la siguiente llamada del holder al
modelo puede refrescar y continuar. El worker no participa ni necesita bloquearse por el mecanismo
de refresh, salvo por el tiempo normal de espera del turno.

El caché del holder debe ser escribible sólo por él para persistir la rotación. Múltiples holders
no deberían compartir copias independientes del mismo refresh token; esa topología queda fuera de
esta prueba y requiere validación de concurrencia.

#### Alternativa por fuera de la CLI

La Messages API de Anthropic soporta de forma estable tools ejecutadas por el cliente: el modelo
devuelve bloques `tool_use`, la aplicación ejecuta la operación y responde con `tool_result`. Eso
permite la misma separación estructural mediante integración directa. Sin embargo, esa API usa la
autenticación de Claude Platform/cloud provider; no se encontró documentación que permita tratar
el OAuth personal cacheado por Claude Code como credencial pública para Messages API. Por tanto,
esta alternativa cambiaría el supuesto de autenticación/costos de FEATURE-016 y no es necesaria
para demostrar viabilidad con Claude Code.

Fuentes:

- Anthropic, [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage).
- Anthropic, [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp).
- Anthropic, [How tool use works](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works).
- Anthropic, [Authentication](https://code.claude.com/docs/en/iam).
- Anthropic, [Error reference](https://code.claude.com/docs/en/errors).
- Anthropic, [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md).

---

### Codex CLI — sí, pero mediante una API experimental

#### Mecanismo documentado

`codex app-server` separa el runtime Codex de un cliente mediante JSON-RPC. Su API oficial abierta
ofrece `dynamicTools` en `thread/start`: cuando el modelo llama una de ellas, app-server envía un
request `item/tool/call` al cliente y espera una respuesta con los resultados. Esto permite que:

1. el app-server holder posea el login ChatGPT/OAuth y haga las llamadas upstream;
2. el cliente/worker reciba únicamente nombre, argumentos e identificadores de la tool;
3. Bash y las operaciones del worktree se ejecuten en el worker, que no posee `auth.json`;
4. el resultado vuelva al holder para continuar el turno.

El app-server holder debe correr sin montar el worktree, con sandbox read-only y sin shell
integrado (`features.shell_tool=false`, mecanismo ya usado por este repo para QA). Las operaciones
Developer se registran como dynamic tools; no se debe usar `command/exec`, `process/spawn` ni la
ejecución integrada del app-server, porque esas rutas correrían comandos donde vive el holder y
romperían el límite de confianza.

La interfaz no exige WebSocket: puede usarse el transporte stdio o Unix socket. Esto evita sumar
la fragilidad del WebSocket, que también está marcado experimental. El cliente del Orquestador
actúa como relay hacia el worker aislado.

#### Garantía y límites

El proceso que ejecuta los comandos sólo ve los argumentos de `item/tool/call` y devuelve
`contentItems`; el schema no incluye credenciales upstream. El holder sigue siendo responsable de
no interpolar tokens en prompts, errores o respuestas. Un filesystem mínimo y la ausencia de tools
integradas ejecutables son controles obligatorios: app-server, por sí solo, también soporta
ejecución local y no constituye aislamiento automáticamente.

El contrato dinámico admite tools genéricas, por lo que en principio puede representar shell,
lectura, edición y patches. No se validó todavía paridad de streaming binario, cancelación,
aprobaciones, output grande ni reproducción exacta de las tools entrenadas de Codex. En especial,
reemplazar tools integradas por schemas propios puede afectar calidad/comportamiento aun cuando el
transporte funcione.

#### Fragilidad

**Media/alta.** El repositorio oficial documenta `dynamicTools`, pero lo marca explícitamente
**experimental** y exige `experimentalApi: true`. Los schemas se generan por versión y la propia
documentación señala que corresponden exactamente al binario que los generó. No es un hack ni un
flag interno: existe en el código abierto, en la documentación oficial y en Codex `0.144.5` de la
VPS. Aun así, nombres, payloads o lifecycle pueden cambiar entre upgrades sin la garantía de una
API estable.

Una implementación podría reducir fragilidad fijando versión, generando bindings desde el mismo
binario y ejecutando contract tests antes de cada upgrade. Eso la hace operable, pero no convierte
el protocolo en estable. Si el owner exige una interfaz no experimental como condición previa, la
vía CLI de Codex todavía no satisface ese umbral.

#### Refresh OAuth

Lo realiza el app-server holder. Su documentación de autenticación indica que el modo ChatGPT
managed posee el flujo OAuth y los refresh tokens, los persiste y los refresca automáticamente;
`account/read` permite además solicitar refresh explícito. El worker no ve ni rota el token.

Para una tool larga aplica el mismo desacople temporal: mientras app-server espera el
`item/tool/call`, el worker puede continuar; al reanudarse el turno, el holder autentica la próxima
llamada upstream. Debe existir un único dueño del caché o coordinación explícita; copiar `auth.json`
a varios holders reintroduciría carreras/rotación y ampliaría el secreto, contrario al patrón.

#### Alternativa por fuera de la CLI

La Responses API ofrece function calling estable: el modelo devuelve items `function_call`, la
aplicación ejecuta la función donde decida y responde con `function_call_output`. Esto separa de
forma limpia inferencia y tools sin depender de `dynamicTools`. Sin embargo, la API pública se
autentica como plataforma; no hay documentación oficial para reutilizar el OAuth personal de
Codex/ChatGPT como credencial de Responses API. Reemplazar la CLI por Responses API implicaría
volver a API key/facturación de plataforma y es un cambio explícito de alcance, no una sustitución
transparente.

Fuentes:

- OpenAI, [Codex app-server README y protocolo](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).
- OpenAI, [Codex app-server source](https://github.com/openai/codex/tree/main/codex-rs/app-server).
- OpenAI, [Function calling en Responses API](https://developers.openai.com/api/docs/guides/function-calling).

---

### Conclusión de factibilidad

El Enfoque 2 **sigue siendo viable, pero debe ajustarse a dos adaptadores específicos**:

- Claude Code: holder OAuth + CLI sin tools integradas + worker MCP remoto. Es una base
  documentada y razonablemente estable; no requiere reemplazar la CLI.
- Codex: holder OAuth en app-server + dynamic tools ejecutadas por el worker. Es técnicamente
  viable en la versión real instalada, pero depende de una API experimental y necesita version pin
  + contract tests.

Por lo tanto, no corresponde concluir que ambas CLIs deban reemplazarse por APIs directas. La
integración directa es un fallback claro para Codex si el owner rechaza depender de una interfaz
experimental; en ese caso también debe aceptar que la autenticación pasaría a credenciales y
facturación de plataforma, porque no se encontró una vía pública soportada para usar el OAuth
personal de Codex contra Responses API.

Esta conclusión sólo resuelve factibilidad. No define el protocolo del broker, los schemas de
tools, la topología Docker ni los criterios de aprobación de FEATURE-015.
