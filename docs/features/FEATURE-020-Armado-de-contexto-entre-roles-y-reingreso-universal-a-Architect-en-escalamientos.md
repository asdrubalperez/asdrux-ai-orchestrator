# FEATURE-020 — Armado de contexto entre roles y reingreso universal a Architect en escalamientos

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: Surge de la validación E2E real de FEATURE-019. Se encontró que el
> mecanismo genérico de reintento de escalamiento (`buildEscalationContext`/`handleLinearEscalation`,
> preexistente desde antes de FEATURE-018) descarta el `business_case` original en cada reintento,
> y que el run de continuación de FEATURE-019 (`PLANNING_TO_QA`) tampoco recibe el Release Plan que
> Planning mismo declaró. El owner señaló que el problema de fondo es más general: cualquier borde
> entre roles que dependa de contexto acumulado en vez de leer artefactos persistidos por
> referencia tiene el mismo riesgo. Discusión conjunta con el Architect confirmó, además, que la
> regla ya documentada en `docs/ROADMAP.md` ("todo hallazgo entra por Architect... llevando el
> contexto acumulado") es literal y universal — incluso para escalamientos originados en Circuito 2
> o 3 de FEATURE-019, que corren en runs separados. El bug de que el cierre de release con release
> siguiente arranca en Planning en vez de Architect (`respondService.ts:197`) se trata aparte, como
> bug-fix directo sobre `main` — no es parte del alcance de este documento.

---

## 1. Feature Identity

- **Name**: Armado de contexto entre roles y reingreso universal a Architect en escalamientos
- **Type**: Backend (motor de pipeline, `respondService.ts`, `runStart.ts`, `escalation.ts`,
  roles `architect.txt`/`functional.txt`/`planning.txt`/`developer.txt`/`qa.txt`) + Schema
  (`runs.root_run_id`)
- **Owner**: asdru
- **Status**: 🟡 En Diseño
- **Priority**: Alta — bloqueó la validación end-to-end de FEATURE-019

---

## 2. Problem Statement

Durante la prueba real de FEATURE-019, Architect escaló su Roadmap para aprobación. El mecanismo
genérico de reintento (`handleLinearEscalation`, `runStart.ts`) reinició a Architect con un
contexto de solo 4 campos (`escalationReason`, `rejectedArtifact`, `originAgentRole`,
`humanSolution`) — **sin el `business_case` original**. Architect, sin poder contrastar su propia
propuesta contra el caso de negocio real, reportó (incorrectamente) que su propuesta había sido
"rechazada". El mismo objeto de 4 campos se usa también en `respondService.ts` para el run hijo
creado tras la aprobación humana — mismo resultado.

Relevamiento posterior (sin necesitar reproducir en vivo) encontró el mismo patrón en un segundo
punto: el run de continuación de FEATURE-019 (`PLANNING_TO_QA`) le da a Planning únicamente
`{ featureJustCompleted }` + el Roadmap activo (`withActiveReleaseContext`) — nunca el Release Plan
(lista de Features + estados) que Planning mismo declaró y persistió. Sin eso, Planning no puede
saber cuál es la Feature siguiente.

Ambos casos comparten la misma causa raíz: **un reinicio de rol (ya sea un reintento automático
dentro del mismo run, o un run nuevo creado tras aprobación humana) no reconstruye el input normal
que ese rol necesitaría recibir según el pipeline — solo le da lo específico de la escalación.**

El owner planteó, además, un principio de diseño más amplio: la razón de que Roadmap, Release Plan
y Features sean persistentes es exactamente que cualquier rol que necesite **leer** algo pueda
hacerlo — la escritura es de quien es dueño (Regla 10, Ownership de Artefactos), la lectura debería
estar abierta. El loop Developer↔QA ya sigue este principio correctamente (verificado en código:
`runDeveloperQaLoop` mantiene el plan de Planning en una variable compartida durante todo el loop,
sin depender de que sobreviva a un reinicio de proceso) — el problema está específicamente en los
puntos donde un rol se reinicia como invocación nueva, sin memoria de proceso de la que tirar.

Se confirmó además, revisando `docs/ROADMAP.md` (ítem "Escalamiento optimizado sin reinicio
completo"), que el diseño v1 ya documentado dice explícitamente: *"todo hallazgo entra por
Architect y avanza en el orden normal del pipeline hasta llegar al dueño real, llevando el contexto
acumulado — no reinicia todo desde cero, pero sí recorre secuencialmente los pasos intermedios"*.
Esto es literal y universal — incluso un escalamiento originado en Developer (Circuito 3, un run
`PLANNING_TO_QA` separado del run original) debe, en teoría, terminar reingresando por Architect.
Hoy esto no ocurre: el mecanismo de reintento (`handleLinearEscalation`) resetea `phaseIndex = 0`
**dentro del pipeline del run actual** — para un run `PLANNING_TO_QA`, eso es Planning, no
Architect. No hay ningún mecanismo que cruce de un run a otro para cumplir la regla documentada.

---

## 3. Functional Goal

1. Cualquier reinicio de un rol (reintento automático, o run nuevo tras aprobación humana)
   reconstruye siempre el `business_case` original, sin importar cuántos saltos de run haya entre
   el run raíz y el run actual.
2. Planning, en cualquier invocación (incluida la continuación de FEATURE-019), recibe siempre el
   Release Plan vigente además del Roadmap activo.
3. Todo escalamiento, sin importar en qué Circuito/run se origine, reingresa literalmente por
   Architect — vía un único run nuevo encadenado que recorre el orden lineal normal del pipeline
   (Architect→Functional→Planning→Developer↔QA), no un run por cada salto.
4. Cada rol, al recibir un contexto de escalamiento donde no es el `targetAgentRole` (el rol
   inmediatamente anterior a quien escaló, en el orden del pipeline) y no tiene nada que aportar,
   pasa el contexto al siguiente rol sin rehacer su propio trabajo normal — vía un marcador
   explícito (`notApplicable`), no reinterpretando el status existente.
5. El "peor caso" (nadie se hizo cargo) se detecta cuando el recorrido completo vuelve a llegar al
   rol que escaló originalmente y el artefacto vigente relevante es exactamente el mismo (mismo
   `id` de versión) que cuando escaló — recién ahí se activa "contenido repetido" y escala al
   humano.
6. El tope de reintentos pasa a contarse en **recorridos completos** (Architect→...→rol que
   escaló), no en invocaciones sueltas de un rol — máximo 3, igual que hoy.

---

## 4. Scope

**Incluido:**
- Columna `root_run_id` en `runs`, resuelta una sola vez por `createRun`/`createRunPendingStart`
  (self si es raíz, heredado del padre si no) — sin necesidad de caminar la cadena en cada lectura.
- Helper para leer `business_case` de cualquier run vía su `root_run_id` (una sola consulta).
- Extensión de `withActiveReleaseContext` (o función equivalente) para inyectar también
  `release_plan` en toda invocación de Planning, no solo `release_roadmap`.
- Nuevo campo `targetAgentRole` en `EscalationContext`, calculado mecánicamente por el
  orquestador (no por el LLM) como el rol inmediatamente anterior en el orden del pipeline al rol
  que escaló (Functional→Architect, Planning→Functional, Developer→Planning, QA→Developer).
  Architect no participa de este mecanismo — sus propias escalaciones (ambigüedad de caso de
  negocio, aprobación de Roadmap) siguen yendo directo al humano, sin cambios.
- Reemplazo del reinicio local (`phaseIndex = 0` dentro del mismo run) por la creación de un único
  run nuevo encadenado (`FULL_PIPELINE`, siempre arrancando en Architect) para **todo**
  escalamiento que hoy dispara un reintento automático o requiere aprobación humana con
  continuación — tanto si se origina en el run principal como en un run `PLANNING_TO_QA`.
- Marcador `notApplicable: true` en `outputArtifact`, reconocido por el orquestador para avanzar
  de fase sin tratar el resultado como un artefacto normal ni como una escalación nueva.
- Ajuste de rol/prompt en `architect.txt`, `functional.txt`, `planning.txt`, `developer.txt` (QA no
  participa de este mecanismo de "paso" — siempre fue destino final del loop, no intermedio de
  este recorrido) para reconocer un contexto de "revisión de escalamiento" y decidir si les toca.
- Detección de "contenido repetido" basada en comparar el `id` de la versión vigente del artefacto
  relevante (en `artifacts` o `project_config_versions`, ambos ya versionados/append-only) contra
  el `id` guardado en el contexto al momento de escalar — no en memoria de proceso.
- Contador de recorridos completos (máximo 3), persistido como parte del contexto que viaja entre
  runs encadenados (no en un `Map` en memoria, que no sobrevive entre runs).

**Excluido:**
- El bug de `respondService.ts:197` (cierre de release con release siguiente arranca en Planning
  en vez de Architect) — bug-fix aparte, ya en curso sobre `main`.
- La optimización futura de "ir directo al dueño real sin recorrer los pasos intermedios" (ítem
  ⚪ Tentativo "Escalamiento optimizado sin reinicio completo") — sigue fuera, es la v2 de esto.
- Cualquier cambio al loop Developer↔QA en sí (`runDeveloperQaLoop`) — ya funciona correctamente
  (verificado: mantiene el plan de Planning en memoria durante todo el loop), no se toca.
- Dar a los agentes acceso directo a la base de datos — el orquestador sigue siendo el único que
  lee/escribe; los agentes solo reciben lo que el orquestador les arma en el contexto.
- `respondMergeApproval` (`respondService.ts:436-463`) — camino totalmente aparte, nunca pasa por
  `buildEscalationContext` ni por este mecanismo; sigue creando el run de continuación
  (`createPlanningToQaChildRun`/`PLANNING_TO_QA`) exactamente como hoy. No debería verse afectado —
  se agrega un escenario a Validation Criteria para confirmarlo explícitamente, no por accidente.

---

## 5. Functional Rules

1. `root_run_id` se resuelve una única vez, en el momento de crear el run (nunca se recalcula ni
   se camina la cadena después) — si el run no tiene `originated_from_run_id`, `root_run_id` es su
   propio `id`; si lo tiene, hereda el `root_run_id` del padre.
2. El `business_case` sigue persistiéndose únicamente en el run raíz (`createRunPendingStart`,
   sin cambios de FEATURE-017) — cualquier run de la cadena lo resuelve leyendo
   `runs.business_case where id = root_run_id`, nunca duplicándolo.
3. Toda invocación de Planning (normal, o de continuación) recibe el Release Plan vigente completo
   (lista de Features + estados), no solo los 2 campos (`ramaBaseTrabajo`, `featureActualId`) que
   se leen hoy para uso interno del merge.
4. `targetAgentRole` es un dato mecánico (tabla estática de predecesor por rol en el orden del
   pipeline), calculado por el orquestador — nunca lo decide ni lo declara el propio agente.
5. Un rol que determina que la escalación no le corresponde responde con
   `outputArtifact: { notApplicable: true }` — el orquestador reconoce este marcador y avanza a la
   fase siguiente sin reiniciar el contador de intentos. Se registra igual un artifact en
   `artifacts` para no perder trazabilidad del recorrido, con `kind: "pass"` (nuevo, junto a los
   3 valores que el código realmente escribe hoy: `"escalation"`, `"design"`, `"code"` —
   `runStart.ts:328`, `runStart.ts:811`; corregido en la ronda 2 de validación, `verdict_approved`/
   `verdict_rejected` no existen como valores reales de `kind`) — ningún código de UI/lógica
   existente consulta `kind` fuera de `"escalation"` (`runView.ts:179`, confirmado en la ronda 1),
   así que agregar este valor no rompe nada.
6. Hay dos mecanismos distintos, y la distinción es **por camino, no por qué pipeline tenía el
   run padre** (corrección real de la ronda 2 de validación — la Regla 6 original ataba esto al
   pipeline del padre, y eso dejaba sin resolver el caso de Developer/QA escalando dentro de
   `FULL_PIPELINE`):
   - **Reintento automático en el mismo run** (`handleLinearEscalation`, sin cambios de mecanismo):
     aplica únicamente a Architect/Functional/Planning escalando como fase lineal dentro de
     `FULL_PIPELINE` — es gratis, sin worktree/rama nueva, y ya reingresa por Architect
     (`phaseIndex = 0`). Solo se le corrige el contexto (Regla 2). Developer/QA nunca pasan por
     este camino (el loop nunca tuvo reintento automático — escala directo, sin cambios).
   - **Camino genérico de `respondService.ts`** (crea un run nuevo tras tu aprobación): aplica a
     **cualquier** escalación que llegue ahí — sin importar el rol que escaló ni el pipeline del
     run padre (`FULL_PIPELINE` o `PLANNING_TO_QA`) — excepto `mergeApproval`, que sigue su camino
     totalmente aparte (Scope, Excluido). Este camino **siempre** usa `pipelineSpec = FULL_PIPELINE`
     (simplifica el bug-fix ya mergeado `resolveChildPipelineSpec`: en vez de forzarlo solo cuando
     hay `releaseClosureRoadmap`, lo fuerza siempre en este camino — es consistente, porque acá
     siempre se crea un run nuevo, nunca hay reingreso gratis posible) y **siempre** arma el
     contexto de reingreso enriquecido (`businessCase`, `targetAgentRole`, soporte
     `notApplicable`), sin importar de qué rol/pipeline vino la escalación.
7. La detección de "contenido repetido" se evalúa **dentro de cada recorrido**, cuando ese
   recorrido llega de nuevo al rol que escaló originalmente (`originAgentRole`) — comparando el
   `id` de la versión vigente contra `originalVersionRef`, que es el `id` vigente **al arrancar
   ese recorrido específico** (no el de la escalación original absoluta, si ya hubo más de un
   recorrido). Si son iguales, se activa el escalamiento a humano ya mismo, en ese recorrido —
   puede pasar en el recorrido 1, 2 o 3, no está atado a llegar al tope. Si son distintos, alguien
   cambió algo real — el pipeline sigue normal desde ahí (Regla 11), lo cual puede terminar en una
   resolución real, o en una escalación nueva más adelante (arrancando un recorrido siguiente, con
   su propio `originalVersionRef` nuevo).

   **Ejemplo de traza, para que no quede ambiguo** (mismo caso de Developer↔Planning que venimos
   usando): Developer escala con el plan en versión `V1` → recorrido 1, `attempt = 1`,
   `originalVersionRef = V1`. Si nadie cambia nada y vuelve a Developer con `V1` intacto →
   repetido, escala a humano — **en el recorrido 1**, sin necesitar un segundo intento. Si Planning
   sí corrige (nueva versión `V2`), el pipeline sigue normal — si eso resuelve el problema, listo,
   sin más recorridos. Si Developer, ya con `V2`, encuentra que el problema persiste (mismo u otro
   motivo) y escala de nuevo, arranca el **recorrido 2**: `attempt = 2`, `originalVersionRef = V2`
   (no `V1`) — la comparación de "repetido" en este recorrido es contra `V2`, no contra el
   original absoluto.
8. El contador de recorridos completos (`attempt`) tiene tope 3 — es un techo de seguridad
   independiente de la detección de "repetido": cubre el caso donde cada recorrido sí produce
   algún cambio real (nunca se detecta "repetido" en el sentido de la Regla 7), pero el problema de
   fondo persiste recorrido tras recorrido. Al llegar a `attempt = 3` sin resolución, se escala a
   humano aunque el contenido de ese último recorrido no sea idéntico al de su propio inicio.
   Viaja en el contexto (nunca en memoria de proceso, que no sobrevive entre runs). Aplica solo al
   camino genérico de `respondService.ts` — el reinicio en el mismo run dentro de `FULL_PIPELINE`
   sigue contando como hoy (`MAX_ESCALATION_ATTEMPTS`, sin cambios).
9. Architect, cuando escala dentro de un run `FULL_PIPELINE` (caso normal — ambigüedad de caso de
   negocio real, o la aprobación de Roadmap que siempre requiere humano por regla), sigue el
   mecanismo actual sin cambios: reinicio en el mismo run, ahora con `business_case` correctamente
   incluido (Regla 2). Architect no participa del mecanismo de "paso" (`notApplicable`) en ningún
   caso — no hay ningún rol anterior a él en el pipeline al que targetAgentRole pudiera apuntar.
10. QA no participa como destino intermedio de este mecanismo — sigue siendo, como hoy, quien
    escala directo a humano cuando el loop Developer↔QA se agota o QA mismo no puede validar.
10b. Planning nunca responde `notApplicable`, sea o no el `targetAgentRole` nominal — su
    `outputArtifact` es lo único que alimenta al loop Developer↔QA (`extractTestCommand`,
    `runStart.ts:768`), que no tiene ningún mecanismo de "paso" propio (Developer/QA no forman
    parte de `pipelineSpec.definition.phases`, solo del `loop`). Cuando Planning recibe el
    contexto de reingreso directamente (Architect y Functional ya pasaron, o Planning es el
    `targetAgentRole`), siempre resuelve de verdad: reafirma el plan/`COMANDO_TEST` vigente sin
    cambios si no hay nada que ajustar, o lo corrige si lo hay — nunca deja un stub
    `notApplicable` en el lugar de donde el loop necesita un plan real. Ver 6.4.a para la
    distinción completa entre esta situación y el flujo normal (Planning procesando un artefacto
    real y nuevo de Functional, sin ningún contexto de reingreso de por medio) y para el impacto
    de esta regla en la detección de "repetido" (Regla 7) cuando `targetAgentRole = "developer"`.
11. Mientras un rol responde `notApplicable` (no le corresponde), el contexto que recibe la fase
    siguiente es **el mismo contexto de reingreso original** (`businessCase`, `escalationReason`,
    `rejectedArtifact`, `targetAgentRole`, etc.), nunca el `outputArtifact` de quien acaba de
    pasar — recién cuando un rol resuelve algo real, su `outputArtifact` pasa a ser el input
    normal de la fase siguiente, como en cualquier ejecución lineal.
12. Cuando el rol que recibe el contexto de reingreso es Planning, el enriquecimiento que hoy se
    le agrega siempre (Roadmap activo, Release Plan) se suma **al lado** del contexto de
    reingreso, sin envolverlo dentro de `functionalArtifact` — el envoltorio actual
    (`functionalArtifact: <lo recibido>`) solo aplica al flujo normal (lo que Functional produjo),
    nunca a un contexto de reingreso.
13. Los runs creados antes de esta Feature no tienen `root_run_id` — cualquier reintento sobre
    ellos vuelve a perder `business_case` (degradación conocida, aceptada, sin backfill). No
    afecta a ningún run creado después de esta Feature.

---

## 6. Technical Considerations

### 6.1 `root_run_id` y resolución de `business_case`

Migración: agregar columna `root_run_id uuid references runs(id)` a `runs`. En `createRun`
(`repository.ts:133-164`) y `createRunPendingStart` (`repository.ts:172-188`): si
`originated_from_run_id`/`originatedFromRunId` es null, `root_run_id = id` (el propio run, recién
generado); si no, `root_run_id` = el `root_run_id` ya persistido del padre (una lectura simple
antes del insert, dentro de la misma transacción).

Nuevo helper en `repository.ts`:
```ts
export async function getBusinessCaseForRun(runId: string): Promise<unknown> {
  const result = await pool.query(
    `select r.business_case
     from runs r
     where r.id = (select root_run_id from runs where id = $1)`,
    [runId]
  );
  return result.rows[0]?.business_case ?? null;
}
```
Una sola consulta indexada, sin recursión ni CTE.

**Runs preexistentes (decisión explícita, no silenciosa)**: la migración no hace backfill de
`root_run_id` para runs creados antes de esta Feature — quedan en `NULL`. Para esos runs,
`getBusinessCaseForRun` no matchea nada y devuelve `null` — cualquier reintento de escalamiento
sobre un run viejo vuelve a tener el bug original (pérdida de `business_case`). Es una degradación
aceptada conscientemente (Regla 13), no un bug nuevo — el owner decidió no hacer backfill. No
afecta a ningún run creado después de mergear esta Feature.

### 6.2 Release Plan en toda invocación de Planning

Extender `withActiveReleaseContext` (`runStart.ts:514-520`) para leer también
`getCurrentProjectConfig(projectId, "release_plan")` e incluirlo — con la distinción por forma que
describe la Corrección 2 de 6.4 (no envolver un contexto de reingreso dentro de
`functionalArtifact`):
```ts
function isReingresoContext(value: unknown): value is { escalationReason: unknown; targetAgentRole: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "escalationReason" in value &&
    "targetAgentRole" in value
  );
}

async function withRoleContext(projectId: string, incomingContext: unknown): Promise<unknown> {
  const roadmap = await getCurrentProjectConfig(projectId, "release_roadmap");
  const releasePlan = await getCurrentProjectConfig(projectId, "release_plan");
  const shared = {
    activeRelease: activeReleaseFromRoadmap(roadmap?.value ?? null),
    releasePlan: releasePlan?.value ?? null,
  };
  return isReingresoContext(incomingContext)
    ? { ...incomingContext, ...shared }
    : { functionalArtifact: incomingContext, ...shared };
}
```
Aplica igual en la invocación normal (dentro de `FULL_PIPELINE`) y en la continuación
(`PLANNING_TO_QA`) — es la misma función, sin duplicar lógica entre ambos casos.

### 6.3 `targetAgentRole` — tabla estática de predecesor

```ts
const PREDECESSOR_ROLE: Partial<Record<AgentRole, AgentRole>> = {
  functional: "architect",
  planning: "functional",
  developer: "planning",
  qa: "developer",
};
```
`architect` no tiene entrada — sus escalaciones no usan este mecanismo (Regla 9). Se calcula en el
momento de armar el contexto de reingreso (`buildEscalationContext` extendido), nunca por el LLM.

### 6.4 Reingreso encadenado — el camino genérico de `respondService.ts`, siempre

**Alcance correcto (ajustado en la ronda 2 de validación — la distinción por "Architect está o no
en el pipeline del padre" dejaba sin resolver el caso de Developer/QA escalando dentro de
`FULL_PIPELINE`, que también cae en este camino genérico)**: la distinción real es **por camino,
no por qué pipeline tenía el run padre** (ver Regla 6). El reintento automático en el mismo run
(`handleLinearEscalation`) solo existe para Architect/Functional/Planning dentro de `FULL_PIPELINE`
— ya reingresa por Architect gratis, sin worktree/rama nueva, solo necesitaba el arreglo de
contexto de 6.1. Developer/QA nunca pasan por ahí (el loop siempre escaló directo a humano, sin
reintento automático). Todo lo demás —cualquier escalación, de cualquier rol, sobre cualquier
pipeline padre, que llegue a requerir aprobación humana— pasa por el camino genérico de
`respondService.ts` (`resolveChildPipelineSpec` + `buildEscalationContext`, excepto
`mergeApproval`, que sigue aparte). Este mecanismo nuevo se aplica **siempre** en ese camino
genérico, sin condición sobre el pipeline del padre ni sobre qué rol escaló.

**Mecanismo**: se crea un run nuevo (mismo patrón que ya usa `respondService.ts` para cualquier
child run: `createRunWorktree`, `createRun` con `client`, `originated_from_run_id`), con
`pipelineSpec = FULL_PIPELINE` siempre (simplifica `resolveChildPipelineSpec`, el bug-fix ya
mergeado: en vez de forzarlo solo cuando hay `releaseClosureRoadmap`, se fuerza siempre en este
camino — es consistente, porque acá siempre se crea un run nuevo, nunca hay reingreso gratis
posible), y contexto inicial:
```ts
{
  businessCase: await getBusinessCaseForRun(originalRunId),
  escalationReason,
  rejectedArtifact,
  originAgentRole,
  targetAgentRole,
  humanSolution,
  attempt,          // contador de recorridos completos, ver 6.6
  originalVersionRef, // id de la versión vigente al momento de escalar, ver 6.5
}
```
Llamamos a este objeto el **contexto de reingreso**. Se distingue de un artifact normal por su
forma (siempre tiene `escalationReason` + `targetAgentRole`, que ningún artifact de Functional
tiene).

**Corrección 1 — cómo viaja el contexto mientras nadie se hace cargo (hallazgo real de la ronda 1,
`runStart.ts:305` no lo soportaba)**: `runStart.ts:305` arma el contexto de cada fase como
`previousResult === null ? currentInitialContext : previousResult.outputArtifact` — esto asume que
lo que sigue siempre es el resultado normal del rol anterior. Necesita una rama nueva: si el
`outputArtifact` de la fase anterior es `{ notApplicable: true }`, el contexto de la fase
siguiente **no** es ese marcador — es el mismo contexto de reingreso que recibió la fase que acaba
de pasar, sin modificar. Recién cuando un rol responde con un `outputArtifact` real (sin el
marcador), se retoma la lógica normal (su output pasa a ser el input siguiente, como cualquier
ejecución lineal) — desde ese punto, el pipeline continúa como cualquier corrida normal, incluido
el loop Developer↔QA si corresponde.

**Corrección 2 — cómo convive esto con el enriquecimiento de Planning (hallazgo real de la ronda
1, choque con `withRoleContext`)**: `withRoleContext` (6.2) hoy envuelve incondicionalmente
cualquier contexto entrante dentro de `functionalArtifact` cuando `agentRole === "planning"`. Si lo
que llega es un contexto de reingreso, este envoltorio lo esconde un nivel más adentro de donde
Planning espera encontrarlo (`escalationReason` directo, no `functionalArtifact.escalationReason`).
`withRoleContext` necesita distinguir por forma: si el contexto entrante tiene `escalationReason` +
`targetAgentRole` (es un contexto de reingreso), se le agrega `activeRelease`/`releasePlan` **al
lado**, sin envolverlo (`{ ...context, activeRelease, releasePlan }`); si no (es el flujo normal,
lo que Functional produjo), se mantiene el envoltorio actual (`{ functionalArtifact: context,
activeRelease, releasePlan }`), sin cambios.

**Costo operativo (agregado tras la ronda 1 — antes no estaba en Riesgos)**: a diferencia del
reinicio dentro de `FULL_PIPELINE` (gratis, mismo run), cada recorrido completo de este mecanismo
crea un run + worktree + rama nuevos — acotado a máximo 3 por escalación (Regla 8), pero es un
costo real de tiempo/tokens que no existía para este camino. Ver 6.7.

### 6.4.a Planning y el loop Developer↔QA — por qué Planning nunca pasa (hallazgo real,
encontrado al implementar)

Al implementar Corrección 1 apareció un caso que ninguna ronda de validación había ejercitado: el
mecanismo de "paso" (`notApplicable`) solo está enganchado a las fases **lineales**
(`pipelineSpec.definition.phases` — Architect, Functional, Planning). Developer y QA corren
exclusivamente dentro de `runDeveloperQaLoop` (`runStart.ts:756`), con su propio armado de
contexto (`{ plan, previousAttemptSummary, qaRejectionReason }`) — no tienen ningún lugar donde
recibir el contexto de reingreso ni decidir "paso/no paso". El loop siempre necesita, de
`planningResult.outputArtifact`, un plan real con `COMANDO_TEST` (`extractTestCommand`,
`runStart.ts:768`) — si Planning "pasara" con `{ notApplicable: true }` (por ejemplo, en una
escalación originada en QA, donde `targetAgentRole = "developer"` según `PREDECESSOR_ROLE`), el
loop se queda sin plan y se rompe.

**Resolución (decisión del owner)**: Planning nunca responde `notApplicable`, sea o no el
`targetAgentRole` nominal — ver Regla 10b. Dos situaciones distintas para Planning, que no hay
que confundir:

- **Situación A — Planning recibe el contexto de reingreso directamente** (Architect y Functional
  ya pasaron, o Planning es el primer destino real antes del loop — pasa con `targetAgentRole`
  igual a `"planning"` o `"developer"`, los dos únicos valores donde Planning es quien sostiene el
  contexto al llegarle). Acá aplica la Regla 10b: Planning siempre resuelve de verdad (reafirma el
  plan/`COMANDO_TEST` vigente si no hay nada que ajustar, o lo corrige si lo hay) — nunca pasa,
  porque alimenta al loop.
- **Situación B — Planning recibe un artefacto real y nuevo de Functional** (Functional era el
  `targetAgentRole`, resolvió, y el pipeline sigue de forma normal). Acá Planning **no** está en
  modo "paso/resuelve" del mecanismo nuevo en absoluto — es el flujo lineal de siempre, sin ningún
  contexto de reingreso de por medio: procesa el input real de Functional exactamente como lo hace
  hoy. No aplica ninguna regla especial.

**Impacto en la detección de "repetido" (Regla 7) para `targetAgentRole = "developer"`**: como
Planning siempre escribe una versión nueva en la Situación A (aunque sea solo reafirmando), la
comparación de `id` de versión (Regla 7) prácticamente nunca coincide con `originalVersionRef` en
este camino específico — casi nunca se detecta "repetido" antes de tiempo. El tope de 3
recorridos (Regla 8) deja de ser un respaldo adicional y pasa a ser **la única red de seguridad
real** para este caso, a diferencia del resto de los caminos (donde "repetido" y "tope" actúan de
forma independiente, como ya muestra el ejemplo de traza de la Regla 7).

Traza concreta para este caso: Recorrido 1 (`attempt = 1`) — QA escala; Architect y Functional
pasan; Planning resuelve (reafirma o ajusta), versión nueva; el loop retoma con Developer. Si QA
no queda conforme, escala de nuevo. Recorrido 2 (`attempt = 2`) — mismo circuito; Planning
resuelve de nuevo, otra versión nueva. Si QA sigue sin conformarse, escala de nuevo. Recorrido 3
(`attempt = 3`, el último permitido) — mismo circuito; si QA todavía no queda conforme, el sistema
**no** arranca un recorrido 4 — corta y escala directo al humano, aunque cada versión haya sido
"distinta" cada vez (nunca se activó "repetido").

### 6.5 Detección de contenido repetido — comparación por `id` de versión

Antes de crear **cada** run de reingreso (no solo el primero), se guarda `originalVersionRef`: el
`id` de la fila vigente en `artifacts` (o `project_config_versions`, según corresponda) que
representa lo que el rol que escala está cuestionando **en ese momento** — si ya hubo un recorrido
anterior que cambió algo, este `id` es el de la versión nueva, no el de la escalación original
absoluta (ver 6.6 y el ejemplo de traza en Regla 7). Ni `artifacts` (`insert`-only, confirmado en
`repository.ts:518-525`) ni `project_config_versions` (versionado con `valid_to`, nunca se pisa
`value`, confirmado en `writeProjectConfigVersion`, `repository.ts:314-347`, invocada desde
`setProjectConfig`, `repository.ts:281-312`) sobreescriben contenido — el `id` guardado sigue
siendo válido para siempre.

Cuando el recorrido llega de nuevo a `originAgentRole` (el rol que escaló al arrancar **ese**
recorrido), el orquestador resuelve cuál es el `id` de la versión **vigente ahora** de ese mismo
artefacto. Si coincide con `originalVersionRef`, nadie lo cambió **durante este recorrido** — se
activa "contenido repetido" (`escalation_repeated_detected`, evento ya existente) y se escala al
humano, sin importar en qué número de recorrido estemos. Si es un `id` distinto, algo cambió — el
pipeline sigue normal desde ahí, lo cual puede resolver el problema o, más adelante, generar una
escalación nueva (un recorrido siguiente, con su propio `originalVersionRef`).

### 6.6 Contador de recorridos completos (tope 3)

`attempt` viaja en el contexto de reingreso (no en un `Map` en memoria, que no sobrevive entre
runs separados). Se inicializa en 1 al crear el primer run de reingreso para una escalación dada, y
se incrementa en 1 cada vez que hace falta crear **otro** run de reingreso completo para la misma
escalación original (o sea, cuando el recorrido anterior sí produjo un cambio real — no fue
"repetido" — pero el problema persiste y se genera una escalación nueva sobre la misma cadena,
todavía sin alcanzar el tope). Al llegar a `attempt = 3` sin resolución, se escala a humano aunque
el contenido no sea idéntico — mismo criterio de tope que existe hoy
(`MAX_ESCALATION_ATTEMPTS`), solo que ahora cuenta recorridos completos en vez de invocaciones
sueltas de un rol.

### 6.7 Riesgos técnicos

- Este mecanismo agrega una pieza nueva al motor de escalamiento para el camino genérico de
  `respondService.ts` (`handleLinearEscalation` sigue sin cambios para el reintento en el mismo
  run dentro de `FULL_PIPELINE`, ver Regla 6) — de todas formas toca puntos usados por todos los
  roles (`runStart.ts:305`, `withRoleContext`), así que el riesgo de regresión es real. Necesita
  cobertura de test proporcionalmente amplia (ver sección 7).
- El marcador `notApplicable` depende de que cada rol lo use correctamente en su prompt — mismo
  tipo de fragilidad ya aceptada (H12) para otras etiquetas de convención (`ROADMAP`,
  `FEATURES`, etc.), tolerada con el mismo mecanismo de defensa (regex genérico, tolerante a
  variaciones de formato).
- El recorrido completo (hasta 5 invocaciones de LLM por vuelta: Architect, Functional, Planning,
  Developer, y potencialmente QA si Developer resuelve y el loop continúa) tiene un costo real de
  tiempo/tokens mayor al reintento actual — y, a diferencia del reinicio dentro de `FULL_PIPELINE`
  (gratis, mismo run/worktree/rama), **cada recorrido de este mecanismo crea un run + worktree +
  rama nuevos**, acotado a máximo 3 por escalación (Regla 8). Es exactamente el costo que el ítem
  ⚪ Tentativo "Escalamiento optimizado sin reinicio completo" ya anticipaba y decide no resolver
  todavía — aceptado como tradeoff de v1, consistente con decisiones anteriores del owner de no
  sobreingenierizar antes de que el costo sea un problema real.

---

## 7. Validation Criteria

| Escenario | Input | Esperado |
|---|---|---|
| Reintento automático de Architect | Architect escala su Roadmap, `humanSolution` null | El run de reingreso incluye `business_case` real (vía `root_run_id`), Architect puede reinterpretar en vez de reportar "rechazado" sin fundamento |
| Aprobación de Roadmap vía camino genérico | Humano aprueba el Roadmap (`roadmapApproval`), child run se crea | `pipelineSpec = FULL_PIPELINE` (sin cambio de resultado respecto a hoy, ya no por coincidencia), `targetAgentRole` indefinido para Architect es un no-op natural, `release_roadmap` ya actualizado antes de que Architect arranque — sin falso positivo de "repetido" |
| Continuación de Planning con Release Plan | Run `PLANNING_TO_QA` arranca tras Feature A mergeada | Planning recibe la lista completa de Features + estados, no solo `featureJustCompleted` |
| Escalamiento de Developer llega a Planning | Developer escala por ambigüedad del plan, `targetAgentRole = "planning"` | Architect y Functional responden `notApplicable`, Planning corrige, el pipeline continúa normal desde Planning (incluye loop Developer↔QA de nuevo) |
| Peor caso — nadie se hace cargo | Ningún rol corrige nada real | Al llegar de nuevo a Developer (`originAgentRole`), el `id` de versión vigente es igual al guardado — se activa `escalation_repeated_detected`, escala a humano |
| Tope de 3 recorridos | 3 recorridos completos sin resolución y sin contenido idéntico detectado | Se escala a humano al llegar a `attempt = 3`, sin esperar un 4to recorrido |
| Cierre de release ya no rompe (regresión) | Confirmar que el bug-fix aparte de `respondService.ts:197` sigue funcionando tras este cambio | Cierre de release con release siguiente sigue arrancando en Architect |
| Loop Developer↔QA sin cambios | Cualquier corrida normal sin escalamiento | Comportamiento idéntico a hoy — este mecanismo no lo toca |
| `respondMergeApproval` intacto (regresión) | Aprobación de merge en Modo Manual (FEATURE-019) | Sigue creando el run de continuación vía `PLANNING_TO_QA`, sin pasar por ningún camino de este mecanismo |

### Validation Evidence

- Prueba real end-to-end en la VPS con un caso de negocio real que fuerce al menos un
  escalamiento en un rol distinto de Architect (ej. Developer), siguiendo el circuito completo
  hasta observar el reingreso y la resolución.
- Consulta SQL sobre `artifacts`/`project_config_versions` mostrando que el `id` de versión
  comparado en la detección de "repetido" corresponde a filas reales, no a un mecanismo en memoria.

---

## 8. Risks

- Es un cambio profundo a un mecanismo central y antiguo (reintento de escalamiento) — mayor
  superficie de riesgo que wiring de features anteriores, que en su mayoría reusaban mecanismos ya
  probados sin tocar su núcleo.
- El costo real (tiempo/tokens) de un recorrido completo de 3-5 roles por escalamiento, hasta 3
  veces, no está medido — vale la pena instrumentar duración real (mismo criterio que
  `phaseTiming` ya usa hoy) para decidir cuándo la optimización futura (ítem Tentativo) deja de ser
  opcional.
- Sin caso de negocio real todavía probado que ejercite un escalamiento fuera de Architect — el
  camino más común (aprobación de Roadmap) seguirá siendo el más validado hasta que haya una
  prueba real con, por ejemplo, un escalamiento genuino de Developer.

---

## 9. Approval Gate

Implementación prohibida hasta aprobación humana explícita de este documento.

---

## Estado de la implementación

Aprobado por el owner (Go para implementar). 3 rondas de validación técnica realizadas (Go
condicionado en las 2 primeras, Go técnico limpio en la ronda 3). Durante el arranque de la
implementación apareció un hallazgo real no cubierto por ninguna ronda de validación (Planning y
el loop Developer↔QA no tenían ningún enganche con el mecanismo de "paso") — resuelto por el owner
(Regla 10b, sección 6.4.a) sin necesitar otra ronda completa. En curso.