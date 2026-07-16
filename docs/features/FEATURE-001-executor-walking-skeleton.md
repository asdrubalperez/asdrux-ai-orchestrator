# FEATURE-001 — Walking Skeleton del Executor (Claude Code)

Versión: v1.0
Basado en: 07-FEATURE-TEMPLATE.md (Standard Mode)

---

# 1. Feature Identity

- **Name**: Executor Walking Skeleton — Claude Code, fase única
- **Type**: Spike técnico / prueba de contrato (no feature de negocio)
- **Owner**: Asdru
- **Status**: **Approved** (Go confirmado 2026-07-16)
- **Priority**: Alta — bloquea todo diseño posterior de persistencia y Orquestador

---

# 2. Problem Statement

El contrato de Executor (interfaz `Executor.runPhase`) fue diseñado y "verificado contra documentación oficial" de Claude Code y Codex, pero **nunca ejecutado en la práctica**. Antes de invertir esfuerzo en el schema de las 4 tablas de persistencia o en la máquina de estados del Orquestador, existe el riesgo de que supuestos clave del contrato no se sostengan en un caso real: permisos de solo-lectura impuestos más allá del prompt, formato real de streaming, y mapeo limpio de la respuesta al `PhaseResult` definido.

Motivación de negocio: de-riesgar la pieza más incierta del diseño antes de comprometer trabajo sobre supuestos no probados.

---

# 3. Functional Goal

Confirmar, con una invocación real y no simulada, que:

1. Se puede invocar Claude Code en modo headless con un rol fijo ("architect") y `roleInstructions` específico.
2. El permiso `filesystem: "read-only"` se sostiene realmente durante la ejecución — no solo porque el prompt lo pide, sino por una restricción efectiva (herramientas habilitadas + sandbox + política de comandos).
3. La respuesta de la herramienta puede mapearse, sin pérdida de información relevante, a la forma `PhaseResult` ya definida (`status`, `outputArtifact`, `summary`, `escalationReason`).

---

# 4. Scope

**Included**
- Una única invocación headless a Claude Code, rol `architect`.
- Verificación efectiva de `permissions.filesystem: "read-only"` (no solo declarativa en el prompt).
- Mapeo de la respuesta real al contrato `PhaseResult`.
- Registro simple del resultado (puede ser un archivo/log local — no la tabla `run_events` todavía).

**Excluded**
- Base de datos / las 4 tablas de persistencia.
- Orquestador (máquina de estados, transición entre fases).
- UI.
- Codex como segundo Executor (se prueba solo Claude Code en este incremento).
- Loop Developer ↔ QA.
- `git worktree` / aislamiento por run (no aplica: no hay escritura en esta Feature).

**Future ideas (optional)**
- Repetir el mismo spike contra Codex para confirmar que el contrato es realmente agnóstico de proveedor.

---

# 5. Functional Rules

1. La invocación debe usar exactamente la forma de `PhaseInvocation` ya definida en 02-ARCHITECTURE.md — no una versión simplificada ad-hoc, porque lo que se está probando es ese contrato tal cual está escrito.
2. El resultado se considera **válido** solo si se puede completar el objeto `PhaseResult` sin campos forzados o inventados (si algo no mapea limpiamente, es un hallazgo, no un detalle a ocultar).
3. La verificación de "read-only" debe incluir al menos un intento explícito de escritura (ej. pedir en el rol que modifique un archivo) para confirmar que el permiso se aplica de verdad y no es solo una instrucción de prompt ignorable.

---

# 6. Estrategia Algorítmica (Opcional)

No aplica — esta Feature no introduce ni modifica lógica de decisión (no hay Core Engine del proyecto involucrado todavía).

---

# 7. Technical Considerations

- **Arquitectura afectada**: ninguna en producción — esto vive fuera del Orquestador, como spike aislado.
- **Integraciones**: Claude Code en modo headless (mecanismo exacto de invocación — Agent SDK vs CLI — sigue siendo un pendiente que esta misma Feature debería ayudar a resolver empíricamente).
- **Dependencias**: acceso funcional a Claude Code headless desde el entorno de prueba (VPS o entorno local del desarrollador).
- **Riesgos técnicos**: que el permiso de solo-lectura no sea imponible tal como está diseñado, obligando a rediseñar la capa de permisos del contrato de Executor.

---

# 8. Validation Criteria

| Escenario | Input | Expected Output |
|---|---|---|
| Invocación básica exitosa | `PhaseInvocation` con rol `architect`, `roleInstructions` de ejemplo, `permissions.filesystem: "read-only"` | Se obtiene una respuesta de Claude Code headless sin error de transporte/autenticación |
| Mapeo a contrato | Respuesta cruda de Claude Code | Se completa `PhaseResult` con `status: "completed"`, `outputArtifact` y `summary` no vacíos, sin campos forzados |
| Intento de escritura bloqueado | Rol instruido a modificar un archivo del filesystem | La escritura falla o es rechazada — evidencia de que `read-only` es real y no solo una instrucción de prompt |
| Escalamiento simulado | Rol instruido a reportar ambigüedad | `PhaseResult.status: "escalated"` con `escalationReason` no nulo |

### Validation Evidence

- Log/transcript de la invocación real (input y output crudo).
- Confirmación explícita del resultado del intento de escritura bloqueada (evidencia de que el sandbox, no el prompt, es lo que impide la escritura).
- El objeto `PhaseResult` final, completado a partir de la respuesta real — no un mock.

Esta evidencia es la que cierra el propósito de la Feature: no "que ejecutó sin error", sino "que el contrato se sostiene con evidencia funcional observable" (04-TESTING-POLICY, principio 8).

---

# 9. Risks

- **Riesgo de contrato**: si `permissions.filesystem` no puede imponerse tal como está diseñado, hay que rediseñar esa parte del contrato de Executor antes de seguir.
- **Riesgo de proveedor**: comportamiento de Claude Code headless en producción puede diferir de la documentación oficial revisada — de ahí que esta Feature exista.
- **Supuesto a validar**: que el mecanismo de invocación (Agent SDK vs CLI) no cambia el resultado del contrato — si cambia, hay que documentar cuál de los dos se adopta y por qué.

---

# 10. Approval Gate

**Aprobado.** Go humano confirmado el 2026-07-16 por Asdru (owner del proyecto).

La implementación (Parte B del handoff) queda habilitada para ejecutarse.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.
