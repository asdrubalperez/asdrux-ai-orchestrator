# FEATURE-019 — Modelo de circuitos anidados para el ciclo de Releases y Features

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: Surge directamente de la revisión de cierre de FEATURE-018 (ver su sección
> "Lecciones Aprendidas" en `docs/features/FEATURE-018-*.md` y en `docs/ROADMAP.md`). El modelo de
> 3 circuitos anidados fue propuesto por el owner (diagramas AS IS / TO BE) y validado contra el
> repo real por el Architect antes de este documento. FEATURE-020 (adaptar lo ya implementado en
> FEATURE-018 a este mecanismo) es una Feature separada, no se hace en este documento.

---

## 1. Feature Identity

- **Name**: Modelo de circuitos anidados para el ciclo de Releases y Features
- **Type**: Backend (motor de pipeline, roles `functional.txt`/`planning.txt`, mecanismo de
  continuación) + Gobernanza (`08-CODE-SYSTEM-PROMPT.md`, `06-DELIVERY-WORKFLOW.md`)
- **Owner**: asdru
- **Status**: 🟢 Aprobada — Go del owner tras 5 rondas de validación técnica (Codex/DAIA). En
  implementación en la rama `feature/019-modelo-circuitos-anidados`.
- **Priority**: Confirmada (`docs/ROADMAP.md`)

---

## 2. Problem Statement

Al cerrar FEATURE-018 se encontraron tres huecos reales, verificados contra el repo (ver Lecciones
Aprendidas de esa Feature):

1. **No existe "Feature" como dato rastreable** — hoy es prosa dentro del artefacto de texto de
   Planning (`ARTEFACTO`), sin ningún registro con estado que el sistema pueda consultar.
2. **El motor de pipeline (`src/pipelines/definitions.ts`) solo corre una Feature por invocación**
   y termina el run al aprobar QA (`finishRun`, `src/cli/commands/runStart.ts`) — no hay
   continuación a la Feature siguiente ni disparo de cierre de release.
3. **El texto de Developer en `08-CODE-SYSTEM-PROMPT.md`** ("si hay Feature siguiente, continúa
   con ella por su cuenta") **choca con la Regla 10** (Ownership de Artefactos, Runbook): el
   Release Plan —y por lo tanto su estado de avance— es propiedad de Planning, no de Developer.

El owner propuso un modelo de 3 circuitos anidados (diagramas AS IS/TO BE acordados en sesión):
Circuito 1 (Roadmap de Releases, Architect→Functional), Circuito 2 (Release Plan, Planning,
repetido por cada Feature), Circuito 3 (Feature Implementation, Developer↔QA, sin cambios). Cada
circuito tiene una salida natural hacia el que lo contiene; reintento (hasta 3, siempre a
Architect) y escalada a humano (siempre a Usuario) se mantienen exactamente iguales a hoy,
aplicando uniformemente sin importar en qué circuito ocurra el problema.

---

## 3. Functional Goal

1. Al completar una Feature (QA aprueba, Developer commitea y pushea), el pipeline **continúa
   automáticamente a Planning** en vez de terminar el run.
2. Planning, al recibir el control, decide si hay una Feature siguiente en el release activo: si
   sí, la asigna al circuito Developer↔QA; si no, declara el release completo y escala para
   aprobación humana, reusando el mecanismo de escalamiento ya construido en FEATURE-018.
3. Al aprobarse el cierre de un release, el pipeline reinicia en Architect (mecanismo ya
   existente, sin cambios), quien confirma/propone el release siguiente si lo hay.
4. Si no quedan releases pendientes en el roadmap tras cerrar uno, el proyecto queda cerrado sin
   escalar de nuevo — no hay nada que aprobar.
5. Functional declara su descomposición de Features de forma estructurada (JSON bolteado a
   `outputArtifact`, mismo patrón que `ROADMAP`/`comandoTest`), como base para que Planning
   trackee estado por Feature.
6. Developer deja de decidir por su cuenta si continúa con la Feature siguiente — siempre vuelve
   a Planning.
7. El tope de 3 reintentos de Developer↔QA (Stage 3) se mantiene **por Feature**, no acumulado a
   nivel de release — cada Feature es un run nuevo con su propio contador.

---

## 4. Scope

**Incluido:**
- Nuevo `PipelineSpec` en `src/pipelines/definitions.ts` para la continuación de Features dentro
  de un release ya en curso (fases: solo `planning`, con el mismo segmento de loop
  Developer↔QA) — se registra automáticamente en `pipeline_definitions` vía el mecanismo ya
  existente de búsqueda-o-creación por nombre+versión (`repository.ts`, función interna usada por
  `runStart.ts`/`intakeService.ts`), sin migración nueva.
- Mecanismo de **continuación por éxito** (distinto del mecanismo de escalamiento, que es por
  respuesta humana): al aprobar QA y completar el commit/push, en vez de que `finishRun` termine
  el run, se crea un run hijo — mismo patrón de worktree/rama que ya usa el escalamiento
  (`createRunWorktree` reusando la rama del padre) — cuyo primer rol es Planning, encadenado vía
  `originated_from_run_id`.
- `functional.txt`: agregar declaración estructurada de Features (`FEATURES: <JSON>`), análoga a
  `ROADMAP`.
- `planning.txt`: lógica de "¿hay Feature siguiente en el release activo?", con persistencia de
  estado (Release Plan versionado, mismo patrón que `release_roadmap`,
  `config_key = "release_plan"`), y declaración de escalamiento de "release completo" cuando no
  queden Features — reusando la distinción por contenido ya construida en FEATURE-018
  (`extractRoadmapApproval`, mismo patrón para el cierre de release).
- Extensión de `respondToEscalation`/`setProjectConfig` (ya con `client?` desde FEATURE-018) para
  reconocer y persistir también la aprobación de "release completo → release siguiente".
- Ajuste de texto en `08-CODE-SYSTEM-PROMPT.md` (Developer ya no decide autónomamente continuar a
  la Feature siguiente) y en `06-DELIVERY-WORKFLOW.md` (Stage 4/Stage 7, reflejar que Developer
  vuelve a Planning).
- Mecanismo real de sub-rama por Feature + merge a la rama base del release, según el modo vigente
  (Manual/Auto) — ver 6.2b. Incluye renombrar "Modo A" → "Modo Manual" en los 7 lugares
  identificados (ver 6.5).
- Persistencia explícita del modo de aprobación (`config_key = "approval_mode"`) — esta Feature
  **absorbe y cierra** el ítem ⚪ Tentativo "Approval Model por Release" de `docs/ROADMAP.md`.

**Excluido:**
- FEATURE-020 (adaptar lo ya implementado en FEATURE-018 a este mecanismo) — Feature separada,
  posterior a esta.
- Evaluación de Tamaño del Release por Planning (`09-RELEASE-PLAN-TEMPLATE.md` §0) — sigue fuera,
  igual que en FEATURE-018.
- Cualquier columna o estado nuevo de "proyecto cerrado" — se deriva de que todos los releases del
  roadmap vigente queden en estado `"Completado"`, sin persistencia adicional.
- Selección de proveedor/modelo/credenciales (FEATURE-022) y credenciales git por usuario
  (FEATURE-023) — Features separadas.
- Generalizar el loop interno del motor de fases — decisión explícita del owner de no tocar esa
  pieza (FEATURE-005), se resuelve con cadena de runs en su lugar.

---

## 5. Functional Rules

1. El Circuito 3 (Developer↔QA) nunca termina el run al aprobar QA — siempre continúa a Planning
   vía run encadenado (`originated_from_run_id`).
2. Planning es el único rol que decide avanzar a la Feature siguiente o cerrar el release —
   Developer nunca lo decide por su cuenta (deroga el texto actual de
   `08-CODE-SYSTEM-PROMPT.md`).
3. El cierre de un release siempre requiere aprobación humana explícita — mismo criterio de Regla
   8.4 ya aplicado para la aprobación inicial del roadmap en FEATURE-018.
4. El release siguiente solo se activa tras esa aprobación — Architect no asume continuidad
   automática entre releases (sin cambios respecto a lo ya definido en FEATURE-018).
5. Si no hay más releases tras cerrar uno, el proyecto queda cerrado sin escalar de nuevo — no hay
   nada que aprobar en ese caso.
6. El contador de reintentos de Developer↔QA (tope 3, Stage 3) es por Feature — cada Feature, al
   ser un run nuevo, tiene su propio contador, nunca acumulado a nivel de release.
7. Si Planning recibe contexto sin ninguna Feature pendiente declarada por Functional (caso
   defensivo, no debería ocurrir si Functional cumplió su Regla), escala en vez de asumir el
   release completo por default.
8. Cada Feature crea su sub-rama desde la rama base del release (no desde una rama de trabajo
   compartida) y, al completarse (QA aprueba), se hace commit y push de esa sub-rama — siempre,
   en cualquier modo.
9. Modo Manual (renombrado de "Modo A"): tras el push de la sub-rama, se escala a humano para
   decidir si se mergea a la rama base del release. Solo tras aprobación humana se hace el merge
   y el push de la rama base actualizada.
10. Modo Auto: tras el push de la sub-rama, se mergea automáticamente a la rama base del release,
    sin consulta, y se pushea la rama base actualizada.
11. La Feature siguiente siempre parte de la rama base ya actualizada (post-merge) — nunca de la
    sub-rama de la Feature anterior directamente.
12. El modo vigente (Manual/Auto) se persiste explícitamente en `project_config_versions`
    (`config_key = "approval_mode"`, mismo patrón versionado que `release_roadmap`/`release_plan`)
    — esta Feature absorbe el alcance del ítem ⚪ Tentativo "Approval Model por Release"
    (`docs/ROADMAP.md`), que queda cerrado al implementarse esto. Default: Manual, si el proyecto
    no tiene ningún valor configurado todavía.
13. El run de continuación (Planning para la Feature siguiente, `PLANNING_TO_QA`) nunca arranca
    antes de que el merge de la Feature anterior a la rama base se resuelva — en Modo Manual, eso
    significa esperar la aprobación humana explícita (no dispara nada mientras el run está
    `escalated`); en Modo Auto, el merge ocurre primero y recién con esa rama base actualizada
    arranca la Feature siguiente. En ningún modo hay dos Features del mismo release avanzando en
    paralelo.
	
---

## 6. Technical Considerations

### 6.1 Nuevo `PipelineSpec` de continuación

`src/pipelines/definitions.ts` gana un nuevo spec (`PLANNING_TO_QA`, siguiendo la convención de
nombrar por fases contenidas y no por motivo de invocación — igual que `full-pipeline-architect-to-qa`):
`phases: [{ agentRole: "planning" }]`, mismo `loop` de
Developer↔QA que ya usa `FULL_PIPELINE`. Se registra en `pipeline_definitions` automáticamente la
primera vez que se usa, vía el mismo mecanismo de búsqueda-o-creación por `name`+`version` que ya
usan `FULL_PIPELINE`/`TWO_PHASE_ARCHITECT_FUNCTIONAL` — sin migración nueva.

### 6.2 Mecanismo de continuación por éxito (pieza genuinamente nueva)

Hoy, al aprobar QA, `finishRun` (`runStart.ts`) cierra el run (`finalizeRun` + commit/push).
Se agrega un run nuevo: en vez de que `finishRun`/el flujo de merge (según el modo, ver 6.2b)
terminen ahí, siempre se crea un run hijo —mismo patrón de
`createRunWorktree` que ya usa `respondToEscalation`, pero con un `baseRef` distinto: acá **no** es
la sub-rama del padre (`parentWorktree.branchName`), porque esa sub-rama es justamente la de la
Feature que ya se mergeó y no hace falta más — es `ramaBaseTrabajo` (la rama base del release, ya
actualizada por el merge de 6.2b, disponible en el Release Plan). Esto es consistente con la Regla
11: la Feature siguiente siempre parte de la rama base ya actualizada, nunca de la sub-rama de la
Feature anterior. El run hijo usa `pipelineSpec = PLANNING_TO_QA`, `originated_from_run_id`
apuntando al run que acaba de cerrar, y contexto indicando qué Feature se completó — es Planning,
dentro de ese run, quien decide si hay Feature siguiente o declara el release completo (Functional
Goal #2), nunca una condición evaluada antes de crear el run. Esto es una
función nueva, distinta de `respondToEscalation` (esa es por respuesta humana; esta es por éxito
automático) pero que reusa sus mismas piezas de bajo nivel (`createRunWorktree`, `createRun` con
`client`, `recordRunConfigVersions`, `recordRunEvent`).
El clon aislado por caso de negocio (`cloneRunRepository`, FEATURE-017) persiste durante toda la
cadena de runs de un release — confirmado en el patrón ya usado por `respondToEscalation`
(`respondService.ts:159`: `createRunWorktree(projectRepoRoot, childRunId, parentWorktree.branchName)`),
que reusa el mismo `repoRoot` para todos los runs encadenados. La rama base del release
(`business_case.rama_base_trabajo`, capturada una sola vez en el run inicial, FEATURE-017) sigue
existiendo localmente en ese clon durante toda la cadena — el merge de cada sub-rama de Feature
contra ella no requiere re-clonar ni re-consultar el business_case en cada Feature.

Decisión: la rama base se persiste explícitamente como campo (`ramaBaseTrabajo`) dentro del valor
JSONB del Release Plan (`config_key = "release_plan"`, ver 6.3), escrita una sola vez al crear la
primera versión del Release Plan (tomada del `business_case` del run raíz, ahí sí accesible
directamente) y disponible sin más lectura en cada transición posterior de ese mismo JSONB. Se
descarta releer `business_case` recursivamente por `originated_from_run_id`: `createRun`
(`repository.ts:133-164`, la función que crea todos los runs hijos de la cadena) no inserta
`business_case` — la columna queda `NULL` en cada run hijo; solo `createRunPendingStart`
(exclusiva del run raíz del intake) la persiste. Caminar la cadena hacia atrás requeriría un
helper recursivo nuevo (CTE en SQL o loop en la aplicación) que no hace falta si el dato ya viaja
en el Release Plan.

### 6.2b Mecanismo de merge a la rama base, por modo

Nueva función en `src/isolation/worktree.ts`, análoga a `pushRunBranch` (`worktree.ts:71-75`):

```ts
export async function mergeFeatureBranchIntoBase(params: {
  repoRoot: string;
  baseBranch: string;
  featureBranch: string;
}): Promise<void> {
  const baseWorktreePath = path.join(
    process.env.WORKTREES_BASE_DIR ?? path.resolve(params.repoRoot, "..", "ai-orchestrator-worktrees"),
    `base-${randomUUID()}`
  );
  await execFileAsync("git", ["worktree", "add", baseWorktreePath, params.baseBranch], { cwd: params.repoRoot });
  try {
    await execFileAsync("git", ["merge", "--no-ff", params.featureBranch,
      "-m", `merge: ${params.featureBranch} -> ${params.baseBranch}`], { cwd: baseWorktreePath });
    await execFileAsync("git", ["push", "origin", params.baseBranch], { cwd: baseWorktreePath });
  } finally {
    await execFileAsync("git", ["worktree", "remove", baseWorktreePath, "--force"], { cwd: params.repoRoot });
  }
}
```

Ocurre en un worktree separado y efímero de la rama base, no en el `worktreePath` del run de la
Feature — `createRunWorktree` (`worktree.ts:17-27`) usa `git worktree add -b <rama-nueva>`, así
que la rama base nunca tiene su propio worktree persistente; hay que crearlo puntualmente para el
merge y borrarlo enseguida (git no permite dos worktrees sobre la misma rama a la vez).

**Disparo según el modo**: no hay ningún `AgentRole` natural dueño de "el sistema decidió pausar
para revisión de merge" — `latestEscalationArtifact` (`respondService.ts:258-261`) exige
`isAgentRole(item.phase)` sobre el artifact de escalación, y acá no hay ningún agente decidiendo
escalar, es el propio Orquestador tras un push exitoso. Se atribuye el artifact sintético a
`phase: "developer"` (dueño real del código a mergear, Regla 10 de Ownership de Artefactos).
Developer también puede escalar por ambigüedad real durante la implementación
(`08-CODE-SYSTEM-PROMPT.md`, línea ~57) — para no confundir ambos casos, el artifact sintético de
aprobación de merge lleva un marcador de contenido explícito (`content.mergeApproval: true`, mismo
criterio que usa `extractRoadmapApproval` para distinguir el marcador de roadmap), que
`respondToEscalation` chequea antes de tratarlo como este caso.

Con esa atribución: en Modo Manual, tras el push de la sub-rama, `recordArtifact(kind: "escalation",
phase: "developer", content: { mergeApproval: true, ... })` + `updateRunStatus(runId, "escalated")`
+ `recordRunEvent`; el humano aprueba vía el mismo `POST /runs/:id/respond` ya existente;
`respondToEscalation` detecta `content.mergeApproval` y, en un único flujo (no una rama excluyente
de la otra): primero llama a `mergeFeatureBranchIntoBase`, y luego siempre crea el child run
`PLANNING_TO_QA` (`baseRef = ramaBaseTrabajo`, ya actualizada por el merge que acaba de correr) —
sin condicionar la creación del run a si hay Feature siguiente o no, consistente con la Regla
Funcional 1 ("el Circuito 3 nunca termina el run... siempre continúa a Planning"); es Planning,
dentro de ese run, quien decide si hay Feature siguiente (Functional Goal #2) o declara el release
completo. En Modo Auto, se llama a `mergeFeatureBranchIntoBase` directamente después del push, y a
continuación se crea el child run `PLANNING_TO_QA` de la misma forma, sin pasar por escalamiento.

**Limpieza post-merge**: el worktree/rama `run/<id>` de la Feature ya mergeada (Feature A) sigue
la misma política que hoy aplica a runs escalados y no retomados — no se borra inmediatamente,
queda sujeto a la política de retención de 21 días (ítem ⚪ Tentativo ya existente en
`docs/ROADMAP.md`, "Limpieza automática de worktrees/branches vencidos"). No se introduce ninguna
limpieza inmediata nueva en esta Feature.

### 6.3 Persistencia del Release Plan (estado por Feature)

Mismo patrón que `release_roadmap` (FEATURE-018): `project_config_versions`,
`config_key = "release_plan"`, versionado. Valor JSONB: `ramaBaseTrabajo` (ver 6.2b — escrita una
sola vez al crear la primera versión, tomada del `business_case` del run raíz), lista de Features
(referenciando los `id` que declaró Functional en `FEATURES`), con estado por Feature
(`Pendiente`/`En curso`/`Completada`) y cuál es la Feature actual. Cada transición (Feature
completada → siguiente asignada) es una nueva versión — historial completo sin código adicional,
igual que ya resolvió FEATURE-018 para el roadmap.

### 6.4 Reuso del mecanismo de escalamiento para cierre de release

Cuando Planning declara "no quedan Features" para el release activo, su salida usa
`ESTADO: escalated` con un marcador de "release completo" en `outputArtifact` (mismo patrón que
`ROADMAP` en el rol Architect). `respondToEscalation`/`setProjectConfig` (ya con `client?` desde
FEATURE-018) se extienden para reconocer también este tipo de contenido: al aprobar, persisten el
cierre del release actual y la propuesta del release siguiente (si existe en el roadmap), y el
child run creado usa `FULL_PIPELINE` de nuevo (su `phases[0].agentRole` ya es `"architect"` —
mecanismo existente, sin cambios).

Si no hay release siguiente: se agrega `{ kind: "project_closed" }` al tipo
`EscalationResponseResult` (`respondService.ts:32-39`, hoy solo tiene `aborted`/`conflict`/`solution`).
Dentro de `respondToEscalation`, tras detectar el marcador de "cierre de release" en el artifact de
escalación: `setProjectConfig(..., client)` marca el release actual `"Completado"` sin activar
ninguno nuevo, luego `resolveEscalatedRunStatus(params.parentRunId, "resolved", client)` (status ya
existente, sin agregar uno nuevo a nivel de runs), `recordRunEvent(params.parentRunId, "project_closed", {...}, client)`,
commit — sin crear ningún child run, mismo patrón que ya usa hoy la rama `{ kind: "aborted" }`
(`respondService.ts:61-73`, que tampoco crea child run). En `app.ts`, el handler de
`POST /runs/:id/respond` necesita un branch nuevo para `result.kind === "project_closed"`,
respondiendo 202 sin `childRunId`.

### 6.5 Ajustes de texto en roles y gobernanza

- `functional.txt`: agregar etiqueta `FEATURES: <JSON con lista de features {id, nombre, resumen}>`,
  mismo tratamiento ad-hoc que `ROADMAP`/`comandoTest` en `parseRoleConvention`
  (`claudeCodeExecutor.ts`) — el regex de extracción por etiqueta ya es genérico, agregar una
  etiqueta nueva no rompe las existentes (confirmado en FEATURE-018).
- `planning.txt`: lógica de decisión "¿hay Feature siguiente?" + declaración del cierre de
  release cuando no la hay.
- `08-CODE-SYSTEM-PROMPT.md`, sección Developer (texto real, línea 158-159: "si hay Feature
  siguiente en el release activo, continúa con ella (vuelve a Stage 4); si el release está
  completo, no continúa por su cuenta — eso ya es Stage 7") — reemplazar por "al completar el
  merge de una Feature, el pipeline continúa automáticamente a Planning; Developer no decide por
  su cuenta si sigue, en ningún caso".
- `06-DELIVERY-WORKFLOW.md`, Stage 4 y la sección "Ciclo de Features dentro de un Release"
  (líneas ~227-234, hoy dice literalmente "Developer consulta el Release Plan... el ciclo vuelve a
  Stage 4" — este es el texto que esta Feature reemplaza en espíritu, Developer ya no decide) y la
  sección "Cierre del Release y Release Siguiente": ajustar para reflejar que la continuación entre
  Features pasa siempre por Planning.
- Renombrar "Modo A" → "Modo Manual" en los 7 lugares confirmados (sin cambio de comportamiento,
  solo nombre; "Modo Auto" no cambia de nombre):
  - `docs/runbook/06-DELIVERY-WORKFLOW.md:200, :211` (sección "Modos de operación")
  - `docs/ROADMAP.md:383, :388, :406` (ítem "Approval Model por Release" y el ítem relacionado de
    creación de PR/merge automático)
  - `docs/features/Feature-013-interfaz-ui-parte-013c-respuesta-escalamiento.md:231`
  - `docs/features/FEATURE-009 runbook-orchestrator.md:60, :78`

### 6.6 Riesgos técnicos

- El mecanismo de continuación por éxito (6.2) es la pieza más grande y nueva de esta Feature —
  a diferencia de FEATURE-018, que reusó mecanismos existentes casi en su totalidad, acá hay una
  función nueva de verdad (aunque construida con piezas ya probadas). Mayor superficie de riesgo
  que el resto del documento.
- Agregar `FEATURES` como etiqueta nueva aumenta otra vez la superficie del riesgo H12 (modelos
  económicos no siempre respetan el formato) — mismo mecanismo de defensa ya validado
  (regex genérico por etiqueta, tolerante a Markdown despojado), pero cada etiqueta nueva es una
  superficie adicional de esa fragilidad conocida.
- El contador de reintentos "por Feature" (Regla 6) depende de que cada Feature sea
  efectivamente un run nuevo — si en el futuro se optimizara para no crear un run por Feature
  (por costo/latencia), este supuesto se rompe y habría que rediseñar el conteo.

---

## 7. Validation Criteria

| Escenario | Input | Esperado |
|---|---|---|
| Feature completada, hay Feature siguiente | QA aprueba Feature A, release tiene Feature B pendiente | Run hijo creado con `PLANNING_TO_QA`, Planning asigna Feature B a Developer↔QA |
| Feature completada, era la última | QA aprueba Feature X, no quedan Features pendientes | Planning declara release completo, escala para aprobación humana |
| Aprobación de cierre con release siguiente | Owner aprueba vía `respond` | Se persiste cierre del release actual + activación del siguiente, child run con `FULL_PIPELINE` reinicia en Architect |
| Aprobación de cierre sin más releases | Owner aprueba, roadmap no tiene releases pendientes | Proyecto queda cerrado, sin nueva escalación |
| Reintentos por Feature | Feature A falla 2 veces en QA, se corrige a la 3ra | Contador de reintentos de Feature A no afecta el de Feature B (run nuevo, contador fresco) |
| Functional sin Features declaradas (defensivo) | Contexto de Planning sin `FEATURES` válido | Planning escala en vez de asumir release completo |
| Merge en Modo Manual | Feature A pushea su sub-rama, `approval_mode = "manual"` | Se escala (artifact `phase: "developer"`), humano aprueba, `mergeFeatureBranchIntoBase` corre recién ahí, rama base actualizada y pusheada |
| Merge en Modo Auto | Feature A pushea su sub-rama, `approval_mode = "auto"` | `mergeFeatureBranchIntoBase` corre automático sin escalamiento, rama base actualizada y pusheada |
| Feature siguiente parte de la rama base actualizada | Feature B arranca tras el merge de Feature A | La sub-rama de Feature B se crea desde la rama base ya con el merge de Feature A adentro |

### Validation Evidence

- Consulta SQL sobre `project_config_versions` (`config_key = "release_plan"`) mostrando la
  evolución de estado por Feature tras cada aprobación real.
- Prueba real end-to-end en la VPS con un release de al menos 2 Features, siguiendo el mismo
  criterio que dio mejores resultados en Features anteriores (probarlo con datos reales, no solo
  revisión de código).

---

## 8. Risks

- Es la Feature con más pieza nueva de código (6.2) desde FEATURE-005 — mayor riesgo relativo que
  los últimos ciclos, que fueron mayormente wiring y reuso.
- FEATURE-020 depende enteramente de que esta Feature cierre su implementación real — cualquier
  cambio de diseño tardío acá repercute directo en el tamaño de FEATURE-020.
- Sin caso de negocio real con más de una Feature por release todavía probado en producción — el
  camino principal (una sola Feature) seguirá siendo el más validado hasta que exista una prueba
  real multi-Feature.

---

## 9. Approval Gate

Implementación prohibida hasta aprobación humana explícita de este documento.

---

## Estado de la implementación

Aprobado por el owner tras 5 rondas de validación técnica (Go condicionado en las primeras 4, Go
limpio en la 5ª). Approval Gate cumplido — pasa a implementación en la rama
`feature/019-modelo-circuitos-anidados`.