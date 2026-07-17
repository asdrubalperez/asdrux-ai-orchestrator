# FEATURE-002 — Aislamiento de Escritura del Executor (Claude Code)

Versión: v1.0
Basado en: 07-FEATURE-TEMPLATE.md (Standard Mode)

---

# 1. Feature Identity

- **Name**: Executor Write Isolation — Claude Code, worktree confinado
- **Type**: Spike técnico / prueba de contrato (no feature de negocio)
- **Owner**: Asdru
- **Status**: **Approved** (Go confirmado 2026-07-16)
- **Priority**: Alta — bloquea la decisión de alcance de Milestone 1

---

# 2. Problem Statement

FEATURE-001 confirmó que `permissions.filesystem: "read-only"` se sostiene realmente (vía restricción de toolset). Pero el contrato de Executor también define `"workspace-write"` con `writableRoots` acotado a un `git worktree` por run (02-ARCHITECTURE.md, sección de aislamiento) — y esa mitad del contrato **nunca se probó**. Es una suposición de diseño: que Claude Code puede escribir libremente dentro de un directorio (el worktree del run) y que esa escritura queda confinada ahí, sin tocar el repo principal ni archivos fuera de `writableRoots`.

Antes de comprometer el schema de persistencia (4 tablas) o el motor del Orquestador, hay que confirmar que este segundo supuesto se sostiene igual que el primero.

---

# 3. Functional Goal

Confirmar, con invocaciones reales y no simuladas, que:

1. Se puede crear una rama y un `git worktree` propio para un run, de forma aislada del repo principal.
2. Una invocación headless a Claude Code con rol `developer` y `permissions.filesystem: "workspace-write"`, `writableRoots` apuntando solo a ese worktree, puede escribir archivos dentro de él.
3. Un intento de escritura fuera de `writableRoots` (ej. en el repo principal o en otra ruta) es bloqueado — la restricción de `writableRoots` es efectiva, no solo declarativa en el prompt.
4. Dos invocaciones encadenadas sobre el mismo run — `architect` (read-only, rol ya validado en FEATURE-001) seguido de `developer` (write, este spike) — no interfieren entre sí y ambas producen un `PhaseResult` válido.

---

# 4. Scope

**Included**
- Creación real de una rama + `git worktree` para un run de prueba.
- Invocación headless a Claude Code, rol `developer`, `permissions.filesystem: "workspace-write"`, `writableRoots` acotado al worktree.
- Verificación efectiva de que la escritura queda confinada al worktree (el repo principal permanece intacto).
- Intento explícito de escritura fuera de `writableRoots` para confirmar que se bloquea.
- Encadenamiento mínimo: invocación `architect` (read-only) → invocación `developer` (write) sobre el mismo run/worktree.
- Mapeo de ambas respuestas al contrato `PhaseResult` ya definido (incluyendo `executorMetadata`).
- Registro de evidencia, mismo patrón que FEATURE-001 (`FEATURE-002-spike-results.md` + carpeta `evidence/FEATURE-002/`).

**Excluded**
- Las 4 tablas de persistencia.
- Orquestador real (máquina de estados, transición automática entre fases).
- UI.
- Loop Developer ↔ QA y su límite de reintentos.
- Codex como Executor (se prueba solo Claude Code).
- Política de limpieza automática de worktrees vencidos (21 días) — no aplica a un spike puntual.
- Push/PR real a `main` — el worktree de prueba puede limpiarse manualmente al cerrar la Feature.

**Future ideas (optional)**
- Repetir este mismo spike con Codex, si más adelante se retoma FEATURE-002 original (Codex), hoy despriorizada.

---

# 5. Functional Rules

1. La invocación debe usar exactamente la forma de `PhaseInvocation` ya definida en `02-ARCHITECTURE.md` — `permissions.filesystem: "workspace-write"` con `writableRoots` apuntando exclusivamente al worktree del run, nunca al repo principal.
2. El resultado se considera válido solo si se confirma, con evidencia (diff de git, listado de archivos), que los cambios quedaron **dentro** del worktree y que el working tree del repo principal (fuera de ese worktree) permanece sin modificaciones.
3. Debe incluirse al menos un intento explícito de escribir fuera de `writableRoots` (ej. instruir al rol `developer` a modificar un archivo fuera del worktree) para confirmar que la restricción se aplica de verdad y no es solo una instrucción de prompt ignorable — mismo principio que FEATURE-001 aplicó para read-only.
4. Debe probarse el encadenamiento de las dos invocaciones (`architect` → `developer`) sobre el mismo run, no como spikes aislados — el objetivo incluye confirmar que no hay interferencia entre fases consecutivas.

---

# 6. Estrategia Algorítmica (Opcional)

No aplica — no hay Core Engine ni lógica de decisión involucrada en este spike.

---

# 7. Technical Considerations

- **Arquitectura afectada**: ninguna en producción — spike aislado, igual que FEATURE-001.
- **Integraciones**: Claude Code headless (mismo mecanismo de invocación confirmado en FEATURE-001, ahora con permisos de escritura).
- **Dependencias**: acceso a `git worktree` en el entorno de prueba; repo con al menos una rama base desde la cual crear el worktree.
- **Riesgos técnicos**: no está confirmado *cómo* Claude Code impone `writableRoots` en la práctica — a diferencia de read-only (donde H1 encontró que se impone excluyendo herramientas de escritura del toolset), acá el toolset de escritura debe estar habilitado, así que el mecanismo de confinamiento tiene que ser otro (posiblemente `cwd` del proceso, o una restricción de ruta propia del CLI). Si no existe un mecanismo confiable más allá del prompt, es un hallazgo que obliga a rediseñar esta parte del contrato — documentarlo como tal, no forzar una conclusión positiva.

---

# 8. Validation Criteria

| Escenario | Input | Expected Output |
|---|---|---|
| Setup de worktree | Crear rama + worktree para un run de prueba | Worktree creado, aislado del repo principal, verificable con `git worktree list` |
| Escritura dentro de `writableRoots` | `PhaseInvocation` rol `developer`, `workspace-write`, `writableRoots` = worktree | Archivo(s) escritos dentro del worktree, confirmables por diff/listado |
| Escritura fuera de `writableRoots` bloqueada | Rol `developer` instruido a modificar un archivo fuera del worktree | La escritura falla o es rechazada — evidencia de que `writableRoots` es real y no solo prompt |
| Encadenamiento de fases | `architect` (read-only) → `developer` (write) sobre el mismo run | Ambas invocaciones producen `PhaseResult` válido, sin interferencia entre sí |

### Validation Evidence

- Log/transcript crudo de ambas invocaciones.
- Diff de git mostrando qué cambió dentro del worktree, y confirmación de que el repo principal quedó sin cambios.
- Confirmación explícita del resultado del intento de escritura bloqueada fuera de `writableRoots`.
- Los dos objetos `PhaseResult` completos, a partir de respuestas reales — no mocks.

---

# 9. Risks

- **Riesgo de contrato**: si `writableRoots` no puede imponerse de forma efectiva (más allá del prompt), hay que rediseñar esa parte del contrato antes de avanzar con Milestone 1.
- **Riesgo de aislamiento**: que una escritura "se escape" del worktree hacia el repo principal sin ser detectada a tiempo — por eso la verificación explícita del diff es obligatoria, no opcional.
- **Supuesto a validar**: que encadenar dos invocaciones (lectura → escritura) sobre el mismo run no introduce comportamiento distinto al de invocaciones aisladas.

---

# 10. Approval Gate

**Aprobado.** Go humano confirmado el 2026-07-16 por Asdru (owner del proyecto).

Decisiones operativas confirmadas junto con el Go:
- El intento de escritura fuera de `writableRoots` se prueba contra **ambos** targets: (a) el propio repo principal (checkout actual) y (b) una ruta arbitraria del sistema, ajena a cualquier git.
- La rama y el worktree de prueba se limpian (se eliminan) al cerrar la Feature, una vez capturada toda la evidencia.

La implementación queda habilitada para ejecutarse.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.
