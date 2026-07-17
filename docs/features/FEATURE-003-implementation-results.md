# FEATURE-003 — Resultados de Implementación (Orquestador Real, Incremento 1)

Versión: v1.0
Fecha de ejecución: 2026-07-17
Ejecutado por: Claude Code (asistente IA de desarrollo), contra Postgres real de la VPS (túnel SSH)
e invocaciones headless reales a Claude Code CLI — sin mocks.

Este documento es la evidencia de cierre exigida por `FEATURE-003-orchestrator-single-phase.md`
(sección 8, Validation Criteria / Validation Evidence). A diferencia de FEATURE-001/002, esto ya
no es un spike descartable: es el primer código real de producto del Orquestador.

---

## 0. Qué se construyó

Proyecto Node.js + TypeScript en la raíz del repo:

```
src/
  contracts/executor.ts        — PhaseInvocation/PhaseResult/Executor, copiado 1:1 de 02-ARCHITECTURE.md §6
  db/pool.ts, db/migrate.ts    — conexión a Postgres (DATABASE_URL_DEV) y runner de migraciones
  db/repository.ts             — acceso a las 4 tablas
  executor/claudeCodeExecutor.ts — adaptador real del Executor para Claude Code CLI
  executor/roles/architect.txt — roleInstructions productivas del rol architect
  isolation/worktree.ts        — creación/remoción real de rama + git worktree por run
  cli/index.ts, cli/commands/  — comando CLI del Orquestador (run:start, run:status)
migrations/0001_init.sql       — schema real de las 4 tablas
```

Punto de entrada: `npm run cli -- run:start --case <json>` y `npm run cli -- run:status --run <id>`
(decisión operativa confirmada junto con el Go: comando CLI, no endpoint HTTP).

---

## 1. Migración de schema — evidencia real

```
npm run migrate
[apply] 0001_init.sql
Migraciones al día.
```

Tablas confirmadas en el Postgres real de la VPS (`postgres-dev-orquestador`, vía túnel SSH):
`pipeline_definitions`, `runs`, `run_events`, `artifacts`, `schema_migrations` (esta última es
propia del mecanismo de tracking de migraciones, no parte del schema conceptual).

### Hallazgo — columnas técnicas agregadas al traducir el schema conceptual a DDL real

`02-ARCHITECTURE.md` describe las 4 tablas a nivel de propósito, no columna por columna. Al
escribir el DDL real fue necesario agregar columnas técnicas no mencionadas explícitamente:
`id`, `created_at`/`updated_at`, `status`, y — más relevante — `branch_name` y `worktree_path` en
`runs`, necesarias para que un run sepa dónde vive su aislamiento de código (sin esto, `run:status`
no podría reportar la ubicación del worktree). Esto es exactamente lo que la Feature anticipaba en
su sección 9 ("Riesgo de schema... documentar como hallazgo, no forzar el schema original"). No se
considera una desviación que requiera aprobación aparte — son adiciones, no simplificaciones de lo
ya definido (Regla Funcional 1 de la Feature prohíbe simplificar, no agregar columnas técnicas
necesarias).

---

## 2. Runs reales — las dos validaciones de la sección 8

### 2.1 Caso completo (`status: completed`)

Comando:
```
npm run cli -- run:start --case case_ok.json
```

Resultado real:
```
[run:start] runId=978361b2-ce98-4f94-a357-791a0a7fd8cc
[run:start] worktree creado: .../ai-orchestrator-worktrees/978361b2-... (rama run/978361b2-...)
[run:start] status final: completed
```

Evidencia completa (query real a Postgres, no mock): `docs/features/evidence/FEATURE-003/run_completed_status.json`.
Confirma:
- `runs.status = "completed"`.
- 3 `run_events` en orden (`run_started`, `phase_started`, `phase_finished`), con `id` correlativo
  (base para `Last-Event-ID` cuando exista SSE).
- 1 `artifacts` row (`kind: "design"`) con el `outputArtifact` real devuelto por Claude Code.
- `executorMetadata: { provider: "claude-code-cli", model: "claude-opus-4-8[1m]" }` persistido.

### 2.2 Caso ambiguo (`status: escalated`)

Comando:
```
npm run cli -- run:start --case case_ambiguo.json
```

Resultado real:
```
[run:start] runId=2c2a1d64-560c-43c7-b185-27107a399ddd
[run:start] status final: escalated
```

Evidencia completa: `docs/features/evidence/FEATURE-003/run_escalated_status.json`. Confirma
`runs.status = "escalated"`, `run_events` con el `escalationReason` real completo (no truncado ni
inventado), y `artifacts.kind = "escalation"`.

### 2.3 Aislamiento de código real

`docs/features/evidence/FEATURE-003/worktree_list_before_cleanup.txt` — `git worktree list`
confirmando que ambos runs crearon su propia rama (`run/<uuid>`) y worktree real, fuera del
checkout principal. Verificado además con `git status --short` dentro del worktree del caso
completo: vacío, sin cambios — coherente con `architect` siendo read-only (mismo mecanismo H1/H5
de FEATURE-001/002, ahora ejercido desde código real del Orquestador en vez de un operador humano).
El repo principal permaneció sin cambios de git en ningún momento por causa de las invocaciones.

Worktrees y ramas de prueba (`978361b2-...`, `2c2a1d64-...`) fueron eliminados al cierre, una vez
capturada esta evidencia — mismo criterio operativo que FEATURE-002.

---

## 3. Qué partes del contrato/mecanismo se sostuvieron

- El mecanismo CLI confirmado en FEATURE-001/002 (cwd = worktree, `--tools` según permisos,
  `ANTHROPIC_API_KEY` + `--bare`) funcionó igual desde código real de Node, no solo desde bash manual.
- El parseo de la convención `ESTADO/RESUMEN/ARTEFACTO/RAZON_ESCALAMIENTO` (H2, nunca se adoptó
  `--json-schema` sin verificarlo primero) se implementó como el mecanismo real de mapeo a
  `PhaseResult` — funcionó sin ajustes en ambos casos.
- `executorMetadata` se completó sin fricción, reforzando el hallazgo H3 (el proveedor sigue
  enrutando a modelos distintos entre invocaciones — esta vez `claude-opus-4-8[1m]` en vez de
  `claude-sonnet-5` como en FEATURE-001/002 — confirma que este campo es necesario para auditar
  qué modelo respondió realmente cada fase).

## 4. Hallazgos nuevos de esta implementación

**H8 — En Windows, invocar `claude` desde `child_process.spawn` de Node requiere resolver el `.exe` real, no el shim `.cmd`.**
El primer intento de invocación real falló: `spawn("claude", ..., { shell: true })` truncó el
`roleInstructions` y el prompt (ambos con saltos de línea) a través de `cmd.exe`, produciendo una
respuesta conversacional genérica en vez de la tarea real — `cmd.exe` no puede transportar
argumentos multilínea de forma confiable, incluso con el arreglo de argumentos que Node intenta
escapar (de ahí el propio warning de deprecación de Node sobre `shell: true` con arrays). La
solución real: resolver la ruta del `.exe` real (`claude.exe`, dentro de
`node_modules/@anthropic-ai/claude-code/bin/` para una instalación npm global) parseando el shim
`.cmd` que Windows expone en el PATH, e invocar ese `.exe` directamente con `spawn(..., { shell: false })`
(el default). Esto elimina el shell por completo — sin él, Node preserva el contenido multilínea
exacto. En Linux/macOS (la VPS de producción real) este problema no debería existir: el binario de
`claude` ahí es directamente ejecutable, sin capa `.cmd`/`shell` de por medio — pendiente de
confirmar la primera vez que el Executor corra en la VPS.

**H9 — El riesgo de concurrencia de procesos (Feature, sección 9) quedó solo parcialmente ejercido.**
Este incremento invoca el CLI como un proceso hijo de un comando corto (`npm run cli -- run:start`
arranca, hace una invocación, termina) — no desde un servicio Node de larga duración que reciba
múltiples runs concurrentes. Se corrieron 2 invocaciones reales, pero **secuenciales** (una después
de la otra, no en paralelo, y cada una en su propio proceso `npm run cli`). El comportamiento bajo
invocaciones **concurrentes** desde un único proceso Node persistente (el escenario real que el
Orquestador va a tener que soportar con múltiples runs simultáneos) **no fue validado en este
incremento** — queda como riesgo abierto para el Incremento 2 (secuencia de 2+ fases), donde
probablemente sí haga falta un proceso de orquestación persistente.

---

## 5. Validation Criteria — verificación cruzada contra la tabla de la Feature

| Escenario | Resultado |
|---|---|
| Migración de schema | ✅ Las 4 tablas existen, verificado con query real a `information_schema.tables` |
| Run de una fase completo | ✅ `runs.status: completed`, evento y artifact reales persistidos |
| Aislamiento de código real | ✅ Rama + worktree reales, `git worktree list` + `git status` limpio |
| Escalamiento persistido | ✅ `runs.status: escalated`, `escalationReason` real y completo |
| Consulta de estado | ✅ `run:status` devuelve el estado persistido sin leer logs crudos |

---

## 6. Conclusión

El primer incremento real del Orquestador funciona end-to-end contra infraestructura real: Postgres
de la VPS (no local, no mock) y Claude Code CLI real. Ambos escenarios de la sección 8 (completado y
escalado) tienen evidencia persistida verificable, no solo "ejecutó sin error". Se encontró y
resolvió un problema real y no anticipado (H8, resolución de binario en Windows) sin comprometer el
mecanismo ya validado en FEATURE-001/002. Queda abierto, explícitamente sin forzar una conclusión
positiva, el comportamiento bajo invocaciones concurrentes de un proceso persistente (H9) — no
bloquea el cierre de este incremento, pero sí es información relevante para diseñar el Incremento 2.

---

## 7. Lecciones Aprendidas (06-DELIVERY-WORKFLOW.md, Stage 6)

Clasificadas según su naturaleza y alcance, antes de mergear esta Feature a `main`:

**Específico de esta implementación (queda acá, no se traslada a ningún otro documento):**
- H8 (resolución del binario real `.exe` vs. el shim `.cmd` en Windows) — es un detalle del
  entorno de desarrollo local en Windows; no necesariamente aplica a la VPS de producción, que
  corre Linux. Pendiente confirmar la primera vez que el Executor corra ahí.
- H9 (riesgo de concurrencia de procesos) — queda explícitamente abierto, no resuelto. Este
  incremento solo ejerció invocaciones secuenciales desde comandos cortos, no desde un servicio
  persistente. No se fuerza una conclusión sobre cómo se comportará bajo concurrencia real.

**Decisiones de arquitectura del proyecto:**
- Ninguna ADR nueva en `02-ARCHITECTURE.md` por este incremento. H9 podría ameritar una si el
  Incremento 2 (secuencia de 2+ fases) confirma que hace falta un proceso persistente en vez de
  comandos cortos — se evalúa en ese momento, con evidencia de ese incremento, no ahora.

**Candidato a conocimiento reusable del AI-Playbook Base (propuesta — no aplicada, requiere decisión aparte):**
- H8: invocar un CLI de terceros desde Node.js en Windows requiere resolver el binario real
  (`.exe`) en vez de usar `shell: true` con un array de argumentos — `cmd.exe` no transporta de
  forma confiable argumentos multilínea (system prompts, contexto JSON con saltos de línea), y
  produce fallos silenciosos (el proceso corre y responde, pero con el argumento truncado/mal
  interpretado, no con un error explícito). Es una lección de integración Node/Windows, no de
  gobernanza de este proyecto — se deja como recomendación para el owner, no se traslada a la
  copia local del Playbook como efecto colateral de este cierre.
