# FEATURE-018 — Wiring real del ciclo Roadmap de Releases (Architect) + Release Plan (Planning)

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: Numeración vigente confirmada contra `docs/ROADMAP.md` real en `main` —
> esta es FEATURE-018 (antes FEATURE-017, antes FEATURE-015). El diseño conceptual de este ciclo
> ya existía en el Runbook (`docs/runbook/02-ARCHITECTURE-TEMPLATE.md` §0 y
> `docs/runbook/09-RELEASE-PLAN-TEMPLATE.md`) desde antes de esta sesión; lo que agrega este
> documento es el wiring real (roles, persistencia, escalamiento, UI) más una simplificación de
> diseño acordada con el owner — ver sección 5.

---

## 1. Feature Identity

- **Name**: Wiring real del ciclo Roadmap de Releases (Architect) + Release Plan (Planning)
- **Type**: Backend (roles `architect.txt`/`planning.txt`, persistencia, escalamiento) + Frontend
  (`ReleasePlanPanel` real) + Gobernanza (edición de `docs/runbook/02-ARCHITECTURE-TEMPLATE.md` §0
  y `docs/runbook/03-AI-CONSTITUTION.md` Regla 8.4)
- **Owner**: asdru
- **Status**: ✅ Ejecutada. Aprobada por el owner, validada en la VPS y mergeada a `main` (commit
  `458c159` implementación, `411f73d` merge). Alcance final ajustado al cierre — ver "Lecciones
  Aprendidas" al final de este documento.
- **Priority**: Confirmada (`docs/ROADMAP.md`)

---

## 2. Problem Statement

El Runbook ya define, desde antes de esta Feature, cómo Architect debe proponer un Roadmap de
Releases y cómo Planning debe organizar el Release Plan de cada release activo. Pero verificado
contra el repo real (tarball de `main`, sesión actual):

- `src/executor/roles/architect.txt` no menciona roadmap ni releases — Architect hoy solo produce
  el contrato genérico ESTADO/RESUMEN/ARTEFACTO/RAZON_ESCALAMIENTO, sin ninguna noción de release.
- `src/executor/roles/planning.txt` tampoco tiene noción de "release activo" ni de secuencia de
  Features — hoy planifica una sola Feature a la vez, sin agruparlas en un release.
- No existe ninguna tabla ni columna que persista un roadmap de releases ni cuál es el "release
  activo" de un proyecto.
- `ReleasePlanPanel` (`web/src/main.tsx`, línea 719) está completamente hardcodeado: tres ítems
  fijos sin fetch a ningún endpoint real — el placeholder que reservó FEATURE-013.
- El mecanismo de aprobación humana que exige `docs/runbook/03-AI-CONSTITUTION.md` Regla 8, punto
  4 ("la aprobación del Roadmap de Releases... y de cada release siguiente al completarse el
  anterior") no tiene ningún camino de implementación hoy — el único mecanismo de escalamiento
  real que existe (`POST /runs/:id/respond`, `respondToEscalation`) fue construido para hallazgos
  dentro de una fase normal del pipeline, no para una aprobación que ocurre antes de que Functional
  reciba nada.

Sin esto, el Roadmap de Releases y el Release Plan son documentos conceptuales sin ningún efecto
en la ejecución real del pipeline ni en lo que ve el usuario.

---

## 3. Functional Goal

1. Architect, en su fase normal, además de la propuesta de arquitectura ya existente, declara
   siempre un Roadmap de Releases — mínimo un release (MVP), incluso cuando todo el alcance cabe
   en uno solo (ver sección 5, simplificación acordada).
2. Esa propuesta de roadmap se escala al humano para aprobación, reusando el mecanismo de
   escalamiento existente (`respondToEscalation`) — no se avanza a Functional hasta que el owner
   aprueba.
3. Una vez aprobado, queda registrado cuál es el **release activo**, persistido de forma versionada
   (histórico completo, no solo el estado actual).
4. Planning, al organizar el trabajo de una Feature, lo hace siempre dentro del contexto del
   release activo — su Release Plan (secuencia + enfoque técnico + Test Plan por Feature) queda
   asociado a ese release.
5. Al completarse un release (todas sus Features en ✅ Ejecutado), Architect recalcula/confirma el
   release siguiente y vuelve a escalar al humano — no hay continuidad automática entre releases.
6. El usuario ve en `ReleasePlanPanel` (pantalla "Run en curso") el estado real: roadmap vigente,
   cuál release está activo, y las Features que lo componen — sin datos hardcodeados.

---

## 4. Scope

**Incluido:**
- Extensión de `architect.txt` para declarar el Roadmap de Releases como parte de su salida normal.
- Extensión de `planning.txt` para operar siempre dentro de un release activo (secuencia +
  enfoque técnico + Test Plan por Feature, sección 2 de `09-RELEASE-PLAN-TEMPLATE.md`).
- Persistencia versionada del roadmap y del release activo, reusando `project_config_versions`
  (`config_key = "release_roadmap"`).
- Extensión del mecanismo de escalamiento existente (`respondToEscalation`) para reconocer una
  escalación de tipo "aprobación de roadmap" y, al aprobarse, persistir la nueva versión en vez de
  (o además de) continuar el pipeline con `humanSolution` como texto libre.
- Endpoint real para exponer el roadmap/release activo del proyecto al frontend.
- `ReleasePlanPanel` conectado a datos reales (fetch, no hardcodeado).
- Edición de gobernanza: `docs/runbook/02-ARCHITECTURE-TEMPLATE.md` §0 (de "condicional" a
  "siempre presente, mínimo un release") y `docs/runbook/03-AI-CONSTITUTION.md` Regla 8, punto 4
  (mismo ajuste de lenguaje).

**Excluido:**
- Evaluación de Tamaño del Release por Planning (`09-RELEASE-PLAN-TEMPLATE.md` §0, "riesgo
  razonable / riesgo real") — su escalamiento asociado (Regla 8.4, "riesgo de que un release
  resulte demasiado grande") queda fuera de este ciclo; Planning sigue escalando ambigüedad de la
  forma genérica ya existente hasta que se diseñe puntualmente.
- Selección de proveedor/modelo/credenciales para el paso de mapeo del roadmap — no aplica acá, es
  el mismo Architect ya en ejecución, no un paso nuevo con su propia llamada al proveedor.
- Cualquier cambio a `mapBusinessCase.ts` (eso es la Feature separada "selección proveedor/
  modelo/credenciales por rol", descartada para este ciclo).
- Credenciales git por usuario (Feature separada, descartada para este ciclo).
- Automatización del avance entre releases sin aprobación humana — explícitamente fuera de
  alcance, la Regla 8.4 exige aprobación en cada release siguiente, sin excepción.

**Ideas futuras (no en este ciclo):**
- Editar manualmente el roadmap desde la UI (hoy solo Architect lo propone y el humano
  aprueba/rechaza vía escalamiento, sin edición directa en pantalla).
- Visualización de progreso del release activo (% de Features completadas) más allá de los tres
  ítems actuales del panel.

---

## 5. Simplificación de diseño acordada con el owner (afecta gobernanza)

El Runbook define hoy el Roadmap de Releases como **condicional**: "Solo aplica cuando el alcance
del business case es demasiado amplio para completarse en un único release. Si el alcance ya viene
acotado a uno solo, esta sección queda No Aplica" (`02-ARCHITECTURE-TEMPLATE.md` §0).

Se acordó **eliminar esta condicionalidad**: Architect siempre declara un roadmap, con un mínimo de
un release (MVP) marcado como activo, incluso cuando todo el alcance cabe en ese único release.
Motivo: el propio Release Plan de Planning (`09-RELEASE-PLAN-TEMPLATE.md`) ya asume implícitamente
la existencia de "un release" sobre el cual organizar la secuencia de Features, exista o no un
roadmap formal — formalizarlo siempre elimina una rama condicional tanto en los prompts de rol como
en el código (persistencia, escalamiento y UI dejan de necesitar una variante "sin roadmap").

Esto requiere editar seis documentos de gobernanza, no solo implementar — lista corregida tras
validación técnica de Codex (ver "Estado de validación" al final), que encontró 4 menciones
adicionales que esta sección no contemplaba originalmente:

- `docs/runbook/02-ARCHITECTURE-TEMPLATE.md` §0 — cambiar el texto de "condicional" a "siempre
  presente, mínimo un release".
- `docs/runbook/03-AI-CONSTITUTION.md` Regla 8, punto 4 — el texto actual dice "la aprobación del
  Roadmap de Releases que Architect propone **cuando el alcance es demasiado amplio para un único
  release**" — debe ajustarse para reflejar que la aprobación aplica siempre, no solo en ese caso.
- `docs/runbook/00-README.md` — dos menciones textuales: "Roadmap de Releases si aplica" (flujo
  general) y "Roadmap de Releases (condicional)" (tabla de Core Documents). Mismo ajuste de texto.
- `docs/runbook/08-CODE-SYSTEM-PROMPT.md` — "el Roadmap de Releases cuando el alcance es demasiado
  amplio para un único release" (sección Architect). Mismo ajuste de texto.
- `docs/runbook/BOOTSTRAP.md` — "incluyendo el Roadmap de Releases (sección 0) si el alcance es
  demasiado amplio para un único release" (Stage 3). Mismo ajuste de texto.
- `docs/runbook/06-DELIVERY-WORKFLOW.md`, sección "Cierre del Release y Release Siguiente" — **este
  no es solo un ajuste de texto**: hoy define una bifurcación de tres ramas ("Si no existe Roadmap
  de Releases: el proyecto queda cerrado" / "Si existe y hay un release siguiente" / "Si existe y
  no hay más"). Bajo la regla nueva, la primera rama se vuelve un caso imposible (siempre existe un
  roadmap) — hay que **colapsar la lógica a dos ramas**: "es el último release del roadmap → el
  proyecto queda cerrado" / "hay un release siguiente → se escala a Architect, que escala al
  humano". No alcanza con reemplazar una palabra en esta sección.

Estas ediciones forman parte del handoff de esta Feature (no son un efecto colateral silencioso).

---

## 6. Functional Rules

1. Architect declara el roadmap siempre, como parte de su salida normal de fase — no es un paso ni
   una invocación separada.
2. El roadmap propuesto nunca se considera vigente sin aprobación humana explícita — ni el primero
   ni ninguno de los siguientes al completar un release.
3. Mientras el roadmap está pendiente de aprobación, el pipeline no avanza a Functional (mismo
   criterio que cualquier escalamiento existente: el run queda en estado `escalated` hasta que el
   humano responde).
4. Solo puede haber un release activo por proyecto en un momento dado.
5. Planning siempre planifica dentro del contexto del release activo vigente al momento de su
   invocación — si no hay uno vigente (caso imposible bajo la Regla 1, pero defendido de todos
   modos), Planning escala en vez de asumir un release implícito.
6. Al aprobarse un roadmap (inicial o siguiente), la versión anterior en `project_config_versions`
   queda cerrada (`valid_to`) y la nueva pasa a ser la vigente — historial completo, nunca se
   sobrescribe en el lugar.
7. El release activo solo cambia por acción explícita de Architect al completarse el anterior,
   nunca automáticamente ni por acción de otro rol.

---

## 7. Technical Considerations

### 7.1 Persistencia — reusar `project_config_versions` (FEATURE-011)

Se reusa la tabla existente en vez de crear una nueva, por decisión explícita evaluada con el
owner:

- `config_key = "release_roadmap"`.
- `value` (JSONB) con forma: lista de releases (`{ id, nombre, alcance_resumen, estado }`, estado
  ∈ `Activo | Pendiente | Completado`) y el id del release activo.
- Ya versionado (`valid_from`/`valid_to`, índice único "una vigente por proyecto+key") — el
  historial completo de cómo evolucionó el roadmap queda resuelto sin código nuevo.
- `changed_in_run_id` vincula la versión al run de Architect que la propuso.
- `changed_by_user_id` vincula la versión al humano que la aprobó (mismo `req.user.id` que ya usa
  `respondToEscalation`).
- `run_config_versions` (tabla puente ya usada por `runStart.ts`) resuelve el snapshot de "qué
  roadmap estaba vigente cuando arrancó este run", sin mecanismo nuevo.
- **Cambio de firma requerido** (identificado en segunda validación técnica): `setProjectConfig`
  hoy abre su propia conexión (`pool.connect()`) y no acepta un `client` externo — a diferencia de
  `getCurrentProjectConfigs` y `createRun`, que sí aceptan `client?: PoolClient` en el mismo
  archivo. Para que la persistencia del roadmap participe de la misma transacción que crea el
  child run (ver 7.2), `setProjectConfig` necesita el mismo parámetro opcional — mismo patrón ya
  existente, no un mecanismo nuevo.

Costo aceptado: `config_key` fue pensado semánticamente para configuración editable por el usuario,
no para un artefacto producido con flujo de aprobación — desprolijidad de nomenclatura, no un
problema funcional.

### 7.2 Escalamiento — extender `respondToEscalation`, no crear un mecanismo nuevo

**Cómo se distingue una escalación de "aprobación de roadmap" de una escalación genérica**: no
hace falta un campo ni un tipo de acción nuevo — la señal ya está en el propio artifact. Hay
exactamente dos casos posibles cuando Architect llega a `ESTADO: escalated`:

- **Architect completó su análisis** (siempre trae `ROADMAP` con contenido — mínimo un release
  MVP, por la Regla 1 de la sección 6): esta es la escalación de "aprobación de roadmap".
- **Architect no pudo completar el análisis** (ambigüedad real — falta información crítica; igual
  que hoy deja `ARTEFACTO: null`, deja `ROADMAP: null` por la misma razón): esta sigue siendo la
  escalación genérica de siempre, sin cambios de comportamiento.

No son dos casos arbitrarios — son mutuamente excluyentes por construcción: no tiene sentido que
Architect proponga un roadmap sin haber completado su análisis.

**Comportamiento al aprobar** (`{solution: ...}` en `respondToEscalation`,
`src/cli/respondService.ts`): si el artifact de escalación del rol `architect` trae `ROADMAP` con
contenido, se hacen **las dos cosas dentro de la misma transacción real**: se persiste la nueva
versión del roadmap vía `setProjectConfig(..., client)` — pasándole el mismo `client` que ya abre
`respondToEscalation` para crear el child run (líneas 118-174 de `respondService.ts`), una vez que
`setProjectConfig` acepte ese parámetro (ver 7.1) — **y** se continúa el pipeline exactamente como
hace hoy (child run → Functional), todo dentro del mismo `begin`/`commit` existente. Si algo falla
a mitad de camino, el `rollback` ya existente deshace ambas escrituras, no solo una — así se logra
la atomicidad real que la versión anterior de este documento afirmaba incorrectamente sin haber
identificado este cambio de firma necesario.

Si `ROADMAP` es `null` (ambigüedad genérica), el comportamiento es exactamente el actual, sin
tocar nada.

Al rechazar (`{abort: true}`), el run queda igual que cualquier escalamiento rechazado hoy — no se
persiste ningún roadmap nuevo, con o sin contenido en `ROADMAP`.

**Riesgo aceptado (H12 aplicado a esta distinción)**: si un modelo económico alucina o deja
contenido parcial en `ROADMAP` durante una escalación que en realidad es ambigüedad genérica, el
sistema podría clasificarla mal. Mitigación: el humano ya ve el artifact completo de la escalación
antes de aprobar — mismo flujo de revisión que cualquier escalamiento hoy (FEATURE-013C) — por lo
que una clasificación errónea se detecta ahí, antes de aprobar. No se agrega mecanismo nuevo para
esto; es un riesgo aceptado, no resuelto con código.

### 7.3 Roles

- `architect.txt`: se agrega instrucción para declarar el roadmap (mínimo un release) como parte
  del contrato de salida, con su propia etiqueta de artefacto (a definir el nombre exacto en el
  detalle de implementación, ej. `ROADMAP:`), separada de `ARTEFACTO` (que sigue siendo la
  propuesta de arquitectura).
- `planning.txt`: se agrega instrucción para operar dentro del release activo recibido en el
  contexto de invocación (el runtime debe inyectarlo, tomándolo de `project_config_versions` vía
  `run_config_versions`, mismo patrón que otras configuraciones vigentes hoy).

### 7.4 Frontend

- `ReleasePlanPanel` deja de tener los tres `ReleasePlanItem` hardcodeados; hace fetch al mismo
  endpoint que ya usa la pantalla (`GET /runs/:id`) en vez de a una ruta nueva. `runs.project_id`
  ya existe (migración 0002) y `getRunDetailForUser` ya lo trae — se extiende
  `buildRunViewModel` (`src/server/runView.ts`) para incluir `releaseRoadmap` en el payload,
  resuelto con `getCurrentProjectConfig(detail.run.project_id, "release_roadmap")`. No se agrega
  ninguna ruta nueva ni namespace `/projects/` — todas las rutas de `src/server/app.ts` son planas
  hoy (`/runs`, `/auth`, `/intake`), y esto mantiene esa convención en vez de introducir una nueva.
- **`project_id` puede ser `null`** (tipo `string | null` en `RunRow`, sin `NOT NULL` a nivel de
  schema — a diferencia de `owner_id`, que sí lo tiene desde la migración 0003; son runs legados
  sin proyecto vinculado). Cuando `detail.run.project_id` es `null`, `releaseRoadmap` en el payload
  va `null` directamente, sin consultar nada — el panel muestra "sin roadmap" en vez de romper.
- **`buildRunViewModel` pasa de síncrona a async**: hoy es una función pura (`src/server/
  runView.ts:71`), con test suite sobre objetos literales sin DB (`runView.test.ts`). Sus 3 call
  sites (`app.ts:125`, `sse.ts:49`, `sse.ts:95`) ya están dentro de funciones `async` — el cambio
  es mecánico (agregar `await`), no arquitectónico. El test suite sí necesita mockear/stubear
  `getCurrentProjectConfig` para no depender de una DB real en esos tests.

### 7.5 Riesgos técnicos

- Reusar `project_config_versions` para algo que no es "configuración editable por el usuario"
  podría generar confusión futura si alguien lee esa tabla esperando solo configuración — mitigado
  con comentario explícito en la migración/código, no con una tabla nueva (decisión ya tomada).
- El parseo de convención de texto (`parseRoleConvention` en `claudeCodeExecutor.ts`) ya tiene
  lógica frágil conocida (H12: modelos económicos no siempre respetan el formato) — agregar una
  etiqueta nueva (`ROADMAP:` o similar) aumenta la superficie de ese problema conocido. Validado
  técnicamente que el regex genérico por etiqueta soporta agregar `ROADMAP` sin romper las
  etiquetas existentes (mismo mecanismo que ya usa `COMANDO_TEST`, precedente ya probado); el
  riesgo de H12 en sí sigue siendo real y a validar con casos reales, no solo con el happy path.
- **Riesgo transitorio (identificado en primera validación técnica, corregido en la segunda)**: la
  versión anterior de este documento afirmaba que la persistencia del roadmap y el avance del
  pipeline ocurrían "atómicamente en la misma transacción" sin haber verificado que
  `setProjectConfig` no acepta un `client` externo — la afirmación era incorrecta tal como estaba
  escrita. Se resuelve con el cambio de firma descrito en 7.1 (agregar `client?: PoolClient` a
  `setProjectConfig`, mismo patrón que `getCurrentProjectConfigs`/`createRun`), que si se aplica sí
  garantiza la atomicidad real vía el `client` compartido de `respondToEscalation`.

---

## 8. Validation Criteria

| Escenario | Input | Esperado |
|---|---|---|
| Alcance chico (single-release) | Business case que cabe en un único release | Architect declara roadmap con un solo release "MVP", estado Activo; se escala igual, mismo camino que alcance grande |
| Alcance grande (multi-release) | Business case que requiere varios releases | Architect declara roadmap con N releases, el primero (MVP) Activo, resto Pendiente |
| Aprobación de roadmap | Owner aprueba vía `respond` | Nueva versión vigente en `project_config_versions`, versión anterior (si existía) cerrada con `valid_to` |
| Rechazo de roadmap | Owner rechaza vía `respond` | No se persiste ninguna versión nueva; run refleja el rechazo igual que cualquier escalamiento rechazado hoy |
| Planning sin release vigente (caso defensivo) | Invocación de Planning sin roadmap aprobado en `project_config_versions` para el proyecto | Planning escala explícitamente en vez de asumir un release implícito |
| Completar un release | Todas las Features del release activo llegan a ✅ Ejecutado | Architect propone el release siguiente y escala de nuevo al humano — no continúa automáticamente |
| UI — roadmap vigente | Proyecto con roadmap aprobado | `ReleasePlanPanel` muestra el release activo real y sus Features, sin datos hardcodeados |
| UI — sin roadmap todavía | Proyecto recién creado, Architect no corrió aún | Panel muestra estado vacío/pendiente real (no los tres ítems fijos actuales) |

### Validation Evidence

- Consulta SQL directa sobre `project_config_versions` mostrando la versión vigente y el historial
  cerrado tras una aprobación real, igual que se hizo en FEATURE-016 con `executorMetadata` para
  confirmar `auth_mode: cli_session` en producción.
- Prueba real end-to-end en la VPS: un business case real que dispare el flujo completo (Architect
  propone → escalamiento → aprobación → Planning organiza dentro del release) — mismo criterio que
  dio los mejores resultados en FEATURE-017 (probarlo con datos reales, no solo revisión de código).

---

## 9. Risks

- Cambiar la Regla 8.4 y la sección 0 del Architecture Template es una edición de gobernanza, no
  solo de código — requiere aprobación explícita del owner sobre el texto exacto antes del
  handoff a Codex, no solo sobre el mecanismo técnico.
- El nuevo tipo de escalamiento ("aprobación de roadmap") comparte código con el escalamiento
  genérico existente — riesgo de que una extensión mal acotada afecte el camino ya probado de
  escalamiento por ambigüedad (FEATURE-012/013C). Cambio mínimo, no refactor del mecanismo
  existente.
- Sin caso de negocio real que amerite múltiples releases todavía probado en producción — el
  camino "multi-release" (recalcular el siguiente al completar uno) quedará validado solo
  conceptualmente hasta que aparezca un caso real de ese tamaño.

---

## 10. Approval Gate

Implementación prohibida hasta aprobación humana explícita de este documento, incluyendo el texto
exacto de las ediciones de gobernanza (sección 5).

---

## Estado de validación

**Primera validación técnica por Codex**: veredicto Go condicionado (3 Go limpios, 2 Go
condicionado en escalamiento y frontend). Hallazgos verificados de forma independiente contra
`main` — todos confirmados exactos.

**Segunda validación técnica por Codex** (sobre la versión con las 3 primeras resoluciones):
gobernanza (punto 5) sube a Go limpio. Escalamiento (punto 2) y frontend (punto 4) se mantienen en
Go condicionado con hallazgos nuevos y más específicos: `setProjectConfig` no acepta `client`
externo (la atomicidad afirmada no era real tal como estaba descrita), `project_id` es nullable
sin manejo explícito, y `buildRunViewModel` pasa de síncrona a async sin que el documento lo
reconociera. Los 4 hallazgos verificados de forma independiente contra `main` — todos confirmados
exactos (citas textuales de `repository.ts`, `respondService.ts`, `runView.ts` y la migración
0002). Las secciones 7.1, 7.2, 7.4 y 7.5 de este documento ya incorporan las tres resoluciones
acordadas con el owner.

**Pendiente**: tercera pasada de validación técnica sobre esta versión, antes del Approval Gate
del owner.

## Estado de la implementación (2026-07-26)

Implementado completo en la rama `feature/018-wiring-roadmap-release-plan`, sobre `main` tal como
estaba tras `6a37d48`. Validado por el owner en la VPS y mergeado a `main` (commit `458c159`
implementación, `411f73d` merge).

Resumen de archivos:

- `src/db/repository.ts` — `setProjectConfig` acepta `client?: PoolClient` opcional (7.1),
  reusando el mismo patrón de `getCurrentProjectConfigs`/`createRun`.
- `src/executor/claudeCodeExecutor.ts` — `parseRoleConvention`/`mapToPhaseResult` reconocen
  `ROADMAP:` y lo boltean a `outputArtifact` (mismo precedente que `COMANDO_TEST`).
- `src/executor/roles/architect.txt` — Regla 4 (declarar roadmap siempre, ESTADO: escalated para
  aprobación) y Regla 5 (reconocer aprobación ya concedida y pasar a ESTADO: completed).
- `src/executor/roles/planning.txt` — Regla 4 (operar dentro de `activeRelease`, escalar si viene
  `null`).
- `src/cli/escalation.ts` — tipos/validadores compartidos `RoadmapApprovalPayload`,
  `isRoadmapApprovalPayload`, `activeReleaseFromRoadmap` (vive acá para evitar el import circular
  entre `respondService.ts` y `runStart.ts`).
- `src/cli/respondService.ts` — `extractRoadmapApproval` distingue la escalación de roadmap sin
  campo/tipo nuevo (7.2); al aprobar, `setProjectConfig(..., client)` corre en la misma transacción
  que crea el child run — atomicidad real, no solo declarada.
- `src/cli/commands/runStart.ts` / `src/cli/intakeService.ts` — `executePipelineRun` recibe
  `projectId` (requerido); Planning recibe `{ functionalArtifact, activeRelease }` como contexto.
- `src/server/runView.ts` / `app.ts` / `sse.ts` — `releaseRoadmap` se resuelve en el llamador
  (`resolveReleaseRoadmap`) y se pasa como parámetro a `buildRunViewModel`, que se mantiene
  síncrona y pura (mejora sobre 7.4: se evitó el cambio sync→async que el documento aceptaba como
  necesario, preservando el test suite existente sin mocks de DB).
- `web/src/main.tsx` — `ReleasePlanPanel` renderiza `run.releaseRoadmap` real, sin datos
  hardcodeados.
- Gobernanza: los 6 documentos listados en la sección 5 fueron editados tal como se detalla ahí,
  incluyendo el colapso de 3 a 2 ramas en `06-DELIVERY-WORKFLOW.md`.

Decisión de scoping tomada durante la implementación (no estaba explícita en el documento): la
"recalculación" del roadmap por Architect al completarse un release (Regla Funcional 7) no inyecta
el roadmap vigente como contexto machine-readable de vuelta a Architect en su primera invocación de
un run nuevo — cada invocación de Architect propone su roadmap de forma independiente, basado en su
propio análisis del caso de negocio recibido. Esto es consistente con la sección 9 del documento
("el camino multi-release... quedará validado solo conceptualmente hasta que aparezca un caso real
de ese tamaño") pero vale la pena que el owner lo confirme explícitamente antes o durante la
validación en VPS, ya que no fue una decisión de diseño explícita en el Approval Gate.

Qué se probó: `tsc --noEmit` (backend y frontend), suite completa (`npm test`, 77 pass / 2 skipped
por Docker CLI no disponible en este entorno — mismo skip preexistente, no relacionado a esta
Feature), `npm run build` (incluye `vite build`). Tests nuevos: `src/cli/escalation.test.ts`
(validadores de roadmap), `src/cli/respondService.test.ts` (`extractRoadmapApproval`),
`src/server/runView.test.ts` (`releaseRoadmap`/`toReleaseRoadmapView`). No se corrió un business
case real end-to-end contra Docker/Claude Code CLI en este entorno (ver Validation Evidence,
sección 8 del documento) — queda para la validación del owner en la VPS.

## Lecciones Aprendidas

**Excluido del alcance final** (ajuste hecho al cierre, no estaba en el documento de Diseño
original): el disparo automático de "release completo → Architect propone el release siguiente"
(Functional Goal original de la Feature). Se descubrió, ya con la implementación validada, que:
- El motor de pipeline (`src/pipelines/definitions.ts`) no tiene ningún concepto de "Feature" como
  dato rastreable — hoy es prosa dentro del artefacto de texto de Planning, no un registro con
  estado.
- El loop de fases (`PipelineSpec.definition.loop`) es deliberadamente de un solo tipo
  (Developer↔QA, decisión de FEATURE-005) — no soporta hoy que Planning itere múltiples Features
  de un release, ni que Architect sea re-invocado automáticamente al cerrar uno.
- El texto de Developer en `08-CODE-SYSTEM-PROMPT.md` ("si hay Feature siguiente, continúa por su
  cuenta") tiene además una tensión real con la Regla 10 (Ownership de Artefactos: el Release Plan
  es propiedad de Planning, no de Developer).

Este hallazgo, surgido en la revisión de cierre de FEATURE-018, derivó en dos Features nuevas —
FEATURE-019 (rediseño del ciclo de ejecución de releases/Features, con Planning gobernando la
iteración y Architect gobernando el avance entre releases) y FEATURE-020 (adaptar esta Feature al
mecanismo que resulte de FEATURE-019). El patrón de reusar mecanismos ya probados (atomicidad vía
`client` compartido, distinción de escalamiento por contenido en vez de un campo nuevo) siguió
dando resultado en esta Feature, igual que en ciclos anteriores.