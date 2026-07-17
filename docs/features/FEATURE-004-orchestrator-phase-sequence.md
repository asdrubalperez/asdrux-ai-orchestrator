# FEATURE-004 — Orquestador Real: Secuencia de 2 Fases con Transición Automática

Versión: v1.0
Basado en: 07-FEATURE-TEMPLATE.md (Standard Mode)

---

# 1. Feature Identity

- **Name**: Orquestador Real — Milestone 1, Incremento 2 (secuencia de 2 fases)
- **Type**: Feature de producto
- **Owner**: Asdru
- **Status**: Draft — pendiente de Go humano
- **Priority**: Alta — segundo incremento de Milestone 1

---

# 2. Problem Statement

FEATURE-003 confirmó que el Orquestador puede invocar y persistir correctamente **una sola fase** real. El diseño completo (`resumen-diseno-orquestador.md`, sección 3) requiere una secuencia de fases con transición automática entre ellas — el Orquestador debe invocar la siguiente fase por sí mismo, leyendo la definición del pipeline, sin que un humano dispare cada fase a mano. Esto todavía no existe: hoy cada invocación es un comando `run:start` independiente.

---

# 3. Functional Goal

Dado un run con un pipeline de 2 fases (`architect` → `functional`, ambas `read-only`):

1. El run se dispara una única vez (un solo comando).
2. El Orquestador invoca `architect`, persiste su resultado.
3. Si `architect` finaliza con `status: "completed"`, el Orquestador invoca automáticamente `functional` a continuación — sin segunda invocación manual del usuario — pasándole como `context` el `outputArtifact` de `architect`.
4. Si `architect` finaliza con cualquier otro estado (`rejected`, `failed`, `interrupted`, `escalated`), el pipeline se detiene ahí — `functional` **no** se invoca, y el `run` queda persistido con ese estado final.
5. `run:status` refleja el progreso de **ambas** fases del run, no solo la última invocada.

---

# 4. Scope

**Included**
- Una `pipeline_definition` real con secuencia de 2 fases (`architect` → `functional`) y su regla de transición, en `definition` (JSONB) — no hardcodeada en el código del Orquestador.
- Lógica de transición automática en el Orquestador: invoca la fase siguiente solo si la anterior completó exitosamente.
- Corte del pipeline ante cualquier estado no exitoso de la primera fase — sin invocar la segunda.
- Persistencia independiente de `run_events`/`artifacts` por cada fase.
- Extensión de `run:status` para mostrar el estado de cada fase del run, no solo la más reciente.
- Mismo aislamiento por worktree ya validado (ambas fases operan sobre el mismo worktree del run).

**Excluded**
- Loop Developer↔QA y su límite de reintentos (Incremento 3).
- Loop Architect↔Functional (ver nota de roadmap en `01-PROJECT-CHARTER.md` — deliberadamente fuera de este incremento).
- Fases con `workspace-write` (Developer) — este incremento usa solo fases `read-only`, para aislar la variable de riesgo real de este Feature (transición automática) sin mezclarla con el cambio de permisos ya validado en FEATURE-002.
- Concurrencia real de múltiples runs simultáneos (riesgo abierto H9 — sigue sin validar).
- UI, Codex.

**Future ideas (no implementar en esta Feature)**
- Incremento 3: pipeline completo con los 5 roles y el loop Developer↔QA.
- Evaluar loop Architect↔Functional si el escalamiento por esta causa resulta frecuente en la práctica (evidencia real, no especulación).

---

# 5. Functional Rules

1. La transición a la fase siguiente ocurre **solo** si `PhaseResult.status === "completed"` de la fase anterior — cualquier otro valor detiene el run inmediatamente, sin invocar la fase siguiente.
2. La secuencia de fases y su regla de transición se leen de `pipeline_definitions.definition` — no se hardcodea el orden en el código del Orquestador (coherente con el diseño: "vive como datos versionados, no como código embebido").
3. Cada fase persiste su propio evento y artifact de forma independiente y verificable — no un evento combinado para las dos fases.
4. No se implementa ningún loop en este incremento — pipeline estrictamente lineal; cualquier necesidad real de iteración (entre cualquier par de fases) resulta en escalamiento, no en reintento automático.

---

# 6. Estrategia Algorítmica (Opcional)

No aplica — transición condicional simple (completed → continuar, cualquier otro estado → detener), sin lógica de decisión compleja.

---

# 7. Technical Considerations

- **Arquitectura afectada**: lógica de ejecución del Orquestador — antes invocaba una fase y terminaba; ahora debe leer la secuencia completa y encadenar invocaciones dentro del mismo proceso de `run:start`.
- **Riesgo de diseño de schema**: representar la secuencia + regla de transición en JSONB de forma simple, sin sobre-diseñar para casos condicionales que no existen todavía (por ejemplo, transiciones distintas según el tipo de artifact producido) — mantenerlo al mínimo necesario para este incremento.
- **Dependencias**: mismo mecanismo CLI, Postgres de desarrollo y aislamiento por worktree ya validados en FEATURE-001/002/003 — no se introduce infraestructura nueva.

---

# 8. Validation Criteria

| Escenario | Input | Expected Output |
|---|---|---|
| Transición automática exitosa | Pipeline de 2 fases, `architect` completa | `functional` se invoca automáticamente, sin segundo comando manual; ambas fases persistidas |
| Corte por escalamiento en fase 1 | `architect` escala | `functional` NO se invoca; `run.status` refleja el corte; `run_events` muestra que el pipeline se detuvo ahí |
| Persistencia independiente por fase | Caso exitoso | 2 sets de `run_events` + 2 `artifacts`, distinguibles por `phase` |
| Consulta de progreso multi-fase | Run en curso o finalizado | `run:status` muestra el estado de cada fase del run, no solo la última |

### Validation Evidence

- Resultado real de las queries a Postgres mostrando ambas fases persistidas (no mocks).
- Log/transcript real de ambas invocaciones encadenadas.
- Caso real de corte por escalamiento, confirmando que la segunda fase nunca se invocó (no solo que "no aparece" — verificar ausencia explícita de invocación, no solo de persistencia).

---

# 9. Risks

- **Riesgo de schema**: la representación de la secuencia en JSONB puede requerir ajustes no anticipados al implementarla — documentar como hallazgo, no forzar.
- **Riesgo de corte real**: confirmar que detener el pipeline ante escalamiento en una secuencia se comporta igual de limpio que escalar en una sola fase (ya validado) — no asumirlo por analogía sin evidencia.
- **Supuesto a validar**: que encadenar 2 invocaciones dentro de un mismo proceso `run:start` no reintroduce el problema de H8 (binario real vs. shim en Windows) de forma distinta al invocarlo dos veces seguidas.

---

# 10. Approval Gate

**Pendiente.** Requiere Go humano explícito de Asdru (owner del proyecto) antes de implementar.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.
