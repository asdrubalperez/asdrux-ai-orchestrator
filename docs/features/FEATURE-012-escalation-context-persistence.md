# FEATURE-012 — Persistencia de contexto/hallazgos en el circuito de escalamiento

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso — origen de este diseño**: previo a este documento, se le pidió a Codex una
> investigación sin sesgo (`docs/research/FEATURE-012-escalation-context-persistence.md`, rama
> `feature/012-escalation-context-persistence-research`) que relevó 7 mecanismos de persistencia
> existentes y evaluó 4 opciones, sin privilegiar `run_events` de entrada. A partir de esa
> investigación, Architect y el owner trabajaron el diseño funcional completo en sesión conjunta,
> resolviendo 5 preguntas de diseño (numeradas abajo en la sección 5) antes de llegar a este
> documento. Este documento formaliza esas decisiones — no reemplaza la investigación de Codex,
> la complementa con las reglas de negocio que solo el owner podía definir.
>
> **Siguiente paso explícito**: el owner va a pedirle a Codex que analice y valide este diseño
> antes de pasar a implementación. Este documento no autoriza implementación por sí solo.
>
> **Actualización — resultado de la primera validación de Codex**: No-Go menor. Codex encontró 3
> huecos reales (verificados contra el código, no solo aceptados de palabra): (1) la comparación
> de artifacts para detectar hallazgo repetido no estaba definida con precisión; (2) no existía
> ninguna superficie por la que un humano pudiera responder a un escalamiento; (3) "reintentar
> dentro del mismo run" requería más que tocar `finalizeRun` — `runStart.ts` hoy corta el proceso
> por completo (`return`) apenas una fase no da `completed`, y no hay ningún comando de reanudación.
> Los 3 puntos se resolvieron en sesión conjunta Architect-owner y quedan incorporados abajo (ver
> Reglas Funcionales 11 a 15, y Technical Considerations actualizado). Pendiente: segunda ronda de
> validación de Codex sobre esta versión antes de Go definitivo.
>
> **Actualización — resultado de la segunda validación de Codex**: Go condicionado menor. Los 3
> huecos grandes quedaron resueltos; Codex señaló 4 precisiones adicionales, todas verificadas
> contra el código antes de resolverlas: (1) estrategia de worktree/branch para el run hijo de
> `run:respond` — no definida; (2) `provider`/`model` no se persisten hoy en ningún lado
> reconstruible tras terminar el proceso; (3) el shape "solo el hallazgo" era impreciso — se
> descubrió que `PhaseResult.escalationReason` existe en el contrato pero **hoy no se persiste en
> absoluto** (se pierde al terminar el proceso), y es distinto de `outputArtifact` (el trabajo en
> sí); (4) la comparación de artifacts (Regla 13) necesitaba especificar serialización para el
> caso de `outputArtifact` como objeto JSON. Los 4 quedan resueltos en las Reglas Funcionales 16 a
> 19 de abajo. Con esto, diseño funcional cerrado — pendiente Go final del owner tras esta versión.
>
> **Actualización — resultado de la tercera validación de Codex**: Go condicionado menor, cada vez
> más cerca de implementación. Los 4 huecos de la segunda ronda quedaron resueltos: 3 aceptados
> tal como se propusieron (reconstrucción de pipeline vía `pipeline_definitions`, error explícito
> para runs viejos sin `provider`/`model`, `recordArtifact` debe devolver el id insertado), y 1
> (worktree del run hijo) se resolvió con un mecanismo mejor al original tras explorarlo en sesión
> conjunta: en vez de reutilizar el worktree/branch del padre (Regla 16 original), el run hijo
> obtiene su **propio** worktree/branch, ramificado desde la punta de la rama del padre — mismo
> comando `git worktree add -b` que ya usa el sistema, apuntando como base a `run/<parentRunId>`
> en vez de a `HEAD`/`main`. Esto resuelve de raíz el riesgo de que el padre quede con un path roto
> tras el cleanup de un hijo, y de paso permite responder más de una vez al mismo padre escalado
> sin colisión (ver Reglas 16 a 22 actualizadas abajo).
>
> **Actualización — resultado de la cuarta validación de Codex**: **Go para implementación**, con
> 4 notas de ejecución menores (no cambian el diseño funcional, ver sección 9.1): validar
> existencia de worktree/branch del padre antes de ramificar; validar mínimamente la `definition`
> leída de `pipeline_definitions`; usar un helper separado para `running ↔ retrying` (no
> reutilizar `finalizeRun`, que opera sobre `PhaseResult` y no admite `retrying`); y una precisión
> menor sobre la Validation Evidence (un padre puede tener más de un hijo si recibió más de una
> respuesta). Diseño funcional considerado cerrado por Codex — decisión de pasar a implementación
> queda en manos del owner.

---

## 1. Feature Identity

- **Name**: Persistencia de contexto/hallazgos en el circuito de escalamiento
- **Type**: Modelo de datos / lógica de orquestación
- **Owner**: asdru
- **Status**: **Aprobada por owner para implementación; implementación en rama**
  (ver Approval Gate, sección 10)
- **Priority**: Alta — bloquea el pendiente explícito de `docs/runbook/06-DELIVERY-WORKFLOW.md`,
  Stage 3 ("el mecanismo concreto de persistencia de ese contexto entre reinicios queda pendiente
  de diseño técnico")

---

## 2. Problem Statement

Stage 3 de `06-DELIVERY-WORKFLOW.md` define el circuito de escalamiento con reinicio: cuando un
agente detecta algo que excede su autoridad, escala hacia Architect, y el circuito recorre de
nuevo el pipeline hasta llegar al dueño real del hallazgo, llevando consigo el contexto/hallazgos
acumulados. El propio documento declara explícitamente que el mecanismo técnico de esa persistencia
entre reinicios queda pendiente — hoy no existe.

Además, el código actual (`finalizeRun`, `src/db/repository.ts`) mapea directo el resultado de una
fase (`PhaseStatus`) al estado del run (`runs.status`), tratando `escalated` como un valor más,
sin distinguir entre "el circuito está reintentando solo" y "el circuito ya agotó sus reintentos y
necesita a un humano". Esto deja sin resolver las dos condiciones de escalamiento a humano que ya
exige la Regla 8 de `03-AI-CONSTITUTION.md`: tope de 3 pasadas del mismo hallazgo, y detección de
hallazgo repetido sin resolver.

## 3. Functional Goal

Después de esta Feature, el sistema debe poder:

- Distinguir, para cualquier `run`, si está corriendo normalmente, reintentando tras un
  escalamiento interno, o realmente detenido esperando a un humano.
- Reconstruir cuántas veces un mismo hallazgo pasó por el circuito sin resolverse, para ese run.
- Detectar automáticamente cuándo un hallazgo se repite sin cambios reales entre pasadas, y
  escalar de inmediato a humano en ese caso, sin esperar el tope de 3.
- Cuando el humano responde con una solución (no aborta), continuar el trabajo en un `run` nuevo,
  vinculado al run original que escaló.
- Cuando el humano aborta, cerrar el run original sin generar continuidad.

## 4. Scope

**Incluido:**
- Nuevo valor de `runs.status`: `retrying`, para el circuito reintentando internamente sin
  necesitar humano.
- Redefinición de cuándo `runs.status` pasa a `escalated`: únicamente al agotar el tope de 3
  pasadas del mismo hallazgo, o al detectar hallazgo repetido — nunca en la primera escalada
  interna.
- Campo nuevo `originated_from_run_id` en `runs`, para vincular el run que continúa tras respuesta
  humana con el run original que escaló.
- Mecanismo de comparación de artifacts entre pasadas del mismo agente origen, para detectar
  hallazgo repetido.
- Ajuste de `finalizeRun`/lógica de derivación de status para incorporar esta regla de negocio en
  vez del mapeo directo actual.

**Excluido de esta Feature:**
- UI para listar hallazgos abiertos across proyectos (se acotó a nivel de proyecto/run específico
  por ahora, ver sección 5, Regla 6).
- Un identificador de "cadena completa" por encima de `run_id` que agrupe todos los runs
  encadenados de un mismo pedido original — se descartó explícitamente por ahora (ver Riesgos,
  sección 9).
- Reintentos automáticos del loop Developer↔QA (Stage 5) — ese loop ya tiene su propio mecanismo
  y tope, no se toca acá.

**Ideas futuras:**
- Identificador de cadena completa por encima de `run_id`, si en el futuro se necesita evitar
  navegar el vínculo `originated_from_run_id` manualmente para reconstruir el historial completo
  de un pedido.
- Vista de "todo lo que me necesita a mí" (hallazgos escalados a humano across proyectos).

## 5. Functional Rules

1. **Mismo `run_id` durante el circuito automático.** Mientras el escalamiento se resuelve solo,
   entre agentes, sin intervención humana, el `run` no cambia de identidad — solo retrocede
   `current_phase` hacia `architect`.

2. **`runs.status` distingue 3 situaciones no-terminales/terminales relacionadas con
   escalamiento:**
   - `running`: corriendo normal, sin tropiezos.
   - `retrying`: un agente escaló, el circuito está reprocesando internamente, sin necesitar
     humano todavía.
   - `escalated`: terminal — se agotó el tope de 3 pasadas del mismo hallazgo, o se detectó
     hallazgo repetido. Requiere intervención humana.

3. **Identidad de "mismo hallazgo".** No se usa hash ni etiqueta declarada por el agente. Se
   compara el artifact que el agente origen entrega en la pasada actual contra el artifact de la
   pasada anterior (mismo agente origen, mismo run). Si son iguales/equivalentes, es hallazgo
   repetido.

4. **Regla de hallazgo repetido (prioridad sobre el tope de 3).** Si al volver al agente que
   originó el escalamiento, la solución que trae la pasada actual es la misma con la que había
   llegado la pasada anterior, se interpreta que nadie se hizo cargo del problema real, y se
   escala a humano de inmediato — sin esperar a agotar las 3 pasadas. En la práctica, este caso
   normalmente se detecta en la 2da pasada, no en la 3ra.

5. **Tope duro de 3 pasadas**, cuando no aplica la regla 4: si el circuito completa 3 pasadas del
   mismo hallazgo sin resolución y sin que se detecte repetición exacta, escala a humano por
   agotamiento de tope.

6. **Resolución dentro del circuito automático es implícita.** No existe un evento explícito de
   "resuelto" mientras el circuito se resuelve solo — se deduce de que la cadena avanzó sin volver
   a fallar en el mismo punto (`status` pasa de `retrying` de vuelta a `running`).

7. **Resolución tras respuesta humana es explícita.** Cuando un run en `escalated` recibe una
   respuesta humana, esa respuesta se registra como evento explícito (contiene la decisión/insumo
   del humano), porque ahí no hay "fase posterior completada" que lo implique — hace falta un
   insumo nuevo que el humano aporta.

8. **Vínculo padre-hijo entre runs, tras respuesta humana.** Si el humano responde con una solución
   (no aborta), se crea un `run` nuevo, con `originated_from_run_id` apuntando al run que escaló, y
   su propio contador de pasadas arranca en 0 (es un ciclo de escalamiento nuevo, no una
   continuación del contador anterior).

9. **Aborto humano no genera continuidad.** Si el humano decide abortar en vez de dar una
   solución, no se crea ningún run nuevo — el run original permanece en `escalated`, sin más
   acción.

10. **Consulta acotada a proyecto/run específico.** La necesidad real identificada es buscar por
    proyecto y fecha de ejecución, no por `run_id` ni por una cadena completa de escalamientos.
    Esta Feature no requiere agregar una vista cross-proyecto de hallazgos abiertos.

11. **El reintento interno vive dentro de la misma invocación de `runStart`.** No se agrega ningún
    comando de reanudación separado para el circuito automático. El `for` de fases lineales de
    `runStart.ts` deja de cortar con `return` al primer `status !== "completed"` cuando ese status
    es `escalated`; en su lugar, evalúa la Regla 3/4 (comparación de artifacts) y decide entre
    reiniciar el bucle desde `architect` (si corresponde reintentar) o cortar con `finishRun` (si
    se agota el tope o hay hallazgo repetido). El resto de los status no-`completed`
    (`rejected`/`failed`/`interrupted`) mantiene el comportamiento actual, sin cambios — fuera de
    scope de esta Feature.

12. **Contexto de reintento = solo el hallazgo, no el `businessCase` original.** Cuando Architect
    es reinvocado por un reintento, el `context` que recibe es el artifact/hallazgo que causó el
    escalamiento — el mismo patrón que ya usa el pipeline hoy (cada fase recibe el
    `outputArtifact` de la fase anterior, no el `businessCase` crudo). Justificación: Architect
    tiene ownership de arquitectura y sus propios entregables; los hallazgos son contra
    entregables de agentes, no contra el input primario del negocio.

13. **Comparación de artifacts (resuelve la Regla 3/4 con precisión): se compara únicamente
    `artifacts.content.outputArtifact`** de la pasada actual contra el de la pasada anterior del
    mismo agente origen — comparación exacta sobre ese campo. **`summary` queda explícitamente
    excluido de la comparación** (es narrativa descriptiva del agente, no la solución en sí; puede
    variar en redacción aunque la solución real no haya cambiado).

14. **Superficie de respuesta humana: comando nuevo `run:respond`.** Se agrega
    `run:respond --run <id> [--solution "<texto>"] [--abort]`, separado de `runStart`, para
    diferenciar claramente la intención de "responder a un escalamiento" de "iniciar un run desde
    cero". El diseño del comando deja lugar a futuras intervenciones humanas no cubiertas por esta
    Feature (ej. detener un run en curso, o que el humano pregunte algo a mitad de proceso) —
    **esta Feature implementa únicamente `--solution` y `--abort`**, el resto queda fuera de
    scope, solo se evita cerrar la puerta a extenderlo después.
    - `--solution`: valida que el run esté en `escalated`; registra evento explícito; crea `run`
      nuevo con `originated_from_run_id`; arranca el bucle de fases para ese run nuevo desde
      `architect`, con contexto = hallazgo original + solución humana.
    - `--abort`: valida que el run esté en `escalated`; registra evento; no crea nada más.

15. **`event_type` mínimos requeridos en `run_events` para esta Feature** (además de los ya
    existentes `phase_started`/`phase_finished`):
    - `escalation_opened` — payload: `{ agentRole, artifactId, attempt }` (se registra cada vez
      que una fase escala y el circuito decide reintentar).
    - `escalation_repeated_detected` — payload: `{ agentRole, artifactId, previousArtifactId }`
      (se registra cuando la comparación de la Regla 13 detecta hallazgo repetido).
    - `escalation_exhausted` — payload: `{ agentRole, attempts }` (tope de 3 alcanzado sin
      repetición exacta).
    - `escalation_human_response` — payload: `{ solution, newRunId }` (respuesta humana con
      solución, vía `run:respond --solution`).
    - `escalation_aborted` — payload: `{}` (respuesta humana de aborto, vía `run:respond --abort`).

16. **`run:respond --solution` crea worktree/branch propio para el run hijo, ramificado desde la
    punta de la rama del padre** (reemplaza la versión anterior de esta regla, que proponía
    reutilizar el mismo worktree). Antes de ramificar, se asegura que el trabajo pendiente del
    padre esté commiteado en su rama (reutilizando `commitAllChanges`, ya existente). Luego:
    `git worktree add -b run/<childRunId> <path-nuevo> run/<parentRunId>` — mismo comando que ya
    usa `createRunWorktree` hoy (`src/isolation/worktree.ts`), cambiando únicamente el ref base
    (`run/<parentRunId>` en vez de `HEAD`). Esto evita que el padre quede con un
    `worktree_path` roto si un hijo hace cleanup al completar, y permite responder más de una vez
    al mismo padre escalado (ej. si el humano se equivocó en la solución la primera vez) sin
    colisión entre intentos — cada intento tiene su propio worktree aislado.

17. **Reconstrucción del pipeline en `run:respond`: vía `pipeline_definitions`, no vía el
    registro en código `PIPELINES`.** El run padre ya tiene `pipeline_definition_id` (FK real a
    `pipeline_definitions`, que guarda la `definition` completa en JSON). `run:respond` lee esa
    fila directamente (`select definition from pipeline_definitions where id = $1`) y la usa tal
    cual — no vuelve a resolver `pipelineName` contra `PIPELINES`. Esto es más robusto: la
    definición queda "congelada" tal como era cuando el run padre arrancó, sin importar si el
    código de `PIPELINES` cambió después.

18. **Runs viejos sin `provider`/`model` en `run_started`: error explícito, sin fallback.** Como
    esta Feature agrega esos campos recién ahora (Regla 17 original, ahora reglas de esta lista),
    cualquier run escalado anterior a esta Feature no los va a tener. `run:respond` debe fallar
    con un mensaje claro (ej. "Este run no tiene provider/model registrado — corrida anterior a
    esta Feature, no se puede reanudar automáticamente") en vez de asumir un default.

19. **`recordArtifact` debe devolver el id insertado.** Hoy retorna `void`
    (`src/db/repository.ts`); se agrega `returning id` a la query y se cambia el tipo de retorno,
    porque los `event_type` de la Regla 15 (`escalation_opened`, `escalation_repeated_detected`)
    necesitan `artifactId`/`previousArtifactId` en su payload.

20. **Shape del contexto de reintento** (corrige la Regla 12 — "el hallazgo" no es un solo campo,
    son dos datos distintos):
    ```
    {
      escalationReason: string,        // el motivo — por qué escaló, ej. "release demasiado grande"
      rejectedArtifact: unknown,       // el outputArtifact real que se rechazó, ej. el plan de release
      originAgentRole: AgentRole,      // qué agente escaló
      humanSolution: string | null     // solo presente si viene de run:respond --solution
    }
    ```
    Este shape aplica tanto al reintento automático interno (Regla 11, `humanSolution: null`) como
    al reintento tras respuesta humana (Regla 14, `humanSolution` con lo que aportó el humano).

21. **Ajuste requerido a la persistencia de artifacts (defecto existente que esta Feature debe
    corregir):** hoy `recordArtifact` (`runStart.ts`) solo persiste `{ outputArtifact, summary }`
    — `escalationReason` se genera en `PhaseResult` pero se descarta, nunca llega a la base de
    datos. Sin corregir esto, la Regla 20 no puede cumplirse (no hay de dónde leer
    `escalationReason` en un reintento que ocurre en un proceso distinto, vía `run:respond`). Se
    agrega `escalationReason` al `content` persistido cuando `status === "escalated"`.

22. **Comparación de artifacts usa JSON canonicalizado, no comparación por referencia** (precisa
    la Regla 13): antes de comparar el `outputArtifact` actual contra el de la pasada anterior, se
    serializan ambos con las claves ordenadas de forma determinística (canonical JSON), y se
    compara la igualdad exacta de esas dos strings resultantes. Cubre tanto el caso de
    `outputArtifact` como string simple (la canonicalización no cambia nada) como el caso de
    objeto JSON (evita falsos negativos por orden de claves no determinístico).


## 6. Estrategia Algorítmica

No aplica lógica de decisión/optimización en el sentido de la sección 6 del template (no hay
scheduling, ranking, ni desempates). La única "decisión" del sistema es la comparación de
equivalencia entre dos artifacts consecutivos del mismo agente origen (Regla Funcional 3/4), que
se documenta como parte de las Technical Considerations (sección 7), no como estrategia
algorítmica separada.

## 7. Technical Considerations

- **Arquitectura afectada**:
  - `runs`: nueva columna `originated_from_run_id` (nullable, FK a `runs.id`), **con índice**
    (`create index runs_originated_from_run_id_idx on runs (originated_from_run_id)` — necesario
    porque la propia validación de esta Feature consulta por ese campo, ver sección 8); nuevo
    valor posible de `status` (`retrying`).
  - `run_events`: sin cambios de schema, solo los nuevos `event_type` listados en Regla 15.
  - `finalizeRun`/el `for` de fases lineales en `src/cli/commands/runStart.ts`: el `for` deja de
    ser de una sola pasada — pasa a ser un bucle controlado que puede reiniciar desde `architect`
    (índice del array de fases vuelve a 0) cuando la Regla 11 lo indica, con un contador de
    intentos **en memoria, dentro de esa misma ejecución del proceso** (no se persiste como
    número aparte — se puede recalcular contando `escalation_opened` en `run_events` para
    cualquier consulta externa, pero el bucle en runtime necesita su propia variable de control
    para saber cuándo cortar).
  - Nuevo comando `src/cli/commands/runRespond.ts` (`run:respond`), que reutiliza el mismo
    mecanismo de bucle de fases que `runStart.ts` para el `run` nuevo que crea.
- **Integraciones**: `runStart.ts` (bucle modificado), `runRespond.ts` (nuevo, invoca el mismo
  bucle para el run hijo).
- **Dependencias**: se apoya en `artifacts.content.outputArtifact` (comparación por JSON
  canonicalizado, `summary` excluido — Regla 22) para detectar hallazgo repetido; se apoya en
  `run_events` (nuevos `event_type` de la Regla 15) como bitácora append-only, sin cambios de
  schema; se apoya en `pipeline_definitions` (columna `definition`, ya existente) para que
  `run:respond` reconstruya el pipeline del run padre (Regla 17), sin volver a resolver contra el
  registro en código `PIPELINES`.
- **Riesgo técnico ya resuelto en esta versión**: la ambigüedad de "artifacts equivalentes" que
  señaló la primera validación de Codex queda cerrada por la Regla 22 (comparación de JSON
  canonicalizado sobre `outputArtifact`, `summary` excluido).
- **Ajustes de la segunda ronda de validación**:
  - `run_started` (evento existente): agregar `provider` y `model` al payload (Regla 17
    original — ahora ver Regla 18 de la tercera ronda para el caso de runs viejos sin estos
    campos).
  - `recordArtifact`: agregar `escalationReason` al `content` persistido cuando
    `status === "escalated"` — hoy se descarta (Regla 21, defecto existente a corregir); además
    debe pasar a devolver el id insertado (Regla 19, tercera ronda).
  - `run:respond` (comando nuevo, `src/cli/commands/runRespond.ts`): crea worktree/branch **propio**
    para el run hijo, ramificado desde la punta de la rama del padre, no reutiliza el del padre
    (Regla 16, corregida en la tercera ronda); reconstruye el pipeline vía `pipeline_definitions`
    (Regla 17); falla explícito si el run padre no tiene `provider`/`model` registrado (Regla 18);
    lee `provider`/`model` del `run_started` del padre vía `run_events` cuando sí están presentes;
    arma el contexto de reintento con el shape de la Regla 20, leyendo `escalationReason` y
    `outputArtifact` del artifact de escalamiento correspondiente (Regla 19, id del artifact).

## 8. Validation Criteria

**Escenario 1 — Caso feliz: circuito se resuelve solo, sin llegar a humano**
- Input: Feature X escala en QA (pasada 1), Architect reintenta, QA aprueba en la pasada 2.
- Output esperado: `runs.status` pasa de `running` a `retrying` en la pasada 1, y vuelve a
  `running` al completarse la pasada 2. No se genera ningún `originated_from_run_id`. El run
  original sigue avanzando con el mismo `run_id`.

**Escenario 2 — Caso no feliz: tope de 3 pasadas agotado, sin repetición exacta**
- Input: Feature X escala en QA 3 veces, con soluciones distintas cada vez (no equivalentes entre
  sí), sin resolverse.
- Output esperado: en las pasadas 1 y 2, `status = retrying`. Al agotar la 3ra pasada sin
  resolución, `status = escalated` (terminal). La bitácora (`run_events`) tiene 3 renglones de
  escalamiento para ese `run_id`.

**Escenario 3 — Caso intermedio: hallazgo repetido detectado antes del tope de 3**
- Input: Feature X escala en QA (pasada 1). El circuito reintenta, dentro de la misma invocación
  de `runStart`, pero el `outputArtifact` (canonicalizado) que vuelve a QA en la pasada 2 es
  idéntico al que causó el rechazo original.
- Output esperado: se registra `escalation_repeated_detected` en la pasada 2, `status` pasa a
  `escalated`, el proceso termina. Al ejecutar `run:respond --run <id> --solution "<texto>"`:
  se crea worktree/branch **propio** para el run hijo, ramificado desde `run/<parentRunId>`
  (Regla 16); se reconstruye el pipeline vía `pipeline_definitions` (Regla 17); se lee
  `provider`/`model` del `run_started` del padre (falla explícito si no están, Regla 18); se
  registra `escalation_human_response`; se crea un `run` nuevo con `originated_from_run_id`; ese
  run nuevo arranca su bucle desde `architect` con contexto
  `{ escalationReason, rejectedArtifact, originAgentRole: "qa", humanSolution: "<texto>" }`
  (Regla 20), contador de pasadas en 0.

### Validation Evidence

- Evidencia observable: consulta directa a `runs` filtrando por `status = 'escalated'` debe
  devolver únicamente casos que genuinamente requieren intervención humana (nunca casos en medio
  de un reintento interno) — esto es lo que permite verificar que la Regla Funcional 2 se cumple
  en la práctica, no solo en el diseño.
- Consulta de `run_events` para un `run_id` dado debe permitir reconstruir, en orden, cada pasada
  del circuito y su resultado — verifica la Regla Funcional 6 (resolución implícita reconstruible).
- Para el caso de vínculo padre-hijo (Escenario 3), verificar que `select * from runs where
  originated_from_run_id = <id del run original>` devuelve exactamente el run de continuación
  (esta consulta debe usar el índice `runs_originated_from_run_id_idx`, no un full scan), y que
  su contador de pasadas propio arranca en 0, no continúa el del run padre.
- Verificar que `run:respond --run <id> --abort` sobre un run en `escalated` registra
  `escalation_aborted` y **no** crea ninguna fila nueva en `runs` — el run original permanece
  intacto en `escalated`.
- Verificar que el run hijo creado por `run:respond --solution` tiene un `branch_name`/
  `worktree_path` **distinto** al del run padre, y que su rama es descendiente de
  `run/<parentRunId>` (`git log` o `git merge-base` deberían mostrar la rama del padre como
  ancestro) — no reutiliza el mismo worktree (Regla 16, corregida en la tercera ronda).
- Verificar que ejecutar `run:respond --solution` **dos veces** sobre el mismo run padre escalado
  no genera ninguna colisión de path/branch — cada ejecución produce su propio worktree/branch
  hijo, ambos ramificados de forma independiente desde el mismo punto del padre.
- Verificar que `run:respond` sobre un run padre sin `provider`/`model` en su `run_started` (caso
  de run anterior a esta Feature) falla con un mensaje explícito, sin crear nada (Regla 18).
- Verificar que el `outputArtifact` persistido en el artifact de escalamiento incluye ahora
  `escalationReason` (Regla 21) — antes de esta Feature, ese campo se generaba pero no llegaba a
  la base de datos.
- Verificar con un caso donde `outputArtifact` es un objeto JSON con orden de claves distinto
  entre dos pasadas pero mismo contenido semántico: la comparación (Regla 22) debe detectarlo
  como igual (hallazgo repetido), no como distinto.

## 9. Risks

- **Riesgo cerrado en esta ronda**: la ambigüedad de "artifacts equivalentes" (Regla 22) — se
  resolvió con comparación de JSON canonicalizado sobre `outputArtifact`, `summary` excluido.
  Riesgo residual menor: si en el futuro `outputArtifact` deja de ser comparable de esta forma
  (ej. contenido no serializable de forma determinística), esta regla necesitará revisión — no se
  anticipa acá.
- **Supuesto sobre alcance de consulta** (Regla 10): se asumió que la necesidad real es buscar por
  proyecto/fecha, no por cadena completa de escalamientos. Si esto resulta insuficiente en la
  práctica, haría falta revisitar el ítem de "Ideas futuras" (identificador de cadena) antes de lo
  esperado.
- **Impacto de migración**: agregar `originated_from_run_id` (con su índice) y el nuevo valor de
  `status` no debería romper runs existentes (campo nuevo, nullable; nuevo valor de `status` es
  aditivo), pero cualquier código que hoy asuma que `runs.status` solo tiene 4 valores (`running`,
  `completed`, `failed`, `escalated`) necesita revisión — Codex debe verificar esto explícitamente
  contra el código real antes de implementar.
- **Riesgo nuevo, introducido por la resolución del punto 3**: convertir el `for` de fases
  lineales en un bucle que puede reiniciar desde `architect` cambia el flujo de control central de
  `runStart.ts` — es el cambio de mayor superficie de esta Feature. Recomendado: Codex debe
  verificar explícitamente que el loop Developer↔QA (fuera de scope, Regla Funcional de exclusión
  en sección 4) no se ve afectado por este cambio de estructura, dado que ambos comparten el mismo
  archivo.
- **Riesgo nuevo, comando `run:respond`**: al ser una superficie de escritura nueva y sensible
  (puede crear runs y modificar estado), requiere la misma verificación de sesión/autenticación
  que ya usa `runStatus.ts` (`readValidSession`) — no se debe asumir que basta con validar
  `status = 'escalated'` sin también validar que quien ejecuta el comando tiene permiso sobre ese
  proyecto/run.
- **Riesgo nuevo, worktree ramificado desde el padre (Regla 16, tercera ronda)**: cada
  `run:respond --solution` exitoso agrega un worktree/branch nuevo en disco — si un padre recibe
  varios intentos (ej. por error humano al responder, ver ejemplo de la Regla 16), los intentos
  abandonados (worktrees de hijos que nunca se completaron) quedan ocupando espacio y no tienen
  hoy una política de limpieza propia — se apoyan en la misma retención de 21 días que ya existe
  para runs escalados, pero conviene que Codex confirme que esa política aplica igual a hijos
  huérfanos, no solo al run original. Además, ramificar depende de que `commitAllChanges` se haya
  ejecutado sobre la rama del padre antes de crear el worktree hijo — si el padre tiene cambios
  sin commitear al momento de escalar, hay que asegurarse de que ese commit se haga como parte del
  flujo de escalamiento (Regla 11), no solo al finalizar con éxito como ocurre hoy.

## 9.1 Notas de Implementación (cuarta validación de Codex — Go, sin nuevo No-Go)

Estas 4 notas no modifican el diseño funcional (Reglas 1 a 22) — son cautelas de ejecución para
quien implemente, verificadas antes de incorporarlas:

1. **`run:respond` debe validar que `worktree_path`/`branch_name` del padre sigan existiendo**
   antes de intentar `commitAllChanges` y ramificar. Si faltan (ej. borrados manualmente, o
   perdidos por alguna limpieza externa al flujo normal), fallar con error explícito — no asumir
   que siempre están disponibles solo porque el run padre existe en `runs`.
2. **La `definition` leída desde `pipeline_definitions` (Regla 17) debe validarse mínimamente**
   antes de ejecutarse: presencia de `phases`, `agentRole` por fase, `permissions`, y `loop` si
   corresponde — mismo nivel de validación que ya se espera de cualquier `PipelineSpec` usado por
   `runStart.ts` hoy, no una validación nueva inventada para esta Feature.
3. **Hace falta un helper separado para las transiciones `running ↔ retrying`** (confirmado
   contra el código: `finalizeRun` opera sobre `PhaseResult`, y `retrying` no es un valor de
   `PhaseStatus` — no puede reutilizarse esa función tal cual para este caso). Se necesita una
   función nueva, ej. `setRunRetrying(runId)` / `setRunRunning(runId)`, separada de `finalizeRun`
   (que sigue usándose solo para los estados terminales: `completed`, `failed`, `escalated`).
4. **Precisión sobre "exactamente un run de continuación"** (Validation Evidence, sección 8): el
   criterio se refiere a un único escenario de respuesta (`select ... where
   originated_from_run_id = <id>` devuelve el run hijo de *esa* respuesta puntual) — no implica
   que un padre solo pueda tener un hijo en su vida. Un mismo padre puede tener múltiples hijos si
   recibió múltiples respuestas (Regla 16, caso de corrección tras error humano); la consulta por
   `originated_from_run_id` naturalmente devuelve todos los que existan, no necesariamente uno
   solo.

## 10. Approval Gate

El diseño funcional fue cerrado en sesión conjunta Architect-owner, y pasó por cuatro rondas de
validación de Codex (No-Go menor → Go condicionado menor → Go condicionado menor → **Go**, con
notas de ejecución incorporadas en la sección 9.1). Codex ya no reporta No-Go de diseño.

Go final explícito del owner otorgado en chat para iniciar implementación. Status: **aprobada para
implementación en rama**.
