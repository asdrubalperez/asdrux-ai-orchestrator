# FEATURE-003 — Orquestador Real: Persistencia + Invocación de una Fase

Versión: v1.0
Basado en: 07-FEATURE-TEMPLATE.md (Standard Mode)

---

# 1. Feature Identity

- **Name**: Orquestador Real — Milestone 1, Incremento 1 (una fase persistida)
- **Type**: Feature de producto (primer código real, ya no es un spike descartable)
- **Owner**: Asdru
- **Status**: **Closed** — implementada y validada con evidencia real el 2026-07-17. Ver `FEATURE-003-implementation-results.md`.
- **Priority**: Alta — primer incremento real del Orquestador, base de todo lo que sigue

---

# 2. Problem Statement

FEATURE-001 y FEATURE-002 validaron el contrato de Executor con spikes descartables — comandos sueltos, sin persistencia real, ejecutados y limpiados manualmente. Corresponde ahora construir el primer incremento real y no descartable del Orquestador: un servicio Node/TypeScript con persistencia genuina en Postgres, capaz de invocar una única fase real y dejar registro correcto y consultable de lo ocurrido — no un log de spike, sino el sistema real empezando a funcionar.

---

# 3. Functional Goal

Dado un run con un pipeline de una sola fase:

1. Se crea un `run` real en la tabla `runs`, referenciando una `pipeline_definition` versionada (aunque sea de una sola fase).
2. Se crea la rama + `git worktree` real para ese run (mismo mecanismo confirmado en FEATURE-002).
3. Se invoca esa fase (ej. rol `architect`, `permissions.filesystem: "read-only"`) contra el adaptador real de Executor para Claude Code, usando el mecanismo CLI ya confirmado (no simulado).
4. El resultado se persiste correctamente: evento append-only en `run_events`, artifact en `artifacts`, y el `run` actualiza su estado (`completed` o `escalated`) según `PhaseResult.status`.
5. Existe una forma real (endpoint HTTP simple o comando del propio Orquestador) de disparar el run y de consultar su estado persistido después — sin tener que leer logs crudos a mano.

---

# 4. Scope

**Included**
- Proyecto Node/TypeScript real (estructura mínima de servicio, no script suelto).
- Migraciones reales de las 4 tablas en Postgres, fieles a `02-ARCHITECTURE.md` sección 5.
- Adaptador Executor real para Claude Code (código productivo, no comandos de spike), usando el mecanismo CLI confirmado (`cwd` = worktree, `--tools` según permisos, autenticación vía `ANTHROPIC_API_KEY`).
- Creación real de rama + `git worktree` por run.
- Un único punto de entrada (endpoint o comando) para disparar un run de una sola fase y consultar su estado.
- Persistencia correcta y verificable en las 4 tablas.
- Persistencia del caso `escalated` (sin lógica de reintento — eso es un incremento futuro).

**Excluded**
- Secuencia o transición automática entre 2+ fases (incremento futuro, ver abajo).
- Pipeline completo (Architect→Functional→Planning→Developer↔QA) con loop de QA y límite de reintentos.
- UI (ninguna pantalla).
- Limpieza automática de worktrees vencidos (21 días) — manual por ahora.
- Autenticación/autorización multiusuario real (el schema contempla `owner_id`, pero no hace falta lógica de permisos todavía).
- SSE / tiempo real (no hay UI que lo consuma todavía).
- Codex como adaptador alternativo.

**Future ideas (asentadas explícitamente, próximos incrementos de Milestone 1 — no implementar en esta Feature)**
- **Incremento 2**: secuencia de 2+ fases con transición automática entre ellas (ej. `architect` → `developer`), ya persistida en el Orquestador real — no como spike manual.
- **Incremento 3**: pipeline completo de los 5 roles, con loop Developer↔QA, límite de reintentos (3) y escalamiento automático al superarlo.
- UI mínima, una vez que el ciclo completo esté persistido y sea estable.

---

# 5. Functional Rules

1. El schema de las 4 tablas debe coincidir exactamente con lo definido en `02-ARCHITECTURE.md` sección 5 — cualquier simplificación de campos requiere aprobación explícita antes de implementarse, no se decide sobre la marcha.
2. La invocación al Executor debe usar el mecanismo ya confirmado empíricamente (Claude Code CLI, `cwd` = worktree del run, `--tools` según el nivel de permisos de la fase, autenticación exclusivamente vía `ANTHROPIC_API_KEY` sin OAuth) — no introducir un mecanismo distinto sin documentar por qué se aparta de la evidencia ya obtenida en FEATURE-001/002.
3. Todo resultado con `PhaseResult.status: "escalated"` debe persistirse como tal en `runs.status` y en `run_events` — no puede perderse ni "resolverse" solo; no hay reintento automático en este incremento.
4. El aislamiento de código (branch + worktree por run) es obligatorio desde este primer incremento, no se pospone — ya está validado en FEATURE-002 y es la base de todo lo que sigue.

---

# 6. Estrategia Algorítmica (Opcional)

No aplica — no hay lógica de decisión/optimización involucrada, es orquestación simple de un único paso.

---

# 7. Technical Considerations

- **Arquitectura afectada**: primer código real de producción del proyecto — todo lo anterior era spike descartable.
- **Integraciones**: PostgreSQL real (contenedor Docker en la VPS o local para desarrollo), Claude Code CLI headless.
- **Dependencias**: Postgres de desarrollo corriendo en contenedor separado en la VPS (`postgres-dev-orquestador`), accedido desde el entorno de desarrollo vía túnel SSH (`localhost:5433` → `127.0.0.1:5432` en la VPS) — nunca expuesto públicamente ni compartido con un futuro Postgres de producción. `ANTHROPIC_API_KEY` como variable de entorno (mecanismo ya resuelto en FEATURE-001). El connection string de desarrollo (`DATABASE_URL_DEV`) vive en `.env.local`, nunca en el chat ni en archivos versionados del repo.
- **Riesgos técnicos**:
  - Primera vez que el schema conceptual se traduce a migraciones reales — pueden aparecer ajustes de tipos/constraints no anticipados; documentarlos como hallazgo si ocurren, no forzar el schema original a la fuerza.
  - No está confirmado cómo se comporta el mecanismo CLI cuando un servicio Node lo invoca repetidamente como proceso hijo (en los spikes se ejecutó una vez por invocación, manual) — observar y documentar si aparece fricción (manejo de procesos, timeouts, límites de concurrencia), no asumir que escala igual que el spike puntual.

---

# 8. Validation Criteria

| Escenario | Input | Expected Output |
|---|---|---|
| Migración de schema | Correr migraciones sobre Postgres limpio | Las 4 tablas existen con las columnas/relaciones definidas en 02-ARCHITECTURE.md |
| Run de una fase completo | Disparar un run con pipeline de 1 fase (`architect`, read-only) | Row en `runs` con `status: completed`, evento en `run_events`, artifact persistido en `artifacts` |
| Aislamiento de código real | Mismo disparo | Rama + worktree creados según la convención ya validada en FEATURE-002 |
| Escalamiento persistido | Rol instruido a escalar | `runs.status: escalated`, `run_events` refleja el `escalationReason` real |
| Consulta de estado | Consultar el run ya finalizado | Se puede leer el estado persistido (vía endpoint o comando), sin necesidad de logs crudos |

### Validation Evidence

- Resultado real de las queries a Postgres (no mocks) mostrando las filas creadas en las 4 tablas.
- Evidencia de la rama + worktree real creados (mismo patrón que FEATURE-002: `git worktree list`, diffs).
- Transcript/log real de la invocación al Executor.
- Confirmación explícita del caso de escalamiento persistido correctamente.

---

# 9. Risks

- **Riesgo de schema**: que la traducción de las 4 tablas a migraciones reales requiera ajustes no anticipados en el diseño conceptual — documentar como hallazgo, no forzar.
- **Riesgo de concurrencia de procesos**: que invocar el CLI repetidamente desde un servicio Node de larga duración se comporte distinto a una invocación manual puntual (los spikes probaron una sola invocación cada vez) — a observar explícitamente durante la implementación.
- **Supuesto a validar**: que el mecanismo de aislamiento (branch + worktree) funciona igual de bien cuando lo crea código real del Orquestador, no un operador humano paso a paso como en el spike.

---

# 10. Approval Gate

**Aprobado.** Go humano confirmado el 2026-07-16 por Asdru (owner del proyecto), junto con las siguientes decisiones operativas:
- Postgres de desarrollo: contenedor separado en la VPS (`postgres-dev-orquestador`), accedido vía túnel SSH — no Docker Desktop local.
- Punto de entrada de este incremento: comando CLI del Orquestador (no endpoint HTTP).

La implementación queda habilitada para ejecutarse.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.
