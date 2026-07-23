# FEATURE-015A — Egress y aislamiento de credenciales OAuth — Parte 015A: Arquitectura holder/worker genérica

Versión: v1.0 (borrador para revisión — no aprobado)
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

1. **Protocolo holder↔worker**: contrato estrecho (nombre de tool + argumentos + resultado), sin
   una operación genérica de "leer cualquier ruta" del holder. Transporte acotado (socket Unix o
   red Docker `--internal`).
2. **Adaptador Claude Code**: holder ejecutado con `--tools ""` (deshabilita herramientas
   integradas) + `--mcp-config`/`--strict-mcp-config` apuntando a un servidor MCP remoto expuesto
   por el worker. `--bare` descartado (deshabilita OAuth/keychain).
3. **Adaptador Codex**: holder ejecutado vía `codex app-server` (`experimentalApi: true`)
   distinguiendo explícitamente 4 superficies: métodos JSON-RPC permitidos al controlador
   confiable (nunca invoca `command/exec` ni `process/spawn`), tools presentadas al modelo (sin
   ninguna de ejecución/lectura local), sandbox/filesystem del holder (sin worktree, read-only,
   home mínimo), y dynamic tools delegadas al worker.
4. **Resolución de la contradicción RO/refresh**: el holder posee su caché de credenciales en un
   directorio/volumen propio, con acceso de lectura y escritura directo (no un bind mount
   read-only). El refresh nativo/reactivo dentro del ciclo de invocación está permitido y
   esperado; si falla, la fase falla explícitamente. Esta regla existe específicamente para no
   repetir la contradicción que encontró la evaluación de FEATURE-016A.
5. **El worker nunca recibe el caché de credenciales**, bajo ninguna configuración de red
   (amplia o mínima) — la política de red específica del worker por rol es responsabilidad de
   FEATURE-015B, no de esta Feature.
6. Política de concurrencia: rechazar una nueva invocación con `cli_session` si ya existe un
   holder activo para la misma identidad OAuth.
7. Fronteras obligatorias: el holder no monta el Docker socket; el worker no puede abrir una
   sesión administrativa contra `app-server`; el holder no escucha puertos accesibles desde el
   worker salvo autenticación y necesidad explícita; configuración, logs, errores y system prompt
   del holder nunca incluyen contenido del caché.
8. Para Codex: version pin de `codex app-server` + contract tests contra el schema de
   `dynamicTools` antes de cualquier upgrade.
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

- Extender el protocolo holder/worker a otros casos de uso del Orquestador que en el futuro
  necesiten aislar un secreto de un proceso con tools de lectura/ejecución.
- Logging/auditoría (Enfoque 3) como capa complementaria de evidencia sobre el mecanismo ya
  implementado, no como sustituto.

---

# 5. Functional Rules

1. El worker nunca recibe el archivo/caché de credenciales OAuth, variables de entorno que lo
   referencien, ni un mount que lo exponga, bajo ninguna configuración de red del worker.
2. El holder no expone ninguna herramienta integrada de ejecución de comandos ni edición de
   archivos sobre su propio filesystem. Para Codex, esto exige distinguir las 4 superficies del
   protocolo `app-server` (Scope → Incluido punto 3) — no alcanza con una sola bandera.
3. Toda operación de shell/filesystem que el modelo solicite se ejecuta en el worker — nunca en
   el holder.
4. El canal holder↔worker no necesita rechazar por schema una tool `read(path)` genérica: si el
   worker la resuelve dentro de su propio namespace, una ruta que apunte al filesystem del holder
   simplemente no existe ahí. La propiedad garantizada es que ninguna ruta cruza hacia el
   filesystem del holder.
5. **El holder posee su caché de credenciales en un directorio/volumen propio con acceso de
   lectura y escritura directo — nunca un bind mount read-only sobre el que se espera escritura de
   refresh.** Refresh nativo/reactivo dentro del ciclo de invocación permitido y esperado; si ese
   refresh falla, la fase falla explícitamente. Esta regla resuelve de raíz la contradicción que
   encontró la evaluación del diseño descartado de FEATURE-016A.
6. Ante falla del holder o del canal, la invocación falla explícitamente (fail-closed), evaluado
   por separado para cada componente (holder caído, worker caído, canal caído).
7. El sistema rechaza iniciar una nueva invocación con `cli_session` si ya existe un holder activo
   para la misma identidad OAuth.
8. Para Codex: fijar versión de `codex app-server` y correr contract tests contra el schema de
   `dynamicTools` antes de cualquier upgrade. Los contract tests validan el schema, no qué tools
   recibió el modelo en runtime — eso requiere verificación aparte (inventario efectivo).
9. Fronteras obligatorias: el holder no monta el Docker socket; el worker no abre sesión
   administrativa contra `app-server`; el holder no escucha puertos accesibles desde el worker
   salvo autenticación y necesidad explícita; configuración, logs, errores y system prompt del
   holder nunca incluyen contenido del caché de credenciales.
10. Esta Feature protege específicamente la credencial OAuth — no todos los secretos posibles del
    worktree. El worker conserva la capacidad de exfiltrar otros datos si el modelo así lo decide;
    eso queda fuera de esta garantía.
11. El mecanismo debe ser neutral respecto a la política de red del worker (amplia o mínima) — esa
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
| Segunda invocación, misma identidad OAuth | Un holder ya activo para esa identidad, se intenta iniciar otro | Rechazado explícitamente (Regla 7) |
| Upgrade de `codex app-server` rompe `dynamicTools` | Contract tests corridos contra la nueva versión antes de actualizar en producción | El contract test detecta la ruptura antes del despliegue |

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

---

# 10. Approval Gate

Implementación prohibida hasta aprobación explícita del owner. Requisitos verificables antes de
esa aprobación:

1. ☐ Protocolo/schema de comunicación holder↔worker definido y documentado para ambos adaptadores.
2. ☐ Spike Claude Code: holder sin herramientas integradas + worker MCP genérico con al menos una
   tool de prueba, sin credenciales reales.
3. ☐ Spike Codex: `app-server` + al menos una dynamic tool de prueba + holder sin acceso al
   worktree, sin credenciales reales.
4. ☐ Inventario efectivo de tools (no solo el schema declarado) demuestra ausencia de tools
   locales prohibidas en el holder, para ambos adaptadores.
5. ☐ Topología Docker (contenedores separados, daemon rootful) validada en la VPS, dada la
   limitación de privilegio de red del kernel ya conocida (FEATURE-008).
6. ☐ Refresh validado con el holder escribiendo en su propio caché (no mount RO) — prueba
   específica de que no se repite la contradicción encontrada en la evaluación de FEATURE-016A.
7. ☐ Fronteras obligatorias (Docker socket, sesión administrativa, puertos, redacción de logs)
   implementadas y verificadas en los spikes.
8. ☐ Política de concurrencia (Regla 7) confirmada por el owner como aceptable.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.
