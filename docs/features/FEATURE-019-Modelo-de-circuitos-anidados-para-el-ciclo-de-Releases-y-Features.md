# FEATURE-019 — Modelo de circuitos anidados para el ciclo de Releases y Features

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: Surge directamente de la revisión de cierre de FEATURE-018 (ver su sección
> "Lecciones Aprendidas" en `docs/features/FEATURE-018-*.md` y en `docs/ROADMAP.md`). El modelo de
> 3 circuitos anidados fue propuesto por el owner (diagramas AS IS / TO BE) y validado contra el
> repo real por el Architect antes de este documento. FEATURE-020 (adaptar lo ya implementado en
> FEATURE-018 a este mecanismo) es una Feature separada, no se hace en este documento.

---

## 1. Feature Identity

- **Name**: Modelo de circuitos anidados para el ciclo de Releases y Features
- **Type**: Backend (motor de pipeline, roles `functional.txt`/`planning.txt`, mecanismo de
  continuación) + Gobernanza (`08-CODE-SYSTEM-PROMPT.md`, `06-DELIVERY-WORKFLOW.md`)
- **Owner**: asdru
- **Status**: 🟡 En Diseño
- **Priority**: Confirmada (`docs/ROADMAP.md`)

---

## 2. Problem Statement

Al cerrar FEATURE-018 se encontraron tres huecos reales, verificados contra el repo (ver Lecciones
Aprendidas de esa Feature):

1. **No existe "Feature" como dato rastreable** — hoy es prosa dentro del artefacto de texto de
   Planning (`ARTEFACTO`), sin ningún registro con estado que el sistema pueda consultar.
2. **El motor de pipeline (`src/pipelines/definitions.ts`) solo corre una Feature por invocación**
   y termina el run al aprobar QA (`finishRun`, `src/cli/commands/runStart.ts`) — no hay
   continuación a la Feature siguiente ni disparo de cierre de release.
3. **El texto de Developer en `08-CODE-SYSTEM-PROMPT.md`** ("si hay Feature siguiente, continúa
   con ella por su cuenta") **choca con la Regla 10** (Ownership de Artefactos, Runbook): el
   Release Plan —y por lo tanto su estado de avance— es propiedad de Planning, no de Developer.

El owner propuso un modelo de 3 circuitos anidados (diagramas AS IS/TO BE acordados en sesión):
Circuito 1 (Roadmap de Releases, Architect→Functional), Circuito 2 (Release Plan, Planning,
repetido por cada Feature), Circuito 3 (Feature Implementation, Developer↔QA, sin cambios). Cada
circuito tiene una salida natural hacia el que lo contiene; reintento (hasta 3, siempre a
Architect) y escalada a humano (siempre a Usuario) se mantienen exactamente iguales a hoy,
aplicando uniformemente sin importar en qué circuito ocurra el problema.

---

## 3. Functional Goal

1. Al completar una Feature (QA aprueba, Developer commitea y pushea), el pipeline **continúa
   automáticamente a Planning** en vez de terminar el run.
2. Planning, al recibir el control, decide si hay una Feature siguiente en el release activo: si
   sí, la asigna al circuito Developer↔QA; si no, declara el release completo y escala para
   aprobación humana, reusando el mecanismo de escalamiento ya construido en FEATURE-018.
3. Al aprobarse el cierre de un release, el pipeline reinicia en Architect (mecanismo ya
   existente, sin cambios), quien confirma/propone el release siguiente si lo hay.
4. Si no quedan releases pendientes en el roadmap tras cerrar uno, el proyecto queda cerrado sin
   escalar de nuevo — no hay nada que aprobar.
5. Functional declara su descomposición de Features de forma estructurada (JSON bolteado a
   `outputArtifact`, mismo patrón que `ROADMAP`/`comandoTest`), como base para que Planning
   trackee estado por Feature.
6. Developer deja de decidir por su cuenta si continúa con la Feature siguiente — siempre vuelve
   a Planning.
7. El tope de 3 reintentos de Developer↔QA (Stage 3) se mantiene **por Feature**, no acumulado a
   nivel de release — cada Feature es un run nuevo con su propio contador.

---

## 4. Scope

**Incluido:**
- Nuevo `PipelineSpec` en `src/pipelines/definitions.ts` para la continuación de Features dentro
  de un release ya en curso (fases: solo `planning`, con el mismo segmento de loop
  Developer↔QA) — se registra automáticamente en `pipeline_definitions` vía el mecanismo ya
  existente de búsqueda-o-creación por nombre+versión (`repository.ts`, función interna usada por
  `runStart.ts`/`intakeService.ts`), sin migración nueva.
- Mecanismo de **continuación por éxito** (distinto del mecanismo de escalamiento, que es por
  respuesta humana): al aprobar QA y completar el commit/push, en vez de que `finishRun` termine
  el run, se crea un run hijo — mismo patrón de worktree/rama que ya usa el escalamiento
  (`createRunWorktree` reusando la rama del padre) — cuyo primer rol es Planning, encadenado vía
  `originated_from_run_id`.
- `functional.txt`: agregar declaración estructurada de Features (`FEATURES: <JSON>`), análoga a
  `ROADMAP`.
- `planning.txt`: lógica de "¿hay Feature siguiente en el release activo?", con persistencia de
  estado (Release Plan versionado, mismo patrón que `release_roadmap`,
  `config_key = "release_plan"`), y declaración de escalamiento de "release completo" cuando no
  queden Features — reusando la distinción por contenido ya construida en FEATURE-018
  (`extractRoadmapApproval`, mismo patrón para el cierre de release).
- Extensión de `respondToEscalation`/`setProjectConfig` (ya con `client?` desde FEATURE-018) para
  reconocer y persistir también la aprobación de "release completo → release siguiente".
- Ajuste de texto en `08-CODE-SYSTEM-PROMPT.md` (Developer ya no decide autónomamente continuar a
  la Feature siguiente) y en `06-DELIVERY-WORKFLOW.md` (Stage 4/Stage 7, reflejar que Developer
  vuelve a Planning).

**Excluido:**
- FEATURE-020 (adaptar lo ya implementado en FEATURE-018 a este mecanismo) — Feature separada,
  posterior a esta.
- Evaluación de Tamaño del Release por Planning (`09-RELEASE-PLAN-TEMPLATE.md` §0) — sigue fuera,
  igual que en FEATURE-018.
- Cualquier columna o estado nuevo de "proyecto cerrado" — se deriva de que todos los releases del
  roadmap vigente queden en estado `"Completado"`, sin persistencia adicional.
- Selección de proveedor/modelo/credenciales (FEATURE-022) y credenciales git por usuario
  (FEATURE-023) — Features separadas.
- Generalizar el loop interno del motor de fases — decisión explícita del owner de no tocar esa
  pieza (FEATURE-005), se resuelve con cadena de runs en su lugar.

---

## 5. Functional Rules

1. El Circuito 3 (Developer↔QA) nunca termina el run al aprobar QA — siempre continúa a Planning
   vía run encadenado (`originated_from_run_id`).
2. Planning es el único rol que decide avanzar a la Feature siguiente o cerrar el release —
   Developer nunca lo decide por su cuenta (deroga el texto actual de
   `08-CODE-SYSTEM-PROMPT.md`).
3. El cierre de un release siempre requiere aprobación humana explícita — mismo criterio de Regla
   8.4 ya aplicado para la aprobación inicial del roadmap en FEATURE-018.
4. El release siguiente solo se activa tras esa aprobación — Architect no asume continuidad
   automática entre releases (sin cambios respecto a lo ya definido en FEATURE-018).
5. Si no hay más releases tras cerrar uno, el proyecto queda cerrado sin escalar de nuevo — no hay
   nada que aprobar en ese caso.
6. El contador de reintentos de Developer↔QA (tope 3, Stage 3) es por Feature — cada Feature, al
   ser un run nuevo, tiene su propio contador, nunca acumulado a nivel de release.
7. Si Planning recibe contexto sin ninguna Feature pendiente declarada por Functional (caso
   defensivo, no debería ocurrir si Functional cumplió su Regla), escala en vez de asumir el
   release completo por default.

---

## 6. Technical Considerations

### 6.1 Nuevo `PipelineSpec` de continuación

`src/pipelines/definitions.ts` gana un nuevo spec (nombre tentativo
`PLANNING_CONTINUATION`): `phases: [{ agentRole: "planning" }]`, mismo `loop` de
Developer↔QA que ya usa `FULL_PIPELINE`. Se registra en `pipeline_definitions` automáticamente la
primera vez que se usa, vía el mismo mecanismo de búsqueda-o-creación por `name`+`version` que ya
usan `FULL_PIPELINE`/`TWO_PHASE_ARCHITECT_FUNCTIONAL` — sin migración nueva.

### 6.2 Mecanismo de continuación por éxito (pieza genuinamente nueva)

Hoy, al aprobar QA, `finishRun` (`runStart.ts`) cierra el run (`finalizeRun` + commit/push).
Se agrega una rama nueva: si el release activo tiene una Feature siguiente pendiente (según el
Release Plan vigente de Planning), en vez de solo cerrar el run, se crea uno hijo —mismo patrón de
`createRunWorktree` reusando la rama del padre que ya usa `respondToEscalation`— con
`pipelineSpec = PLANNING_CONTINUATION`, `originated_from_run_id` apuntando al run que acaba de
cerrar, y contexto indicando qué Feature se completó. Esto es una función nueva, distinta de
`respondToEscalation` (esa es por respuesta humana; esta es por éxito automático) pero que reusa
sus mismas piezas de bajo nivel (`createRunWorktree`, `createRun` con `client`,
`recordRunConfigVersions`, `recordRunEvent`).

### 6.3 Persistencia del Release Plan (estado por Feature)

Mismo patrón que `release_roadmap` (FEATURE-018): `project_config_versions`,
`config_key = "release_plan"`, versionado. Valor JSONB: lista de Features (referenciando los `id`
que declaró Functional en `FEATURES`), con estado por Feature
(`Pendiente`/`En curso`/`Completada`) y cuál es la Feature actual. Cada transición (Feature
completada → siguiente asignada) es una nueva versión — historial completo sin código adicional,
igual que ya resolvió FEATURE-018 para el roadmap.

### 6.4 Reuso del mecanismo de escalamiento para cierre de release

Cuando Planning declara "no quedan Features" para el release activo, su salida usa
`ESTADO: escalated` con un marcador de "release completo" en `outputArtifact` (mismo patrón que
`ROADMAP` en el rol Architect). `respondToEscalation`/`setProjectConfig` (ya con `client?` desde
FEATURE-018) se extienden para reconocer también este tipo de contenido: al aprobar, persisten el
cierre del release actual y la propuesta del release siguiente (si existe en el roadmap), y el
child run creado usa `FULL_PIPELINE` de nuevo (su `phases[0].agentRole` ya es `"architect"` —
mecanismo existente, sin cambios).

### 6.5 Ajustes de texto en roles y gobernanza

- `functional.txt`: agregar etiqueta `FEATURES: <JSON con lista de features {id, nombre, resumen}>`,
  mismo tratamiento ad-hoc que `ROADMAP`/`comandoTest` en `parseRoleConvention`
  (`claudeCodeExecutor.ts`) — el regex de extracción por etiqueta ya es genérico, agregar una
  etiqueta nueva no rompe las existentes (confirmado en FEATURE-018).
- `planning.txt`: lógica de decisión "¿hay Feature siguiente?" + declaración del cierre de
  release cuando no la hay.
- `08-CODE-SYSTEM-PROMPT.md`, sección Developer: quitar "si hay Feature siguiente, continúa con
  ella por su cuenta (vuelve a Stage 4)" — reemplazar por "al completar el merge de una Feature,
  el pipeline continúa automáticamente a Planning; Developer no decide por su cuenta si sigue".
- `06-DELIVERY-WORKFLOW.md`, Stage 4 y la sección "Cierre del Release y Release Siguiente": ajustar
  para reflejar que la continuación entre Features pasa siempre por Planning.

### 6.6 Riesgos técnicos

- El mecanismo de continuación por éxito (6.2) es la pieza más grande y nueva de esta Feature —
  a diferencia de FEATURE-018, que reusó mecanismos existentes casi en su totalidad, acá hay una
  función nueva de verdad (aunque construida con piezas ya probadas). Mayor superficie de riesgo
  que el resto del documento.
- Agregar `FEATURES` como etiqueta nueva aumenta otra vez la superficie del riesgo H12 (modelos
  económicos no siempre respetan el formato) — mismo mecanismo de defensa ya validado
  (regex genérico por etiqueta, tolerante a Markdown despojado), pero cada etiqueta nueva es una
  superficie adicional de esa fragilidad conocida.
- El contador de reintentos "por Feature" (Regla 6) depende de que cada Feature sea
  efectivamente un run nuevo — si en el futuro se optimizara para no crear un run por Feature
  (por costo/latencia), este supuesto se rompe y habría que rediseñar el conteo.

---

## 7. Validation Criteria

| Escenario | Input | Esperado |
|---|---|---|
| Feature completada, hay Feature siguiente | QA aprueba Feature A, release tiene Feature B pendiente | Run hijo creado con `PLANNING_CONTINUATION`, Planning asigna Feature B a Developer↔QA |
| Feature completada, era la última | QA aprueba Feature X, no quedan Features pendientes | Planning declara release completo, escala para aprobación humana |
| Aprobación de cierre con release siguiente | Owner aprueba vía `respond` | Se persiste cierre del release actual + activación del siguiente, child run con `FULL_PIPELINE` reinicia en Architect |
| Aprobación de cierre sin más releases | Owner aprueba, roadmap no tiene releases pendientes | Proyecto queda cerrado, sin nueva escalación |
| Reintentos por Feature | Feature A falla 2 veces en QA, se corrige a la 3ra | Contador de reintentos de Feature A no afecta el de Feature B (run nuevo, contador fresco) |
| Functional sin Features declaradas (defensivo) | Contexto de Planning sin `FEATURES` válido | Planning escala en vez de asumir release completo |

### Validation Evidence

- Consulta SQL sobre `project_config_versions` (`config_key = "release_plan"`) mostrando la
  evolución de estado por Feature tras cada aprobación real.
- Prueba real end-to-end en la VPS con un release de al menos 2 Features, siguiendo el mismo
  criterio que dio mejores resultados en Features anteriores (probarlo con datos reales, no solo
  revisión de código).

---

## 8. Risks

- Es la Feature con más pieza nueva de código (6.2) desde FEATURE-005 — mayor riesgo relativo que
  los últimos ciclos, que fueron mayormente wiring y reuso.
- FEATURE-020 depende enteramente de que esta Feature cierre su implementación real — cualquier
  cambio de diseño tardío acá repercute directo en el tamaño de FEATURE-020.
- Sin caso de negocio real con más de una Feature por release todavía probado en producción — el
  camino principal (una sola Feature) seguirá siendo el más validado hasta que exista una prueba
  real multi-Feature.

---

## 9. Approval Gate

Implementación prohibida hasta aprobación humana explícita de este documento.

---

## Estado de la implementación

Pendiente — este documento está en revisión del owner antes de Governance y handoff a Codex.