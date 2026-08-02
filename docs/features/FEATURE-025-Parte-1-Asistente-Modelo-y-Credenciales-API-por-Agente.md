# FEATURE-025-Parte-1 — Asistente IA, modelo y credenciales API por agente

# 1. Feature Identity

* **Name:** Asistente IA, modelo y credenciales API por agente
* **Type:** Configuración de ejecución / aislamiento de credenciales
* **Owner:** Asdrubal Pérez
* **Status:** Aprobado — en implementación (2026-08-02)
* **Priority:** Alta
* **Approval Gate:** Abierto — aprobado por el owner tras revisión técnica

---

# 2. Problem Statement

El Orquestador ya permite resolver por usuario y por rol qué asistente de IA y qué modo de autenticación utilizar mediante `user_agent_config` y `resolveAgentConfig`.

Sin embargo, el comportamiento actual presenta limitaciones estructurales.

## 2.1 Configuración sin interfaz

La selección de asistente y modo de autenticación existe en backend, pero no dispone de una interfaz self-service.

Actualmente puede modificarse mediante:

* opciones de CLI;
* acceso directo a base de datos;
* configuración técnica fuera del flujo normal del usuario.

## 2.2 Modelo no persistido por agente

El modelo no forma parte de `user_agent_config`.

Actualmente se recibe como un string global mediante `--model`, lo que implica que:

* no se persiste por usuario;
* no se persiste por rol;
* se aplica al run completo;
* no se valida contra el asistente elegido;
* puede contener un valor arbitrario;
* no participa de la precedencia por rol, global y default.

## 2.3 API keys compartidas por el host

Los ejecutores utilizan variables globales del proceso, como:

* `ANTHROPIC_API_KEY`;
* `CODEX_API_KEY`.

Estas credenciales no pertenecen al usuario dueño del run.

FEATURE-025 Parte 1 debe eliminar este mecanismo para las invocaciones que usen `auth_mode = api_key`.

Después de implementar la Feature:

* no debe existir fallback operativo a claves globales;
* cada usuario debe registrar sus propias API keys;
* cada invocación debe usar exclusivamente la credencial del owner del run.

Actualmente existe un único usuario operativo, por lo que la retirada del fallback global no requiere compatibilidad temporal. El usuario deberá registrar sus credenciales después de autenticarse.

## 2.4 Reintentos con configuración congelada

El mecanismo de reintento de escalaciones conserva hoy la selección original de:

* proveedor;
* modo de autenticación;
* modelo.

Esta selección se recupera del evento `run_started` y no se vuelve a resolver contra `user_agent_config`, porque la configuración del usuario podría haber cambiado desde la ejecución original.

Las credenciales no pueden tratarse del mismo modo:

* una API key no puede persistirse en eventos;
* una clave rotada o eliminada no debe seguir utilizándose;
* conservar versiones anteriores de secretos aumentaría el riesgo y la complejidad.

La Feature debe definir explícitamente qué se conserva y qué se vuelve a resolver durante un reintento.

---

# 3. Functional Goal

Después de implementar esta Feature:

* cada usuario podrá configurar globalmente o por rol el asistente de IA;
* cada usuario podrá elegir un modelo compatible con ese asistente;
* cada usuario podrá elegir `api_key` o `cli_session`;
* cada usuario podrá registrar sus propias API keys por proveedor;
* las API keys se almacenarán cifradas y aisladas por usuario;
* cada invocación resolverá la configuración efectiva para el usuario y rol correspondientes;
* ningún executor utilizará una API key global del host;
* un rol configurado con `api_key` no podrá ejecutarse sin una credencial propia;
* los reintentos conservarán proveedor, modelo y modo originales;
* los reintentos resolverán la credencial activa actual del usuario;
* el modo `cli_session` mantendrá temporalmente el mecanismo actual hasta FEATURE-025 Parte 2;
* la configuración podrá ser diferente para cada rol;
* la ausencia o invalidez de una credencial producirá un corte técnico antes de invocar al agente.

---

# 4. Scope

## Included

* Interfaz de configuración global y por rol.
* Selector de asistente.
* Selector de modelo filtrado por asistente.
* Selector de modo de autenticación.
* Catálogo cerrado de proveedores y modelos.
* Persistencia de `model` en `user_agent_config`.
* Nueva tabla de credenciales de IA por usuario y proveedor.
* Cifrado AES-256-GCM de API keys.
* Clave de cifrado específica para credenciales de IA.
* Alta, sustitución y eliminación de credenciales.
* Consulta del estado de una credencial sin exponer el secreto.
* Eliminación del fallback a API keys globales.
* Resolución efectiva por usuario y rol.
* Resolución separada y efímera de credenciales.
* Inyección de credenciales en el entorno individual del proceso hijo.
* Corte técnico por credencial ausente o configuración inválida.
* Tratamiento explícito de reintentos.
* Persistencia de provider, model y auth mode usados en el run.
* Resolución de la credencial vigente en cada reintento.
* Actualización de los reingresos automáticos.
* Revisión de la capa de aislamiento de tools.
* Cobertura nueva para `resolveAgentConfig`, `AgentConfig` y `user_agent_config`.
* Migración `0021`.

## Excluded

* OAuth personal para Claude o Codex.
* Cambios internos al mecanismo actual de `cli_session`.
* Fallback a claves globales.
* Conservación de versiones antiguas de API keys.
* Persistencia de secretos o ciphertext IDs dentro de eventos de run.
* Configuración compartida entre usuarios.
* Un único asistente obligatorio para todos los roles.
* Selección de proveedor o modelo en `mapBusinessCase.ts`.
* Eliminación de la lectura global de `ANTHROPIC_API_KEY` en `mapBusinessCase.ts`.
* Límites de consumo.
* Cuotas.
* Facturación.
* Catálogo dinámico consultado en vivo.
* Rotación automática.
* Validación de saldo o plan del proveedor.
* Cambios de cuentas self-service de FEATURE-041.
* Refactor general del módulo de cifrado de GitHub.

## Future ideas

* Resolver `mapBusinessCase.ts` mediante configuración por usuario.
* Incorporar OAuth personal en FEATURE-025 Parte 2.
* Auditar y retirar definitivamente toda variable global de credenciales después de ambas partes.
* Versionar snapshots completos de configuración si una Feature futura requiere reproducibilidad estricta.

---

# 5. Functional Rules

## 5.1 Propiedad y precedencia

1. Toda configuración pertenece a un usuario.
2. Puede existir:

   * una configuración global;
   * una configuración específica por rol.
3. La configuración específica del rol tiene precedencia sobre la global.
4. La configuración global tiene precedencia sobre los defaults.
5. Ninguna configuración es compartida entre usuarios.
6. Cada rol puede tener una combinación diferente.

## 5.2 Proveedores soportados

Inicialmente:

* Claude Code;
* Codex.

El catálogo es cerrado y server-side.

La UI no puede enviar proveedores arbitrarios.

## 5.3 Modelos

1. Cada modelo pertenece a un proveedor soportado.
2. El backend es la fuente de verdad.
3. El modelo no puede ser un string libre sin validación.
4. El modelo debe persistirse en `user_agent_config`.
5. Si cambia el proveedor y el modelo deja de ser compatible:

   * se limpia el modelo;
   * o se rechaza el guardado.
6. Nunca debe persistirse una combinación incompatible.
7. La actualización del catálogo será manual y controlada.

## 5.4 Modo `api_key`

1. Requiere una credencial propia del usuario.
2. La credencial debe pertenecer al proveedor efectivo.
3. No existe fallback a variables globales.
4. La ausencia de credencial detiene el flujo antes de invocar al agente.
5. El error debe ser distinguible.
6. El error debe indicar qué proveedor requiere configuración.
7. El problema no debe escalarse a un agente.
8. El runtime no debe intentar ejecutar parcialmente configurado.

## 5.5 Modo `cli_session`

1. Continúa disponible.
2. No requiere una API key.
3. Mantiene temporalmente el mecanismo actual.
4. Su aislamiento personal corresponde a Parte 2.
5. Parte 1 no depende de Parte 2.
6. Parte 2 sí reutilizará el modelo y la UI de Parte 1.

## 5.6 Credenciales

1. Se almacenan por:

   * usuario;
   * proveedor.
2. Una credencial puede utilizarse en varios roles del mismo usuario.
3. No se duplica dentro de `user_agent_config`.
4. Se almacena cifrada.
5. Nunca se devuelve después de guardarse.
6. La API solo expone metadatos no sensibles.
7. Sustituir una credencial invalida el secreto anterior.
8. Eliminar una credencial impide futuras ejecuciones `api_key`.
9. No se conservan versiones antiguas para reintentos.
10. El plaintext solo existe durante la resolución e invocación.
11. No debe aparecer en:

    * logs;
    * eventos;
    * errores;
    * artefactos;
    * respuestas HTTP;
    * argumentos visibles;
    * registros del run.

## 5.7 Resolución de configuración

Para un usuario y rol:

1. Configuración específica.
2. Configuración global.
3. Defaults permitidos.

La configuración efectiva contiene:

* provider;
* model;
* auth mode.

La credencial se resuelve después y de forma separada.

## 5.8 Resolución por invocación

1. La configuración se resuelve en cada invocación.
2. No se resuelve una sola vez para todo el run.
3. Cada rol puede producir una selección diferente.
4. Se utiliza el owner del run.
5. La credencial no se persiste.
6. Una nueva invocación normal utiliza la configuración vigente.
7. Un reintento de escalación utiliza la selección funcional original.

## 5.9 Reintentos

En un reintento de escalación:

1. Se reutilizan del run original:

   * provider;
   * model;
   * auth mode.
2. Estos valores se recuperan del evento `run_started`.
3. No se vuelve a consultar `user_agent_config` para esos campos.
4. La API key original no se persiste.
5. Si `auth_mode = api_key`, se resuelve la credencial activa actual del mismo usuario y proveedor.
6. Si la credencial fue rotada, se usa la nueva.
7. Si fue eliminada, el reintento se bloquea.
8. No se reutilizan API keys antiguas.
9. No se versionan secretos exclusivamente para reproducir un reintento.
10. La diferencia respecto de la ejecución original es deliberada y de seguridad:

    * la configuración funcional queda congelada;
    * el material secreto debe estar vigente.

## 5.10 Corte técnico

Antes de construir el executor:

* validar provider;
* validar model;
* validar auth mode;
* resolver credencial cuando corresponda;
* confirmar que la credencial existe.

Ante fallo:

* no se invoca al agente;
* no se crea un proceso hijo;
* se registra un error no sensible;
* se devuelve un estado distinguible.

## 5.11 Concurrencia

1. No debe modificarse `process.env` global.
2. Debe preservarse el patrón actual de entorno por proceso hijo.
3. Cada invocación recibe un objeto `env` independiente.
4. Ningún executor conserva secretos en estado global.
5. Dos usuarios pueden ejecutar simultáneamente sin contaminación.

## 5.12 Reingresos automáticos

La resolución debe aplicarse también a:

* `createPlanningToQaChildRun`;
* `createArchitectReentryChildRun`;
* cualquier otro child run o circuito automático.

Estos flujos no pueden omitir la resolución de modelo o credencial.

---

# 6. Estrategia Algorítmica

No existe optimización, pero sí una resolución determinística.

## 6.1 Entradas

* `userId`;
* rol;
* configuración específica;
* configuración global;
* defaults;
* catálogo de proveedores;
* catálogo de modelos;
* auth mode;
* estado actual de las credenciales;
* snapshot funcional original, en caso de reintento.

## 6.2 Salida de configuración

```ts
interface EffectiveAgentConfig {
  executorProvider: ExecutorProvider;
  model: string;
  authMode: "api_key" | "cli_session";
}
```

## 6.3 Salida de autenticación

```ts
interface ResolvedExecutorAuthentication {
  mode: "api_key" | "cli_session";
  apiKey?: string;
}
```

La autenticación no debe formar parte de objetos persistibles.

## 6.4 Flujo normal

1. Resolver configuración de rol.
2. Completar desde global.
3. Completar desde defaults.
4. Validar provider.
5. Validar model.
6. Validar auth mode.
7. Si es `api_key`, resolver credencial actual.
8. Si no existe, cortar.
9. Construir executor.

## 6.5 Flujo de reintento

1. Leer provider, model y auth mode del evento original.
2. No consultar configuración actual para esos campos.
3. Validar que continúan siendo soportados.
4. Si es `api_key`, resolver credencial activa actual.
5. Si no existe, cortar.
6. Construir executor con:

   * configuración original;
   * credencial vigente.

## 6.6 Determinismo

Para una invocación normal, la misma configuración persistida produce el mismo resultado.

Para un reintento:

* la selección funcional es estable;
* la credencial puede cambiar por rotación o eliminación;
* ese cambio es intencional y seguro.

---

# 7. Technical Considerations

## 7.1 Migración

Próxima migración:

```text
0021
```

Debe incluir:

* columna `model` en `user_agent_config`;
* nueva tabla de credenciales de IA.

## 7.2 Modelo de datos

### `user_agent_config`

Extender con:

```text
model
```

Cambio aditivo compatible con los índices parciales existentes.

### `user_ai_provider_credentials`

Estructura conceptual:

```text
id
user_id
provider
credential_ciphertext
credential_iv
credential_auth_tag
created_at
updated_at
```

Restricción única:

```text
(user_id, provider)
```

El ID identifica el registro actual, pero no se utiliza para preservar versiones anteriores.

Una rotación actualiza o reemplaza la credencial vigente.

## 7.3 Clave de cifrado

Debe utilizarse una clave nueva:

```text
AI_CREDENTIAL_ENCRYPTION_KEY
```

Debe ser distinta de:

```text
GIT_CREDENTIAL_ENCRYPTION_KEY
```

Motivos:

* separación de dominios;
* reducción del blast radius;
* rotación independiente;
* preparación para OAuth de IA;
* coste de implementación mínimo.

No se requiere renombrar ni generalizar ampliamente `gitCredentialEncryption.ts`.

Las funciones existentes ya aceptan una clave como parámetro.

La implementación debe:

* resolver `AI_CREDENTIAL_ENCRYPTION_KEY`;
* pasarla explícitamente a las primitivas existentes;
* mantener intacta la interfaz pública usada por GitHub.

## 7.4 Catálogo de modelos

Catálogo estático server-side.

Estructura conceptual:

```ts
const AI_MODEL_CATALOG = {
  claude_code: [],
  codex: [],
};
```

Los modelos concretos deben confirmarse durante implementación contra las versiones soportadas por los CLI.

No se consulta dinámicamente a terceros.

## 7.5 Configuración y autenticación separadas

Se recomienda separar:

```ts
resolveEffectiveAgentConfig(userId, role)
```

de:

```ts
resolveExecutorAuthentication(userId, config)
```

Así se reduce el riesgo de serializar secretos.

## 7.6 Reintentos y evento `run_started`

El evento debe conservar:

* provider;
* model;
* auth mode.

No debe conservar:

* API key;
* ciphertext;
* IV;
* auth tag;
* copia de la credencial;
* referencia a una versión histórica de secreto.

El reintento usa esos valores funcionales y resuelve la credencial vigente.

## 7.7 Ejecutores

`ClaudeCodeExecutor` y `CodexExecutor` deben recibir una API key desde el caller.

Las variables globales no deben ser fuente de ejecución.

Debe preservarse el patrón actual:

```ts
spawn(command, args, { env: childEnv })
```

No se debe introducir una mutación de `process.env`.

## 7.8 Capa de aislamiento de tools

Deben revisarse:

* `qaWorkerServer.ts`;
* `roleWorkerServer.ts`;
* `searchProxyServer.ts`;
* `worker.ts`.

Actualmente tratan `ANTHROPIC_API_KEY` y `CODEX_API_KEY` como secretos prohibidos.

La implementación debe confirmar que:

* los nombres utilizados para inyectar la credencial siguen bloqueados;
* el secreto no llega a workers que no lo necesitan;
* la nueva fuente de credenciales no debilita el aislamiento existente.

## 7.9 Runtime afectado

Como mínimo:

* migración `0021`;
* `user_agent_config`;
* tipos `AgentConfig`;
* `resolveAgentConfig`;
* nuevo CRUD de credenciales;
* cifrado con `AI_CREDENTIAL_ENCRYPTION_KEY`;
* `buildExecutor`;
* `ClaudeCodeExecutor`;
* `CodexExecutor`;
* `runStart.ts`;
* loop de fases;
* `createPlanningToQaChildRun`;
* `createArchitectReentryChildRun`;
* `respondService.ts`;
* mecanismo de retry;
* evento `run_started`;
* endpoints backend;
* UI de configuración;
* capa de aislamiento de tools;
* logs y eventos;
* tests nuevos de configuración;
* tests de reintentos;
* tests de concurrencia.

## 7.10 `mapBusinessCase.ts`

Queda explícitamente fuera de alcance.

Actualmente utiliza `ANTHROPIC_API_KEY` mediante un camino independiente y directo.

Por tanto, después de Parte 1 puede seguir existiendo un lector de una clave global en el repositorio.

Esto no contradice el alcance, porque Parte 1 elimina el mecanismo global del pipeline de Executors, no del mapper.

Debe documentarse para que una auditoría no interprete erróneamente que ya no existe ninguna lectura global.

## 7.11 Cobertura de tests

Actualmente no existe cobertura directa para:

* `resolveAgentConfig`;
* `AgentConfig`;
* `user_agent_config`.

La Feature debe crear esta cobertura desde cero.

Como mínimo:

* precedencia rol/global/default;
* validación de modelos;
* credencial presente;
* credencial ausente;
* aislamiento entre usuarios;
* retry con credencial rotada;
* retry con credencial eliminada;
* child runs automáticos;
* ausencia de fallback global.

## 7.12 `--model`

No hay consumidores conocidos en CI o automatizaciones.

Recomendación:

* retirar `--model` del flujo normal;
* usar la configuración persistida como fuente principal;
* mantenerlo temporalmente solo si existe un caso administrativo real;
* no permitir que sobrescriba silenciosamente configuración persistida.

La decisión definitiva puede cerrarse durante implementación, siempre que no contradiga estas reglas.

## 7.13 API backend

Endpoints para:

* consultar configuración;
* guardar configuración;
* obtener catálogo;
* consultar estado de credenciales;
* guardar o sustituir API key;
* eliminar API key.

Ninguna respuesta devuelve secretos.

## 7.14 UI

Debe permitir:

* configuración global;
* overrides por rol;
* selección de provider;
* selección de modelo;
* selección de auth mode;
* alta de credenciales;
* rotación;
* eliminación;
* visualización de estado;
* identificación anticipada de configuraciones incompletas.

## 7.15 Dependencias

* FEATURE-016.
* FEATURE-026.
* FEATURE-025 Parte 2 depende de esta Parte 1.
* FEATURE-041 no es dependencia.

El spike de Parte 2 puede ejecutarse en paralelo.

---

# 8. Validation Criteria

## Scenario 1 — Credencial propia de Claude

**Input**

Usuario configura un rol con Claude, modelo válido y `api_key`.

**Expected output**

* Usa la credencial propia.
* No consulta la clave global.
* No expone el secreto.

## Scenario 2 — Credencial propia de Codex

**Input**

Usuario configura Codex con modelo válido.

**Expected output**

* Usa la credencial de OpenAI/Codex del usuario.
* Inyecta la key solo al proceso hijo.

## Scenario 3 — Credencial ausente

**Input**

Rol configurado con `api_key`, sin credencial.

**Expected output**

* Corte antes de invocar.
* Error distinguible.
* Ningún fallback global.

## Scenario 4 — Configuración por rol

**Input**

Roles con combinaciones diferentes.

**Expected output**

Cada rol usa su configuración.

## Scenario 5 — Precedencia

**Input**

Global más override específico.

**Expected output**

El override prevalece.

## Scenario 6 — Modelo incompatible

**Input**

Modelo de Claude con Codex.

**Expected output**

Rechazo antes de persistir o ejecutar.

## Scenario 7 — Cambio de provider

**Input**

Cambio con modelo incompatible.

**Expected output**

Modelo limpiado o guardado rechazado.

## Scenario 8 — Rotación

**Input**

Usuario sustituye la API key.

**Expected output**

Nuevas invocaciones usan la nueva.

## Scenario 9 — Eliminación

**Input**

Usuario elimina la key.

**Expected output**

Próximas ejecuciones se bloquean.

## Scenario 10 — Aislamiento

**Input**

Dos usuarios ejecutan simultáneamente.

**Expected output**

Cada proceso recibe su propia credencial.

## Scenario 11 — Variables globales presentes

**Input**

Host con claves globales; usuario sin clave propia.

**Expected output**

El run falla y no usa las globales.

## Scenario 12 — Variables globales ausentes

**Input**

Host sin claves globales; usuario configurado.

**Expected output**

El run funciona.

## Scenario 13 — Retry sin cambios

**Input**

Run original con provider/model/auth mode y credencial activa.

**Expected output**

El retry conserva selección y usa credencial vigente.

## Scenario 14 — Retry tras rotación

**Input**

La key se rota después del run original.

**Expected output**

El retry usa la nueva key.

## Scenario 15 — Retry tras eliminación

**Input**

La key se elimina.

**Expected output**

El retry se bloquea antes de invocar.

## Scenario 16 — Configuración modificada antes del retry

**Input**

El usuario cambia provider o modelo en su configuración.

**Expected output**

El retry conserva provider, modelo y auth mode originales.

## Scenario 17 — Child run Planning → QA

**Input**

Reingreso automático.

**Expected output**

Resuelve configuración y credencial del rol QA.

## Scenario 18 — Reingreso Architect

**Input**

Circuito automático.

**Expected output**

Resuelve correctamente la configuración del Architect.

## Scenario 19 — Capa de tools

**Input**

Invocación con API key propia.

**Expected output**

Los workers aislados no reciben secretos prohibidos.

## Scenario 20 — `mapBusinessCase.ts`

**Input**

Ejecución del mapper.

**Expected output**

Mantiene su comportamiento actual y queda documentado como fuera de alcance.

## Scenario 21 — Sin exposición

**Input**

Alta, ejecución, error, retry, eliminación.

**Expected output**

La key no aparece en logs, eventos ni respuestas.

## Validation Evidence

Debe aportarse:

* configuración visible por rol;
* catálogo de modelos;
* estado de credencial sin secreto;
* datos cifrados en base;
* ejecución exitosa con credencial propia;
* fallo sin credencial;
* prueba con globales presentes;
* concurrencia entre usuarios;
* retry tras rotación;
* retry tras eliminación;
* child runs;
* revisión de workers;
* suite nueva de configuración;
* ausencia de secretos en logs y eventos.

---

# 9. Risks

## Riesgo 1 — Filtración de secretos

**Impacto:** crítico.

**Mitigación**

* cifrado;
* inyección efímera;
* sanitización;
* separación de configuración y autenticación;
* tests específicos.

## Riesgo 2 — Contaminación entre ejecuciones

El aislamiento ya existe mediante entornos separados por proceso.

**Tratamiento**

Preservar el patrón existente y cambiar únicamente el origen del valor inyectado.

## Riesgo 3 — Reintentos con credenciales obsoletas

Persistir o conservar la key original permitiría reutilizar un secreto rotado o comprometido.

**Mitigación**

Resolver siempre la credencial activa actual.

## Riesgo 4 — Retry bloqueado tras eliminación

Un retry puede dejar de ser ejecutable.

**Evaluación**

Es comportamiento deliberado: una credencial eliminada no debe seguir utilizándose.

## Riesgo 5 — Configuraciones inválidas

**Mitigación**

Catálogo server-side y validación doble.

## Riesgo 6 — Call sites incompletos

Los child runs y reintentos pueden omitir la nueva resolución.

**Mitigación**

Mapeo explícito y pruebas de Circuitos 2/3.

## Riesgo 7 — Capa de tools debilitada

**Mitigación**

Revisar variables prohibidas y entornos de worker.

## Riesgo 8 — Cobertura inexistente

**Mitigación**

Crear tests desde cero para configuración y precedencia.

## Riesgo 9 — Clave de cifrado compartida

**Mitigación**

Usar `AI_CREDENTIAL_ENCRYPTION_KEY`.

## Riesgo 10 — Refactor innecesario

**Mitigación**

Reutilizar primitivas existentes sin renombrar ni mover módulos salvo necesidad real.

## Riesgo 11 — Confusión sobre `mapBusinessCase.ts`

**Mitigación**

Documentarlo expresamente como fuera de alcance y lector global remanente.

## Riesgo 12 — Retirada de `--model`

**Mitigación**

Verificar usos y aplicar una transición explícita.

---

# 9.1 Ampliación decidida durante la implementación (2026-08-02)

El mapeo de intake (texto libre -> campos del caso de negocio, `src/intake/mapBusinessCase.ts`,
FEATURE-017) usaba la misma clave global del host (`ANTHROPIC_API_KEY`) que esta Feature retira
para los 5 roles reales del pipeline — un hueco no contemplado en el diseño original porque el
mapeo nunca se identificó como "un agente" (no tiene Executor, no aparece en `PhaseInvocation`, no
participa del timeline de un run).

**Decisión del owner**: tratarlo con el mismo mecanismo, no con una regla de fallback aparte —
`"intake"` ("Asistente de Entrada") se agrega como un sexto valor de `role` en `user_agent_config`
(migración `0022_agent_config_intake_role.sql`, tipo `ConfigurableAgentRole` separado de `AgentRole`
para no ensuciar el tipo que gobierna las fases reales del pipeline). Resuelve con
`resolveAgentConfig`/`resolveExecutorAuthentication`, idéntico a los 5 roles.

**Límite real, documentado explícitamente**: `mapBusinessCase.ts` sigue siendo una llamada HTTP
directa y exclusiva a la API de Anthropic — no sabe hablar con Codex ni con una sesión OAuth. Si
`"intake"` resuelve a `executorProvider: "codex"` o a `authMode: "cli_session"`,
`mapIntakeText` (`src/cli/intakeService.ts`) corta explícitamente con
`IntakeMappingProviderUnsupportedError`/`IntakeMappingAuthModeUnsupportedError` (HTTP 409, mensaje
claro) en vez de intentar algo que no existe. Cerrar ese límite es alcance de
`docs/features/FEATURE-025-Parte-3-Soporte-Codex-y-OAuth-para-el-Asistente-de-Entrada.md`
(prioridad Baja, sin urgencia).

---

# 10. Approval Gate

La implementación está prohibida hasta aprobación humana explícita.

Antes de aprobar deben confirmarse:

1. Nombre definitivo de la tabla.
2. Estructura de migración `0021`.
3. Catálogo inicial de modelos.
4. Contrato de errores.
5. Contrato de retry.
6. Resolución de credencial vigente en reintentos.
7. Uso de `AI_CREDENTIAL_ENCRYPTION_KEY`.
8. Todos los call sites de child runs.
9. Revisión de la capa de tools.
10. Tratamiento de `--model`.
11. Cobertura nueva de configuración.
12. Ausencia total de fallback global en Executors.
13. Documentación explícita de `mapBusinessCase.ts` fuera de alcance.

**Estado del gate:** cerrado — diseño corregido pendiente de revisión técnica final y aprobación explícita.
