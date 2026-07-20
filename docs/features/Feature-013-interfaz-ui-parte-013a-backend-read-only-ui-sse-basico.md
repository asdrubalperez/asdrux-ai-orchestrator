# FEATURE-013 — Capa de UI "Run en curso" — Parte 013A: Backend read-only + UI + SSE básico

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: este documento es la **Parte 013A** de FEATURE-013. Sigue siendo la misma
> Feature del Roadmap (🟡 FEATURE-013) — la división en partes (013A/013B/013C) es solo
> organizativa, a pedido de la primera validación de Codex sobre el borrador único original (ver
> dictamen: "Go condicionado a una ronda corta de cierre de diseño", bloqueante 1: "scope
> expandido respecto al Roadmap"). El Roadmap no se cierra hasta que las tres partes estén
> implementadas; el cierre final se hace con el último incremento (013C).
>
> Partes relacionadas: 013B (sesiones web) y 013C (respuesta a escalamiento) — documentos
> separados. 013A depende de que 013B exista antes de cualquier despliegue público (ver sección 9,
> Risks).

---

## 1. Feature Identity

- **Name**: Capa de UI "Run en curso" — Parte 013A: Backend read-only + UI + SSE básico
- **Type**: Backend (primer servidor HTTP del proyecto) + Frontend (UI standalone)
- **Owner**: asdru
- **Status**: En diseño — borrador v2, incorpora los hallazgos de la primera validación de Codex
- **Priority**: Media — misma prioridad que FEATURE-013 en `docs/ROADMAP.md`

---

## 2. Problem Statement

Hoy no existe ninguna forma de observar el estado de un run activo salvo consultando la base de
datos directamente o corriendo `run:status` desde la máquina con la sesión CLI local. No hay
visibilidad remota, y no hay ningún servidor HTTP en el proyecto — todo es CLI (`src/cli`).

## 3. Functional Goal

Un endpoint de solo lectura + una página web que muestran en tiempo real el estado de un run:
timeline fijo de 6 nodos con estado por nodo, bitácora narrativa, y banner informativo de
escalamiento (sin acción todavía — responder al escalamiento es 013C). Actualización en tiempo
real vía SSE, no polling.

## 4. Scope

### Incluido
1. Servidor HTTP en **Express** (Node), primer servidor del proyecto.
2. `GET /runs/:id` — detalle del run, reusando `getRunDetailForUser` ya existente.
3. `GET /runs/:id/stream` — SSE, contrato con `Last-Event-ID` (ver Regla 5).
4. Trigger de Postgres (`NOTIFY`) sobre `insert` en `run_events` y `update` en `runs`.
5. Frontend: **Vite + React + TypeScript + Tailwind + shadcn/ui + TanStack Query**.
6. Timeline de 6 nodos + Bitácora Narrativa + banner de escalamiento (informativo, sin botón
   funcional — el botón "Validar Ahora" se habilita recién en 013C).

### Excluido (partes separadas)
1. Login real / sesiones server-side → **013B**.
2. Respuesta a escalamiento (`run:respond` vía HTTP) → **013C**.
3. Disparo, Historial/Admin (ítems Tentativos separados del Roadmap).

### Explícitamente fuera de alcance de producción hasta 013B
Este documento **no** habilita despliegue público del backend. Ver Risks (sección 9).

---

## 5. Functional Rules

1. **Timeline siempre de 6 nodos** (`User`, `Architect`, `Functional`, `Planning`, `Developer`,
   `QA`), sin importar `pipeline_definition_id`. Los nodos de fases que el pipeline del run no
   incluye quedan en `pendiente` indefinidamente — decisión explícita del owner.

2. **Estados de nodo de agente**:
   - `pendiente` (gris): sin `phase_started` para ese rol.
   - `en_curso` (azul): `phase_started` sin `phase_finished` posterior.
   - `completado` (verde): último `phase_finished` de ese rol con `result.status === "completed"`.
   - `escalado` (naranja): `runs.status === "escalated"` y el rol es el de la última fase con
     `result.status === "escalated"`.
   - `fallido` (rojo): `result.status === "failed"` / `"rejected"` sin reintento posterior exitoso.

3. **Estados de nodo `User`** (representa al humano — inicia y, más adelante, responde
   escalamientos):
   - `iniciado` (verde): desde `run_started`.
   - `esperando_respuesta` (naranja): mientras `status === "escalated"` sin respuesta posterior
     (el botón real de respuesta es 013C; en 013A este estado es solo informativo).
   - `respondido` (verde): tras `escalation_human_response` o `escalation_aborted` (eventos que
     013C empieza a generar por HTTP; 013A ya sabe leerlos si existen).

4. **Bitácora Narrativa**: se arma recorriendo `run_events`. `phase_finished` usa literalmente
   `payload.result.summary` (ya es narrativa curada). El resto de los tipos de evento se traducen
   con una plantilla fija por `event_type` (ver detalle en el documento consolidado previo —
   `run_started`, `phase_started`, `escalation_opened`, `escalation_repeated_detected`,
   `escalation_exhausted`, `escalation_human_response`, `escalation_aborted`, `run_error`).

5. **Contrato SSE — alineado a la decisión ya aprobada en `02-ARCHITECTURE.md`** ("`run_events` —
   auditoría y reconexión SSE sin pérdida vía `Last-Event-ID`"), corregido tras la segunda
   validación de Codex para cubrir un hueco real: `updateRunCurrentPhase`, `updateRunStatus` y
   `finalizeRun` (`src/db/repository.ts`) escriben directo sobre `runs` con SQL plano,
   **sin ningún `run_event` garantizado como acompañante** — un replay que solo mire
   `run_events.id > Last-Event-ID` puede no reconstruir un cambio de `runs.status`/`current_phase`
   si el corte de conexión coincidió justo con uno de esos updates. Contrato corregido:
   - **En toda conexión — con o sin `Last-Event-ID`** — el servidor manda primero un evento
     `snapshot` con el detalle completo y actual (`run` + `events` + `artifacts`, vía
     `getRunDetailForUser`), **sin `id:`** (no lleva `id`, así no interfiere con el
     `Last-Event-ID` que el navegador vaya a recordar de los eventos reales que sigan). Esto
     garantiza que cualquier cambio de `runs` que no haya generado un `run_event` propio igual
     quede reflejado, sin depender de que el replay lo capture.
   - Inmediatamente después del snapshot, si el cliente mandó `Last-Event-ID`, el servidor hace
     **replay**: todos los `run_events` con `id > Last-Event-ID` para ese run, en orden, antes de
     pasar a "live". El replay complementa al snapshot (para reconstruir la Bitácora Narrativa
     completa), no lo reemplaza como mecanismo anti-pérdida — esa garantía la da el snapshot.
   - Cada evento de `run_events` emitido (replay o live) lleva `id:` igual al `id` real de esa
     fila — nunca un id sintético, para no crear ambigüedad de parseo del lado del servidor.
   - **Heartbeat**: un comentario SSE (`: heartbeat\n\n`) cada 15s, para mantener la conexión viva
     a través de cualquier proxy intermedio y detectar cortes silenciosos del lado del cliente.
   - El disparo real de cada evento viene del trigger de Postgres (Regla 6), no de `NOTIFY`
     manual desde el código de aplicación — el proceso que sirve la UI y el proceso que escribe
     (`run:start` por CLI) son procesos separados hoy.

6. **Trigger de Postgres**: función + trigger sobre `run_events` (`AFTER INSERT`) y `runs`
   (`AFTER UPDATE OF status, current_phase`), que ejecuta `pg_notify('run_events_channel',
   json_build_object('run_id', ...))`. El servidor mantiene una única conexión `LISTEN` persistente
   y demultiplexa por `run_id` hacia las conexiones SSE abiertas de cada cliente.

7. **Acceso durante 013A (sin login todavía)**: siguiendo el mismo criterio ya usado para Postgres
   de desarrollo (`docs/playbook/02-ARCHITECTURE.md`, "Postgres de desarrollo... vía túnel SSH...
   nunca conexión directa"), el servidor de 013A se valida **solo vía túnel SSH a la VPS**, nunca
   expuesto públicamente. El `userId` para las pruebas de esta parte se pasa de forma fija/por
   variable de entorno del lado del servidor de desarrollo — no hay usuario real logueado todavía.
   Este mecanismo temporal se elimina por completo al integrar 013B (Regla 7 de 013B reemplaza
   esta).

---

## 6. Estrategia Algorítmica

No aplica — mapeos determinísticos evento→estado y evento→bitácora (Reglas 2-4), no hay
optimización ni desambiguación.

---

## 7. Technical Considerations

- Primer servidor HTTP del proyecto (Express).
- Trigger SQL nuevo — pieza de infraestructura de base de datos, no solo aplicativa.
- Frontend nuevo: Vite + React + TS + Tailwind + shadcn/ui + TanStack Query — usar TanStack Query
  para el fetch inicial (`GET /runs/:id`) e invalidar/refetch la query cuando el `EventSource`
  reciba un evento, en vez de mantener estado manual duplicado.
- CORS y TLS **no se resuelven en esta parte** — 013A se valida solo por túnel SSH (Regla 7);
  la exposición pública real llega con 013B.
- Dependencia de FEATURE-012 (ya cerrada): reusa `run_events`/`artifacts` tal como quedaron
  definidos ahí, sin cambios de esquema adicionales en esta parte.

---

## 8. Validation Criteria

| Escenario | Input | Salida esperada |
|---|---|---|
| Run en curso, fase intermedia | `phase_started` en `functional` sin `phase_finished` | `Functional` azul; `Architect` verde; resto gris |
| Pipeline corto | Run `SINGLE_PHASE_ARCHITECT` completado | 6 nodos visibles; `Architect` verde; los otros 4 en gris permanente |
| Reconexión sin pérdida | Cliente se desconecta y reconecta con `Last-Event-ID` de hace 2 eventos | Recibe primero el `snapshot` actual, y luego exactamente los 2 eventos perdidos en orden, sin duplicados ni saltos |
| Primera conexión | Cliente sin `Last-Event-ID` | Recibe evento `snapshot` con el detalle completo actual, sin `id:` |
| Reconexión tras cambio solo en `runs` | Se corta la conexión; mientras está caída, `runs.status` pasa a `completed`/`escalated`/`retrying` vía `updateRunStatus`/`finalizeRun` sin que se inserte ningún `run_event` nuevo; el cliente reconecta con `Last-Event-ID` del último evento visto | El `snapshot` inicial de la reconexión refleja el nuevo `runs.status` correctamente, aunque no haya ningún `run_event` posterior que lo indique |
| Cambio en paralelo | Un `run:start` por CLI inserta un evento mientras la UI está abierta | La UI refleja el cambio sin recargar, vía push del trigger de Postgres |
| Heartbeat | Conexión SSE abierta sin eventos reales por 30s | Se reciben al menos 2 heartbeats; la conexión no se cae |

### Validation Evidence
Evidencia real esperada (mismo criterio que FEATURE-012): un run real corriendo por CLI en la VPS
mientras la UI (corriendo local, contra la VPS vía túnel SSH) muestra el avance sin refresco
manual; y una prueba explícita de reconexión con `Last-Event-ID` cortando la conexión a mitad de
un run y confirmando que no se pierde ningún evento.

---

## 9. Risks

- **No apto para despliegue público todavía.** Sin 013B no hay autenticación real — el acceso
  vía túnel SSH (Regla 7) es la única salvaguarda. No debe exponerse la VPS a internet con este
  servidor corriendo hasta que 013B esté integrado.
- **Primera pieza de infraestructura de base de datos más allá de tablas/columnas** (trigger +
  `NOTIFY`) — requiere prueba explícita de que sobrevive a reinicios de la conexión `LISTEN` del
  servidor (reconexión del propio servidor a Postgres, no solo del cliente al servidor).

---

## 10. Approval Gate

Implementación prohibida hasta aprobación explícita del owner. Siguiente paso sugerido: enviar
esta parte a validación de Codex (Go/No-Go), igual que se hizo con el borrador único original y
con FEATURE-012.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.
