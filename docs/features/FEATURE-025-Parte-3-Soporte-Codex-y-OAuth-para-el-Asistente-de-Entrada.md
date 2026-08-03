# FEATURE-025-Parte-3 — Soporte Codex y OAuth para el Asistente de Entrada

# 1. Feature Identity

* **Name:** Soporte Codex y OAuth para el Asistente de Entrada
* **Type:** Ampliación de integración / mapeo de intake
* **Owner:** Asdrubal Pérez
* **Status:** Aprobado — en implementación (2026-08-03)
* **Priority:** Media
* **Approval Gate:** Abierto — aprobado por el owner tras la decisión de arquitectura documentada en 3.1 (OAuth reutiliza el holder Docker de los roles reales; API key mantiene el camino HTTP directo)
* **Dependencias:**

  * FEATURE-025 Parte 1 — implementada
  * FEATURE-025 Parte 2 — implementada y validada

---

# 2. Problem Statement

El Asistente de Entrada transforma el texto libre aportado por el usuario en los campos estructurados del caso de negocio.

Este mapeo se realiza actualmente mediante:

```text
src/intake/mapBusinessCase.ts
```

El módulo:

* construye un prompt mediante `buildMappingPrompt`;
* llama directamente a Anthropic Messages API;
* recibe una respuesta textual;
* la transforma y valida mediante `parseMappingResponse`;
* no utiliza el pipeline de agentes;
* no utiliza tools;
* no utiliza `ClaudeCodeExecutor` ni `CodexExecutor`;
* no utiliza la arquitectura holder/worker.

FEATURE-025 Parte 1 incorporó `"intake"` como un sexto rol configurable y permitió resolver para él:

* proveedor;
* modelo;
* modo de autenticación;
* API key propia.

Sin embargo, el camino de ejecución continúa soportando únicamente:

```text
Claude + api_key
```

Cuando la configuración efectiva del rol `intake` selecciona:

```text
Codex + api_key
Claude + cli_session
Codex + cli_session
```

`mapIntakeText` produce actualmente un corte técnico explícito mediante:

* `IntakeMappingProviderUnsupportedError`;
* `IntakeMappingAuthModeUnsupportedError`.

Este comportamiento es deliberado: impide intentar una integración que todavía no existe.

FEATURE-025 Parte 3 debe completar la matriz de configuraciones soportadas para el Asistente de Entrada sin convertir el mapeo en un pipeline completo ni duplicar la lógica de los Executors.

---

# 3. Functional Goal

Después de implementar esta Feature, el Asistente de Entrada podrá ejecutar el mismo mapeo estructurado utilizando cualquiera de estas combinaciones:

| Proveedor | API key propia | Sesión OAuth personal |
| --------- | -------------: | --------------------: |
| Claude    |             Sí |                    Sí |
| Codex     |             Sí |                    Sí |

El comportamiento funcional será equivalente para las cuatro combinaciones:

1. Recibir texto libre.
2. Construir el mismo contrato de mapeo.
3. Solicitar al modelo una respuesta JSON.
4. Validar y normalizar la respuesta.
5. Aplicar las restricciones de dominio existentes.
6. Devolver los campos mapeados.
7. No crear un run de pipeline.
8. No habilitar tools.
9. No exponer credenciales al modelo ni al navegador.
10. No utilizar credenciales globales.
11. No realizar fallback a otro proveedor o modo de autenticación.

La configuración efectiva se seguirá resolviendo mediante:

```text
resolveAgentConfig(userId, "intake")
```

La autenticación se resolverá mediante la infraestructura entregada por FEATURE-025 Parte 1 y Parte 2.

## 3.1 Decisión de arquitectura: API key vs OAuth no se tratan igual

Revisión técnica posterior a la primera versión de este documento (2026-08-03): las cuatro
combinaciones **no** comparten el mismo nivel de riesgo, y forzarlas a los cuatro adaptadores
simétricos que proponía la versión anterior de este documento habría sido peor para la seguridad
real, no mejor.

**API key (Claude y Codex): sin cambios respecto al planteo original.** Una API key es un secreto
que viaja como header en una única llamada HTTP puntual — no se materializa como archivo, no queda
ningún estado reutilizable si algo sale mal. El camino liviano (`fetch` directo, sin Docker, sin
CLI) ya es proporcional al riesgo real.

**OAuth (Claude y Codex): cambia respecto al planteo original.** Una sesión OAuth personal *sí* se
materializa como un archivo real en disco mientras el CLI corre (`.credentials.json`/`auth.json`,
infraestructura de Parte 2). El planteo original de este documento (secciones 5.8/5.9/7.8/7.9 en su
versión anterior) proponía correr `claude`/`codex app-server` **directamente en el host**, fuera de
Docker — el mismo patrón que ya usan los adaptadores de login de Parte 2
(`claudeLoginAdapter.ts`/`codexLoginAdapter.ts`). La diferencia real: el login nunca procesa texto
libre aportado por el usuario como prompt; el mapeo de intake sí, por definición. Sin tools no hay
manera de que una inyección de prompt escale a ejecución de código o acceso a filesystem — pero la
sesión OAuth materializada queda en un proceso del host expuesto a texto no confiable de todos
modos, sin la capa de aislamiento que ya existe y se usa para los 5 roles reales.

**Decisión:** los caminos OAuth reutilizan el mismo contenedor Docker (misma imagen, mismos flags
de seguridad: `--read-only`, `--cap-drop ALL`, `--security-opt no-new-privileges`, tmpfs) que ya usan
`ClaudeCodeExecutor`/`CodexExecutor` para los 5 roles reales — pero **sin worker, sin MCP, sin
ninguna tool registrada**. No hay nada que "tenga" el modelo más allá de generar texto; el
contenedor existe únicamente como caja fuerte para la credencial OAuth materializada mientras dura
la llamada, no porque el mapeo necesite ninguna otra pieza de la maquinaria de un rol de pipeline
(no hay `PhaseInvocation`, no hay `PhaseResult`, no hay artifact, no hay worktree, no hay run). Este
es un holder sin worker — la mitad de la arquitectura holder/worker de FEATURE-015A que ya existe,
reutilizada tal cual, sin construir nada nuevo a nivel de aislamiento.

Esto **no** significa reutilizar `ClaudeCodeExecutor.runPhase`/`CodexExecutor.runPhase` como caja
negra (`AgentRole` es un union cerrado de los 5 roles reales; `PhaseInvocation`/`PhaseResult` traen
semántica de escalamiento/artifact que no aplica acá) — significa reutilizar las primitivas de bajo
nivel ya construidas (resolución de binario, construcción de `docker run` con los flags de
seguridad ya validados, protocolo JSON-RPC de Codex app-server, materialización/recolección/CAS de
Parte 2) en un adaptador propio y chico, dedicado a intake. El contrato de prompt/respuesta sigue
siendo exactamente `buildMappingPrompt`/`parseMappingResponse` (sección 5.4/5.5) para las cuatro
combinaciones por igual — no se introduce una convención `ESTADO`/`ARTEFACTO` nueva solo para esto,
esa convención existe en los 5 roles reales por necesidades (escalamiento, roadmap) que el mapeo de
intake no tiene.

---

# 4. Scope

## Included

### Matriz completa de ejecución

* Claude con API key propia.
* Codex con API key propia.
* Claude con sesión OAuth personal.
* Codex con sesión OAuth personal.

### Contrato común de mapeo

* Conservación de `buildMappingPrompt`.
* Conservación de `parseMappingResponse`.
* Conservación de `BusinessCaseValues`.
* Conservación de la validación específica de `tipo_solucion`.
* Conservación de los valores manuales previos.
* Respuesta exclusivamente estructurada.
* Validación server-side del resultado.

### Adaptadores de proveedor

Ver 3.1: API key y OAuth no comparten arquitectura.

* Adaptador HTTP de Anthropic (existente, sin cambios de fondo).
* Adaptador HTTP de OpenAI para API key (nuevo, sin Docker, sin CLI).
* Adaptador Claude OAuth vía holder Docker sin worker (nuevo).
* Adaptador Codex OAuth vía holder Docker sin worker (nuevo).
* Selección interna por proveedor y modo.
* Contrato de salida común (`buildMappingPrompt`/`parseMappingResponse`, sin excepción).

### Autenticación

* API key resuelta para el usuario.
* Conexión OAuth resuelta por:

  * `user_id`;
  * proveedor.
* Materialización temporal mediante la infraestructura de Parte 2.
* Persistencia de posibles refresh producidos durante el mapeo.
* Cleanup de sesiones temporales.

### Seguridad

* Ningún fallback a credenciales globales.
* Ningún acceso al caché OAuth legacy.
* Ninguna API key en logs.
* Ningún blob OAuth en logs.
* Ningún token en errores.
* Tools deshabilitadas.
* Sin acceso al workspace del proyecto.
* Sin acceso a repositorios.
* Sin creación de worktree.
* Directorio de trabajo vacío y temporal para caminos CLI.

### Errores funcionales

* Proveedor no soportado.
* Modelo incompatible.
* API key ausente.
* Conexión OAuth ausente.
* Reautenticación requerida.
* Respuesta inválida.
* Contrato CLI incompatible.
* Timeout del mapeo.
* Error remoto del proveedor.

### UI

* Eliminación de mensajes que indiquen que Codex u OAuth no están soportados.
* Visualización de errores reales de conexión o configuración.
* Identificación anticipada de una configuración incompleta.
* Conservación del flujo actual de revisión y confirmación.

## Excluded

* Convertir `intake` en una fase del pipeline.
* Crear un run para realizar el mapeo.
* Utilizar Architect, Functional u otro rol para mapear.
* Agregar tools al Asistente de Entrada.
* Permitir acceso al repositorio durante el mapeo.
* Reutilizar todo `ClaudeCodeExecutor` o `CodexExecutor` como caja negra.
* Crear un nuevo Executor formal para `intake`.
* Crear un framework genérico de inferencia para proveedores futuros.
* Streaming de resultados de mapeo.
* Conversación multi-turn con el Asistente de Entrada.
* Preguntas de seguimiento generadas por el modelo.
* Cambios al formulario o a los campos de intake.
* Cambios a la lógica de completitud.
* Cambios al flujo de confirmación del caso.
* Cambios a FEATURE-025 Parte 2.
* Browser callback alternativo de Codex.
* Fallback automático entre:

  * Claude y Codex;
  * OAuth y API key;
  * modelos distintos.
* Garantizar resultados textualmente idénticos entre proveedores.

## Future ideas

* Métricas de calidad comparadas entre proveedores.
* Selección automática de modelo económico.
* Reintento opcional con el mismo proveedor ante JSON inválido.
* Uso de structured outputs nativos cuando exista un contrato estable común.
* Soporte para otros proveedores.
* Sesión conversacional de refinamiento del intake.

---

# 5. Functional Rules

## 5.1 Resolución de configuración

1. El rol utilizado siempre es:

```text
intake
```

2. La configuración se obtiene mediante el mismo mecanismo que el resto de los agentes.
3. La precedencia sigue siendo:

   * override de `intake`;
   * configuración global;
   * defaults vigentes.
4. La configuración efectiva contiene:

   * provider;
   * model;
   * auth mode.
5. No se mezclan valores de configuraciones diferentes.
6. El mapper no modifica la configuración.

## 5.2 Matriz de selección

La implementación debe seleccionar exactamente un camino:

```text
claude + api_key
  → Anthropic HTTP Mapping Adapter

codex + api_key
  → OpenAI HTTP Mapping Adapter

claude + cli_session
  → Claude OAuth Mapping Adapter

codex + cli_session
  → Codex OAuth Mapping Adapter
```

Una combinación desconocida debe fallar antes de invocar un proveedor.

## 5.3 Sin fallback

1. Codex no puede caer a Claude.
2. Claude no puede caer a Codex.
3. OAuth no puede caer a API key.
4. API key no puede caer a OAuth.
5. Un modelo incompatible no puede sustituirse silenciosamente.
6. Una conexión ausente debe producir un error accionable.
7. Una respuesta inválida no puede disparar otro proveedor automáticamente.

## 5.4 Contrato del prompt

1. `buildMappingPrompt` continúa siendo la fuente de verdad.
2. Todos los adaptadores reciben el mismo contenido semántico:

   * instrucciones de sistema;
   * texto del usuario;
   * definición de campos;
   * valores previos;
   * reglas de `tipo_solucion`.
3. Las diferencias de formato necesarias por proveedor permanecen dentro del adaptador.
4. Ningún adaptador puede relajar las reglas funcionales del prompt.
5. El modelo no debe dialogar ni realizar preguntas.
6. El modelo debe responder únicamente con el objeto requerido.

## 5.5 Contrato de salida

1. Todos los adaptadores devuelven texto.
2. El texto se procesa mediante `parseMappingResponse`.
3. No se confía en el proveedor para validar el dominio.
4. Solo se conservan las claves definidas en `intake_field_definitions`.
5. Strings vacíos se convierten en `null`.
6. Valores inválidos de `tipo_solucion` se convierten en `null`.
7. Campos adicionales devueltos por el modelo se ignoran.
8. Un JSON no válido produce un error de mapeo.
9. No se persiste un resultado parcial automáticamente.

## 5.6 Claude con API key

1. Conserva el camino HTTP existente.
2. Utiliza la API key propia del usuario.
3. Utiliza el modelo efectivo de `intake`.
4. No consulta `ANTHROPIC_API_KEY`.
5. No cambia el comportamiento actual salvo por refactor interno del adaptador.
6. Debe existir cobertura de regresión.

## 5.7 Codex con API key

1. Utiliza la API oficial de OpenAI mediante una llamada HTTP server-side.
2. Utiliza la API key propia del usuario.
3. Utiliza el modelo efectivo configurado para `intake`.
4. No utiliza `CodexExecutor`.
5. No inicia Codex app-server.
6. No materializa una sesión OAuth.
7. No habilita tools.
8. Debe solicitar una respuesta textual compatible con `parseMappingResponse`.
9. El endpoint y contrato utilizados deben corresponder a la versión oficial soportada al implementar.
10. La respuesta del proveedor debe normalizarse dentro del adaptador.

## 5.8 Claude con OAuth

1. Resuelve la conexión personal de Claude del usuario (`resolveOAuthConnection`, Parte 2).
2. Materializa un `CLAUDE_CONFIG_DIR` temporal mediante `materializeOAuthSession` (Parte 2), igual
   que los 5 roles reales.
3. **Ejecuta `claude -p` dentro del mismo contenedor Docker (misma imagen, mismos flags de
   seguridad) que usa `ClaudeCodeExecutor` para los roles reales — nunca directamente en el host**
   (ver 3.1). El directorio materializado se monta escribible dentro del contenedor, no se accede
   desde el proceso del Orquestador.
4. No utiliza `--bare` (deshabilita OAuth de raíz, mismo hallazgo que Parte 2).
5. Utiliza `--setting-sources ""` (mismo criterio que Parte 2).
6. No monta MCP, no registra ningún servidor MCP, no pasa `--tools` ni `--allowedTools`.
7. Mantiene las restricciones vigentes de FEATURE-016 y Parte 2 (allowlist de entorno, sin
   `process.env` completo).
8. **No arranca worker** — no hay tools que servir, así que no hace falta la mitad
   worker/socket/MCP-bridge de la arquitectura holder/worker (FEATURE-015A). Solo el holder.
9. El prompt es directamente `buildMappingPrompt` (system + user), pasado vía `--system-prompt` y
   como argumento posicional — no la convención `ESTADO`/`ARTEFACTO` de los roles reales.
10. Utiliza un `--workdir` vacío y temporal dentro del contenedor (`tmpfs`), nunca el worktree de
    un proyecto — no hay proyecto en juego en este punto del flujo.
11. Recoge exclusivamente el campo `.result` de la respuesta JSON del CLI, y lo procesa con
    `parseMappingResponse`.
12. Recoge y promueve cambios de `.credentials.json` mediante `collectAndPromoteOAuthSession`
    (Parte 2, CAS).
13. Limpia el temporal materializado en `finally` (`cleanupMaterializedOAuthSession`, Parte 2).

## 5.9 Codex con OAuth

1. Resuelve la conexión personal Codex del usuario (`resolveOAuthConnection`, Parte 2).
2. Materializa un `CODEX_HOME` temporal y escribible mediante `materializeOAuthSession` (Parte 2).
3. **Inicia `codex app-server` dentro del mismo contenedor Docker (misma imagen pineada, mismos
   flags de seguridad) que usa `CodexExecutor` para los roles reales — nunca directamente en el
   host** (ver 3.1).
4. Comprueba la sesión mediante:

```text
account/read
```

5. No ejecuta:

```text
account/login/start
```

6. El login pertenece exclusivamente a la pantalla de conexiones.
7. `thread/start` se invoca con `dynamicTools: []` — cero tools disponibles, no una lista filtrada.
8. **No arranca worker** — mismo criterio que 5.8.8: sin tools que servir, no hace falta la mitad
   worker/socket de la arquitectura holder/worker; solo el holder.
9. El prompt del turno es directamente `buildMappingPrompt` (system + user combinados en el input
   del turno) — no la convención `ESTADO`/`ARTEFACTO`/`outputSchema` de `PHASE_RESULT_SCHEMA` que
   usan los roles reales.
10. Utiliza `cwd: "/holder-empty"` (tmpfs), igual que los roles reales — no hay repositorio.
11. Recoge la respuesta textual acumulando `item/agentMessage/delta` hasta `turn/completed` (mismo
    mecanismo ya usado por `CodexExecutor`), y la procesa con `parseMappingResponse`.
12. Recoge y promueve cambios de `auth.json` mediante `collectAndPromoteOAuthSession` (Parte 2, CAS).
13. Limpia el temporal materializado en `finally` (`cleanupMaterializedOAuthSession`, Parte 2).

## 5.10 Tools y capacidades

1. El Asistente de Entrada no necesita tools.
2. Los adaptadores OAuth no arrancan worker (ver 3.1/5.8.8/5.9.8) — no hay MCP ni ningún canal por
   el que el modelo pueda pedir una tool, no solo una lista vacía dentro de un mecanismo que sigue
   presente.
3. No debe existir acceso a:

   * shell;
   * filesystem del proyecto;
   * MCP;
   * Git;
   * artifacts;
   * bases de datos;
   * navegación.
4. El modelo solo recibe el prompt de mapeo.
5. La salida textual es el único canal esperado.

## 5.11 Directorio de trabajo

Para caminos OAuth:

1. Crear un directorio temporal exclusivo.
2. No utilizar el repositorio del proyecto.
3. No utilizar el directorio del Orquestador.
4. No incluir archivos de configuración del proyecto.
5. Evitar auto-discovery de instrucciones o contexto externo.
6. Eliminarlo al terminar.

## 5.12 Refresh OAuth

1. El mapeo puede provocar un refresh.
2. Se reutiliza la coordinación de Parte 2.
3. Claude mantiene single-flight.
4. Codex mantiene CAS y la coordinación definida.
5. El adaptador no implementa otra estrategia de refresh.
6. Un refresh irrecuperable produce `reauth_required`.
7. El usuario debe autenticarse nuevamente desde Configuración.
8. No se solicita autenticación dentro del flujo de intake.

## 5.13 Timeouts

1. Todo mapeo tendrá timeout.
2. El timeout debe ser independiente del pipeline.
3. Al vencer:

   * cancelar la solicitud HTTP; o
   * terminar el proceso/app-server.
4. Limpiar temporales.
5. No persistir resultados incompletos.
6. No dejar procesos huérfanos.
7. El mensaje debe permitir reintentar el mapeo.

## 5.14 Errores de configuración

Antes de invocar:

* validar provider;
* validar model;
* validar auth mode;
* validar credencial o conexión;
* validar contrato disponible.

Si falla:

* no invocar al proveedor;
* devolver error distinguible;
* no transformar el error en un 500 genérico;
* no mostrar secretos.

## 5.15 Errores del proveedor

Los adaptadores deben normalizar como mínimo:

```text
intake_mapping_authentication_required
intake_mapping_model_unsupported
intake_mapping_rate_limited
intake_mapping_provider_unavailable
intake_mapping_timeout
intake_mapping_invalid_response
intake_mapping_failed
```

Los cuerpos completos de error de los proveedores no deben enviarse directamente a la UI si contienen datos sensibles o internos.

## 5.16 Idempotencia funcional

1. El mapeo no persiste un run.
2. Repetirlo puede generar variaciones de redacción.
3. El resultado solo se vuelve definitivo cuando el usuario confirma el formulario.
4. Un fallo no modifica valores ya completados.
5. `previousValues` continúa preservando entradas manuales.

## 5.17 Observabilidad

Puede registrarse:

* proveedor;
* modelo;
* auth mode;
* user ID interno;
* duración;
* resultado;
* categoría de error;
* si hubo refresh;
* versión de sesión inicial y final.

No puede registrarse:

* prompt completo con información sensible, salvo política explícita;
* texto completo del caso en logs normales;
* API key;
* access token;
* refresh token;
* blob OAuth;
* respuesta bruta en errores visibles;
* identificadores externos de cuenta.

---

# 6. Estrategia Algorítmica

## 6.1 Flujo general

```text
Usuario solicita mapear
        ↓
Cargar campos de intake
        ↓
Resolver AgentConfig para "intake"
        ↓
Validar provider/model/authMode
        ↓
Seleccionar Mapping Adapter
        ↓
Resolver autenticación necesaria
        ↓
Construir prompt común
        ↓
Invocar proveedor
        ↓
Obtener texto
        ↓
parseMappingResponse
        ↓
Devolver fields + values
```

## 6.2 Selección de adaptador

```ts
type IntakeMappingProvider = "claude" | "codex";
type IntakeMappingAuthMode = "api_key" | "cli_session";

interface IntakeMappingRequest {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  timeoutMs: number;
}

interface IntakeMappingAdapter {
  map(request: IntakeMappingRequest): Promise<string>;
}
```

Selección conceptual:

```ts
function selectIntakeMappingAdapter(
  provider: IntakeMappingProvider,
  authMode: IntakeMappingAuthMode
): IntakeMappingAdapter;
```

No se recomienda una jerarquía más amplia ni registro dinámico de proveedores.

## 6.3 API key

```text
Resolver API key propia
        ↓
Construir adaptador HTTP
        ↓
Enviar prompt
        ↓
Normalizar texto
        ↓
Parsear
```

## 6.4 OAuth

```text
Resolver conexión personal
        ↓
Coordinar refresh si corresponde
        ↓
Materializar sesión temporal
        ↓
Levantar holder Docker (misma imagen/flags que los roles reales, sin worker)
        ↓
Ejecutar CLI/app-server dentro del contenedor, sin tools, cwd vacío (tmpfs)
        ↓
Recoger texto
        ↓
Recoger sesión actualizada
        ↓
Promover mediante CAS
        ↓
Limpiar temporales y detener el contenedor
        ↓
Parsear
```

## 6.5 Fallo de parsing

```text
Respuesta recibida
        ↓
parseMappingResponse
        ↓
¿JSON válido?
   ├─ Sí → devolver valores
   └─ No → intake_mapping_invalid_response
```

No hay fallback automático a otro proveedor.

---

# 7. Technical Considerations

## 7.1 Refactor de `mapBusinessCase.ts`

Actualmente el módulo combina:

* construcción del prompt;
* parsing;
* llamada HTTP específica de Anthropic.

Debe separarse con cambio mínimo.

Mantener:

```text
buildMappingPrompt
parseMappingResponse
completenessPercent
BusinessCaseValues
```

Mover la invocación específica de Anthropic a un adaptador.

El orquestador del mapping puede permanecer en el mismo módulo o en uno pequeño y explícito.

## 7.2 Estructura sugerida

Sin obligación sobre nombres definitivos:

```text
src/intake/
  mapBusinessCase.ts
  intakeMappingAdapters.ts
  anthropicApiMappingAdapter.ts
  openAiApiMappingAdapter.ts
  claudeOAuthMappingAdapter.ts
  codexOAuthMappingAdapter.ts
```

Evitar crear muchos archivos si la implementación resulta pequeña. Puede agruparse por modo o proveedor cuando mejore la claridad.

## 7.3 `mapIntakeText`

Debe dejar de cortar de forma general por:

* provider distinto de Claude;
* auth mode distinto de API key.

Nuevo flujo:

1. Resolver config.
2. Seleccionar adaptador.
3. Resolver la autenticación requerida.
4. Ejecutar mapping.
5. Devolver fields y values.

Los errores actuales:

```text
IntakeMappingProviderUnsupportedError
IntakeMappingAuthModeUnsupportedError
```

pueden:

* eliminarse si ya no tienen casos posibles;
* o conservarse únicamente para valores futuros desconocidos.

## 7.4 Reutilización de Parte 1

Para API key debe reutilizarse la resolución ya existente.

No debe introducirse:

* otra tabla;
* otro cifrado;
* otra prioridad;
* otra forma de buscar credenciales.

## 7.5 Reutilización de Parte 2

Para OAuth deben reutilizarse:

* resolución de conexión;
* estados `connected` / `reauth_required`;
* materialización;
* single-flight;
* CAS;
* recolección;
* cleanup;
* errores funcionales.

No duplicar estas responsabilidades dentro de los adaptadores de intake.

## 7.6 Claude API adapter

El comportamiento existente debe preservarse:

* endpoint Messages;
* versión de API;
* headers;
* modelo efectivo;
* límite de salida suficiente;
* extracción del bloque textual.

Los valores concretos deben permanecer centralizados.

## 7.7 OpenAI API adapter

Debe:

* utilizar la API oficial vigente;
* autenticar con la API key propia;
* solicitar una única salida textual;
* deshabilitar tools;
* limitar el output;
* normalizar la respuesta;
* respetar timeout y cancelación.

No añadir el SDK oficial si `fetch` resulta suficiente y consistente con el repositorio.

La decisión SDK frente a `fetch` corresponde al cambio mínimo:

* si no existe SDK instalado y la llamada es simple, preferir `fetch`;
* no añadir una dependencia solo para una invocación.

## 7.8 Claude OAuth adapter

Ver 3.1: **sí** corre dentro del holder Docker de `ClaudeCodeExecutor` (misma imagen
`ai-orchestrator-developer:latest`, mismos flags `--read-only`/`--cap-drop ALL`/
`--security-opt no-new-privileges`/tmpfs) — a diferencia de un adaptador puramente HTTP, la
credencial OAuth materializada no puede quedar expuesta a un proceso del host recibiendo texto no
confiable como prompt.

No reutilizar directamente `ClaudeCodeExecutor.runPhase`, porque el mapper:

* no tiene `PhaseInvocation` (`AgentRole` es un union cerrado de los 5 roles reales, `intake` no
  pertenece a ese tipo);
* no produce `PhaseResult`;
* no usa artifacts;
* no necesita worker (sin tools, no hay nada que ese proceso deba servir).

Sí debe reutilizar utilidades internas de bajo nivel ya construidas y validadas:

* `resolveClaudeBinary` (para el binario dentro de la imagen, si aplica) y los mismos flags de
  `docker run` que ya usa `runRoleIsolated`;
* construcción segura del entorno (mismo allowlist, nunca `process.env` completo);
* `materializeOAuthSession`/`collectAndPromoteOAuthSession`/`cleanupMaterializedOAuthSession`
  (Parte 2), tal cual;
* parsing de la respuesta JSON del CLI (extraer `.result`), sin la convención `ESTADO`/`ARTEFACTO`.

No realizar un refactor amplio del Executor únicamente para evitar unas pocas líneas repetidas —
el adaptador de intake es su propia función chica, con su propio array de argumentos de
`docker run`, sin montar `worker.socketDirectory`/`roleMcpBridgePath()`/`mcp.json`.

## 7.9 Codex OAuth adapter

Ver 3.1: **sí** corre dentro del holder Docker de `CodexExecutor` (misma imagen pineada
`feature015a-codex-pin-candidate:0.145.0`, mismos flags de seguridad) — mismo criterio que 7.8.

No reutilizar directamente `CodexExecutor.runPhase` (mismas razones que 7.8: `PhaseInvocation`,
`PhaseResult`, `PHASE_RESULT_SCHEMA` no aplican).

Debe reutilizar el protocolo JSON-RPC del app-server, con un flujo específico y sin worker:

1. arrancar `codex app-server --listen stdio://` dentro del contenedor;
2. `initialize` → `initialized`;
3. comprobar la sesión con `account/read` (nunca `account/login/start`);
4. `thread/start` con `dynamicTools: []` (cero tools, no una lista filtrada) y `cwd: "/holder-empty"`;
5. `turn/start` con el prompt de `buildMappingPrompt` como input — sin `outputSchema` de
   `PHASE_RESULT_SCHEMA`;
6. acumular `item/agentMessage/delta` hasta `turn/completed` (mismo mecanismo que ya usa
   `CodexExecutor` para recoger la respuesta final);
7. cerrar el proceso limpiamente.

No iniciar login. No registrar ningún método `item/tool/call` — al no anunciar `dynamicTools`, el
app-server no debería intentar invocar ninguna, pero el adaptador igual debe responder cualquier
solicitud inesperada de forma segura (denegar) en vez de asumir que nunca puede ocurrir.

## 7.10 Aislamiento sin worker (pero con holder)

La ausencia de **worker** es aceptable porque:

* no existen tools que servir;
* no se ejecuta código generado;
* no se monta el workspace;
* no se entrega filesystem del proyecto;
* el proceso solo produce texto.

El **holder** (contenedor Docker) sí se mantiene para los caminos OAuth, precisamente porque:

* la sesión OAuth se materializa como archivo real, a diferencia de una API key;
* el contenido que el modelo procesa es texto libre no confiable del usuario;
* reutilizar el mismo aislamiento ya validado para los 5 roles reales es más simple y más seguro
  que argumentar por qué un proceso del host con la credencial real es igual de seguro.

Aun con holder y sin worker:

* debe ejecutarse con un entorno mínimo dentro del contenedor;
* no debe heredar `process.env` completo;
* el `cwd`/`--workdir` debe estar vacío (tmpfs, no el worktree de ningún proyecto);
* los archivos de sesión deben estar limitados al directorio OAuth materializado montado, nunca al
  caché legacy global.

## 7.11 Modelos

Cada configuración debe utilizar un modelo compatible con el proveedor.

El catálogo de Parte 1 sigue siendo la fuente de verdad.

El mapper no mantiene un segundo catálogo.

Si no existe modelo efectivo:

* utilizar el default definido por la configuración general;
* o fallar según el contrato final de Parte 1.

No conservar defaults internos contradictorios entre el mapper y `user_agent_config`.

El `DEFAULT_MAPPING_MODEL` actual debe revisarse para no saltarse la configuración centralizada.

## 7.12 Structured output

El contrato funcional continúa siendo texto JSON procesado por `parseMappingResponse`.

Puede utilizarse una capacidad nativa de structured output solo cuando:

* esté soportada por el proveedor y modelo;
* no cambie el contrato común;
* no obligue a mantener schemas divergentes complejos.

No es requisito de esta Feature.

## 7.13 Timeout configurable

Definir una configuración específica, por ejemplo:

```text
INTAKE_MAPPING_TIMEOUT_MS
```

No reutilizar timeouts largos de fases del pipeline.

Debe existir un default razonable y validado.

## 7.14 API y frontend

La ruta de mapeo existente no necesita cambiar su contrato exitoso:

```text
fields
values
```

Los errores deben mapearse a respuestas distinguibles.

La UI debe:

* conservar los valores introducidos;
* mostrar error accionable;
* dirigir a Configuración cuando falte API key o conexión OAuth;
* permitir reintentar.

## 7.15 Tests existentes y nuevos

Revisar cobertura actual de:

* `buildMappingPrompt`;
* `parseMappingResponse`;
* `mapIntakeText`;
* endpoints de intake.

Agregar cobertura de matriz:

```text
Claude + api_key
Codex + api_key
Claude + OAuth
Codex + OAuth
```

Los tests no deben requerir proveedores reales salvo validación E2E explícita.

## 7.16 Runtime afectado

Como mínimo:

* `src/intake/mapBusinessCase.ts`;
* `src/cli/intakeService.ts`;
* resolución de autenticación de Parte 1;
* runtime OAuth de Parte 2;
* cliente/protocolo Claude Code;
* cliente/protocolo Codex app-server;
* endpoints de intake;
* manejo de errores;
* UI de intake;
* tests;
* documentación de arquitectura.

## 7.17 Dependencias

### Parte 1

Proporciona:

* rol `intake`;
* provider;
* model;
* auth mode;
* API keys propias.

### Parte 2

Proporciona:

* conexión personal;
* materialización;
* refresh;
* CAS;
* cleanup;
* desconexión;
* ausencia de caché global.

Parte 3 no debe modificar estos contratos salvo corrección técnica indispensable documentada.

---

# 8. Validation Criteria

## Scenario 1 — Claude con API key

**Input**

`intake` configurado con:

* Claude;
* modelo compatible;
* API key propia.

**Expected output**

* Se usa el adaptador HTTP existente.
* El mapeo funciona igual que antes.
* No se consulta una clave global.

## Scenario 2 — Codex con API key

**Input**

`intake` configurado con Codex y API key propia.

**Expected output**

* Se invoca OpenAI mediante HTTP.
* Se usa el modelo configurado.
* Se obtiene un objeto compatible.
* No se inicia Codex CLI.

## Scenario 3 — Claude con OAuth

**Input**

`intake` configurado con Claude y `cli_session`.

**Expected output**

* Se resuelve la conexión personal.
* Se materializa `.credentials.json`.
* Se ejecuta Claude dentro del holder Docker (misma imagen que los roles reales), sin worker, sin
  MCP, sin tools.
* No se monta repositorio ni worktree de ningún proyecto.
* Se obtiene y parsea la respuesta.
* El temporal se elimina y el contenedor se detiene.

## Scenario 4 — Codex con OAuth

**Input**

`intake` configurado con Codex y `cli_session`.

**Expected output**

* Se materializa `auth.json`.
* Se ejecuta el app-server dentro del holder Docker (misma imagen pineada que los roles reales),
  sin worker.
* Se utiliza `account/read`.
* No se inicia login.
* `thread/start` se invoca con `dynamicTools: []`.
* Se obtiene y parsea el resultado.
* El temporal se elimina y el contenedor se detiene.

## Scenario 5 — API key ausente

**Expected output**

* Corte previo a la invocación.
* Error accionable.
* Sin fallback OAuth o global.

## Scenario 6 — OAuth no conectado

**Expected output**

* Error `not_connected`.
* La UI dirige a Configuración.
* No se invoca el CLI.

## Scenario 7 — Reautenticación requerida

**Expected output**

* Error `reauth_required`.
* No se ejecuta el mapeo.
* Se conserva el texto y los valores del usuario.

## Scenario 8 — Modelo incompatible

**Expected output**

* Corte antes de invocar.
* No se sustituye el modelo.

## Scenario 9 — JSON inválido Claude API

**Expected output**

* `intake_mapping_invalid_response`.
* No se persiste resultado parcial.

## Scenario 10 — JSON inválido Codex API

Mismo resultado esperado.

## Scenario 11 — JSON inválido Claude OAuth

Mismo resultado esperado.

## Scenario 12 — JSON inválido Codex OAuth

Mismo resultado esperado.

## Scenario 13 — Preservación de valores manuales

**Input**

`previousValues` contiene campos completados.

**Expected output**

* Se mantienen según el contrato actual.
* El proveedor no cambia esta regla.

## Scenario 14 — Validación de `tipo_solucion`

**Input**

El modelo devuelve un valor fuera del dominio.

**Expected output**

Se normaliza a `null` en las cuatro combinaciones.

## Scenario 15 — Campos adicionales

**Input**

El modelo devuelve claves no definidas.

**Expected output**

Se ignoran.

## Scenario 16 — Timeout HTTP

**Expected output**

* Se aborta la solicitud.
* Se devuelve error de timeout.
* No quedan recursos abiertos.

## Scenario 17 — Timeout Claude OAuth

**Expected output**

* Se termina el contenedor holder.
* Se recoge la sesión si corresponde de forma segura.
* Se elimina el temporal.

## Scenario 18 — Timeout Codex OAuth

**Expected output**

* Se termina el contenedor holder (app-server incluido).
* Se elimina el temporal.
* No queda proceso ni contenedor huérfano.

## Scenario 19 — Refresh durante Claude OAuth

**Expected output**

* Parte 2 coordina el refresh.
* Se promueve la sesión actualizada.
* El mapping termina correctamente.

## Scenario 20 — Refresh durante Codex OAuth

Mismo resultado esperado con CAS.

## Scenario 21 — Dos mappings simultáneos, usuarios distintos

**Expected output**

* Credenciales separadas.
* Temporales separados.
* Resultados independientes.

## Scenario 22 — Dos mappings simultáneos, mismo usuario

**Expected output**

* No comparten directorio.
* El refresh se coordina.
* No se corrompe la conexión.

## Scenario 23 — Sin acceso al repositorio

Para ambos caminos OAuth:

* cwd vacío (tmpfs dentro del holder);
* sin mount del proyecto;
* sin archivos del caso;
* sin Git;
* sin worker, sin MCP, sin tools.

## Scenario 24 — Ausencia de secretos

En éxito, error, timeout y refresh:

* no se registran API keys;
* no se registran tokens;
* no se registran blobs;
* no se registran códigos OAuth.

## Scenario 25 — Regresión del flujo de intake

**Expected output**

* El usuario puede mapear;
* revisar;
* editar;
* confirmar;
* crear el run pendiente;
* iniciar el pipeline.

## Scenario 26 — Provider desconocido

**Expected output**

Error técnico explícito antes de invocar.

## Scenario 27 — Auth mode desconocido

**Expected output**

Error técnico explícito antes de invocar.

## Validation Evidence

Debe aportarse:

* tests unitarios del contrato común;
* tests de los cuatro adaptadores;
* tests de selección;
* tests de errores;
* prueba de API key propia para ambos proveedores;
* prueba OAuth real para ambos proveedores;
* verificación de ausencia de tools;
* verificación de cwd vacío;
* refresh o reutilización del runtime de Parte 2;
* prueba de concurrencia;
* ausencia de secretos;
* E2E desde la pantalla de intake hasta la revisión de campos.

---

# 9. Risks

## Riesgo 1 — Diferencias de respuesta entre proveedores

Los proveedores pueden seguir las instrucciones de forma diferente.

**Mitigación**

* prompt común;
* parser común;
* validación server-side;
* criterios E2E por proveedor.

## Riesgo 2 — Uso innecesario de Executors completos

Reutilizar los Executors podría arrastrar pipeline, artifacts, MCP y workspace.

**Mitigación**

Adaptadores de mapping pequeños que reutilizan únicamente primitivas necesarias.

## Riesgo 3 — Duplicación excesiva

Cuatro caminos pueden producir código repetido.

**Mitigación**

Compartir:

* prompt;
* parser;
* errores;
* timeout;
* contrato de adaptador.

No crear una abstracción más amplia de la necesaria.

## Riesgo 4 — Fuga de OAuth

Un CLI recibe la sesión personal.

**Mitigación**

* runtime de Parte 2;
* temporal exclusivo;
* cwd vacío;
* sin tools;
* entorno mínimo;
* cleanup.

## Riesgo 5 — Auto-discovery de contexto

Los CLIs podrían leer instrucciones locales.

**Mitigación**

* cwd vacío;
* configuración explícita;
* flags ya validados;
* sin repositorio.

## Riesgo 6 — Refresh concurrente

Un mapping podría coincidir con otro run.

**Mitigación**

Reutilizar single-flight y CAS de Parte 2.

## Riesgo 7 — Modelo no adecuado para JSON

Algunos modelos pueden producir respuestas menos consistentes.

**Mitigación**

* catálogo compatible;
* prompt estricto;
* parser;
* validación real por cada modelo soportado.

## Riesgo 8 — API de OpenAI cambiante

El contrato HTTP puede evolucionar.

**Mitigación**

* encapsular en adaptador;
* contract tests;
* documentación de la versión utilizada.

## Riesgo 9 — Codex app-server cambiante

**Mitigación**

Pin y schema hash establecidos por Parte 2.

## Riesgo 10 — Claude CLI cambiante

**Mitigación**

Pin y contract tests establecidos por Parte 2.

## Riesgo 11 — Logs con información del caso

El texto de intake puede contener información sensible.

**Mitigación**

No registrar prompt o respuesta completos en logs normales.

## Riesgo 12 — Alcance excesivo

La Feature incorpora cuatro combinaciones.

**Evaluación**

El alcance continúa siendo cohesivo porque resuelve una única capacidad:

> hacer que la configuración ya disponible del rol `intake` sea realmente ejecutable.

Separar Codex y OAuth en Features distintas prolongaría estados donde la UI permite configuraciones que el runtime rechaza.

## Riesgo 13 — Uso directo de OAuth fuera del runtime

Los adaptadores podrían duplicar materialización o refresh.

**Mitigación**

Parte 3 debe consumir el runtime público de Parte 2, no reconstruir su lógica.

## Riesgo 14 — Resultado distinto entre API y CLI

El mismo modelo puede comportarse de forma diferente según la superficie.

**Mitigación**

Validar equivalencia funcional, no identidad textual.

---

# 10. Approval Gate

La implementación permanece prohibida hasta aprobación humana explícita.

Antes de aprobar deben confirmarse:

1. **Arquitectura**

   * Adaptadores de mapping, no Executors nuevos (ni ampliación de `AgentRole`).
   * API key: sin Docker, sin CLI, HTTP directo (sin cambios respecto al planteo original).
   * OAuth: reutiliza el holder Docker de los roles reales (misma imagen, mismos flags de
     seguridad), sin worker, sin MCP, sin tools -- decisión de arquitectura documentada en 3.1.
   * Sin pipeline, tools ni repositorio en ninguna de las cuatro combinaciones.

2. **Matriz**

   * Claude + API key.
   * Codex + API key.
   * Claude + OAuth.
   * Codex + OAuth.

3. **API key Codex**

   * Confirmado (2026-08-03): `gpt-5.6-sol`/`gpt-5.6-terra`/`gpt-5.6-luna` son válidos como
     `model` en la Responses API pública de OpenAI con una API key estándar (mismos IDs que usa el
     Codex CLI) -- fuente oficial `developers.openai.com/api/docs/models`. Confirmar `fetch` frente
     a SDK al implementar (sin SDK de OpenAI instalado en el repo hoy).

4. **OAuth Claude**

   * Confirmar que corre dentro del holder Docker de `ClaudeCodeExecutor` (misma imagen y flags de
     seguridad), no directamente en el host.
   * Confirmar invocación headless exacta dentro del contenedor.
   * Confirmar ausencia de worker/MCP/tools (no una lista vacía dentro de un mecanismo presente).
   * Confirmar cwd vacío (tmpfs).

5. **OAuth Codex**

   * Confirmar que corre dentro del holder Docker de `CodexExecutor` (misma imagen pineada y
     flags de seguridad), no directamente en el host.
   * Confirmar secuencia app-server dentro del contenedor.
   * Confirmar `account/read`.
   * Confirmar `thread/start` con `dynamicTools: []` y ausencia de worker.

6. **Parte 2**

   * Confirmar interfaces públicas reutilizables.
   * Confirmar materialización, recolección, CAS y cleanup.

7. **Modelos**

   * Confirmar que el catálogo central es la única fuente.
   * Retirar o reconciliar `DEFAULT_MAPPING_MODEL`.

8. **Errores**

   * Confirmar categorías funcionales.
   * Confirmar respuestas del endpoint.

9. **Timeout**

   * Confirmar nombre y default.

10. **Seguridad**

    * Sin workspace.
    * Sin tools.
    * Sin credenciales globales.
    * Sin logs sensibles.

11. **Testing**

    * Confirmar suite de matriz.
    * Confirmar E2E real de los cuatro caminos o justificar las combinaciones no disponibles en el entorno.

12. **Gate**

    * Aprobación explícita del owner antes de implementar.

**Estado del gate:** abierto — diseño completo, revisado técnicamente contra el código real (validación de `mapBusinessCase.ts`, `intakeService.ts`, runtime de Parte 2, protocolo Codex app-server, catálogo de modelos de OpenAI) y aprobado explícitamente por el owner el 2026-08-03, con la decisión de arquitectura de la sección 3.1 (API key vía HTTP directo sin Docker; OAuth reutilizando el holder Docker de los roles reales, sin worker).
