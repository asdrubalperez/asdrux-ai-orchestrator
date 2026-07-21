# FEATURE-013 — Capa de UI "Run en curso" — Parte 013C: Respuesta a escalamiento

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: Parte 013C de FEATURE-013 (misma Feature de Roadmap). Depende de 013A
> (timeline/UI donde vive el botón y el banner) y 013B (sesiones — el endpoint de esta parte
> requiere sesión válida). Es el **último incremento** de FEATURE-013 — al cerrar esta parte,
> corresponde mover FEATURE-013 completa a ✅ Ejecutado en `docs/ROADMAP.md`.

---

## 1. Feature Identity

- **Name**: Capa de UI "Run en curso" — Parte 013C: Respuesta a escalamiento
- **Type**: Backend (endpoint + refactor de servicio) + Frontend (modal)
- **Owner**: asdru
- **Status**: En diseño — borrador v2
- **Priority**: Media — cierra FEATURE-013 en el Roadmap

---

## 2. Problem Statement

Hoy la única forma de responder a un run escalado es `run:respond --run <id> (--solution "<texto>"
| --abort)` desde una terminal con la sesión CLI local. Verificado contra el código real
(`runRespond.ts`), hay dos problemas adicionales para exponer esto por HTTP:

1. `--abort` solo registra el evento `escalation_aborted` — **no actualiza `runs.status`**. El
   run queda `escalated` para siempre en la UI aunque el humano ya haya dicho que no.
2. `--solution` ejecuta `executePipelineRun(...)` de forma síncrona, dentro del mismo proceso que
   maneja la respuesta — en HTTP eso implicaría un request abierto por potencialmente varios
   minutos, con riesgo de timeout o de perder el resultado si se corta la conexión.

## 3. Functional Goal

Un botón "Validar Ahora" en el banner de escalamiento (013A) que abre un modal explicando el
motivo exacto (repetido vs. agotado), pide Sí/No, y si es Sí pide texto adicional — todo eso
resuelto por un endpoint HTTP que responde rápido y ejecuta el reintento en background,
reflejando el avance por el mismo SSE de 013A.

## 4. Scope

### Incluido
1. Extraer la lógica reusable de `runRespond.ts` a una función de servicio (ej.
   `respondToEscalation(...)`) invocable tanto desde el comando CLI existente como desde el
   endpoint HTTP nuevo — sin duplicar lógica (Regla 3 de `03-AI-CONSTITUTION.md`, cambio mínimo).
2. Nuevo estado terminal `runs.status = "aborted"`, seteado correctamente cuando se aborta un
   escalamiento.
3. `POST /runs/:id/respond` (requiere sesión válida de 013B) — body `{ solution: string }` o
   `{ abort: true }`. Responde rápido (`202 Accepted`) y dispara la ejecución en background
   (mismo proceso Node, sin esperar a que termine el pipeline para responder el HTTP).
4. Modal en el frontend (013A): muestra motivo (Regla 5), `escalationReason` y `outputArtifact`
   rechazado; botones Sí/No; si Sí, cuadro de texto obligatorio.

### Excluido
1. Cola de jobs persistente / reintentos si el proceso Node se cae a mitad de una ejecución en
   background — riesgo aceptado explícito (ver Risks), consistente con el perfil de riesgo ya
   existente hoy para runs disparados por CLI (que tampoco sobreviven un crash del proceso).

---

## 5. Functional Rules

1. **Mapeo de estado al abortar o al continuar con solución**: ambos caminos deben dejar al padre
   en un estado terminal distinto de `escalated` — no solo `--abort`:
   - `--abort` (CLI) y `{ abort: true }` (HTTP) → `runs.status = "aborted"`.
   - `--solution` (CLI) y `{ solution }` (HTTP) → `runs.status = "resolved"` (estado terminal
     nuevo, simétrico a `aborted`). Corrige un bug real encontrado por Codex: hoy
     `run:respond --solution` crea el run hijo y registra `escalation_human_response`, pero
     **nunca cambia `runs.status` del padre** — queda `escalated` para siempre, lo que además
     rompe la idempotencia (Regla 6) si se basa solo en `status !== "escalated"`.
   - Con esto, la Regla 6 (idempotencia) sigue siendo simplemente "si `status !== "escalated"`,
     409" — simétrica para los dos caminos, sin necesitar lógica especial de detectar el evento
     `escalation_human_response` por separado.
   - Ambas transiciones van vía la función de servicio compartida (Regla de scope 1), y corrigen
     el comportamiento del CLI también, no solo el endpoint HTTP nuevo.

2. **Nodo `User` tras abortar o resolver**: pasa a `respondido` (verde) — ver 013A, Regla 3.

3. **Banner — motivo explícito**: distingue, usando el último evento terminal:
   - `escalation_repeated_detected` → "Se repitió el mismo resultado — se necesita tu validación."
   - `escalation_exhausted` → "Se agotaron los 3 reintentos internos — se necesita tu validación."

4. **Modal "Validar Ahora"**: muestra el motivo (Regla 3), el `escalationReason` (texto libre del
   agente) y el `outputArtifact` rechazado del artifact `kind: "escalation"` más reciente.
   Pregunta "¿Deseas que el agente continúe con indicaciones tuyas?":
   - **No** → `POST /runs/:id/respond` con `{ abort: true }`.
   - **Sí** → cuadro de texto obligatorio; al confirmar, `POST /runs/:id/respond` con
     `{ solution: "<texto>" }`, viajando ese texto tal cual al agente que escaló.

   **Extensión real necesaria (verificada contra el código, no existe hoy)**: el view model que ya
   arma `buildEscalationBanner()` en `src/server/runView.ts` hoy solo expone
   `{ isEscalated, agentRole, reason }` — no incluye el `outputArtifact` rechazado ni distingue
   `escalation_repeated_detected` de `escalation_exhausted` (Regla 3). Ambos datos ya existen en
   `artifacts`/`run_events` (se ve en el propio `buildEscalationBanner`, que ya lee
   `artifact?.content` y los eventos), así que es extender esa función, no construir algo nuevo:
   ```ts
   return {
     isEscalated: true,
     agentRole,
     reason: escalationReasonFromArtifact(artifact?.content) ?? latestEscalationReasonFromEvents(events),
     outputArtifact: artifact?.content ?? null, // nuevo
     motive: latestTerminalEscalationMotive(events), // nuevo: "repeated" | "exhausted" | null
   };
   ```
   El campo ya se llama `reason` en el view model actual (no `escalationReason` como decía la
   versión anterior de este documento) — usar ese nombre real en el modal, no inventar uno nuevo.

5. **Ejecución asíncrona**: el endpoint valida (sesión, ownership vía `getRunDetailForUser`,
   `status === "escalated"`), persiste lo necesario para crear el run hijo (worktree, eventos —
   igual que hoy), responde `202 Accepted`, y **luego** invoca `executePipelineRun(...)` sin
   bloquear la respuesta HTTP.

   **`.catch()` en background — sin duplicar `run_error`** (precisado tras la validación de
   Codex): `executePipelineRun` ya registra `run_error` internamente antes de relanzar el error
   (ver `runStart.ts`, catch interno). El `.catch()` del endpoint no debe volver a registrar
   `run_error` — alcanza con loguearlo operacionalmente (`console.error` o el logger que
   corresponda), solo para que la promesa no quede rechazada sin manejar. El registro en la base
   ya lo hace `executePipelineRun` por su cuenta.

   **Transición de estado del padre — atómica, no leer-luego-escribir** (precisado tras la
   validación de Codex, riesgo real de doble POST concurrente creando dos runs hijos si dos
   requests llegan casi al mismo tiempo y ambos leen `status = "escalated"` antes de que el
   primero termine de actualizar): la transición de `runs.status` (a `"aborted"` o `"resolved"`,
   Regla 1) debe hacerse con una escritura condicional atómica, no con un `SELECT` separado
   seguido de un `UPDATE`:
   ```sql
   UPDATE runs SET status = $2 WHERE id = $1 AND status = 'escalated' RETURNING *;
   ```
   Si no devuelve fila (0 rows afectadas), significa que otro request ya lo resolvió primero —
   responder `409` sin crear un segundo run hijo ni relanzar la ejecución. Alternativa aceptable:
   transacción con `SELECT ... FOR UPDATE` sobre el run padre antes de decidir — cualquiera de
   las dos formas cierra la condición de carrera, la clave es que la lectura del estado actual y
   la escritura de la transición sean una sola operación atómica, no dos separadas.

   **Contrato de respuesta HTTP — distinto según el camino** (precisado tras la validación de
   Codex, el documento anterior asumía una sola forma de respuesta para los dos casos, y
   `abort` no tiene run hijo):
   - `{ abort: true }` → `202 { status: "aborted" }`.
   - `{ solution: "<texto>" }` → `202 { childRunId: "<uuid>" }`.

   **Navegación del frontend al run hijo** (precisado tras la validación de Codex — el SSE está
   indexado por `runId` en `sse.ts`, `clientsByRunId.get(client.runId)`, y no sigue
   automáticamente a un run distinto): tras recibir `childRunId` en la respuesta del POST, el
   modal cierra y el frontend actualiza el run activo (el mismo mecanismo que ya existe para
   buscar un Run ID manualmente) a ese `childRunId` — reconectando el `EventSource` al nuevo run.
   El avance se observa por el SSE del **run hijo**, no del padre (el padre ya quedó en estado
   terminal `resolved`, sin más eventos relevantes que mostrar en vivo). Para `{ abort: true }`
   no hay transición de run — el usuario se queda viendo el mismo run, ahora en `aborted`.

6. **Idempotencia**: garantizada por la escritura atómica de la Regla 5 (`UPDATE ... WHERE
   status = 'escalated'`), no por una verificación previa separada — si la fila no se actualiza
   porque otro request ya la resolvió, responder 409 sin crear un segundo run hijo.

---

## 6. Estrategia Algorítmica

No aplica.

---

## 7. Technical Considerations

- Refactor de `runRespond.ts`: extraer sin reescribir la lógica de negocio ya validada en
  FEATURE-012 (worktree ramificado, `buildEscalationContext`, etc.) — solo separar "obtención de
  inputs + validaciones" (reusable) de "impresión por consola" (específico de CLI).
- Requiere 013B integrado (sesión real) antes de exponerse — sin autenticación, cualquiera podría
  responder escalamientos ajenos.
- Requiere 013A integrado (timeline + SSE) para que el resultado de la ejecución en background sea
  observable — sin eso, el humano no vería qué pasó tras responder.
- **Nota corregida sobre el proxy de Vite**: verificado con Codex — `vite.config.ts` ya proxya
  `"/runs"` como prefijo, así que `POST /runs/:id/respond` queda cubierto automáticamente, sin
  necesidad de agregar una entrada nueva (a diferencia de `/auth` en 013B, que sí era un prefijo
  nuevo). La lección de 013B sigue siendo válida como criterio general, pero en este caso
  puntual no aplica ningún cambio.
- **Componentes shadcn ya instalados, usarlos**: el correctivo de 013B ya instaló
  `dialog`/`alert-dialog` (`web/src/components/ui/`) específicamente para este modal — usarlos
  directamente en vez de armar un modal HTML propio desde cero. `AlertDialog` es el candidato más
  directo (pregunta con acción destructiva/confirmación tipo Sí/No), con el cuadro de texto
  condicional dentro del mismo diálogo cuando se elige "Sí".
- **`EscalationBanner` ya existe, pero es solo informativo hoy**: el componente actual
  (`web/src/main.tsx`) muestra el motivo en texto, sin ningún botón de acción — agregar el botón
  "Validar Ahora" ahí mismo, que abre el modal, en vez de crear un banner nuevo.

---

## 8. Validation Criteria

| Escenario | Input | Salida esperada |
|---|---|---|
| Abortar | `{ abort: true }` sobre run `escalated` | `runs.status = "aborted"`; `202 { status: "aborted" }`; banner desaparece; nodo `User` verde; usuario se queda en el mismo run |
| Continuar con solución | `{ solution: "texto" }` sobre run `escalated` | `runs.status` del padre pasa a `"resolved"`; `202 { childRunId }`; frontend navega al run hijo y el SSE sigue su avance en vivo |
| Doble respuesta | Segunda llamada sobre el mismo run (ya `aborted` o `resolved`) | 409, sin crear un segundo run hijo |
| Sin sesión | Request sin cookie válida | 401 (depende de 013B) |
| Run de otro usuario | `userId` de la sesión ≠ `owner_id` del run | 404 (mismo comportamiento que `getRunDetailForUser` hoy) |

### Validation Evidence
Evidencia E2E real (mismo criterio que FEATURE-012): un escalamiento real respondido desde el
modal en un navegador real, confirmando contra la base de datos que se creó el run hijo esperado
y que `runs.status` del padre terminó en el valor correcto (`aborted` o el run hijo avanzando).

---

## 9. Risks

- **Ejecución en background sin cola persistente**: si el proceso Node se reinicia mientras un run
  hijo está ejecutándose (disparado por este endpoint), esa ejecución se pierde sin reintento
  automático — mismo riesgo que ya existe hoy para runs iniciados por CLI, no es un riesgo nuevo
  introducido por esta parte, pero ahora es alcanzable también desde HTTP.
- Depende funcionalmente de 013A y 013B — no tiene valor por sí sola sin ambas.

---

## 10. Approval Gate

Implementación prohibida hasta aprobación explícita del owner. Enviar a validación de Codex antes
de implementar. Al cerrar esta parte, actualizar `docs/ROADMAP.md`: mover FEATURE-013 completa de
🟡 Confirmado a ✅ Ejecutado (último incremento).

**Además, en ese mismo cierre**, agregar un nuevo ítem en la sección `⚪ Tentativo` del Roadmap
(pendiente desde el correctivo de layout de esta sesión, no incluido todavía):

> Wiring real del ciclo Roadmap de Releases (Architect) + Release Plan (Planning) — hoy
> documentado en el Runbook (`docs/runbook/02-ARCHITECTURE-TEMPLATE.md`, sección 0, y
> `docs/runbook/09-RELEASE-PLAN-TEMPLATE.md`) pero no implementado en los roles reales del
> Orquestador (`src/executor/roles/architect.txt`, `planning.txt`) ni en la UI. La UI ya reservó
> el espacio (placeholder `ReleasePlanPanel`, sin datos reales) en FEATURE-013.

Este ítem es distinto de "Approval Model por Release" (ya existente en el Roadmap, sobre el rigor
de aprobación Modo A/Auto) — no fusionarlos ni confundirlos.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.