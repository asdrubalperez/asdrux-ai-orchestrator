# FEATURE-017 — Capa de UI — Disparo (intake de caso de negocio asistido por IA)

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: Este documento surge de una sesión de Discovery extensa, con varios cambios
> de alcance en el camino (ver Scope). El más relevante: lo que arrancó como "un formulario para
> cargar un caso de negocio" resultó ser un flujo de intake asistido por IA con mapeo estructurado,
> más una capacidad nueva del Orquestador (estado previo al arranque de un run, y cancelación real
> desde una lista) que no existía en ninguna forma antes de esta Feature. La numeración fue
> reordenada explícitamente por el owner: esta Feature pasa a ser **FEATURE-017**; lo que antes era
> FEATURE-017 (Wiring Release Plan) pasa a **FEATURE-018**; lo que antes era FEATURE-018
> (Milestone 2) pasa a **FEATURE-019** — ver `docs/ROADMAP.md`, ya actualizado y verificado contra
> `main`.

---

## 1. Feature Identity

- **Name**: Capa de UI — Disparo (intake de caso de negocio asistido por IA)
- **Type**: Frontend (nueva pantalla) + Backend (mapeo por IA, nuevo estado de `runs`,
  cancelación real) + persistencia (DB)
- **Owner**: asdru
- **Status**: Implementado en la rama `feature/017-ui-disparo-intake` — pendiente de revisión del
  owner y aprobación de merge a `main`. Ver "Estado de la implementación" al final de este
  documento.
- **Priority**: Confirmada — es el próximo incremento de trabajo real (ver `docs/ROADMAP.md`)

---

## 2. Problem Statement

Hoy la única forma de arrancar un run es `npm run cli -- run:start --case <ruta-a-json>` — un
archivo JSON sin schema formal, escrito a mano, sin ningún paso de revisión antes de que el
pipeline arranque. Esto es utilizable para quien construye el Orquestador, pero no para un usuario
final: no hay forma de escribir el caso de negocio en lenguaje natural (texto libre o un documento
ya redactado) y que el sistema lo estructure, y no hay ninguna pantalla — solo la terminal.

Además, hoy "crear un run" y "arrancarlo" son la misma acción atómica — no existe ningún estado
intermedio donde un caso quede cargado y confirmado pero todavía no iniciado, lo cual es
imprescindible si el flujo empieza en una UI (el usuario necesita poder revisar antes de
comprometerse a arrancar el pipeline real).

---

## 3. Functional Goal

1. El usuario pega texto libre (por ejemplo, la transcripción de un relevamiento) o carga un
   archivo `.md`/`.txt` con la información ya redactada de una iniciativa.
2. El Orquestador mapea esa información, **sin inventar contenido y sin dialogar con el usuario**,
   contra una estructura de 12 campos predeterminados y parametrizables (ver sección 7).
3. El usuario ve el resultado del mapeo en una pantalla de revisión, con el % de completitud
   calculado sobre esos 12 campos, puede editar cualquier campo, y solo puede continuar cuando
   llega al 100% (o recalcula después de completar campos a mano).
4. Al confirmar, el caso queda persistido en un estado **Sin Iniciar** — visible en una lista
   mínima de "mis casos", desde donde el usuario decide cuándo apretar **Iniciar** (recién ahí
   arranca el pipeline real, y es el Architect quien juzga si la información alcanza).
5. Desde esa misma lista, un run **En Curso** puede **Cancelarse** (reusando el estado `aborted`
   ya existente, con una vía de transición nueva). Los estados **Finalizado**/**Cancelado**
   ofrecen **Visualizar** (reusa la UI de "Run en curso" de FEATURE-013).

---

## 4. Scope

### Incluido

1. **Pantalla de Disparo**: input de texto libre o carga de archivo `.md`/`.txt`.
2. **Mapeo por IA**: llamada directa y simple al proveedor (sin holder/worker, sin tools — ver
   Regla 5), que intenta completar los 12 campos predeterminados a partir del texto de entrada.
   Lo que no puede mapear queda vacío — nunca inventa contenido.
3. **12 campos predeterminados**, con su definición viviendo en una tabla simple en DB (sin
   versionado — ver Excluido #1):
   1. Tipo de solución (`nueva` | `mejora_existente`) — va primero, condiciona nada más en el MVP
      (Repositorio y Rama Base son siempre requeridos independientemente de este valor).
   2. Visión
   3. Necesidad / Problema
   4. Solución Propuesta
   5. Grupo Objetivo / Beneficiarios
   6. Objetivos de Negocio
   7. Alternativas / Competidores
   8. Canales
   9. Beneficios Esperables
   10. Supuestos y Pendientes
   11. Repositorio (siempre requerido)
   12. Rama Base de Trabajo (siempre requerida; default `main` si el usuario no indica nada)
4. **Modal de revisión/confirmación**: muestra el resultado del mapeo campo por campo, editable,
   con % de completitud (sobre los 12 campos). Botón **Continuar** deshabilitado hasta 100%;
   mientras no llegue a 100%, se ofrece **Recalcular** (vuelve a correr el mapeo sobre el texto
   original + las ediciones ya hechas por el usuario).
5. **Nuevo estado `sin_iniciar` en `runs`**: el caso confirmado se persiste ahí, con el pipeline
   real todavía sin arrancar (sin worktree, sin branch, sin invocación al Architect).
6. **Lista mínima de "mis casos"**: solo los del usuario autenticado, con botón según estado:
   - `sin_iniciar` → **Iniciar** (dispara el pipeline real, transición a `running`).
   - `running`/equivalentes en curso → **Cancelar** (transición nueva hacia `aborted`).
   - `completed`/`failed`/`aborted` → **Visualizar** (reusa la UI de FEATURE-013).
7. Actualización de `docs/playbook/02-ARCHITECTURE.md` (hoy dice `[Pendiente]` para el stack de
   frontend — ya resuelto de hecho por FEATURE-013 con React+Vite+TanStack Query+Radix UI; esta
   Feature deja eso explícito, sin ambigüedad).

### Excluido

1. **Versionado de la definición de los 12 campos** — tabla simple, sin historial. Diseñada de
   forma escalable para agregar versionado después (mismo criterio que `user_agent_config` en
   FEATURE-016), pero no se construye ahora.
2. **Persistencia de borrador antes de confirmar** — el estado del mapeo/edición es *session-only*
   (vive en el frontend mientras la pestaña está abierta). Si el usuario cierra sin confirmar, se
   pierde y debe volver a pegar el texto. No hay tabla de "borrador".
3. **Pausar un run en curso** — no existe ningún mecanismo de interrupción/reanudación del
   pipeline hoy, y diseñarlo (¿solo entre fases? ¿a mitad de una fase?) es una pieza de trabajo
   propia. Queda fuera de este incremento, como ítem futuro separado.
4. **Historial/admin completo** — vista de equipo, filtros, rol de administrador. La lista de esta
   Feature es explícitamente mínima: solo "mis casos", sin buscador, sin filtros, sin vista de
   otros usuarios. La versión completa es una iteración futura que reusa esta base.
5. **Elección de proveedor/modelo para el mapeo** — usa el default del sistema (mismo criterio que
   hoy usan las fases reales sin override), no se expone al usuario en esta Feature. Relacionado
   con el ítem Tentativo "Selección de proveedor/modelo/credenciales por rol", que sigue separado.

### Future ideas

- Persistencia de borrador antes de confirmar (si en la práctica perder el texto al cerrar sin
  confirmar resulta molesto).
- Versionado de la definición de los 12 campos.
- Pausar un run en curso.
- Historial/admin completo (equipo, filtros, vista de administrador).
- Elección de proveedor/modelo para el paso de mapeo, si en la práctica el default no da buenos
  resultados para ciertos tipos de texto de entrada.

---

## 5. Functional Rules

1. **El Orquestador nunca inventa contenido en el mapeo.** Lo que no puede extraer del texto de
   entrada queda vacío — no rellena con contenido plausible, no hace preguntas de seguimiento al
   usuario durante el mapeo (esa construcción del caso de negocio, si hiciera falta, ocurre fuera
   del Orquestador, con otra herramienta ya existente del owner).
2. **El % de completitud se calcula sobre los 12 campos**, no sobre 10 ni sobre ningún subconjunto
   — un campo vacío cuenta como incompleto sin importar cuál sea.
3. **El botón Continuar está deshabilitado hasta el 100%.** Por debajo de 100%, la única acción
   disponible junto a los campos editables es **Recalcular** — vuelve a mapear usando el texto
   original más cualquier edición manual ya hecha por el usuario, no descarta lo ya completado a
   mano.
4. **Repositorio y Rama Base de Trabajo son siempre requeridos**, independientemente del valor de
   "Tipo de solución". Rama Base tiene default `main` si el usuario no indica nada, pero el campo
   en sí cuenta como completo con ese default — no exige que el usuario lo toque para llegar al
   100%.
5. **El mapeo es una llamada directa y simple al proveedor, no una fase del pipeline.** No pasa
   por el holder/worker aislado (`runRoleIsolated`), no tiene tools, no tiene `authMode` — no
   existe el problema que ese aislamiento resuelve (canal de respuesta con tools + credencial real)
   porque acá no hay tools que dar. Usa la misma credencial (`ANTHROPIC_API_KEY`) que ya vive en el
   backend del Orquestador.
6. **Confirmar el mapeo persiste el run en estado `sin_iniciar`.** En ese momento no existe
   worktree, no existe branch, no hay ninguna invocación al Architect — recién ocurre al apretar
   **Iniciar**.
7. **Apretar Iniciar transiciona `sin_iniciar` → `running`** y dispara exactamente el mismo flujo
   que hoy ejecuta `runStart.ts` (creación de worktree/branch, primera invocación al Architect con
   el caso de negocio ya mapeado como `initialContext`).
8. **Cancelar un run en curso reusa el mecanismo de escalamiento de FEATURE-013C, no inventa una
   transición directa nueva.** El usuario fuerza el run a `escalated` (transición nueva, ver 7.4);
   inmediatamente se dispara `respondToEscalation(...)` con `{ abort: true }` — la misma función
   de servicio que ya usa `run:respond --abort` para runs escalados por el propio agente, sin
   código nuevo en esa parte. **La cancelación se aplica en el próximo punto de corte natural del
   pipeline** (antes de arrancar la siguiente fase), no interrumpe una invocación de Executor
   realmente en curso — mismo criterio ya aceptado para dejar Pausar fuera del MVP (Scope,
   Excluido #3): no se construye ningún mecanismo de interrupción de procesos/contenedores en
   esta Feature.
9. **La lista es exclusivamente de "mis casos"** — filtrada por `owner_id` del usuario
   autenticado, sin excepción, en este incremento.
10. **Es el Architect, no el paso de mapeo, quien juzga si el caso de negocio alcanza** — el mapeo
    solo estructura lo que hay; la decisión de suficiencia/escalamiento sigue el mecanismo ya
    existente (`03-AI-CONSTITUTION.md`, Reglas 8 y 10), sin cambios.

---

## 6. Estrategia Algorítmica

**Mapeo de texto libre a los 12 campos:** una única llamada al modelo (sin tools, sin turnos
múltiples) con el texto/archivo de entrada y la definición vigente de los 12 campos (nombre,
descripción, tipo), pidiendo como salida un JSON con esa forma exacta — mismo patrón de
"structured output" que ya usa este proyecto en otros contextos (respuesta JSON forzada, sin
preámbulo). Campos no encontrados en el texto: `null`/vacío, nunca un valor inventado.

**Cálculo de completitud:** `campos_completos / 12 * 100`, redondeado. Un campo cuenta como
completo si tiene contenido no vacío después del mapeo o de la edición manual del usuario. Recalcular
repite la misma llamada de mapeo, pasando el texto original **más** los valores ya editados a mano
por el usuario como contexto adicional (para no perder ediciones ya hechas si el recálculo
encuentra algo nuevo en otro campo).

No hay heurística de matching parcial ni score ponderado por campo — es binario (completo/vacío)
por campo, simple a propósito (ver Risks si esto resulta insuficiente en la práctica).

---

## 7. Technical Considerations

### 7.1 Definición de los 12 campos — tabla simple, sin versionado

Migración `0009_intake_field_definitions.sql`:

```sql
create table intake_field_definitions (
  id uuid primary key default gen_random_uuid(),
  field_key text not null unique,
  field_order integer not null,
  label text not null,
  description text not null,
  field_type text not null default 'text',
  updated_at timestamptz not null default now(),
  constraint intake_field_definitions_type_check
    check (field_type in ('text', 'textarea', 'select', 'list'))
);
```

Sembrada (seed) con los 12 campos descriptos en Scope, incluido `tipo_solucion` como `select` con
opciones `nueva`/`mejora_existente`. Sin `valid_from`/`valid_to` — una sola fila vigente por
`field_key`, actualizable in-place. Diseño escalable: migrar a versionado después implicaría
agregar esas dos columnas más un índice único parcial, sin romper esta forma.

### 7.2 Extensión de `runs` — nuevo estado y columna de caso mapeado

Migración `0010_runs_sin_iniciar.sql`:

```sql
alter table runs add column business_case jsonb;
alter table runs alter column pipeline_definition_id drop not null;
```

- `business_case`: el JSON resultante del mapeo (los 12 campos ya completos al 100%), guardado en
  el momento de la confirmación — reemplaza el uso actual de `initialContext` como variable
  efímera en memoria (`runStart.ts`) por persistencia real.
- **Decisión confirmada por el DAIA (verificada contra el repo real): `pipeline_definition_id` se
  resuelve en el momento de la confirmación** (cuando el caso pasa a `sin_iniciar`), no en el
  arranque. Se reusa `ensurePipelineDefinition` (hoy en `runStart.ts:90`), desacoplada de la
  creación de worktree/branch, para fijar la definición ya en ese punto. **Justificación**: hoy
  `pipeline_definition_id` es `not null` en la migración `0001_init.sql`, y se asume no-nula en
  todo el código que la consume (`RunRow` en `src/db/repository.ts`, y la lectura en
  `src/cli/respondService.ts:98-102` para reanudar un run hijo tras escalamiento). Volverla
  nullable obligaría a tocar el tipo `RunRow` y cada consumidor, sin necesidad real: el pipeline a
  usar ya se conoce en el momento de crear el caso (viene del flag `--pipeline` o equivalente en la
  UI), no depende de nada que ocurra recién al iniciar. **Se descarta** la alternativa de dejarla
  nullable hasta `running`.
- Nuevo valor de `status`: `'sin_iniciar'`. No requiere migración de constraint: `runs.status` es
  `text not null default 'running'` **sin CHECK constraint** hoy (a diferencia de, por ejemplo,
  `user_agent_config`, que sí tiene checks explícitos de enum) — agregar un valor nuevo es
  compatible con el schema actual sin tocarlo. `branch_name`/`worktree_path` ya son nullable a
  nivel de columna DB hoy y se completan recién en la transición a `running` — **pero esto no
  alcanza**: ver el punto siguiente sobre `createRun`.
- **Hallazgo adicional (verificado contra el repo real): `createRun` (`src/db/repository.ts:120-128`)
  necesita un cambio de firma o una función nueva paralela.** No es solo un tema de columnas DB
  nullable — la función hoy exige `branchName: string` y `worktreePath: string` como parámetros
  **requeridos** (sin `?`) en su objeto `params`. Un run creado en `sin_iniciar` no tiene ninguno de
  los dos todavía (no hay worktree ni branch hasta `Iniciar`), así que `createRun` tal cual existe
  hoy no puede usarse para crear ese registro. Opciones a decidir en implementación: (a) volver
  `branchName`/`worktreePath` opcionales en la firma de `createRun` y ajustar el `insert` para
  aceptar `null`, o (b) crear una función paralela (ej. `createRunPendingStart`) que inserte solo
  con los campos disponibles en `sin_iniciar` y deje `branch_name`/`worktree_path` en `null` hasta
  que `Iniciar` los complete via `update`. No se resuelve aquí cuál preferir — queda como decisión
  de implementación, pero el punto no puede quedar implícito: sin este cambio, la Feature no
  compila contra el código real.

### 7.3 Mecanismo de mapeo — llamada directa, sin Executor

Un módulo nuevo (ej. `src/intake/mapBusinessCase.ts`), sin relación con `Executor`/`runRoleIsolated`:
- Input: texto crudo (string) + definición vigente de los 12 campos (leída de
  `intake_field_definitions`).
- Llamada directa a la API del proveedor (mismo `ANTHROPIC_API_KEY` que ya usa el backend),
  pidiendo salida JSON estructurada, sin tools.
- Output: objeto con los 12 campos, cada uno `string | null`.
- Sin holder, sin worker, sin contenedor Docker — proceso del propio backend del Orquestador.

### 7.4 Cancelar — reuso de `respondToEscalation` (FEATURE-013C), no una transición nueva desde cero

**Reconsiderado durante Discovery**: en vez de construir una transición directa
`running → aborted`, Cancelar reusa el mecanismo ya existente y probado de FEATURE-013C:

1. Nueva pieza, acotada: transición `running → escalated` **forzada por el usuario** (no por el
   agente). Requiere una función de repositorio nueva (ej. `forceUserEscalation(runId, userId)`)
   que verifique ownership y marque el run como `escalated` con un motivo distinto a
   `escalation_repeated_detected`/`escalation_exhausted` (ej. `user_cancel_requested`), para que el
   banner/modal de 013C pueda, si hace falta, distinguir el origen — a confirmar con el DAIA si
   esto requiere tocar `buildEscalationBanner()`.
2. **Cero código nuevo para la segunda mitad**: una vez `escalated`, se invoca
   `respondToEscalation(runId, { abort: true })` — la misma función de servicio que ya extrajo
   FEATURE-013C, reusada tal cual. **Corrección de referencia (verificada por el DAIA contra el
   repo real): esta función vive en `src/cli/respondService.ts:40-195`, no en `runRespond.ts`** —
   `runRespond.ts` es únicamente el wrapper de comando CLI que la invoca
   (`src/cli/commands/runRespond.ts`); la lógica de servicio está en `respondService.ts`. Toda
   mención previa a `runRespond.ts` como dueño de `respondToEscalation` queda corregida por esta.
   Confirmado además que sí soporta `{ abort: true }` (líneas 23, 55-73), que valida
   `parentRun.status === 'escalated'` antes de actuar (devuelve `conflict` si no lo está), y que
   usa un `UPDATE ... WHERE status = 'escalated'` atómico (`resolveEscalatedRunStatus`,
   `repository.ts:371`) — la secuencia `running → escalated → abort` es coherente con el código
   real sin fricción adicional.
3. **Cancelación no interrumpe una invocación de Executor en curso.** Se aplica en el próximo
   punto de corte natural del pipeline (antes de arrancar la siguiente fase). Decisión explícita
   del owner (2026-07-25): mismo criterio que dejar Pausar fuera del MVP — no se construye ningún
   mecanismo de interrupción de procesos/contenedores en esta Feature. El pipeline debe chequear,
   antes de arrancar cada fase, si el run fue forzado a `escalated`/`aborted` externamente, y si es
   así, no arrancar la siguiente invocación.

**Punto cerrado por el DAIA, verificado contra el repo real:**

- **El chequeo pre-fase es código enteramente nuevo, no reuso de nada existente.** El manejo de
  escalamiento que hoy existe (`handleLinearEscalation` en `runStart.ts`) **no consulta
  `runs.status` en la DB antes de arrancar una fase** — es puramente reactivo: reacciona al
  `PhaseResult` que la propia invocación devuelve de forma síncrona al terminar
  (`result.status === "escalated"`, `runStart.ts` línea ~224), usando una variable local
  (`previousResult`), no un guard previo. No hay ningún "camino de escalamiento por agente" que
  se pueda reusar tal cual para el chequeo de cancelación por usuario — ambos casos necesitan
  lógica nueva compartida, no una reutilización de algo ya construido.
- **Ubicación exacta**: dentro del `while` en `runStart.ts` (línea ~188-190, función
  `executePipelineRun`), antes de `await updateRunCurrentPhase(...)`; y simétricamente en
  `runDeveloperQaLoop` (`for` en línea ~379), antes de cada invocación a Developer (líneas
  ~380-399) y a QA (líneas ~415-436).
- **Función nueva requerida**: no existe hoy ninguna función tipo `isRunCancelled`/`getRunStatus`
  en `src/db/repository.ts` — hay que crearla, y llamarla en ambos puntos de corte antes de
  arrancar la siguiente fase.
- **Función nueva requerida para forzar la escalación (mitad 1 del mecanismo)**: tampoco existe
  hoy ninguna función que transicione un run *hacia* `escalated` desde afuera del propio pipeline
  — la única función análoga, `resolveEscalatedRunStatus` (`repository.ts:365-371`), transiciona
  *desde* `'escalated'` hacia `'aborted'`/`'resolved'`, nunca hacia `escalated`. Hace falta una
  función nueva, ej. `forceUserEscalation(runId, userId)`, con el mismo patrón de
  `UPDATE ... WHERE status = 'running'` (para evitar carreras con el propio pipeline
  transicionando el run de forma concurrente), que verifique ownership y marque el run como
  `escalated` con motivo `user_cancel_requested`.
- **Ampliación de scope necesaria en `src/server/runView.ts` — no estaba contemplada en el
  documento original.** `buildEscalationBanner()` (línea ~143-157) y el tipo `motive` en
  `RunViewModel` (línea ~58) están hardcodeados a `"repeated" | "exhausted" | null`, y
  `latestTerminalEscalationMotive` (líneas ~245-251) solo reconoce los event types
  `escalation_repeated_detected`/`escalation_exhausted`. Un evento nuevo (ej.
  `escalation_forced_by_user`, asociado al motivo `user_cancel_requested`) **caería
  silenciosamente en `motive: null`** si no se amplía explícitamente el tipo y el matcher. Se
  agrega este trabajo al scope de la sección 7.4.
- **Punto a resolver en implementación, documentado explícitamente**: `latestEscalatedAgentRole`
  (`runView.ts` líneas ~226-235) identifica la fase escalada buscando el último evento
  `phase_finished` con `status === "escalated"` — evento que **no existe** si el usuario cancela
  mientras una fase sigue efectivamente en curso (no terminó todavía). En ese caso el helper
  devolvería el `agentRole` de un escalamiento previo (si lo hubo) o `null`, sin reflejar
  correctamente cuál era la fase activa al momento de la cancelación. Solución propuesta: el
  evento de cancelación forzada (`forceUserEscalation`) debe registrar explícitamente el
  `agentRole`/fase activa del run en ese momento (ya disponible en `runs.current_phase`), para que
  el banner pueda mostrarlo sin depender de inferencia post-hoc sobre `phase_finished`.

### 7.5 Frontend

- Pantalla de Disparo: input de texto/archivo, llamada al endpoint de mapeo, modal de
  revisión/confirmación con % y edición inline.
- Lista mínima: consulta simple filtrada por `owner_id`, con el botón correspondiente a cada
  `status`. Reusa componentes ya existentes de FEATURE-013 donde aplique (ej. la UI de "Run en
  curso" para el botón Visualizar).

---

## 8. Validation Criteria

| Escenario | Input | Salida esperada |
|---|---|---|
| Mapeo completo de un texto rico (ejemplo real ya usado en Discovery) | Transcripción de relevamiento completa | Los 12 campos completos, 100%, Continuar habilitado |
| Mapeo parcial | Texto que no menciona, por ejemplo, "Canales" | Ese campo queda vacío, completitud <100%, Continuar deshabilitado, Recalcular disponible |
| Recalcular tras edición manual | Usuario completa un campo a mano, aprieta Recalcular | El campo editado a mano no se pierde; el mapeo puede completar otros campos nuevos |
| Confirmar al 100% | Los 12 campos completos | Run creado con `status='sin_iniciar'`, `business_case` persistido, sin worktree/branch |
| Iniciar desde `sin_iniciar` | Usuario aprieta Iniciar | Transición a `running`, worktree/branch creados, primera invocación real al Architect con el caso mapeado |
| Architect juzga insuficiencia real | Caso mapeado al 100% pero con contenido ambiguo/contradictorio | El Architect escala, mismo mecanismo ya existente — sin cambios de esta Feature |
| Cancelar un run en curso | Usuario aprieta Cancelar desde la lista | Transición `running → escalated` (forzada por usuario) seguida de `respondToEscalation({ abort: true })` → `aborted`. Si hay una fase realmente en ejecución, se aplica recién en el próximo punto de corte, no interrumpe el proceso activo |
| Lista solo muestra casos propios | Dos usuarios distintos, cada uno con casos propios | Cada uno ve solo los suyos |
| Repositorio/Rama Base siempre exigidos | Tipo de solución = "nueva" | Repositorio sigue siendo obligatorio para el 100%; Rama Base cuenta como completa con el default `main` sin que el usuario la toque |

### Validation Evidence

Evidencia real esperada: al menos un caso mapeado de punta a punta con el ejemplo real ya usado en
esta conversación de Discovery (la transcripción de Tempo Auto Planner), confirmando que el mapeo
produce los 12 campos razonablemente poblados sin inventar contenido no presente en el texto
original. Además, evidencia real de la transición `sin_iniciar → running` disparando un run real
(no simulado), y de `running → aborted` vía Cancelar sin pasar por escalamiento — a verificar
independientemente contra el repo/VPS antes de aceptar cualquier cierre, mismo criterio del resto
del proyecto.

---

## 9. Risks

- **Cancelar no interrumpe una invocación de Executor realmente en curso — decisión explícita,
  no un descuido.** Reusa el mecanismo de escalamiento de FEATURE-013C (transición forzada a
  `escalated` + `respondToEscalation({ abort: true })`), aplicándose en el próximo punto de corte
  natural del pipeline. Mismo criterio ya aceptado para dejar Pausar fuera del MVP. Si en la
  práctica la demora hasta el próximo punto de corte resulta molesta (fases largas), es un ítem a
  reconsiderar junto con Pausar, no antes.
- **El cálculo de completitud es binario, no ponderado** — un campo con una sola palabra cuenta
  igual que uno bien desarrollado. Si en la práctica esto permite llegar a 100% con contenido pobre
  que igual el Architect termina rechazando, es una señal de que el diseño de completitud necesita
  revisarse — no se resuelve preventivamente acá para no sobreingeniería algo que puede no ser un
  problema real.
- **Mapeo sin tools, pero sigue siendo una llamada a un LLM con texto arbitrario del usuario** —
  mismo tipo de superficie que cualquier prompt de usuario libre; no hay mecanismo de tools que
  explotar, pero cabe la posibilidad de que el texto de entrada intente manipular el mapeo (ej.
  instrucciones inyectadas en el texto pegado). No es un riesgo de credenciales (no hay ninguna en
  juego en este paso), pero sí de calidad del mapeo — mismo tipo de riesgo que ya existe hoy con
  cualquier input de texto libre a un modelo, no exclusivo de esta Feature.
- **Limitación conocida, aceptada para esta versión: el clonado usa una única identidad git fija,
  configurada a nivel de servidor** (hoy, la clave SSH del usuario del sistema que corre el proceso
  del Orquestador) — no existe ningún concepto de credencial git por usuario del Orquestador. Esto
  significa que solo se pueden clonar repos a los que esa identidad ya tenga acceso — hoy funciona
  porque hay un solo usuario real (el owner) y sus propios repos. Si otra persona usara el
  Orquestador con sus propios repos privados, esto fallaría de la misma manera que falló
  inicialmente en esta prueba, porque la identidad que clona no sería la suya. No se resuelve en
  esta Feature — ver ítem Tentativo "Credenciales git por usuario para el Orquestador" en
  `docs/ROADMAP.md`.

---

## 10. Approval Gate

Implementación prohibida hasta aprobación explícita del owner.

**Estado de la validación técnica del DAIA: cerrada, con hallazgos adicionales que amplían el
scope original (secciones 7.2 y 7.4 ya actualizadas en este documento).** Resumen:

- §7.4 (chequeo de cancelación pre-fase): **resuelto** — es código nuevo (no hay nada existente
  que reusar), ubicación exacta documentada (`runStart.ts` líneas ~188-190 y ~379).
- §7.4 (banner de escalamiento): **scope ampliado** — `buildEscalationBanner()`/tipo `motive` en
  `src/server/runView.ts` necesitan ampliarse para reconocer el motivo `user_cancel_requested`, o
  el banner cae en `null` silenciosamente. No estaba en el documento original.
- §7.4 (identificación de fase cancelada a mitad de ejecución): **pendiente de diseño puntual** —
  el evento de cancelación forzada debe registrar explícitamente `current_phase`/`agentRole`, ya
  que `latestEscalatedAgentRole` no lo infiere si la fase no terminó con `phase_finished`.
- §7.2 (`pipeline_definition_id`): **resuelto** — se fija en la confirmación, no en el arranque,
  reusando `ensurePipelineDefinition`.
- §7.2 (hallazgo adicional, no anticipado en el documento original): `createRun`
  (`src/db/repository.ts:120-128`) exige `branchName`/`worktreePath` como parámetros de función
  requeridos, no solo columnas DB nullable — necesita cambio de firma o función paralela
  (ej. `createRunPendingStart`) antes de poder crear un run en `sin_iniciar`.
- Corrección de referencia: `respondToEscalation` vive en `src/cli/respondService.ts`, no en
  `runRespond.ts` (que es solo el wrapper CLI) — corregido en toda mención del documento.

El Architect verifica estas conclusiones de forma independiente contra el repo/VPS real antes de
llevarlas al owner para el Go final.

**Corrección post-Go (detectada al iniciar la implementación):** la sección 4 enumeraba solo 12
campos, pero el resto del documento decía "13 campos" en todas sus menciones (Reglas 2 y 4,
Estrategia Algorítmica, fórmula de completitud). Confirmado con el owner (2026-07-25): son **12**
campos — se corrigió cada mención de "13" a "12" en todo el documento, incluida la fórmula de
completitud (`campos_completos / 12 * 100`).

---

## Estado de la implementación (2026-07-25)

Implementado completo en la rama `feature/017-ui-disparo-intake`, siguiendo las decisiones
cerradas por el DAIA (secciones 7.2/7.4 de este documento). Resumen de archivos:

**Backend**
- `migrations/0009_intake_field_definitions.sql` — tabla + seed de los 12 campos.
- `migrations/0010_runs_sin_iniciar.sql` — `runs.business_case jsonb`. `pipeline_definition_id`
  se mantiene `not null`, resuelto en la confirmación (no en el arranque), tal como decidió el
  DAIA.
- `src/db/repository.ts` — funciones nuevas: `createRunPendingStart` (no reusa `createRun`, que
  exige `branchName`/`worktreePath` — hallazgo de la validación técnica), `promoteRunToRunning`,
  `getRunStatus`, `forceUserEscalation`, `listRunsForUser`, `getIntakeFieldDefinitions`.
- `src/intake/mapBusinessCase.ts` (+ test) — llamada directa a la Messages API de Anthropic vía
  `fetch` nativo (no hay SDK de Anthropic en este repo; los Executors invocan CLI, no aplica acá
  porque no hay tools que aislar). Modelo fijo `claude-haiku-4-5-20251001`, sin exposición al
  usuario (Scope/Excluido #5).
- `src/cli/intakeService.ts` — `confirmIntake`, `startPendingRun`, `cancelRun`: orquestan
  repository + mapBusinessCase + `respondToEscalation` (reusado tal cual, sin cambios).
- `src/cli/commands/runStart.ts` — `haltIfCancelledExternally`, llamado antes de cada fase en el
  `while` de `executePipelineRun` y en cada iteración de `runDeveloperQaLoop`. Código enteramente
  nuevo, según lo verificado en la validación técnica (el escalamiento por agente es reactivo, no
  hay guard previo que reusar).
- `src/server/runView.ts` (+ test) — `motive` ampliado con `"user_cancel_requested"`;
  `buildEscalationBanner` resuelve el `agentRole` desde el propio evento de cancelación forzada
  cuando no hay `phase_finished` que lo indique.
- `src/server/app.ts` — endpoints nuevos: `POST /intake/map`, `POST /runs`, `GET /runs`,
  `POST /runs/:id/start`, `POST /runs/:id/cancel`.

**Frontend** (`web/src/intake/`, sin router — mismo criterio que el resto del proyecto, navegación
por `useState` de vista): `DisparoScreen.tsx` (texto libre o archivo `.md`/`.txt`), `ReviewModal.tsx`
(edición inline, % de completitud, Recalcular, Continuar deshabilitado hasta 100%),
`CasesList.tsx` ("mis casos" con Iniciar/Cancelar/Visualizar según `status`). `web/src/main.tsx`
gana una barra de navegación mínima (`AppNav`); `RunDashboard` (FEATURE-013A) queda intacto, solo
con un prop `hideHeader` para no duplicar el logout cuando se accede vía Visualizar.

**Decisión de diseño no anticipada en el documento**: el schema de `intake_field_definitions`
(sección 7.1) no tiene columna de opciones para el único campo `select` (`tipo_solucion`) — sus
dos opciones (`nueva`/`mejora_existente`) quedaron hardcodeadas en `ReviewModal.tsx`, no leídas de
la definición. No se tocó el schema aprobado para esto.

**Verificado en este entorno**: `tsc --noEmit` (backend) y `tsc -p web/tsconfig.json --noEmit`
(frontend) sin errores; `npm test` completo — 61 pass / 2 skip (normativos de Docker, preexistentes)
/ 0 fail; `vite build` genera el bundle sin errores.

**No verificado en este entorno** (sin acceso a la DB de desarrollo desde este sandbox — requiere
correrse en el entorno real antes del merge): `npm run migrate` contra una base real, y la
evidencia end-to-end pedida en la sección 8 (mapeo real de un texto rico, transición
`sin_iniciar → running` disparando un run real, `running → aborted` vía Cancelar). Falta correr
esto contra el repo/VPS real antes del Go final, mismo criterio que el resto del proyecto.

### Ronda 2 — hallazgos de la prueba end-to-end real del owner (2026-07-25)

El owner corrió el flujo completo (mapeo → confirmación → Iniciar → run real) en la VPS y encontró
6 problemas reales, verificados uno por uno contra el código. Correcciones aplicadas:

1. **Recalcular eliminado** (`web/src/intake/ReviewModal.tsx`) — cambio de diseño, no bug menor: el
   % en vivo (client-side) ya cubre completar campos vacíos a mano; una segunda llamada al modelo
   pisaba ediciones ya hechas (`setValues` reemplazaba el estado completo sin fusionar, y Haiku no
   repetía fielmente el valor editado). El fetch a `/intake/map` queda solo en `DisparoScreen.tsx`.
2. **Pipeline default corregido** (`src/cli/intakeService.ts`, `confirmIntake`) —
   `SINGLE_PHASE_ARCHITECT` → `FULL_PIPELINE`. El default anterior no era un bug de "corte", el run
   nunca tuvo más fases definidas; los casos de la UI terminaban `completed` tras solo Architect.
3. **Clonado real y aislado del repo del caso de negocio** — decisión del owner: `repositorio`/
   `rama_base_trabajo` del business_case pasan a ser el repo de trabajo real (antes eran solo texto
   de contexto, ignorado por el pipeline real, que seguía usando `project.repo_path`). Implementado
   en `src/isolation/worktree.ts` (`cloneRunRepository`/`removeRunClone`/`RunRepoCloneError`, sin
   compartir working tree entre casos) y `src/cli/intakeService.ts` (`startPendingRun` clona antes
   de promover a `running`; si falla, corte técnico explícito vía `failPendingRunTechnically` —
   `status='failed'` + evento `repo_clone_failed`, nunca se invoca al Architect). `runStart.ts`
   (`executePipelineRun`/`finishRun`) gana un `cleanupStrategy: "shared-worktree" | "standalone-clone"`
   para no romper el flujo CLI clásico (`--case`) ni el de reintento de escalamiento
   (`respondService.ts`), que siguen usando worktrees compartidos sobre `project.repo_path` sin
   cambios. Detalles de implementación dejados a mi criterio, según lo pedido: convención de path
   (`RUN_CLONES_BASE_DIR`, default `~/ai-orchestrator-case-clones`) y credencial git (ninguna
   nueva — se asume la misma configuración ambiente que ya usa `pushRunBranch` para push a
   `origin`).
4. **`authMode` auditable** — sumado a `executorMetadata` en el contrato (`src/contracts/executor.ts`,
   con eco en `docs/playbook/02-ARCHITECTURE.md` secciones 6 y 9) y en ambos Executors
   (`ClaudeCodeExecutor`, `CodexExecutor`), en el path activo de invocación real. Auditable desde
   ahora vía `run_events.phase_finished`.
5. **Texto de "Tipo de solución" corregido** — "Mejora existente" → "Mejora de una solución ya
   existente" en la opción del `<select>` (`ReviewModal.tsx`, ya visible al usuario ahí; el schema
   de `intake_field_definitions` no tiene columna de opciones, por eso vive en el frontend, no en
   la migración). De paso corregí también la `description` sembrada de `tipo_solucion` en
   `migrations/0009` (sí se muestra al usuario como texto de ayuda bajo el campo) y agregué
   `migrations/0011_fix_tipo_solucion_description.sql` con el `UPDATE` puntual para el dev ya
   migrado.
6. Verificación repetida: `tsc --noEmit` (backend) y `tsc -p web/tsconfig.json --noEmit` (frontend)
   sin errores; `npm test` completo — 61 pass / 2 skip / 0 fail; `vite build` sin errores.

**No verificado en este entorno** (mismo motivo que la ronda 1 — sin DB ni VPS accesibles desde
este sandbox): `npm run migrate` (incluida la migración 0011 nueva) y el reintento de la evidencia
end-to-end de la sección 8, ahora con el pipeline completo y el clonado real del repo.

### Ronda 3 — hallazgos adicionales de la corrida real (2026-07-25)

1. **`git clone` colgado esperando credenciales interactivas** — un repo privado/inexistente-pero-
   indistinguible-de-privado dejaba el proceso colgado para siempre en
   `Username for 'https://github.com':`, nunca falla, nunca dispara `RunRepoCloneError`, bloquea el
   request HTTP hasta matarlo a mano. Corregido con `GIT_TERMINAL_PROMPT=0` + `GIT_ASKPASS=echo` en
   el env del `git clone` de `cloneRunRepository` (`src/isolation/worktree.ts`) — `checkout -b`
   posterior no lo necesita, opera enteramente local sin acceso a red.
2. **Normalización HTTPS → SSH para GitHub** — una vez resuelto el cuelgue, el clonado seguía
   fallando para repos privados porque la VPS solo tiene configurada una clave SSH y el usuario
   escribe la URL en formato https (la que copia del navegador). Se agrega
   `normalizeGitCloneUrl()` (+ test, `src/isolation/worktree.test.ts`) que convierte
   `https://github.com/OWNER/REPO(.git)?` → `git@github.com:OWNER/REPO.git` antes de clonar; deja
   intacta cualquier URL ya en formato SSH o de otro host (solo GitHub por ahora, sin generalizar).
3. **Limitación conocida documentada explícitamente** (sección 9, Risks): el clonado usa una única
   identidad git fija a nivel de servidor (la clave SSH del usuario del sistema que corre el
   proceso del Orquestador) — no hay concepto de credencial git por usuario del Orquestador. Sumado
   el ítem Tentativo correspondiente a `docs/ROADMAP.md`.
4. Verificación repetida: `tsc --noEmit` (backend) y `tsc -p web/tsconfig.json --noEmit` (frontend)
   sin errores; `npm test` completo (incluye los 4 tests nuevos de `normalizeGitCloneUrl`);
   `vite build` sin errores.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.