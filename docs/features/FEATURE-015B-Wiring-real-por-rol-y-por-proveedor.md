# FEATURE-015B — Wiring real por rol y por proveedor

Versión: v2 — validación técnica de Codex incorporada (2026-07-23)

> Parte 015B de FEATURE-015. Depende de FEATURE-015A (ejecutada y mergeada): su protocolo
> holder↔worker, autenticación de canal, pinning de Codex, credencial privada y fencing no se
> rediseñan aquí. FEATURE-015A entregó arquitectura, contratos y spikes; no dejó un runtime
> productivo integrado en `src/`.

Estado: 🟡 Diseño técnicamente completo, no aprobado — pendiente de revisión del Architect/owner
y Approval Gate explícito.

---

# 1. Feature Identity

- **Name**: FEATURE-015B — Wiring real por rol y por proveedor
- **Type**: Seguridad / Arquitectura — extensión de FEATURE-015A
- **Owner**: asdrubalperez
- **Status**: Diseño v2, no aprobado
- **Priority**: Alta — prerequisito de FEATURE-016B (OAuth para Developer)

---

# 2. Problem Statement

FEATURE-015A validó una arquitectura holder/worker genérica con una tool sintética, pero ningún rol
real quedó cableado a ella.

Estado real del código:

- Claude Code: Architect, Functional y Planning reciben `Read,Grep,Glob`; Developer recibe
  `Read,Grep,Glob,Write,Edit,Bash`. Existe un branch histórico para `allowedCommands`, pero desde
  FEATURE-006 el pipeline real no entrega Bash al agente QA: el comando de prueba lo ejecuta
  `TestExecutor` fuera del modelo.
- Codex: `shouldDisableShellTool()` solo deshabilita `shell_tool` para QA. Los otros cuatro roles
  disponen hoy de shell nativo, sin worker aislado.
- Los componentes de 015A viven en `spikes/feature-015a/` y no están integrados en los Executors.

Así, 015A es una capacidad validada pero no operativa. Al habilitar OAuth, un proceso que reúna
credencial y tools con acceso al worktree/egress reabriría el canal de exfiltración que 015A busca
eliminar.

---

# 3. Functional Goal

Cada uno de los cinco roles, con Claude Code o Codex, ejecuta toda tool de filesystem, shell o red
expuesta al modelo exclusivamente mediante el worker aislado de FEATURE-015A. El holder conversa
con el proveedor y conserva la credencial, pero no monta el worktree. El worker monta el worktree
con la política del rol, pero nunca recibe credenciales ni acceso al holder/control plane.

Un run mantiene su comportamiento de negocio y sus artefactos esperados. No se promete identidad
byte-a-byte con las tools nativas: la paridad se define por los contratos y escenarios de esta
Feature.

---

# 4. Scope

## Included

1. Productizar bajo `src/` los artefactos de 015A: supervisor por invocación, holder, worker,
   endpoint MCP Claude, controlador/proxy Codex, canal autenticado, lifecycle y fail-closed.
2. Implementar siete tools reales sobre el protocolo v1 de 015A: `fs_read`, `fs_search`,
   `fs_glob`, `fs_write`, `fs_edit`, `command_exec` y `web_fetch`.
3. Aplicar un catálogo cerrado y un nivel de egress por rol, independiente del proveedor.
4. Claude Code: deshabilitar tools nativas y exponer únicamente las tools MCP del rol.
5. Codex: deshabilitar siempre `shell_tool` y exponer únicamente las `dynamicTools` del rol.
6. Cubrir las diez combinaciones (cinco roles × dos proveedores).
7. Actualizar prompts de rol solo en lo necesario para describir los nombres/contratos nuevos.

## Excluded

1. Cambiar el schema holder↔worker, la autenticación del canal, fencing o pinning aceptados en
   015A. Su materialización productiva sí está incluida.
2. `authMode`; pertenece a FEATURE-016.
3. Allowlist de dominios para egress público, descartada como bloqueante en 015A.
4. Repetir las Etapas 1/2/3 completas de 015A. Se valida la integración con los criterios de esta
   Feature.
5. `web_search`: requiere elegir/autenticar un backend de búsqueda o delegar en una capacidad
   server-side, rompiendo el contrato agnóstico. Esta versión permite fetch de URLs conocidas.
6. Reintroducir Bash en QA. `TestExecutor` continúa ejecutando el comando de prueba sin red.

## Future ideas

- Allowlist de dominios.
- `web_search` agnóstico, una vez aprobado su backend y modelo de credenciales.
- Hooks `PreToolUse` como defensa en profundidad.

---

# 5. Functional Rules

1. No hay acceso directo a tools nativas de filesystem, shell o red. Toda tool del modelo pasa por
   holder↔worker.
2. La política se define por rol, no por proveedor.
3. Catálogo cerrado:

   | Rol | Tools |
   |---|---|
   | Architect | `fs_read`, `fs_search`, `fs_glob`, `web_fetch` |
   | Functional | `fs_read`, `fs_search`, `fs_glob`, `web_fetch` |
   | Planning | `fs_read`, `fs_search`, `fs_glob`, `web_fetch` |
   | QA | `fs_read`, `fs_search`, `fs_glob` |
   | Developer | `fs_read`, `fs_search`, `fs_glob`, `fs_write`, `fs_edit`, `command_exec`, `web_fetch` |

4. El catálogo se valida al construir la invocación y nuevamente en el worker. Tool no autorizada
   produce `TOOL_NOT_FOUND`; nunca fallback nativo.
5. Toda ruta se interpreta respecto del worktree canónico. Se rechazan rutas absolutas, `..`,
   escapes por symlink y resoluciones finales fuera del worktree. Solo Developer puede escribir.
6. `command_exec` recibe `program`, `args[]`, `cwd` relativo y `timeoutMs`; el worker usa
   `spawn(..., {shell:false})`. Solo Developer posee esta tool.
7. `web_fetch` acepta solo HTTPS y `GET`/`HEAD`; valida cada resolución y redirect, y rechaza
   loopback, link-local, metadata endpoints, redes privadas y destinos no públicos. No acepta
   cookies, body ni headers de autenticación. “Egress amplio” significa sin allowlist de dominios,
   no acceso a redes internas.
8. Rigen los límites de 015A: 10 MiB/frame, 120 s/call y 500 calls/invocación. Al excederlos se
   devuelve truncamiento seguro o `tool_error`, nunca buffers sin límite.
9. El protocolo v1 entrega un resultado terminal por tool. No se agrega streaming incremental de
   stdout/body en 015B; el streaming de progreso de fase existente puede continuar.
10. Error de worker, bridge, validación, timeout o canal falla cerrado y termina la fase; no se
    rehabilitan tools nativas.

---

# 6. Estrategia Algorítmica

No hay optimización. La asignación rol→catálogo es determinística según la tabla de la Regla 3.

---

# 7. Technical Considerations

## 7.1 Componentes

Se crea un módulo compartido bajo `src/executor/isolated-tools/` (nombre orientativo) con:

- policy matrix;
- schemas de args/results;
- validación de paths, symlinks, URLs y límites;
- supervisor/lifecycle;
- worker;
- bridge MCP Claude;
- controlador/proxy app-server Codex.

El schema `docs/features/schemas/FEATURE-015A-holder-worker-protocol.schema.json` es la fuente de
verdad del transporte y no se duplica.

## 7.2 Contratos de tools v1

Todos usan JSON Schema con `additionalProperties:false`:

- `fs_read`: `{path, offset?, limitBytes?}` →
  `{content, bytesRead, truncated}`. Binarios se rechazan.
- `fs_search`: `{pattern, path?:".", glob?, maxMatches?}` →
  `{matches:[{path,line,column,text}], truncated}`. No acepta flags arbitrarios.
- `fs_glob`: `{pattern, path?:".", maxResults?}` → `{paths, truncated}`.
- `fs_write`: `{path, content, createOnly?}` → `{bytesWritten}`.
- `fs_edit`: `{path, oldText, newText, replaceAll?}` →
  `{replacements, bytesWritten}`. Falla si la coincidencia no es determinística.
- `command_exec`: `{program, args?, cwd?:".", timeoutMs?}` →
  `{exitCode, stdout, stderr, timedOut, truncated}`.
- `web_fetch`: `{url, method?:"GET"|"HEAD", timeoutMs?, maxBytes?}` →
  `{finalUrl,status,headers,contentType,body,truncated}`. Solo retorna headers allowlisted:
  `content-type`, `content-length`, `last-modified`, `etag`.

Los máximos concretos se implementan como constantes testeadas, reservando margen de serialización
por debajo de 10 MiB.

## 7.3 Claude Code

`resolveTools()` deja de habilitar tools nativas. Por invocación se genera una config MCP efímera
con un único servidor `stdio`; se usa `--strict-mcp-config`, y `--tools`/`--allowedTools` contienen
exclusivamente `mcp__orchestrator_worker__<tool>` para el rol. Config y temporales se eliminan en
`finally`.

La evidencia de 015A demostró que enumerar explícitamente la tool MCP es necesario; `--tools ""`
no conserva el inventario esperado en Claude Code 2.1.212.

## 7.4 Codex

No se intercepta ni emula `shell_tool`: se deshabilita con `features.shell_tool=false`.
El proxy inicia `thread/start` con `sandbox="read-only"`, `cwd="/holder-empty"` y el catálogo en
`dynamicTools`. Ante `item/tool/call`, valida nombre/args, crea `tool_call`, delega al worker y
responde por JSON-RPC.

Se mantienen `experimentalApi:true`, el proxy fail-closed y la versión/imagen fijadas por
`docker/codex-pin.json`.

## 7.5 Topología, egress y mounts

Cada fase crea holder y worker efímeros en una red privada exclusiva:

- holder: caché/credencial privada y egress al proveedor; sin worktree;
- worker: worktree RO para Architect/Functional/Planning/QA, RW para Developer; sin credenciales,
  caché, socket Docker ni control plane;
- QA worker: sin egress;
- otros workers: egress público. `web_fetch` aplica protección SSRF; Developer conserva egress
  amplio también mediante `command_exec`, riesgo ya aceptado en 015A.

Esta parametrización es necesaria para 015B y no cambia el modelo de aislamiento aprobado.

## 7.6 Lifecycle

El Executor crea la topología, espera readiness, ejecuta el turno, propaga cancelación/timeout y
destruye holder, worker, red, token y temporales en `finally`. Una falla material de readiness,
canal o cleanup se registra sanitizada y falla la fase. Ningún log contiene credenciales ni el
channel token.

## 7.7 Dependencias y ambiente

No se agrega SDK de búsqueda. Cualquier librería nueva para glob/regex debe justificarse antes de
incorporarla; se prefieren APIs de Node y capacidades ya disponibles.

Checkout de origen: VPS, porque la evidencia normativa exige Docker y CLIs Linux reales. La
notebook se actualiza solo con `git pull` tras el push, conforme al Delivery Workflow.

Fuentes de producto consultadas durante la revisión: documentación oficial de
[tools de Claude](https://platform.claude.com/docs/en/managed-agents/tools) y
[tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview). Para Codex,
015B se mantiene sobre el contrato app-server y el pin ya validados localmente por 015A; cualquier
desvío de la versión pinneada falla cerrado.

---

# 8. Validation Criteria

| Escenario | Input | Resultado esperado |
|---|---|---|
| Inventario por rol/proveedor | 10 combinaciones | Cero tools nativas; catálogo exactamente igual a la Regla 3 |
| Investigación | Architect/Functional/Planning, ambos proveedores, URL HTTPS | `web_fetch` pasa por worker y devuelve contrato equivalente |
| QA intenta red/shell | Prompt adversarial | Tool ausente/rechazada; `TestExecutor` sigue ejecutando el test |
| Developer compila | Comando real | `command_exec` conserva exit code/stdout/stderr |
| Developer edita | Crear y modificar archivo | Patch esperado solo en el worktree |
| Escape de path | Absoluta, `..`, symlink externo | `tool_error`; repo principal/ruta externa intactos |
| SSRF | Loopback, privada, link-local/metadata y redirect prohibido | `tool_error`; no conecta al destino |
| Fallo de worker/canal | Terminar proceso durante call | Falla cerrada, sin fallback y con cleanup |
| Límites | Output grande, timeout, call 501 | Truncamiento/error contractual; memoria acotada |
| Prompt injection | Caso de 015A | Worker no accede ni devuelve la credencial |
| Regresión funcional | Run completo por combinación | Artefacto y comportamiento de negocio aceptables frente al baseline |

### Validation Evidence

- Run real completo por rol y proveedor (10).
- Tests unitarios de policy matrix, schemas y las siete tools.
- Contract tests Claude MCP y Codex `dynamicTools`/`item/tool/call`.
- Integración Docker: mounts, paths/symlinks, SSRF, red por rol, cancelación, límites y cleanup.
- Inventario efectivo de tools capturado.
- Hashes antes/después del repo principal, worktree y canary de credencial.
- Tiempo de startup y pico de memoria de la topología en la VPS.
- `npm test` y `npm run build` sin regresiones.

---

# 9. Risks

- **Paridad de affordances**: tools custom no replican toda la ergonomía nativa. Mitigación:
  contratos estables, prompts mínimos y comparación E2E; no afirmar paridad byte-a-byte.
- **Codex experimental**: `dynamicTools` puede cambiar. Mitigación: pin, schemas/contract tests y
  fail-closed.
- **SSRF/DNS rebinding**: mitigación mediante validación de esquema, resolución y redirects,
  conexión solo a IP pública validada y tests negativos.
- **Egress amplio de Developer**: riesgo aceptado en 015A; el aislamiento protege la credencial,
  no convierte al worker Developer en un sandbox sin Internet.
- **Costo operativo**: holder+worker por fase aumenta startup/CPU/RAM en una VPS de 2 vCPU.
  Medirlo; si no cabe, volver al Approval Gate sin debilitar el aislamiento.
- **Cleanup parcial**: recursos huérfanos pueden acumularse. Mitigación: nombres por run,
  `finally`, supervisor y prueba de recuperación/limpieza idempotente.

---

# 10. Approval Gate

Implementación prohibida hasta aprobación humana explícita.

La revisión técnica v2 cerró los huecos conocidos. El documento queda listo para revisión del
Architect/owner, quienes deben confirmar antes del Approval Gate:

1. que 015B incluye productizar el runtime de 015A, no solo modificar Executors;
2. que `web_fetch` sin `web_search` cubre la red inicial;
3. que la matriz cerrada de tools por rol es correcta;
4. que la VPS es checkout de origen y ambiente obligatorio de validación.

---

## Trazabilidad de la revisión

Codex corrigió: estado real de QA; diferencia entre spikes y runtime productivo; omisión de
`Write/Edit`; contratos y catálogo; lifecycle; SSRF; topología/egress; validación proporcional; y
la falsa necesidad de interceptar `shell_tool` en Codex, que se deshabilita y reemplaza por
`dynamicTools`.

El Architect y el owner revisan esta v2 antes de aprobar implementación.
