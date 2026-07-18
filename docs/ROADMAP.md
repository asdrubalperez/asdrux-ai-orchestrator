# Roadmap — asdrux-ai-orchestrator

## Vista rápida

**✅ Ejecutado**
- Milestone 0
- Milestone 1 — Pipeline completo Claude Code (FEATURE-001 a 006)
- Spike Codex — walking skeleton, invocación única read-only (FEATURE-007)

**🟡 Confirmado**
- Milestone 2 — Validación end-to-end con caso de negocio real
- Construcción de `CodexExecutor` de producción — paridad con Claude Code

**⚪ Tentativo**
- Loop Architect ↔ Functional
- Selección de proveedor/modelo/credenciales por rol
- Approval Model por Release
- Concurrencia de runs simultáneos
- Limpieza automática de worktrees/branches vencidos
- Egress de red con allowlist fino (Developer)
- `PreToolUse` hooks como defensa en profundidad (QA)
- Creación real de PR vía API de GitHub / merge automático
- Deployment Strategy y separación dev/staging/prod
- Capa de UI (Disparo, Run en curso, Historial/admin)

---

## Detalle

### ✅ Milestone 0
VPS operativa, Docker Engine instalado, deploy key de escritura configurada, repositorio
`ai-orchestrator` creado.

### ✅ Milestone 1 — Pipeline completo Claude Code (FEATURE-001 a 006)
Pipeline de 5 fases (Architect, Functional, Planning, Developer, QA) funcionando end-to-end sobre
Claude Code como Executor. Incluye aislamiento de escritura (FEATURE-002), orquestación de fase
única y secuencia (FEATURE-003, FEATURE-004), pipeline completo (FEATURE-005), y confinamiento
seguro de ejecución — QA sin Bash, Developer en contenedor endurecido (FEATURE-006).

### ✅ Spike Codex — walking skeleton, invocación única read-only (FEATURE-007)
Confirma que el contrato de `Executor` es agnóstico de proveedor: Codex puede integrarse como
segundo motor de ejecución sin rediseñar Orquestador ni UI. Alcance real de lo probado: una
invocación única, rol `architect`, `permissions.filesystem: "read-only"` — equivalente de
FEATURE-001, no de FEATURE-002 (aislamiento de escritura), FEATURE-004/005 (secuencia multi-fase,
pipeline completo) ni FEATURE-006 (confinamiento QA). La paridad completa con Claude Code
(escritura, confinamiento QA, orquestación multi-fase) queda explícitamente en el ítem
🟡 Confirmado "Construcción de `CodexExecutor` de producción — paridad con Claude Code" — eso es
lo que falta, no un extra opcional.

### 🟡 Milestone 2 — Validación end-to-end con caso de negocio real
Necesario y ya decidido antes de sumar al resto del equipo. No es opcional — por eso está
Confirmado y no Tentativo.

### 🟡 Construcción de `CodexExecutor` de producción — paridad con Claude Code
Confirmado con el owner: se construye `CodexExecutor` como implementación de producción, no solo
el walking skeleton de FEATURE-007. Implica repetir para Codex el equivalente de FEATURE-002
(aislamiento de escritura), FEATURE-004/005 (secuencia multi-fase, pipeline completo) y FEATURE-006
(confinamiento QA) — es la paridad completa con Claude Code que el spike todavía no cubre.

### ⚪ Loop Architect ↔ Functional
Evaluar solo si el escalamiento por esta causa resulta frecuente en la práctica. Requeriría su
propio límite de reintentos y condición de corte, no se asume por analogía con Developer↔QA.

### ⚪ Selección de proveedor/modelo/credenciales por rol
Ítem ampliado en la sesión de FEATURE-007, cubre tres superficies de configuración, todas parte de
la misma pantalla de Disparo de la UI:
- Selección de proveedor (Claude Code / Codex / futuro) por rol.
- Selección de modelo dentro de ese proveedor, por rol (motivado por H12: Haiku no siempre
  respeta convenciones de formato estrictas).
- Configuración de credenciales/API token por agente o global. Hoy resuelto a mano vía
  `.env.local` (`ANTHROPIC_API_KEY`, `CODEX_API_KEY`) porque el Orquestador todavía se construye a
  sí mismo; cuando exista la UI real, cada usuario va a necesitar cargar sus propias credenciales,
  no las de desarrollo. Sin diseño todavía de dónde/cómo se almacenan (relacionado con el ítem
  "Approval Model por Release", para cuando el Orquestador opere sobre proyectos externos).
- El mismo toggle "misma configuración para todos los agentes" vs "una configuración por agente"
  aplica a los tres puntos — proveedor, modelo y credenciales — no solo a proveedor/modelo.

### ⚪ Approval Model por Release
Cuarta configuración de `06-DELIVERY-WORKFLOW.md` — aprobación humana obligatoria al cierre de una
Release, con autonomía del Orquestador para encadenar Features dentro de ella sin gate individual.
Aplica cuando el Orquestador opere sobre proyectos externos.

### ⚪ Concurrencia de runs simultáneos
H9 (FEATURE-003): solo se probaron invocaciones secuenciales; comportamiento bajo múltiples runs
concurrentes desde un proceso Node persistente no está validado.

### ⚪ Limpieza automática de worktrees/branches vencidos
Política de retención a 21 días para runs escalados y no retomados — sin diseñar todavía.

### ⚪ Egress de red con allowlist fino (Developer)
Hoy el contenedor de Developer usa la red bridge default de Docker, sin allowlist fino de salida.

### ⚪ `PreToolUse` hooks como defensa en profundidad (QA)
Prioridad muy baja, no descartado del todo. Dependen de una API específica de Claude Code — no
portan a Codex.

### ⚪ Creación real de PR vía API de GitHub / merge automático
Hoy el flujo termina en rama lista, sin apertura de PR ni merge automatizado a `main`.

### ⚪ Deployment Strategy y separación dev/staging/prod
Sin diseñar.

### ⚪ Capa de UI
Tres pantallas — Disparo, Run en curso, Historial/admin — siguen `[Pendiente]` en
`02-ARCHITECTURE.md`.
