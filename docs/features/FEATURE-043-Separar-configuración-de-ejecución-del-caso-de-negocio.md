# FEATURE-043 — Separar repositorio y rama del caso de negocio

# 1. Feature Identity

* **Name:** Separar repositorio y rama del caso de negocio
* **Type:** Refactor funcional / evolución del modelo de dominio
* **Owner:** Asdrubal Pérez
* **Status:** Implementada y validada E2E en producción real (2026-08-02)
* **Priority:** Baja
* **Approval Gate:** Cerrado — aprobado por el owner, implementación completa

---

## Resultado de la implementación (2026-08-02)

Implementada en la rama `feature/043-separar-configuracion-ejecucion` (commits `c69a0bc`, `bf0634a`)
sobre el diseño aprobado más arriba. Backend: `migrations/0018` (`runs.base_branch_name`, nullable,
separada de `business_case` y de `branch_name`), `migrations/0019` (elimina la fila `repositorio` de
`intake_field_definitions`), `getRootRunExecutionContext` (resuelve `business_case` + rama del run
raíz en una sola consulta), resolver de precedencia en `confirmIntakeForProject`/`startPendingRun`
(columna nueva -> legacy en `business_case` -> default), y en `persistReleasePlanIfDeclared` con un
tercer nivel adicional no previsto en el diseño original (ver hallazgo abajo). Frontend:
`ReviewModal.tsx` separado en secciones "Caso de negocio"/"Ejecución", repositorio del proyecto
solo lectura, completitud recalculada solo sobre campos descriptivos.

**Hallazgo real durante la implementación, no cubierto por el diseño**: el comando CLI
`run:start --case` (`createRun`) nunca persiste `business_case` en la base de datos — solo lo pasa
en memoria como `initialContext`. La sección 7.7 del diseño recomendaba resolver la rama del primer
Release Plan consultando directamente la DB (`getRootRunExecutionContext`); reemplazar el fallback
en memoria por esa consulta sin más hubiera roto ese camino del CLI en silencio. Se resolvió con una
cadena de precedencia de tres niveles: columna nueva -> `business_case` del run raíz ya persistido
en DB (runs legacy del flujo web) -> `initialContext` en memoria (camino exclusivo del CLI).

**Segundo hallazgo, encontrado en la validación manual del owner, no anticipado por el diseño**: la
columna `description` de `rama_base_trabajo` en `intake_field_definitions` (desde
`migrations/0009`, sin tocar desde su creación) decía literalmente `'... default "main" si no se
indica'` — ese texto se inyecta tal cual en el prompt de mapeo (`buildMappingPrompt`), así que el
modelo cumplía al pie de la letra y devolvía `"main"` en vez de `null` cuando el texto no mencionaba
ninguna rama. Como la sugerencia automática del frontend solo actúa sobre un campo vacío, esto la
dejaba sin efecto siempre — la iniciativa central de esta Feature (que la rama nunca sea "main" por
default silencioso, sino una sugerencia real basada en el contenido del caso) quedaba anulada por un
texto de configuración que predataba esa sugerencia y nunca se había actualizado. Corregido en
`migrations/0020` (retira la instrucción de default; la Regla 1 general del prompt — "nunca
inventes, va en null" — ya cubre este campo como a cualquier otro).

**Validación E2E real (2026-08-02, `aio.asdru.space`/`api.aio.asdru.space`)**: el owner probó el
flujo completo con un caso real — el modal mostró "10 campos" (la rama ya no cuenta en el
porcentaje del caso de negocio), la sección "Ejecución" separada con
`asdrubalperez/pruebas-ia` en solo lectura, y la rama sugerida
`feature/modulo-interno-de-calculo-de-propinas-para-un-sistema-de-fac` (derivada del contenido real
del caso, no "main" ni un placeholder genérico). El owner creó el caso y ejecutó el run de punta a
punta sin errores.

Tests: `tsc --noEmit` limpio en backend y frontend; suite completa 255 pass / 0 fail, incluidos 5
tests nuevos de las funciones puras del modal (`ReviewModal.test.tsx`) y un test de integración real
contra Postgres (`repository.test.ts`, con skip si no hay DB local) que valida la persistencia
separada y la resolución vía run raíz para un run hijo.

---

# 2. Problem Statement

Los campos descriptivos del caso de negocio y parte de la configuración técnica de ejecución se encuentran actualmente mezclados dentro del mismo modelo de intake.

Los campos `repositorio` y `rama_base_trabajo` continúan definidos junto con los campos descriptivos en `intake_field_definitions`, pero su comportamiento real ya es diferente.

## `repositorio`

Después de FEATURE-042, el repositorio de los casos nuevos procede del proyecto seleccionado.

Sin embargo:

* continúa incluyéndose en el prompt de mapeo;
* el modelo todavía puede extraerlo;
* el frontend lo oculta;
* `confirmIntakeForProject` lo elimina antes de persistir;
* permanece como fallback operativo para determinados runs legacy cuyo proyecto no dispone de repositorio canónico.

Por tanto, `repositorio` es peso muerto para los casos nuevos, pero su valor histórico no puede eliminarse indiscriminadamente porque todavía participa en la compatibilidad de ejecución de runs antiguos.

## `rama_base_trabajo`

La rama continúa siendo funcional:

* puede extraerse desde el texto libre;
* se revisa y modifica en el modal;
* se valida antes de confirmar;
* se vuelve a leer y validar al iniciar el run;
* se utiliza para el clon o checkout;
* se utiliza como fallback al persistir el primer `RELEASE_PLAN` del proyecto.

Actualmente se encuentra almacenada en `business_case`, aunque representa configuración de ejecución.

Separarla sin actualizar todos sus consumidores rompería el flujo productivo. En particular, `persistReleasePlanIfDeclared` falla de forma dura cuando Planning declara el primer `RELEASE_PLAN` y no puede resolver `ramaBaseTrabajo`.

La Feature debe separar el modelo sin perder:

* el gate previo al inicio;
* el clon de la rama;
* la creación del primer Release Plan;
* la continuidad de runs históricos;
* el fallback legacy de repositorio.

---

# 3. Functional Goal

Después de implementar la Feature:

* los casos nuevos no extraerán ni persistirán `repositorio`;
* el repositorio de los casos nuevos procederá exclusivamente del proyecto;
* los runs legacy podrán seguir utilizando `business_case.repositorio` cuando no exista repositorio canónico en su proyecto;
* la IA podrá seguir extrayendo una rama mencionada en el texto;
* la rama se presentará como configuración de ejecución;
* la rama de los runs nuevos se persistirá fuera de `business_case`;
* todos los consumidores actuales obtendrán la rama mediante un resolver central;
* el gate de confirmación, el gate de inicio, el clon y la persistencia del primer `RELEASE_PLAN` seguirán funcionando;
* los runs históricos seguirán siendo legibles y ejecutables dentro de las reglas de compatibilidad existentes.

---

# 4. Scope

## Included

* Eliminar `repositorio` de las definiciones utilizadas para mapear casos nuevos.
* Eliminar su extracción mediante IA para nuevos casos.
* Eliminar la lógica de ocultación y descarte que deje de ser necesaria.
* Mantener el repositorio del proyecto como fuente primaria.
* Preservar el fallback histórico de `business_case.repositorio` exclusivamente para runs legacy.
* Mantener la extracción mediante IA de `rama_base_trabajo`.
* Separar la rama del JSON descriptivo de los nuevos runs.
* Crear una ubicación persistente específica para la rama base.
* Introducir un resolver central de rama.
* Aplicar el resolver en:

  * confirmación del intake;
  * inicio del run;
  * clon o checkout;
  * validación de rama;
  * construcción de contexto;
  * persistencia del primer `RELEASE_PLAN`;
  * lecturas de runs encadenados o históricos.
* Actualizar `ramaBaseTrabajoFromBusinessCase` o reemplazar su responsabilidad por el nuevo resolver.
* Actualizar `persistReleasePlanIfDeclared`.
* Revisar el cálculo de completitud del modal.
* Mantener compatibilidad con `getBusinessCaseForRun`.
* Actualizar los tests de `runStart.ts`, intake, mapeo, persistencia y frontend.

## Excluded

* Permitir elegir otro repositorio por caso.
* Eliminar inmediatamente el fallback de repositorio legacy.
* Migrar o limpiar masivamente todos los JSON históricos.
* Rediseñar `branchValidationService`.
* Crear una tabla genérica de configuración.
* Crear categorías configurables para todos los campos.
* Modificar la semántica de `runs.branch_name`.
* Rediseñar el ciclo de vida de Releases.
* Cambiar el contrato funcional de `RELEASE_PLAN`.

## Future ideas

* Retirar el fallback legacy de repositorio cuando ya no existan runs compatibles que lo necesiten.
* Crear una entidad de configuración de ejecución si aparecen varios atributos operativos.
* Migrar históricos mediante un proceso específico si existe una necesidad operativa comprobada.

---

# 5. Functional Rules

## 5.1 Repositorio de casos nuevos

1. El repositorio debe proceder de `project.repository_clone_url`.
2. `repositorio` no debe incluirse entre los campos esperados por el mapeo.
3. Una URL o nombre de repositorio mencionado en el texto no debe cambiar el destino de ejecución.
4. Los nuevos `business_case` no deben contener `repositorio`.
5. La UI no debe ofrecer un repositorio editable dentro del intake.

## 5.2 Compatibilidad de repositorio legacy

1. El proyecto es siempre la fuente primaria.
2. Cuando un run histórico no tenga repositorio canónico de proyecto, se permite el fallback a `business_case.repositorio`.
3. Este fallback debe permanecer explícitamente identificado como compatibilidad legacy.
4. La Feature no debe eliminarlo accidentalmente.
5. El fallback no debe utilizarse para casos nuevos.
6. Su retirada futura requerirá una Feature o decisión explícita.

## 5.3 Extracción de rama

1. La rama debe continuar siendo extraíble desde el texto libre.
2. Una rama explícitamente mencionada debe prevalecer sobre una sugerencia automática.
3. La sugerencia solo se utiliza cuando no hay rama extraída ni introducida.
4. El usuario puede modificar la rama antes de confirmar.
5. El valor confirmado debe persistirse en la nueva ubicación.

## 5.4 Resolución central de rama

Debe existir un único mecanismo conceptual para resolver la rama base.

Orden de precedencia:

1. Nueva ubicación persistente de la rama base.
2. Valor histórico `business_case.rama_base_trabajo`.
3. Valor contenido en un contexto legacy anidado bajo `businessCase`, cuando corresponda.
4. Default funcional vigente, únicamente en los puntos donde el comportamiento actual admita `main`.
5. Ausencia de valor.

El resolver debe distinguir entre:

* resolución para confirmación;
* resolución para inicio;
* resolución histórica;
* resolución para persistencia de Release Plan.

No todos los consumidores pueden aplicar silenciosamente `main`. El primer `RELEASE_PLAN`, por ejemplo, debe recibir una rama confirmada y coherente con la ejecución real.

## 5.5 Persistencia

1. Los campos descriptivos deben persistirse en `runs.business_case`.
2. La rama base debe persistirse fuera de `business_case` para runs nuevos.
3. No debe mantenerse escritura dual permanente.
4. Durante una migración controlada puede aceptarse lectura dual.
5. El evento `intake_confirmed` debe reflejar de forma separada:

   * caso de negocio;
   * configuración de ejecución, cuando su contrato lo permita.

## 5.6 Inicio del run

1. `startPendingRun` debe leer la rama mediante el resolver central.
2. Debe mantener el gate `validateForRunStart`.
3. La rama usada para validar debe ser la misma utilizada para el clon o checkout.
4. La ausencia de rama debe seguir las reglas de default existentes únicamente cuando sean válidas.
5. El repositorio debe resolverse con:

   * proyecto;
   * fallback legacy, cuando aplique.

## 5.7 Primer Release Plan

1. `persistReleasePlanIfDeclared` debe seguir garantizando que todo `RELEASE_PLAN` persistido contiene `ramaBaseTrabajo`.
2. En la primera versión del Release Plan, la rama debe obtenerse desde la nueva ubicación persistente del run raíz.
3. Para runs históricos, podrá utilizarse el fallback desde el `business_case` raíz.
4. En versiones posteriores debe conservarse la rama del Release Plan vigente, tal como ocurre actualmente.
5. La separación de `business_case` no puede provocar el error:

   * “Planning declaró RELEASE_PLAN pero no hay ramaBaseTrabajo disponible”.
6. La rama incorporada al Release Plan debe coincidir con la rama base utilizada para iniciar la ejecución.
7. No debe confundirse con la rama de trabajo materializada del run.

## 5.8 Diferencia entre rama base y `runs.branch_name`

1. La nueva ubicación representa la **rama base de trabajo solicitada o confirmada para el caso**.
2. `runs.branch_name` representa la rama de trabajo efectiva registrada por el runtime.
3. Ambos conceptos no deben reutilizar la misma columna.
4. El nombre de la nueva columna debe evitar ambigüedad con `branch_name`.
5. La documentación y los tipos deben explicar explícitamente la diferencia.

## 5.9 Completitud del intake

1. La separación visual no debe romper el gate de confirmación.
2. Debe decidirse explícitamente si la rama forma parte del porcentaje descriptivo del caso.
3. Recomendación:

   * el porcentaje de “Caso de negocio” debe calcularse solo con campos descriptivos;
   * la sección “Ejecución” debe tener su propia validación.
4. `canContinue` debe requerir:

   * caso descriptivo completo según sus reglas;
   * configuración de ejecución válida según sus reglas.
5. La rama no debe desaparecer del gate simplemente por dejar de formar parte de `visibleFields`.

---

# 6. Estrategia Algorítmica

No introduce un algoritmo de optimización, pero sí una lógica determinística de resolución.

## Objetivo

Resolver una única rama base coherente para todos los puntos del ciclo de vida.

## Entradas

* rama persistida en la nueva ubicación;
* `business_case` histórico;
* contexto legacy anidado;
* Release Plan vigente;
* default permitido por el flujo.

## Salidas

* rama base normalizada;
* ausencia explícita;
* error funcional cuando la rama sea obligatoria.

## Prioridades

### Para iniciar un run

1. Nueva ubicación.
2. `business_case.rama_base_trabajo` legacy.
3. Default `main`, si continúa siendo la regla aprobada.

### Para persistir el primer Release Plan

1. Rama ya persistida en el Release Plan vigente, si existe.
2. Nueva ubicación del run raíz.
3. `business_case` histórico del run raíz.
4. Error duro si no existe ninguna rama válida.

### Para sugerencia de UI

1. Rama extraída.
2. Rama introducida por el usuario.
3. Sugerencia automática.
4. Default visual, solo cuando esté definido.

## Comportamiento determinístico

Para las mismas fuentes persistidas, todos los consumidores deben resolver la misma rama.

---

# 7. Technical Considerations

## 7.1 Modelo de datos

Debe agregarse una columna nullable específica en `runs`.

Nombre recomendado:

```text
base_branch_name
```

o un nombre equivalente inequívoco.

No se recomienda `rama_base_trabajo` si el esquema utiliza nombres ingleses, ni un nombre que pueda confundirse con `branch_name`.

La nueva columna no sustituye `runs.branch_name`.

## 7.2 Diferencia de conceptos

* `base_branch_name`: rama base declarada para el caso.
* `branch_name`: rama efectiva asociada al worktree o ejecución del run.

La implementación debe conservar ambos campos cuando el flujo los necesite.

## 7.3 Resolver central

Debe introducirse una función central, por ejemplo:

```ts
resolveBaseBranchForRun(...)
```

Su contrato debe aceptar las fuentes necesarias sin introducir consultas ocultas difíciles de probar.

Puede complementarse con funciones específicas:

```ts
resolveBaseBranchForStart(...)
resolveBaseBranchForReleasePlan(...)
```

La separación es aceptable cuando cada contexto tenga reglas distintas, pero la precedencia histórica debe estar centralizada.

## 7.4 `confirmIntakeForProject`

Debe:

* validar la rama confirmada;
* persistirla en la nueva columna;
* persistir solo campos descriptivos en `business_case`;
* dejar de descartar manualmente `repositorio` cuando este ya no forme parte del contrato;
* registrar correctamente el evento de confirmación.

## 7.5 `startPendingRun`

Debe modificarse explícitamente.

Actualmente:

* lee `rama_base_trabajo` desde `run.business_case`;
* aplica default `main`;
* resuelve repositorio desde proyecto con fallback al JSON legacy;
* ejecuta el gate de rama antes del clon.

Después de FEATURE-043 debe:

* resolver la rama desde la nueva columna con fallback histórico;
* conservar el fallback legacy de repositorio;
* ejecutar el mismo gate;
* utilizar la rama resuelta para el clon;
* evitar que distintos valores se utilicen entre validación y checkout.

## 7.6 `getBusinessCaseForRun`

La función existente para recuperar el caso de negocio raíz es:

```text
getBusinessCaseForRun
```

No existe `getLatestBusinessCaseInChain`.

La solución debe decidir entre:

* ampliar la consulta para recuperar también la nueva rama base del run raíz;
* crear una función equivalente que devuelva contexto de ejecución y caso de negocio;
* realizar una consulta específica desde el resolver.

Recomendación mínima:

```ts
getRootRunExecutionContext(runId)
```

con una salida semejante a:

```ts
{
  businessCase: unknown;
  baseBranchName: string | null;
}
```

Esto evita mantener dos consultas independientes sobre el mismo run raíz.

## 7.7 `runStart.ts`

Debe incluirse expresamente entre los componentes afectados.

### `ramaBaseTrabajoFromBusinessCase`

Actualmente resuelve:

* `rama_base_trabajo` directa;
* `businessCase.rama_base_trabajo` con recursión acotada.

Después de la Feature:

* no puede seguir siendo la fuente primaria para runs nuevos;
* puede conservarse como parser de compatibilidad legacy;
* debe quedar detrás del resolver central;
* su nombre o documentación debe indicar claramente que solo procesa estructuras históricas.

### `persistReleasePlanIfDeclared`

Actualmente:

1. conserva `ramaBaseTrabajo` de una configuración previa;
2. si no existe, usa `fallbackRamaBaseTrabajo`;
3. falla de forma dura si ninguna fuente contiene la rama.

Debe recibir una rama resuelta desde:

1. configuración previa del Release Plan;
2. nueva ubicación del run raíz;
3. `business_case` histórico del run raíz.

No debe depender exclusivamente del JSON descriptivo.

### Llamadores

Todos los puntos que construyen `fallbackRamaBaseTrabajo` deben actualizarse y probarse. No basta con modificar la función pura de extracción.

## 7.8 Mapeo

`mapBusinessCase.ts` debe separar:

```ts
interface IntakeMappingResult {
  businessCase: Record<string, string | null>;
  execution: {
    baseBranchName: string | null;
  };
}
```

No debe incluir `repositorio`.

El parser debe tolerar únicamente el formato legacy durante la transición definida, no de manera indefinida.

## 7.9 Frontend

`ReviewModal.tsx` debe mostrar:

### Caso de negocio

Campos descriptivos.

### Ejecución

* repositorio del proyecto, solo lectura;
* rama base, editable;
* resultado del gate.

También debe revisar:

* `completenessPercent`;
* `canContinue`;
* cualquier contador basado en `visibleFields`;
* prioridad entre rama extraída y sugerencia automática.

## 7.10 Arquitectura afectada

Como mínimo:

* nueva migración de `runs`;
* migración correctiva de `intake_field_definitions`;
* tipos de `RunRow`;
* funciones de creación y lectura de runs;
* `src/cli/intakeService.ts`;
* `src/intake/mapBusinessCase.ts`;
* `src/intake/mapBusinessCase.test.ts`;
* `src/cli/commands/runStart.ts`;
* `src/cli/commands/runStart.test.ts`;
* `src/db/repository.ts`;
* `web/src/intake/ReviewModal.tsx`;
* tests del modal o de su lógica;
* consumidores de `business_case.rama_base_trabajo`;
* eventos que serialicen el caso;
* contratos API afectados.

## 7.11 Dependencias

* FEATURE-019, por la incorporación de la rama al Release Plan.
* FEATURE-020, por la recuperación del `business_case` del run raíz y contextos de reingreso.
* FEATURE-042, por repositorio canónico a nivel de proyecto y gates Git.
* FEATURE-026, por autenticación y gestión del repositorio.
* `branchValidationService`.
* ciclo de vida de `RELEASE_PLAN`.

## 7.12 Migración histórica

No se requiere inicialmente un backfill masivo.

Se recomienda:

* lectura desde nueva columna;
* fallback histórico desde JSON;
* escritura nueva exclusivamente en columna.

Un backfill podrá evaluarse si simplifica de forma significativa la operación de runs históricos activos.

---

# 8. Validation Criteria

## Scenario 1 — Repositorio no enviado al modelo

**Input**

Texto que menciona un repositorio.

**Expected output**

* El prompt no solicita `repositorio`.
* El resultado no contiene `repositorio`.
* El proyecto continúa determinando el repositorio.

## Scenario 2 — Run nuevo con repositorio de proyecto

**Input**

Proyecto configurado y caso nuevo.

**Expected output**

* Se utiliza `project.repository_clone_url`.
* El JSON no contiene `repositorio`.
* No se utiliza ningún valor mencionado en el texto.

## Scenario 3 — Run legacy sin repositorio canónico

**Input**

Run histórico con `business_case.repositorio` y proyecto sin `repository_clone_url`.

**Expected output**

* `startPendingRun` utiliza el fallback legacy.
* El comportamiento previo se conserva.
* No se interpreta como comportamiento permitido para casos nuevos.

## Scenario 4 — Rama explícita en texto

**Input**

“Implementar desde la rama develop”.

**Expected output**

* Se extrae `develop`.
* La sugerencia no la sobrescribe.
* Se valida y persiste fuera del JSON.

## Scenario 5 — Persistencia separada

**Input**

Confirmación con rama `develop`.

**Expected output**

* La nueva columna contiene `develop`.
* `business_case` no contiene la rama.
* `business_case` no contiene repositorio.

## Scenario 6 — Inicio de run nuevo

**Input**

Run nuevo con nueva columna `develop`.

**Expected output**

* `startPendingRun` resuelve `develop`.
* El gate valida `develop`.
* El clon utiliza `develop`.

## Scenario 7 — Inicio de run histórico

**Input**

Run sin nueva columna y con rama en el JSON.

**Expected output**

* El resolver obtiene la rama histórica.
* El gate y el clon continúan funcionando.

## Scenario 8 — Primer `RELEASE_PLAN` de un run nuevo

**Input**

Planning declara `RELEASE_PLAN` y la rama solo existe en la nueva columna.

**Expected output**

* `persistReleasePlanIfDeclared` obtiene la rama.
* Persiste el plan con `ramaBaseTrabajo`.
* No lanza el error de rama ausente.

## Scenario 9 — Primer `RELEASE_PLAN` legacy

**Input**

Run histórico sin nueva columna y con rama en `business_case`.

**Expected output**

* Se utiliza el fallback histórico.
* El Release Plan se persiste correctamente.

## Scenario 10 — Release Plan posterior

**Input**

Ya existe un Release Plan con `ramaBaseTrabajo`.

**Expected output**

* Se conserva el valor vigente.
* No se sustituye por otro fallback.

## Scenario 11 — Ninguna rama disponible

**Input**

No existe rama en configuración previa, nueva columna ni JSON histórico.

**Expected output**

* Cuando el flujo requiera obligatoriamente una rama para persistir el Release Plan, se produce un error explícito.
* El error identifica todas las fuentes consultadas.
* No afirma únicamente que falta en `business_case`.

## Scenario 12 — Diferencia entre ramas

**Input**

Run con rama base `develop` y `branch_name` de ejecución `feature/043`.

**Expected output**

* Ambos valores se conservan.
* Ningún campo sobrescribe al otro.
* Cada consumidor utiliza el concepto correcto.

## Scenario 13 — Completitud visual

**Input**

Campos descriptivos completos y rama pendiente.

**Expected output**

* El caso de negocio puede mostrar 100 % descriptivo.
* `canContinue` permanece bloqueado hasta que la ejecución sea válida, cuando corresponda.
* La UI comunica cuál sección falta.

## Scenario 14 — Regresión de reingreso

**Input**

Contexto `ReentryContext` con `businessCase` legacy anidado.

**Expected output**

* El resolver conserva la compatibilidad.
* No se reproduce el incidente documentado en FEATURE-020.

## Scenario 15 — Tests existentes

**Input**

Suite completa, incluyendo `runStart.test.ts`.

**Expected output**

* Se actualizan los tests directos de `ramaBaseTrabajoFromBusinessCase`.
* Se agregan tests de la nueva fuente.
* Se cubre la persistencia del primer Release Plan.

## Validation Evidence

Debe obtenerse evidencia de:

* prompt sin `repositorio`;
* nuevo run sin campos operativos en el JSON;
* columna de rama persistida;
* modal con secciones separadas;
* gate de confirmación exitoso;
* gate de inicio exitoso;
* clon sobre la rama correcta;
* primer Release Plan con `ramaBaseTrabajo`;
* ejecución legacy con fallback de repositorio;
* run histórico con fallback de rama;
* diferencia observable entre rama base y `branch_name`;
* suite automatizada completa.

---

# 9. Risks

## Riesgo 1 — Ruptura del primer Release Plan

**Impacto:** crítico.

Separar la rama del JSON sin modificar `runStart.ts` provoca un fallo productivo cuando Planning declara el primer `RELEASE_PLAN`.

**Mitigación**

Actualizar conjuntamente:

* resolver del run raíz;
* `ramaBaseTrabajoFromBusinessCase`;
* llamadores;
* `persistReleasePlanIfDeclared`;
* tests de regresión.

## Riesgo 2 — Eliminar el fallback legacy de repositorio

**Impacto:** alto para runs históricos.

**Mitigación**

Mantenerlo explícitamente fuera del flujo de casos nuevos.

## Riesgo 3 — Inconsistencia entre confirmación e inicio

La rama validada al confirmar podría ser distinta de la utilizada al iniciar.

**Mitigación**

Persistir el valor confirmado y reutilizarlo mediante el resolver.

## Riesgo 4 — Confusión con `runs.branch_name`

**Mitigación**

Utilizar nombres distintos, documentar semánticas y agregar tests con valores diferentes.

## Riesgo 5 — Gate visual incompleto

Separar la UI podría eliminar involuntariamente la rama del cálculo de `canContinue`.

**Mitigación**

Separar completitud descriptiva y validez de ejecución.

## Riesgo 6 — Lectores directos del JSON

Consumidores no identificados podrían seguir leyendo la rama directamente.

**Mitigación**

Búsqueda completa de referencias y migración al resolver central.

## Riesgo 7 — Escritura dual permanente

**Mitigación**

Definir claramente que la escritura nueva solo utiliza la columna.

## Riesgo 8 — Cambio del contrato del modelo

**Mitigación**

Tests de parser, estructura y respuestas incompletas.

## Riesgo 9 — Error de consulta del run raíz

Una consulta incorrecta podría leer la rama del run derivado en vez del raíz.

**Mitigación**

Extender o complementar `getBusinessCaseForRun` utilizando `root_run_id` y pruebas de cadenas.

---

# 10. Approval Gate

La implementación permanece prohibida.

Antes de aprobar deben confirmarse:

1. La nueva ubicación persistente y su nombre.
2. La diferencia respecto de `runs.branch_name`.
3. El contrato del resolver central.
4. La actualización de `startPendingRun`.
5. La actualización de `runStart.ts`.
6. La fuente usada por `persistReleasePlanIfDeclared`.
7. La compatibilidad de repositorio legacy.
8. La revisión de `completenessPercent` y `canContinue`.
9. Los escenarios de regresión del primer Release Plan.
10. La actualización de `runStart.test.ts`.

**Estado del gate:** cerrado — diseño corregido pendiente de nueva revisión técnica.
