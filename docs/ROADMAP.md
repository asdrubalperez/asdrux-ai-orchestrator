# Roadmap — asdrux-ai-orchestrator

## Vista rápida

**✅ Ejecutado**
- Milestone 0
- Milestone 1 — Pipeline completo Claude Code (FEATURE-001 a 006)
- Spike Codex — walking skeleton, invocación única read-only (FEATURE-007)
- Construcción de `CodexExecutor` de producción — paridad con Claude Code
- Feature 10 — `users`, `projects` y login del CLI: tablas `users`/`projects` creadas, migración
  de `runs.owner_id`/`project_id` (19/19 backfilleados), comandos `login`/`logout`/`seed:user` con
  `bcryptjs`, sesión local de 30 días
- FEATURE-011 — Configuración vigente por proyecto: migración
  `0004_project_config_versions.sql`, tabla dedicada versionada, funciones de repositorio
  (`getCurrentProjectConfig`, `getCurrentProjectConfigs`, `setProjectConfig`,
  `getProjectConfigHistory`) e integración en `runStart.ts`
- FEATURE-012 — Persistencia de contexto/hallazgos en escalamiento: migración
  `0005_escalation_context_persistence.sql`, `runs.originated_from_run_id`, estado `retrying`,
  comando `run:respond`, worktree hijo ramificado desde la rama del padre y validación E2E real
  documentada en `docs/features/FEATURE-012-implementation-results.md`
- Feature 09 — Runbook para el Orquestador AI automático: 12 archivos en `docs/runbook/`, v1.0,
  marcador `[PENDIENTE-DB-PROJECTS]` reemplazado por la referencia real a
  `project_config_versions` (FEATURE-011), pasada de consistencia cruzada completa
- Evolución del Playbook: declaración de rama/checkout de origen movida de Stage 6 a Stage 3 en
  `06-DELIVERY-WORKFLOW.md` (v1.2), Lessons Learned de Feature 10

**🟡 Confirmado**
- FEATURE-013 — Capa de UI — "Run en curso" (solo lectura, sin Disparo ni Historial/admin todavía)
- FEATURE-014 — Milestone 2 — Validación end-to-end con caso de negocio real

**⚪ Tentativo**
- Escalamiento optimizado sin reinicio completo
- Selección de proveedor/modelo/credenciales por rol
- Approval Model por Release
- Concurrencia de runs simultáneos
- Limpieza automática de worktrees/branches vencidos
- Egress de red con allowlist fino (Developer)
- `PreToolUse` hooks como defensa en profundidad (QA)
- Creación real de PR vía API de GitHub / merge automático
- Deployment Strategy y separación dev/staging/prod
- Capa de UI (Disparo, Historial/admin — "Run en curso" ya pasó a Confirmado, ver arriba)
- Notificación Slack/webhook complementaria a la UI de monitoreo (post FEATURE-013, si hace falta
  alertas fuera de cuando se está mirando activamente)

- Bajar expiracion de sesion del CLI de 30 dias a 48 horas al pasar a produccion - condicionado a
  que no se haya implementado otro mecanismo de autenticacion antes de esa fecha.
- Limpieza de persistencia de codigo versionado: `artifacts.commit_ref` existe en schema pero no se
  puebla nunca; los commits reales quedan hoy solo en `run_events`.
- Revaluar sesion local del CLI: el token no tiene validacion server-side ni tabla `sessions`;
  actualmente es confianza local unicamente.

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
✅ Ejecutado "Construcción de `CodexExecutor` de producción — paridad con Claude Code" — eso es
lo que falta, no un extra opcional.

### ✅ FEATURE-011 — Configuración vigente por proyecto
Tabla dedicada versionada por `project_id` + `config_key` para persistir configuraciones editables
por producto, consultar la vigente por índice único parcial y registrar qué versiones estaban
vigentes al iniciar cada run. Implementada con la migración `0004_project_config_versions.sql`,
funciones en `src/db/repository.ts` (`getCurrentProjectConfig`, `getCurrentProjectConfigs`,
`setProjectConfig`, `getProjectConfigHistory`) e integración del snapshot vigente en
`src/cli/commands/runStart.ts`. Ver `docs/features/FEATURE-011-project-config-versions.md`.

### 🟡 FEATURE-014 — Milestone 2 — Validación end-to-end con caso de negocio real
Necesario y ya decidido antes de sumar al resto del equipo. No es opcional — por eso está
Confirmado y no Tentativo.

### ✅ Feature 09 — Runbook para el Orquestador AI automático
Diseño completo y cerrado: 12 archivos en `docs/runbook/` (equivalente al `docs/playbook/` actual
de este mismo repo, pero pensado para que el Orquestador AI automático los consuma y opere sobre
ellos sin loop humano, salvo en los 6 puntos taxativos definidos en `00-README.md`). El marcador
`[PENDIENTE-DB-PROJECTS]` (9 apariciones en 7 archivos) fue reemplazado por la referencia real al
mecanismo de persistencia de configuración por producto (`project_config_versions`, FEATURE-011).
Pasada de consistencia cruzada de los 12 archivos completada — corrigió una referencia cruzada
real (`BOOTSTRAP.md` y `08-CODE-SYSTEM-PROMPT.md` mencionaban erróneamente que las secciones
"Editable por producto" incluían `07-FEATURE-TEMPLATE.md`, que no tiene ninguna). Bump de versión
a `v1.0` en los 12 archivos.

### ✅ Feature 10 — `users`, `projects` y login del CLI
Implementada y mergeada en `main`. Tablas `users` (con `password_hash` vía `bcryptjs`) y `projects`
creadas; `runs.owner_id`/`project_id` migrados a FK real, 19/19 filas backfilleadas. Comandos
`login`/`logout`/`seed:user`, sesión local de 30 días en `~/.orquestador/session.json`.

- **Sesiones/usuarios**: resuelto — `users` con `password_hash` real, validado por invocación.
  Sin tabla `sessions` ni validación server-side del token (ver ítem Tentativo correspondiente).
- **Proyectos**: resuelto — tabla `projects` con `repo_path`, `owner_id` FK a `users`. El marcador
  `[PENDIENTE-DB-PROJECTS]` de `docs/runbook/` quedó reemplazado por la referencia real a
  `project_config_versions` en FEATURE-011.
- **Proceso por proyecto**: sin cambios respecto al diseño original — la tabla `artifacts`
  existente (JSONB, `commit_ref`) sigue cubriendo esto, ahora conectada a `projects` vía `runs`.

El diseño de la tabla `projects` (y su relación con `runs`/`artifacts`) se hace recién con el
resultado de la investigación de Codex, no antes.

### ✅ FEATURE-012 — Persistencia de contexto/hallazgos en el circuito de escalamiento
Implementada y mergeada en `main`. El circuito de escalamiento de `06-DELIVERY-WORKFLOW.md`
(Stage 3) ya distingue reintento interno de escalamiento terminal mediante el estado `retrying`,
persiste la continuidad entre runs con `runs.originated_from_run_id`, conserva el contexto del
hallazgo en `run_events`/`artifacts`, y agrega `run:respond --solution|--abort` para la respuesta
humana. El run hijo usa worktree/branch propio ramificado desde la rama del padre.

Implementación principal: migración `0005_escalation_context_persistence.sql`, cambios en
`src/db/repository.ts`, `src/cli/commands/runStart.ts`, `src/cli/commands/runRespond.ts` y
`src/isolation/worktree.ts`. Validación E2E real con Postgres, Codex CLI y worktrees reales
documentada en `docs/features/FEATURE-012-implementation-results.md`.

### ✅ Construcción de `CodexExecutor` de producción — paridad con Claude Code
Cerrado en FEATURE-008 (ver `docs/features/FEATURE-008-implementation-results.md`). Se replicó
para Codex el equivalente de FEATURE-002 (aislamiento de escritura, resuelto vía Docker con
`--sandbox danger-full-access`, no con el sandbox nativo de Codex — bloqueado en esta VPS por un
problema de privilegio de red del kernel), FEATURE-004/005 (secuencia multi-fase, pipeline
completo) y FEATURE-006 (confinamiento QA, vía `--config features.shell_tool=false`). Paridad
completa alcanzada y validada con evidencia real contra la VPS.

### ⚪ Escalamiento optimizado sin reinicio completo
La v1 ya diseñada en Feature 09 (`03-AI-CONSTITUTION.md`, Reglas 8 y 10) resuelve el escalamiento
con una vía única: todo hallazgo entra por Architect y avanza en el orden normal del pipeline
hasta llegar al dueño real, llevando el contexto acumulado — no reinicia todo desde cero, pero sí
recorre secuencialmente los pasos intermedios aunque no tengan nada que resolver. Este ítem es la
optimización futura: permitir que el circuito llegue directo al dueño real sin recorrer los pasos
intermedios, cuando el costo de la v1 secuencial resulte un problema real en la práctica.

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
Feature 09 (`06-DELIVERY-WORKFLOW.md`, Stage 6) ya diseñó la v1: Modo A (default — automático
hasta el push de cada Feature, humano revisa antes del merge a la rama principal) y Modo Auto
(también el merge es automático; solo el deploy a producción requiere humano, sin excepción, por
la Regla 9 de `03-AI-CONSTITUTION.md`).

Lo que queda Tentativo: exponer el rigor (Modo A / Modo Auto) como configuración parametrizable
real para el usuario final — hoy es fijo, decidido por quienes operan el Orquestador. Aplica
cuando el Orquestador opere sobre proyectos externos.

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
Hoy el flujo termina en rama lista, sin apertura de PR ni merge automatizado a `main`. La política
que este código futuro debería seguir ya quedó diseñada en Feature 09 (`06-DELIVERY-WORKFLOW.md`,
Stage 6, Modo A / Modo Auto) — este ítem es la implementación real, todavía sin código.

### ⚪ Deployment Strategy y separación dev/staging/prod
Sin diseñar.

### 🟡 FEATURE-013 — Capa de UI — "Run en curso"
Confirmado como FEATURE-013, decidido en la sesión de diseño del Runbook (Feature 09): UI mínima de
solo lectura que muestra el estado de un run en curso, apoyada en la persistencia ya existente
(`getRunDetail` / tabla `artifacts`, ver `docs/playbook/02-ARCHITECTURE.md`, sección 5) — no
requiere construir nada nuevo en esa capa, solo un endpoint fino más una página que lo consulte.
Disparo e Historial/admin quedan fuera de esta Feature, ver ítem Tentativo "Capa de UI" abajo.
Feature 10 (investigación de base de datos, ver arriba) ya no compite por este número.

### ⚪ Capa de UI (Disparo, Historial/admin)
Dos pantallas — Disparo (crear un run nuevo desde la UI) e Historial/admin (listado de runs
propios o del equipo) — siguen `[Pendiente]` en `02-ARCHITECTURE.md`. "Run en curso" ya se
promovió a Confirmado (FEATURE-013, ver arriba) — este ítem es solo el resto.

### ⚪ Notificación Slack/webhook complementaria
Evaluada en la misma sesión que "Run en curso" como alternativa de monitoreo — se descartó como
primera opción porque, a esfuerzo comparable, una UI mínima de solo lectura daba más valor y era
reusable hacia la Capa de UI completa. Queda como complemento futuro si hace falta alertas push
(fase completada/fallida) fuera de cuando alguien está mirando la UI activamente.
