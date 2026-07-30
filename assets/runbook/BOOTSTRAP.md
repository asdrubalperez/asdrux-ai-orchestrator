# BOOTSTRAP.md

# Runbook Bootstrap

Versión: v1.0
Dueño: Architect (ejecuta este proceso; ver `03-AI-CONSTITUTION.md`, Regla 10, Ownership de
Artefactos)

## Propósito

Este documento define el proceso determinístico que el Orquestador sigue **antes** de empezar a
trabajar sobre cualquier business case, para un producto gestionado nuevo o ya existente.

Todo producto gestionado usa el Runbook completo. La variabilidad entre productos vive en las
secciones "Editable por producto" que Architect completa (Approval Model, Áreas Sensibles,
Release Strategy, etc.), no en qué archivos se cargan.

Cada paso de este proceso se resuelve con lo que ya está disponible: el business case, el acceso
ya provisto, o los artefactos que ya existan para ese producto — nunca preguntando de forma libre.

---

# Stage 1 — ¿El producto gestionado ya existe?

Se determina consultando si ya existen Project Brief y Architecture (`01`, `02`) para el producto
al que pertenece este business case — no se pregunta, se verifica contra lo que ya esté
persistido en `project_config_versions` (FEATURE-011).

**Si no existen** → este es un producto nuevo. Continuar en Stage 2.

**Si ya existen** → el Runbook y los artefactos de este producto ya están inicializados. Se
entrega el business case directamente a Architect (Stage 3) — Architect, con Project Brief y
Architecture ya vigentes, determina por sus propios mecanismos (`01`, `02`) si esto es una Feature
más dentro del alcance ya definido, o si requiere amendar la Architecture. No se repite la
inicialización de Stage 2 para un producto que ya la tiene.

---

# Stage 2 — Inicialización del Runbook (solo para un producto nuevo)

1. El Orquestador resuelve su Runbook desde los assets read-only distribuidos con la instalación,
   exclusivamente mediante `RunbookProvider`. No busca ni copia el baseline desde el repositorio
   gestionado y no depende del `cwd`.
2. Los documentos propios del producto se materializan únicamente en sus rutas canónicas:
   `docs/project/PROJECT-BRIEF.md`, `docs/architecture/ARCHITECTURE.md`,
   `docs/releases/<release-key>/RELEASE-PLAN.md` y
   `docs/features/<feature-code>-<slug>.md`. El Roadmap de Releases forma parte de
   `ARCHITECTURE.md`.
3. Las configuraciones vigentes se consultan desde `project_config_versions` (FEATURE-011).
4. La ubicación y forma de acceso al código fuente del producto ya quedó cubierta como campo
   declarativo obligatorio en `01-PROJECT-BRIEF-TEMPLATE.md`, sección 0 (incluyendo el caso
   greenfield, marcado "No Aplica") — este Bootstrap no vuelve a preguntarlo por separado.
5. Las secciones "Editable por producto" de `03`, `04`, `05` y `06` se completan como parte
   del mismo trabajo de Architect en Stage 3 — no antes, no como un paso separado que bloquee el
   inicio del Project Brief.

---

# Stage 3 — Entrega a Architect

El business case completo (nuevo o ya en curso) se entrega a Architect, quien sigue el proceso ya
definido en:

* `01-PROJECT-BRIEF-TEMPLATE.md` — Chequeo Declarativo (gate duro) y resto del Project Brief
* `02-ARCHITECTURE-TEMPLATE.md` — incluyendo el Roadmap de Releases (sección 0), siempre presente

Este Bootstrap termina cuando Architect entrega Project Brief y Architecture completos, y el
Roadmap de Releases ya aprobado por el humano — desde ahí, el ciclo lo rige
`06-DELIVERY-WORKFLOW.md` desde su Stage 1 (Functional).

---

# Principios

* Nada de esto es conversacional — cada decisión se resuelve contra lo que ya existe o contra
  campos declarativos ya definidos, nunca preguntando de forma libre.
* El baseline del Runbook pertenece a la instalación del Orquestador; los documentos generados
  pertenecen al producto gestionado.
* Los templates requeridos se resuelven y validan antes de abrir cualquier transacción documental.
* El startup sólo queda operativo si existen y pueden leerse `VERSION`, los assets consumidos por
  funcionalidades habilitadas y, actualmente, `07-FEATURE-TEMPLATE.md`. Assets futuros que todavía
  no se consumen no bloquean el arranque.
