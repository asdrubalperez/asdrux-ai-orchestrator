# FEATURE-022 — Lectura universal de artifacts por todos los roles

# 1. Feature Identity

* **Name:** Lectura universal de artifacts por todos los roles
* **Type:** Arquitectura / Plataforma del Orquestador
* **Owner:** Asdru — Product Owner
* **Implementation Owner:** DAIA
* **Status:** Implementada, validada y mergeada a `main` (`4e4f209`); validación funcional conjunta
  pendiente con FEATURE-023 Parte 1 y Parte 2
* **Priority:** P0

---

# 2. Problem Statement

## Limitación actual

Asdrux AI Orquestador persiste artifacts generados por los distintos roles, incluyendo resultados de diseño, planificación, desarrollo, QA y escalamiento.

Sin embargo, los agentes no disponen de una capacidad general para descubrir y recuperar esos artifacts durante su ejecución.

Actualmente, cada rol depende de una combinación de:

* contenido empujado directamente en el contexto;
* información disponible en el worktree;
* referencias que no puede resolver;
* reconstrucción manual o inferida de resultados anteriores.

El backend puede recuperar artifacts asociados a un run para la UI o para procesos internos, pero esa capacidad no está disponible como herramienta para los roles.

## Necesidad

Todos los roles deben poder consultar cualquier artifact perteneciente al proyecto del run actual, independientemente de qué rol lo haya producido.

Esta capacidad debe funcionar bajo demanda:

* el contexto transporta referencias pequeñas;
* el rol descubre qué artifacts están disponibles;
* el rol lee únicamente los artifacts que necesita;
* el Orquestador evita inyectar automáticamente todo el historial del proyecto.

## Motivación

La falta de acceso produce:

* repetición de análisis ya realizados;
* pérdida de contexto entre Features;
* dependencia accidental del código presente en el worktree;
* dificultad para continuar después de reinicios o cambios de rol;
* referencias persistidas que no tienen utilidad operacional para el agente;
* riesgo de decisiones contradictorias respecto de artifacts anteriores.

La auditoría de DAIA confirmó que existen artifacts útiles persistidos, pero ningún mecanismo general de lectura para los agentes. También confirmó que Release y Feature no tienen hoy una relación relacional directa con los runs y artifacts que las produjeron.

---

# 3. Functional Goal

Después de implementar esta Feature:

1. Cualquier rol del Orquestador podrá descubrir los artifacts disponibles dentro del proyecto asociado a su run.
2. Cualquier rol podrá leer el contenido de un artifact concreto bajo demanda cuando no supere el
   límite de 64 KiB; para artifacts mayores recibirá metadata, resumen y tamaño sin contenido.
3. La consulta podrá restringirse mediante filtros simples y útiles.
4. Ningún rol recibirá automáticamente el contenido completo de todos los artifacts.
5. Ningún rol podrá consultar artifacts pertenecientes a otro proyecto.
6. La capacidad de lectura será común para todos los roles.
7. La propiedad de escritura de los artifacts no será modificada por esta Feature.
8. Las referencias incluidas en contextos futuros podrán convertirse en referencias operacionalmente útiles.

El comportamiento esperado es:

```text
Rol recibe contexto mínimo
        ↓
Rol necesita información previa
        ↓
Lista artifacts disponibles
        ↓
Selecciona artifact relevante
        ↓
Lee metadata o contenido
        ↓
Continúa su trabajo
```

---

# 4. Scope

## Included

### Capacidad común para todos los roles

La Feature debe habilitar la misma capacidad de lectura para:

* Architect;
* Functional;
* Planning;
* Developer;
* QA;
* cualquier otro rol operativo existente en el pipeline.

No se diseñará una solución exclusiva para Planning ni para `featureJustCompleted`.

### Descubrimiento de artifacts

Los roles podrán listar artifacts del proyecto del run actual.

La lista deberá ofrecer metadata suficiente para decidir qué artifact leer, sin devolver siempre el contenido completo.

Como mínimo:

* identificador del artifact;
* run productor;
* fase;
* tipo o `kind`;
* rol productor, cuando pueda determinarse;
* fecha de creación;
* resumen;
* referencia de commit, cuando exista;
* tamaño de la representación JSON UTF-8 del contenido.

`phase` se devolverá siempre como está persistida. `producerRole` tendrá el mismo valor cuando
`phase` corresponda a un `AgentRole` reconocido; de lo contrario será `null`. No se agregará una
columna duplicada para representar el rol productor.

### Lectura de artifact

Los roles podrán solicitar un artifact concreto mediante su identificador y recibir:

* metadata;
* contenido persistido;
* resumen;
* información de trazabilidad disponible.

### Filtros

La consulta deberá admitir, como mínimo, filtros por:

* `run_id`;
* `kind`;
* fase o rol productor;
* rango temporal;
* límite de resultados;
* cursor opaco de continuación.

Los filtros y metadata por Feature o Release quedan fuera de la primera versión porque el modelo
actual no ofrece una asociación confiable. Las operaciones podrán extender su metadata en una
Feature futura sin cambiar sus garantías de aislamiento.

### Aislamiento por proyecto

Un rol sólo podrá leer artifacts del proyecto correspondiente al run que está ejecutando.

El agente no podrá seleccionar libremente otro `project_id`.

### Control de volumen

El mecanismo deberá evitar acumulación descontrolada de contexto.

Como mínimo:

* la lista no devuelve automáticamente el contenido completo;
* el límite de listado será 20 por default y 100 como máximo;
* el listado truncado devolverá un cursor opaco de continuación;
* cada resumen incluido en una respuesta tendrá un máximo de 2 KiB UTF-8 e indicará si fue
  truncado;
* la lectura se realiza artifact por artifact;
* `artifact_read` devolverá contenido completo únicamente cuando su representación JSON UTF-8 no
  supere 64 KiB;
* para artifacts mayores devolverá metadata, resumen existente, tamaño total, `content: null`,
  `complete: false` y `reason: "CONTENT_TOO_LARGE"`;
* la lectura parcial queda fuera de FEATURE-022.

### Compatibilidad con referencias existentes

La capacidad deberá poder reutilizar identificadores existentes como:

* `run_id`;
* `artifact_id`;
* `root_run_id`;
* `originated_from_run_id`;
* referencias de configuración.

No es obligatorio resolver en esta Feature todas las referencias posibles, pero el diseño no debe
crear un mecanismo exclusivo para una sola referencia. `root_run_id`,
`originated_from_run_id` y referencias de configuración no serán filtros de listado en v1; podrán
servir a contextos futuros que conduzcan al descubrimiento mediante las operaciones comunes.

### Persistencia mínima adicional

La primera versión no agregará migraciones, columnas, tablas ni índices. El proyecto se obtiene
mediante `runs.project_id`; el rol productor se deriva de `artifacts.phase`; el resumen existente y
el tamaño se obtienen al consultar. Cualquier persistencia adicional requerirá evidencia de que los
patrones aprobados no pueden satisfacerse con el modelo actual.

### Pruebas

Se deberán agregar pruebas que demuestren:

* acceso desde todos los roles;
* listado de artifacts;
* lectura individual;
* filtrado;
* aislamiento entre proyectos;
* manejo de artifact inexistente;
* manejo de contenido grande;
* ausencia de modificación de artifacts mediante las herramientas de lectura.

---

## Excluded

Queda fuera de FEATURE-022:

* generación y actualización completa de los cuatro documentos canónicos del Runbook;
* lifecycle del `01-PROJECT-BRIEF-TEMPLATE`;
* lifecycle del `02-ARCHITECTURE-TEMPLATE`;
* lifecycle del `07-FEATURE-TEMPLATE`;
* lifecycle del `09-RELEASE-PLAN-TEMPLATE`;
* modal de Feature completada;
* guardado obligatorio de Features en `docs/features/`;
* edición universal de artifacts;
* cambio de ownership de escritura;
* reanudación durable del loop Developer↔QA;
* corrección del `release_plan` stale;
* corrección del contrato `COMANDO_TEST` entre `src/` y `dist/`;
* búsqueda semántica;
* embeddings;
* base vectorial;
* object storage;
* permisos configurables artifact por artifact;
* editor documental;
* sincronización bidireccional genérica entre DB y repositorio;
* migración completa de Release y Feature a entidades relacionales.

---

## Future Ideas

* asociación durable `Release → Feature → Run → Artifact`;
* lectura por Feature y Release mediante identidad relacional;
* búsqueda textual en contenido;
* resúmenes generados bajo demanda;
* integración con artifacts canónicos del Runbook;
* visualización de relaciones entre artifacts;
* recuperación operacional del estado de loops;
* políticas de retención o archivado.

Estas ideas no forman parte del criterio de aceptación actual.

---

# 5. Functional Rules

## Rule 1 — Lectura universal

Todos los roles tienen permiso de lectura sobre todos los artifacts pertenecientes al proyecto del run actual.

No se aplicarán restricciones de lectura según el rol productor.

## Rule 2 — Escritura sin cambios

FEATURE-022 no modifica las reglas de escritura.

Cada artifact continúa siendo generado o actualizado únicamente por:

* el rol propietario;
* el Orquestador;
* el proceso del pipeline autorizado.

Las nuevas herramientas expuestas a los agentes son de solo lectura.

## Rule 3 — Contexto mínimo

El Orquestador no debe resolver e insertar automáticamente todos los artifacts en cada invocación.

Los contextos podrán incluir:

* IDs;
* referencias;
* resúmenes mínimos;
* indicaciones de artifacts disponibles.

El contenido completo se recupera sólo cuando el rol lo solicita.

## Rule 4 — Proyecto derivado del run

El proyecto autorizado se obtiene internamente a partir del run activo.

El agente:

* no envía un `project_id` arbitrario;
* no envía ni controla el `requestingRunId`;
* no puede consultar otro proyecto;
* no puede ampliar el scope autorizado mediante parámetros.

El `requestingRunId` queda ligado internamente por el Orquestador al executor o runtime confiable
al iniciar cada fase. Todas las consultas derivan el proyecto desde ese run persistido.

## Rule 5 — Descubrimiento antes de lectura

La operación de listado debe devolver metadata y resúmenes, no todos los contenidos completos.
Cada resumen tendrá un máximo de 2 KiB UTF-8 y estará acompañado por `summaryTruncated`.

La operación de lectura recibe un identificador concreto.

## Rule 6 — Feature y Release fuera de v1

La primera versión no acepta filtros ni devuelve metadata por Feature o Release. No se inventará ni
inferirá silenciosamente ninguna asociación. Su incorporación futura requerirá una identidad
confiable y no modificará las garantías de las operaciones comunes.

## Rule 7 — Resultados determinísticos

Ante los mismos datos y filtros, la lista deberá mantener un orden determinístico:

1. creación descendente;
2. identificador como desempate estable.

El orden exacto será `(created_at DESC, id DESC)`. Cuando existan más resultados, la respuesta
incluirá un `nextCursor` opaco basado internamente en esa misma tupla. El agente podrá reutilizar el
cursor, pero no construirá ni modificará su contenido.

## Rule 8 — Límites explícitos

`artifact_list` tendrá límite 20 por default y 100 como máximo. Consultará `limit + 1` para
determinar si existen más resultados y devolverá `truncated` y `nextCursor`.

`artifact_read` devolverá:

* tamaño total de la representación JSON UTF-8;
* contenido completo, `complete: true` y `reason: null` cuando el tamaño sea menor o igual a 64 KiB;
* metadata, resumen existente, tamaño total, `content: null`, `complete: false` y
  `reason: "CONTENT_TOO_LARGE"` cuando el límite sea superado.

La lectura parcial no se implementará en esta Feature.

## Rule 9 — Artifact inexistente o no autorizado

La lectura de un `artifact_id` inexistente y la de un artifact perteneciente a otro proyecto
devolverán exactamente el mismo resultado controlado: `ARTIFACT_NOT_FOUND`.

La respuesta no permitirá inferir si un identificador externo existe. Los parámetros inválidos se
distinguirán mediante `INVALID_ARGUMENTS`, porque ese error describe la solicitud y no revela datos.

Un filtro `run_id` perteneciente a otro proyecto devolverá una lista vacía, sin revelar metadata del
run externo.

## Rule 10 — Observabilidad

Cada llamada generará un log técnico estructurado en el proxy confiable, sin contenido ni resumen.

Como mínimo registrará:

* timestamp;
* run solicitante;
* rol;
* operación;
* artifact consultado únicamente para `artifact_read`;
* código de resultado;
* cantidad de resultados para `artifact_list`;
* duración.

FEATURE-022 no agregará una tabla de auditoría ni un `run_event` por lectura.

## Rule 11 — Compatibilidad

Los artifacts históricos válidos deben continuar siendo legibles, aun cuando carezcan de metadata nueva.

La ausencia de metadata enriquecida no debe bloquear la lectura por `artifact_id` o `run_id`.

## Rule 12 — Sin mutación accidental

Las operaciones de lectura no podrán:

* actualizar artifacts;
* alterar timestamps;
* crear nuevas versiones;
* modificar estados del run;
* escribir en el worktree.

---

# 6. Estrategia Algorítmica

No aplica una estrategia algorítmica de decisión de negocio.

Sí se requiere comportamiento determinístico en:

* aplicación de filtros;
* aislamiento por proyecto;
* ordenamiento;
* límites;
* paginación de listados;
* resolución de errores.

## Resolución conceptual

### Listado

```text
Run activo
  → obtener project_id autorizado
  → aplicar filtros permitidos
  → consultar artifacts relacionados con runs del proyecto
  → ordenar por created_at DESC, id DESC
  → aplicar cursor opaco y límite
  → devolver metadata, resumen, truncated y nextCursor
```

### Lectura

```text
Run activo
  → obtener project_id autorizado
  → recibir artifact_id
  → buscar en un único join el artifact perteneciente a un run del proyecto
  → devolver ARTIFACT_NOT_FOUND si no existe o no está autorizado
  → calcular tamaño JSON UTF-8
  → devolver metadata y contenido completo hasta 64 KiB
  → devolver metadata sin contenido si supera 64 KiB
```

El detalle técnico de implementación será definido por DAIA respetando estos contratos.

---

# 7. Technical Considerations

## Arquitectura afectada

La Feature probablemente afectará:

* repositorio de persistencia;
* runtime de herramientas aisladas;
* políticas de herramientas por rol;
* binding interno del run solicitante al executor;
* proxy host confiable y telemetría técnica;
* tests de aislamiento;
* tipos compartidos.

## Herramientas esperadas

La implementación expondrá exactamente dos herramientas comunes:

### `artifact_list`

Responsabilidad:

* listar artifacts disponibles;
* aplicar filtros;
* devolver metadata y resúmenes;
* no devolver automáticamente contenido;
* aplicar paginación determinística mediante cursor opaco.

Parámetros:

```ts
{
  runId?: string;
  kind?: string;
  phase?: AgentRole;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  cursor?: string;
}
```

No acepta `projectId`, `requestingRunId`, Feature ni Release.

Respuesta:

```ts
{
  items: Array<{
    artifactId: string;
    runId: string;
    phase: string;
    producerRole: AgentRole | null;
    kind: string;
    createdAt: string;
    summary: string | null;
    summaryTruncated: boolean;
    commitRef: string | null;
    contentBytes: number;
  }>;
  truncated: boolean;
  nextCursor: string | null;
}
```

### `artifact_read`

Responsabilidad:

* leer un artifact concreto;
* verificar pertenencia al proyecto;
* controlar tamaño;
* devolver metadata y contenido.

Parámetros:

```ts
{ artifactId: string }
```

Respuesta para contenido de hasta 64 KiB:

```ts
{
  artifactId: string;
  runId: string;
  phase: string;
  producerRole: AgentRole | null;
  kind: string;
  createdAt: string;
  summary: string | null;
  summaryTruncated: boolean;
  commitRef: string | null;
  contentBytes: number;
  content: unknown;
  complete: true;
  reason: null;
}
```

Para contenido mayor a 64 KiB la misma respuesta tendrá `content: null`, `complete: false` y
`reason: "CONTENT_TOO_LARGE"`.

Estos nombres forman parte del contrato de la Feature. No se fusionarán ambas responsabilidades en
una operación ambigua.

## Persistencia existente

La solución deberá reutilizar inicialmente:

* `runs.project_id`;
* `artifacts.run_id`;
* `artifacts.phase`;
* `artifacts.kind`;
* `artifacts.content`;
* `artifacts.commit_ref`;
* `artifacts.created_at`.

El acceso por proyecto puede resolverse inicialmente mediante:

```text
Project
  → Runs
      → Artifacts
```

No es necesario crear inmediatamente tablas completas para Release y Feature.

La primera versión no requiere ninguna migración. Los índices existentes
`runs_project_id_idx` y `artifacts_run_id_idx` cubren el join inicial. Antes de agregar un índice
deberá inspeccionarse el plan de consulta con `EXPLAIN` y datos representativos; no se agregará
optimización preventiva ni se denormalizará `project_id` en `artifacts`.

## Metadata adicional

No se agregará metadata persistida en v1:

* `producerRole` se deriva de `phase`;
* `summary` se obtiene de `content.summary` cuando existe y se limita a 2 KiB UTF-8 en las
  respuestas, indicando truncamiento mediante `summaryTruncated`;
* `contentBytes` se calcula en PostgreSQL mediante `octet_length(content::text)`, que define de
  forma única la representación JSON UTF-8 usada para aplicar el límite;
* artifacts históricos sin esos valores derivados continúan siendo legibles y devuelven `null`
  donde corresponda.

## Feature y Release

La auditoría confirmó que Feature y Release viven actualmente dentro de configuraciones JSONB.

Por lo tanto:

* FEATURE-022 no incluye filtros ni metadata por Feature o Release;
* no debe introducir una migración completa del dominio como efecto colateral.

## Seguridad

El control de acceso debe realizarse en backend.

No es suficiente confiar en:

* instrucciones del prompt;
* IDs provistos por el agente;
* filtrado posterior realizado por el modelo.

El acceso a PostgreSQL se ejecutará en un proxy host confiable, autenticado y efímero, accesible
por Unix socket desde el worker. El proxy queda ligado al `requestingRunId` y al rol al crearse.

El worker aislado:

* no recibe credenciales de PostgreSQL;
* no recibe un `project_id`;
* no permite que el agente elija el `requestingRunId`;
* recibe únicamente socket y token efímeros de esa invocación;
* sólo puede invocar `artifact_list` y `artifact_read`.

La pertenencia se verifica antes de devolver metadata o contenido y dentro de la misma consulta
autorizada. QA conserva `--network none`: el socket Unix no requiere habilitar red.

## Rendimiento

La consulta deberá evitar:

* cargar todos los artifacts del proyecto en memoria;
* realizar lecturas sin límite;
* escanear contenido JSONB innecesariamente;
* repetir consultas completas para cada resultado.

DAIA deberá revisar el plan de consulta con `EXPLAIN`. FEATURE-022 no agregará índices inicialmente;
si la evidencia contradice esta decisión antes del Approval Gate de implementación, deberá
escalarse al owner en vez de incorporar una migración silenciosa.

`artifact_list` consultará `limit + 1`, nunca cargará todo el proyecto y no seleccionará contenido
para retornarlo. `artifact_read` aplica el límite de 64 KiB antes de construir la respuesta para el
agente.

## Compatibilidad con providers

La herramienta deberá funcionar con cualquier provider o modelo soportado por el runtime aislado.

No debe depender de una capacidad específica de Claude, Codex u otro proveedor.

## Ownership

La política de herramientas por rol deberá permitir las operaciones de lectura a todos los roles.

No deberán habilitarse operaciones de escritura genérica de artifacts.

`artifact_list` y `artifact_read` formarán un catálogo compartido que se compondrá en las policies
de Architect, Functional, Planning, Developer y QA. Los futuros roles que utilicen el mismo runtime
deberán incorporar ese catálogo común, sin redefinir permisos caso por caso.

## Observabilidad

El proxy emitirá logs técnicos estructurados con timestamp, run solicitante, rol, operación,
artifact ID sólo para lectura, resultado, cantidad de items y duración. Nunca registrará contenido,
resumen ni filtros de texto libre. FEATURE-022 no persistirá una tabla adicional ni un
`run_event` por cada lectura.

## Roadmap al cierre de implementación

Después de implementar y validar FEATURE-022, y antes del merge definitivo a `main` y su posterior push, DAIA deberá:

1. actualizar `docs/ROADMAP.md`;
2. incorporar FEATURE-022 en la posición acordada;
3. desplazar en `+1` la numeración de todas las Features posteriores;
4. actualizar referencias internas afectadas;
5. verificar que no queden IDs duplicados;
6. verificar que no queden nombres de archivo o enlaces inconsistentes;
7. incluir el cambio del Roadmap en la misma rama de la Feature.

Esta actualización es un requisito de entrega y no parte del comportamiento runtime.

---

# 8. Validation Criteria

## Scenario 1 — Architect lista artifacts del proyecto

**Input**

Un run de Architect asociado a un proyecto con artifacts de varios roles.

**Expected output**

Architect puede listar los artifacts disponibles del proyecto.

La respuesta incluye metadata y resumen, pero no el contenido completo de todos los artifacts.

---

## Scenario 2 — Functional lee un artifact de Architect

**Input**

Functional solicita mediante ID un artifact de diseño producido por Architect dentro del mismo proyecto.

**Expected output**

Functional recibe el artifact y su metadata.

No necesita que el contenido haya sido insertado previamente en su contexto.

---

## Scenario 3 — Planning lee artifacts de Developer y QA

**Input**

Planning consulta artifacts correspondientes a un run anterior de Developer y QA dentro del mismo proyecto.

**Expected output**

Planning puede leer ambos artifacts usando la herramienta común.

El comportamiento no depende de `featureJustCompleted` ni de una herramienta exclusiva para Planning.

---

## Scenario 4 — Developer lee artifacts de Functional y Planning

**Input**

Developer solicita la definición funcional y el plan técnico persistidos en runs anteriores.

**Expected output**

Developer puede recuperar ambos artifacts sin recibir automáticamente todos los artifacts del proyecto.

---

## Scenario 5 — QA consulta artifact de Developer

**Input**

QA solicita un artifact `code` producido por Developer.

**Expected output**

QA recibe el artifact correcto y su trazabilidad.

---

## Scenario 6 — Aislamiento entre proyectos

**Input**

Un rol del Proyecto A intenta leer un `artifact_id` perteneciente al Proyecto B y luego solicita
un identificador inexistente.

**Expected output**

Ambas operaciones devuelven exactamente `ARTIFACT_NOT_FOUND`, sin diferencias observables que
permitan inferir si el ID externo existe.

---

## Scenario 7 — Artifact inexistente

**Input**

Un rol solicita un identificador inexistente y otro request usa argumentos con forma inválida.

**Expected output**

El ID inexistente devuelve `ARTIFACT_NOT_FOUND`. Los argumentos inválidos devuelven
`INVALID_ARGUMENTS`.

El run no falla por una excepción no manejada.

---

## Scenario 8 — Listado filtrado

**Input**

Un rol lista artifacts filtrando por `kind`, fase o run.

**Expected output**

Sólo se devuelven resultados que cumplen los filtros.

El orden es determinístico.

---

## Scenario 9 — Límite de resultados

**Input**

Un proyecto contiene más artifacts que el límite configurado.

**Expected output**

La herramienta devuelve únicamente el máximo permitido, `truncated: true` y un `nextCursor`
opaco. Al reutilizar el cursor devuelve la página siguiente sin duplicados ni omisiones, incluso
cuando varios artifacts tienen el mismo `created_at`.

---

## Scenario 10 — Contenido grande

**Input**

Un rol solicita un artifact cuya representación JSON UTF-8 supera 64 KiB.

**Expected output**

La herramienta devuelve metadata, resumen existente, tamaño total, `content: null`,
`complete: false` y `reason: "CONTENT_TOO_LARGE"`. No devuelve contenido parcial ni rompe el
contexto.

---

## Scenario 11 — Artifact histórico

**Input**

Un rol solicita un artifact creado antes de FEATURE-022 y sin metadata enriquecida.

**Expected output**

El artifact continúa siendo legible mediante su ID, siempre que pertenezca al proyecto autorizado.

---

## Scenario 12 — Herramientas de solo lectura

**Input**

Un rol intenta usar la herramienta para modificar un artifact.

**Expected output**

No existe operación de escritura disponible.

El artifact permanece sin cambios.

---

## Scenario 13 — Todos los roles tienen acceso

**Input**

La misma operación de listado y lectura se ejecuta desde cada rol soportado.

**Expected output**

Todos los roles pueden utilizar la capacidad sin políticas especiales de exclusión.

---

## Scenario 14 — No acumulación de contexto

**Input**

Se inicia un rol dentro de un proyecto con numerosos artifacts.

**Expected output**

El contexto inicial no incluye automáticamente el contenido completo del historial.

Los artifacts se incorporan únicamente cuando el rol utiliza las herramientas.

---

## Scenario 15 — Filtro por run externo

**Input**

Un rol del Proyecto A ejecuta `artifact_list` con el `run_id` de un run del Proyecto B.

**Expected output**

La respuesta contiene una lista vacía y no revela metadata del run o proyecto externo.

---

## Scenario 16 — Run solicitante inválido

**Input**

El runtime intenta operar con un `requestingRunId` inexistente o con `project_id` nulo.

**Expected output**

El proxy falla de forma cerrada antes de consultar o devolver artifacts. El agente no puede
reemplazar ese run ID mediante argumentos.

---

## Scenario 17 — Logs sin contenido

**Input**

Un rol lista y lee un artifact cuyo contenido y resumen contienen un valor canario.

**Expected output**

El log técnico incluye run, rol, operación, resultado, cantidad o artifact ID y duración, pero no
incluye el canario, el contenido, el resumen ni filtros de texto libre.

---

## Scenario 18 — QA conserva aislamiento de red

**Input**

QA utiliza `artifact_list` y `artifact_read` dentro de su runtime con `--network none`.

**Expected output**

Ambas operaciones funcionan mediante Unix socket sin habilitar red, comandos o herramientas de
escritura.

---

## Scenario 19 — Worker sin credenciales DB

**Input**

Se inspecciona el entorno efectivo del worker de cada rol durante una consulta.

**Expected output**

No contiene credenciales ni URL de PostgreSQL, `project_id` o un `requestingRunId` controlable. El
acceso DB ocurre exclusivamente en el proxy host confiable.

---

## Scenario 20 — Cursor inválido

**Input**

Un rol llama `artifact_list` con un cursor malformado.

**Expected output**

La herramienta devuelve `INVALID_ARGUMENTS`, no ejecuta una consulta y no revela el contenido
interno del cursor.

---

## Scenario 21 — Compatibilidad de metadata histórica

**Input**

Un artifact histórico tiene una `phase` no reconocida, no contiene `summary` y tiene
`commit_ref = null`.

**Expected output**

El listado y la lectura conservan `phase`, devuelven `producerRole: null`, `summary: null` y
`commitRef: null`, sin bloquear el acceso autorizado.

---

## Scenario 22 — Resumen grande

**Input**

Un artifact contiene un `summary` cuya representación UTF-8 supera 2 KiB.

**Expected output**

`artifact_list` y `artifact_read` devuelven como máximo 2 KiB UTF-8 del resumen,
`summaryTruncated: true` y nunca incorporan el resumen completo al log técnico.

---

## Validation Evidence

La implementación deberá presentar:

* tests unitarios de repositorio;
* tests de autorización por proyecto;
* tests de las herramientas aisladas;
* tests parametrizados para todos los roles;
* tests de artifact inexistente;
* tests de límites;
* test de resumen mayor a 2 KiB;
* tests de artifacts históricos;
* tests de cursor, incluyendo empate de `created_at`;
* tests que demuestren el mismo error para ID inexistente y externo;
* test de filtro `run_id` de otro proyecto;
* tests de run solicitante inexistente o sin proyecto;
* test de logs sin contenido ni resumen;
* test de QA con `--network none`;
* test de worker sin credenciales DB;
* evidencia de que las herramientas no mutan datos;
* resultado completo de la suite;
* tests parametrizados de policy y worker para Architect, Functional, Planning, Developer y QA;
* un smoke real por provider para validar el wiring de Claude y Codex, sin exigir una invocación
  LLM por cada combinación de rol y provider;
* diff final del Roadmap renumerado.

---

# 9. Risks

## Risk 1 — Convertir la Feature en un sistema documental completo

La lectura universal podría derivar en:

* búsqueda semántica;
* permisos complejos;
* edición;
* versionado avanzado;
* almacenamiento externo.

**Mitigation**

Limitar FEATURE-022 a listado, lectura, aislamiento y control de volumen.

## Risk 2 — Mantener identidad insuficiente

La falta de relación Feature/Release puede limitar filtros útiles.

**Mitigation**

Aceptar esa limitación explícitamente y agregar sólo metadata indispensable. No ocultar inferencias como relaciones confiables.

## Risk 3 — Fuga entre proyectos

Una validación incompleta podría permitir leer artifacts externos usando un ID conocido.

**Mitigation**

Derivar siempre el proyecto desde el run activo y validar la pertenencia en backend.

## Risk 4 — Explosión de contexto

Un artifact grande podría consumir demasiado contexto.

**Mitigation**

Separar listado de lectura, limitar `artifact_list` a 20 por default y 100 como máximo, limitar cada
resumen a 2 KiB y no devolver contenido mayor a 64 KiB en v1.

## Risk 5 — Políticas desiguales por rol

La capacidad podría quedar habilitada sólo en algunos roles por error.

**Mitigation**

Definir una política común y pruebas parametrizadas para todos los roles.

## Risk 6 — Crear un caso especial para Planning

La implementación podría resolver únicamente `featureJustCompleted`.

**Mitigation**

Los criterios de aceptación requieren lectura cruzada desde todos los roles.

## Risk 7 — Romper artifacts históricos

Agregar metadata obligatoria podría impedir acceder a registros anteriores.

**Mitigation**

Mantener compatibilidad y campos nuevos opcionales cuando corresponda.

## Risk 8 — Consultas ineficientes

La búsqueda por proyecto podría resultar costosa en proyectos grandes.

**Mitigation**

Reutilizar `runs_project_id_idx` y `artifacts_run_id_idx`, verificar con `EXPLAIN` y no agregar
índices o denormalización sin evidencia.

## Risk 9 — Lectura usada como sustituto de lifecycle documental

La existencia de una biblioteca de artifacts podría confundirse con la generación de documentos canónicos del Runbook.

**Mitigation**

Mantener explícitamente fuera de alcance el lifecycle de los cuatro templates.

## Risk 10 — Renumeración incompleta del Roadmap

La incorporación retroactiva de FEATURE-022 puede dejar referencias desactualizadas.

**Mitigation**

DAIA deberá buscar y actualizar referencias internas antes del merge.

## Risk 11 — Confiar acceso DB al worker aislado

Entregar credenciales o identidad seleccionable al worker podría romper el aislamiento aunque las
tools nominalmente sean de lectura.

**Mitigation**

Ejecutar las consultas en un proxy host confiable por Unix socket, ligado al run y rol por el
Orquestador, con token efímero y sin exponer credenciales, `project_id` o `requestingRunId`
controlable al worker.

## Risk 12 — Cursor inválido o inconsistente

Un cursor malformado o sin desempate estable podría repetir resultados u omitir artifacts con el
mismo timestamp.

**Mitigation**

Usar un cursor opaco validado que represente internamente `(created_at, id)`, rechazar cursores
malformados con `INVALID_ARGUMENTS` y mantener el orden `(created_at DESC, id DESC)`.

---

# 10. Approval Gate

La implementación de FEATURE-022 está prohibida hasta recibir aprobación humana explícita.

La aprobación debe confirmar:

* alcance general para todos los roles;
* lectura de cualquier artifact del proyecto;
* operaciones de solo lectura;
* contexto bajo demanda;
* aislamiento por proyecto;
* `requestingRunId` ligado internamente por el Orquestador;
* error indistinguible `ARTIFACT_NOT_FOUND`;
* límite de 64 KiB sin lectura parcial;
* listado con límite 20/100 y cursor opaco;
* resúmenes limitados a 2 KiB con indicador de truncamiento;
* reutilización de la persistencia actual;
* proxy host confiable por Unix socket, sin credenciales DB en workers;
* logs estructurados sin contenido, sin tabla ni evento por lectura;
* ausencia de migraciones e índices nuevos en v1;
* exclusión del lifecycle completo de templates;
* actualización y renumeración del Roadmap antes del merge.

**Estado del Approval Gate:** Aprobado por confirmación explícita del owner el 2026-07-28.
