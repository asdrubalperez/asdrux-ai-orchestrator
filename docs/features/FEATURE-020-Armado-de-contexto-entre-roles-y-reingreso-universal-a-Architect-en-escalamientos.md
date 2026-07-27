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
   fase siguiente sin registrar un artifact de tipo `design`/`code` normal para ese rol, y sin
   reiniciar el contador de intentos.
6. El recorrido completo (Architect→...→rol que escaló) vive en un único run nuevo, con
   `pipelineSpec = FULL_PIPELINE` siempre — nunca se crea un run por cada rol que dice "no es mío".
7. La detección de "contenido repetido" solo se evalúa cuando el recorrido llega de nuevo al rol
   que escaló originalmente (`originAgentRole`) — comparando el `id` de la versión vigente del
   artefacto relevante contra el `id` guardado al momento de escalar. Si son iguales, se activa el
   escalamiento a humano (regla ya existente, sin cambios en ese punto final).
8. El contador de recorridos completos tiene tope 3 (igual que hoy) — se incrementa cada vez que
   se crea un run nuevo encadenado para la misma escalación original, viaja en el contexto (nunca
   en memoria de proceso), y al alcanzar el tope se escala a humano aunque el contenido no sea
   idéntico al original.
9. Architect no participa del mecanismo de "paso" — sus propias escalaciones (ambigüedad de caso
   de negocio real, o la aprobación de Roadmap que siempre requiere humano por regla) siguen
   yendo directo al humano, sin cambios respecto a hoy.
10. QA no participa como destino intermedio de este mecanismo — sigue siendo, como hoy, quien
    escala directo a humano cuando el loop Developer↔QA se agota o QA mismo no puede validar.

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

### 6.2 Release Plan en toda invocación de Planning

Extender `withActiveReleaseContext` (`runStart.ts:514-520`) para leer también
`getCurrentProjectConfig(projectId, "release_plan")` e incluirlo:
```ts
async function withRoleContext(projectId: string, functionalArtifact: unknown): Promise<unknown> {
  const roadmap = await getCurrentProjectConfig(projectId, "release_roadmap");
  const releasePlan = await getCurrentProjectConfig(projectId, "release_plan");
  return {
    functionalArtifact,
    activeRelease: activeReleaseFromRoadmap(roadmap?.value ?? null),
    releasePlan: releasePlan?.value ?? null,
  };
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

### 6.4 Reingreso único vía `FULL_PIPELINE`, con marcador `notApplicable`

Se reemplaza el reinicio local de `handleLinearEscalation` (`phaseIndex = 0` dentro del mismo run)
por la creación de un run nuevo (mismo patrón que ya usa `respondService.ts` para cualquier child
run: `createRunWorktree`, `createRun` con `client`, `originated_from_run_id`), con
`pipelineSpec = FULL_PIPELINE` siempre, y contexto inicial:
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
Cada rol, al recibir este contexto, evalúa si `targetAgentRole` es él (o si de todas formas tiene
algo que corregir aunque no sea el destinatario esperado — el "peor caso" sigue avanzando). Si no
tiene nada que aportar, responde `{ status: "completed", outputArtifact: { notApplicable: true } }`.
El orquestador, al ver este marcador, **no** registra un artifact de tipo `design`/`code` normal
para ese rol y pasa el mismo contexto de reingreso (sin modificar) a la fase siguiente — el pipeline
avanza, pero el contenido que viaja sigue siendo el de la escalación original, no el output de este
rol.

Si un rol SÍ resuelve el problema (produce un `outputArtifact` real, sin el marcador), el pipeline
continúa de ahí en más de forma **normal** — como cualquier ejecución lineal — hasta el final del
pipeline (incluido el loop Developer↔QA si corresponde), no se corta ahí.

### 6.5 Detección de contenido repetido — comparación por `id` de versión

Antes de crear el run de reingreso, se guarda `originalVersionRef`: el `id` de la fila vigente en
`artifacts` (o `project_config_versions`, según corresponda) que representa lo que el rol que
escaló estaba cuestionando. Ni `artifacts` (`insert`-only, confirmado en `repository.ts:518-525`)
ni `project_config_versions` (versionado con `valid_to`, nunca se pisa `value`, confirmado en
`repository.ts:281-340`) sobreescriben contenido — el `id` guardado sigue siendo válido para
siempre.

Cuando el recorrido llega de nuevo a `originAgentRole` (el rol que escaló originalmente), el
orquestador resuelve cuál es el `id` de la versión **vigente ahora** de ese mismo artefacto. Si
coincide con `originalVersionRef`, nadie lo cambió — se activa "contenido repetido"
(`escalation_repeated_detected`, evento ya existente) y se escala al humano, igual que hoy. Si es
un `id` distinto, algo cambió — el pipeline sigue normal desde ahí.

### 6.6 Contador de recorridos completos (tope 3)

`attempt` viaja en el contexto de reingreso (no en un `Map` en memoria, que no sobrevive entre
runs separados). Se inicializa en 1 al crear el primer run de reingreso para una escalación dada, y
se incrementa en 1 cada vez que hace falta crear **otro** run de reingreso completo para la misma
escalación original (o sea, cuando el recorrido llegó a `originAgentRole` sin detectar cambio, pero
todavía no se alcanzó el tope). Al llegar a `attempt = 3` sin resolución, se escala a humano aunque
el contenido no sea idéntico — mismo criterio de tope que existe hoy
(`MAX_ESCALATION_ATTEMPTS`), solo que ahora cuenta recorridos completos en vez de invocaciones
sueltas de un rol.

### 6.7 Riesgos técnicos

- Este mecanismo reemplaza una pieza central del motor de escalamiento (`handleLinearEscalation`),
  usada por todos los roles desde antes de FEATURE-018 — el riesgo de regresión es real y amplio,
  no acotado a un solo camino. Necesita cobertura de test proporcionalmente amplia (ver sección 7).
- El marcador `notApplicable` depende de que cada rol lo use correctamente en su prompt — mismo
  tipo de fragilidad ya aceptada (H12) para otras etiquetas de convención (`ROADMAP`,
  `FEATURES`, etc.), tolerada con el mismo mecanismo de defensa (regex genérico, tolerante a
  variaciones de formato).
- El recorrido completo (hasta 5 invocaciones de LLM por vuelta: Architect, Functional, Planning,
  Developer, y potencialmente QA si Developer resuelve y el loop continúa) tiene un costo real de
  tiempo/tokens mayor al reintento actual (1 invocación). Es exactamente el costo que el ítem
  ⚪ Tentativo "Escalamiento optimizado sin reinicio completo" ya anticipaba y decide no resolver
  todavía — aceptado como tradeoff de v1, consistente con decisiones anteriores del owner de no
  sobreingenierizar antes de que el costo sea un problema real.

---

## 7. Validation Criteria

| Escenario | Input | Esperado |
|---|---|---|
| Reintento automático de Architect | Architect escala su Roadmap, `humanSolution` null | El run de reingreso incluye `business_case` real (vía `root_run_id`), Architect puede reinterpretar en vez de reportar "rechazado" sin fundamento |
| Continuación de Planning con Release Plan | Run `PLANNING_TO_QA` arranca tras Feature A mergeada | Planning recibe la lista completa de Features + estados, no solo `featureJustCompleted` |
| Escalamiento de Developer llega a Planning | Developer escala por ambigüedad del plan, `targetAgentRole = "planning"` | Architect y Functional responden `notApplicable`, Planning corrige, el pipeline continúa normal desde Planning (incluye loop Developer↔QA de nuevo) |
| Peor caso — nadie se hace cargo | Ningún rol corrige nada real | Al llegar de nuevo a Developer (`originAgentRole`), el `id` de versión vigente es igual al guardado — se activa `escalation_repeated_detected`, escala a humano |
| Tope de 3 recorridos | 3 recorridos completos sin resolución y sin contenido idéntico detectado | Se escala a humano al llegar a `attempt = 3`, sin esperar un 4to recorrido |
| Cierre de release ya no rompe (regresión) | Confirmar que el bug-fix aparte de `respondService.ts:197` sigue funcionando tras este cambio | Cierre de release con release siguiente sigue arrancando en Architect |
| Loop Developer↔QA sin cambios | Cualquier corrida normal sin escalamiento | Comportamiento idéntico a hoy — este mecanismo no lo toca |

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

Pendiente — documento recién redactado, aún no enviado a validación técnica (Codex/Claude Code).