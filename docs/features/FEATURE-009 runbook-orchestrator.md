# FEATURE-009 — Resultados de diseño: Runbook para el Orquestador AI automático

Fecha de esta sesión: 2026-07-18/19
Rama sugerida: `feature/009-runbook`
Estado: **diseño completo, borrador v0.1 en los 12 archivos — no está cerrada del todo** (ver
sección "Pendientes explícitos" antes de asumir que sí).

## Resumen

El playbook actual (`docs/playbook/`) está diseñado para que lo use un humano junto a un
asistente IA — asume lectura, confirmación y decisión humana en cada paso. Esta Feature diseñó su
equivalente para que el Orquestador, una vez operativo, lo consuma y opere sobre él **sin loop
humano**, salvo en un conjunto taxativo de excepciones. El resultado son 12 archivos nuevos en
`docs/runbook/`, todos commiteados y en `main`, en versión `v0.1 (borrador de diseño, pendiente de
aprobación)`.

Este documento resume las decisiones de diseño y los hallazgos — no repite el contenido de cada
archivo, que ya está en el repo.

## Qué se produjo

`docs/runbook/`:

| Archivo | Dueño | Contenido |
|---|---|---|
| `00-README.md` | — | Índice, flujo general, los 6 casos donde el pipeline vuelve al humano |
| `01-PROJECT-BRIEF-TEMPLATE.md` | Architect | Chequeo declarativo (gate duro) + evaluación preliminar del business case |
| `02-ARCHITECTURE-TEMPLATE.md` | Architect | Documento vivo por producto; incluye Roadmap de Releases (sección 0, condicional) |
| `03-AI-CONSTITUTION.md` | — (rige a los 5 roles) | Autoridad de decisión, Ownership de Artefactos, circuito de escalamiento |
| `04-TESTING-POLICY.md` | Planning | Reglas de testing — QA no la consulta directo, se rige por el Test Plan |
| `05-CODING-STANDARDS.md` | Developer | Estándares de código |
| `06-DELIVERY-WORKFLOW.md` | — (orquesta a los 5 roles) | Stages 1-7 por Release, Approval Model automático, loop Developer↔QA, ciclo de repetición de Features |
| `07-FEATURE-TEMPLATE.md` | Functional | Molde de Feature, incluye los 3 escenarios mínimos (feliz/no feliz/intermedio) |
| `08-CODE-SYSTEM-PROMPT.md` | — (una sección por rol) | Core Behavior compartido + comportamiento específico de cada rol |
| `09-RELEASE-PLAN-TEMPLATE.md` | Planning | Artefacto único: secuencia del release + enfoque técnico + Test Plan por Feature |
| `AGENTS.md` | — | Punto de entrada |
| `BOOTSTRAP.md` | Architect | Inicialización determinística, sin modos, sin pasos conversacionales |

`docs/ROADMAP.md` también se actualizó (8 cambios — detalle en la sección correspondiente del
propio Roadmap, no se repite acá).

## Decisiones de arquitectura confirmadas (no reabrir sin evidencia nueva)

- **Ownership de Artefactos** (`03`, Regla 10): un único dueño por artefacto, cualquier agente
  puede leer cualquier artefacto pero solo el dueño lo escribe. QA no es dueño de nada — ejecuta y
  diagnostica, no diseña.
- **Circuito de escalamiento con vía única**: todo hallazgo que excede la autoridad de decisión de
  un agente entra siempre por Architect (no rutas directas a cada dueño), y desde ahí avanza en el
  orden normal del pipeline hasta el dueño real — llevando el contexto/hallazgos del agente de
  origen, sin reiniciar todo desde cero.
- **Approval Gate automático por defecto**: el pipeline avanza solo; la vuelta al humano es la
  excepción, reservada a 6 casos taxativos: dato declarativo sin resolver, Regla 9 (producción,
  siempre), tope de 3 reintentos Developer↔QA, agotamiento del circuito de escalamiento (3
  pasadas o hallazgo repetido), aprobación del Roadmap de Releases, riesgo de release demasiado
  grande.
- **Concepto de Release**: conjunto acotado de Features que se implementan y mergean
  secuencialmente. Si el business case es muy amplio, Architect propone un Roadmap de Releases
  (siempre empezando por MVP) y escala al humano una sola vez al inicio — no por Feature.
- **Branching**: rama principal del producto + sub-rama por Feature. Modo A (default): automático
  hasta el push, humano revisa antes de mergear a la rama principal. Modo Auto: también el merge
  es automático. El deploy a producción real es siempre humano, en cualquier modo, sin excepción.
- **Release Plan como artefacto único**: lo que iban a ser "Plan de Implementación", "Test Plan" y
  "secuencia de Features" como tres conceptos sueltos se fusionaron en un solo archivo
  (`09-RELEASE-PLAN-TEMPLATE.md`), dueño Planning — evita la ambigüedad entre "el plan de la
  Feature" y "el plan del release".

## Hallazgos relevantes de esta sesión

- **La persistencia de artefactos de diseño ya está resuelta y construida, no es un problema
  nuevo**: `docs/playbook/02-ARCHITECTURE.md`, sección 5, ya documenta el modelo real (verificado
  contra `migrations/0001_init.sql` y `src/db/repository.ts`, función `recordArtifact`, invocada
  desde `runStart.ts`): código en git vía `commit_ref`, diseño (texto/JSON) en la tabla
  `artifacts` existente. Esto reduce el pendiente real de persistencia solo a la falta de una
  tabla `projects` para modelar múltiples productos gestionados — no a un problema de "archivos vs
  base de datos" en general.
- **El Roadmap ya tenía un ítem ("Approval Model por Release") que se solapaba con el diseño de
  Modo A/Modo Auto de esta Feature** — se actualizó el ítem existente en vez de crear uno
  duplicado.
- **Feature 10 se redefinió al cierre de esta sesión**: dejó de ser "UI mínima de solo lectura"
  (eso quedó como ítem de Roadmap "Capa de UI — Run en curso", Confirmado, todavía sin número de
  Feature asignado) y pasó a ser investigación de persistencia de sesiones/usuarios/proyectos,
  delegada a Codex, no al Architect.

## Pendientes explícitos (no bloqueantes, pero reales)

- **Pasada de consistencia cruzada** de los 12 archivos antes de subir de `v0.1` a `v1.0` — no se
  hizo todavía.
- **Marcador literal `[PENDIENTE-DB-PROJECTS]`** — 9 apariciones en `00`, `01`, `02`, `03`, `04`,
  `AGENTS.md`, `BOOTSTRAP.md`. Reemplazar cuando exista la tabla `projects` (Feature 10
  redefinida).
- **Mecanismo técnico de persistencia de contexto/hallazgos** durante el circuito de escalamiento
  (`06`, Stage 3) — revisar primero si la tabla `run_events` ya existente lo resuelve
  directamente.
- **Dónde vive la ubicación de acceso/repo de cada producto gestionado** dentro del futuro modelo
  de `projects` — ligado al punto anterior.

## Lecciones Aprendidas

Clasificadas según el criterio ya fijado en `06-DELIVERY-WORKFLOW.md`, Stage 7:

**Conocimiento permanente del Runbook** (ya incorporado en los propios archivos, no hace falta
acción adicional):
- Nunca redactar el Runbook comparándolo con "el Playbook de Producto original" — el Orquestador
  que lo lee en producción no tiene ese contexto; cada regla debe leerse autocontenida.
- El patrón de tres capas (Baseline fijo / Configuración Editable decidida por Architect una vez
  por producto / instancia por Feature) se repite en `03`, `04`, `05`, `06` — mantenerlo si se
  agregan archivos nuevos al Runbook.

**Decisiones de arquitectura del proyecto** (quedan en `02-ARCHITECTURE.md` de este mismo repo,
no en el Runbook que gestiona productos de terceros):
- La tabla `artifacts` ya resuelve persistencia de diseño; falta `projects` para multi-producto.

**Conocimiento específico de esta Feature** (contexto de por qué se tomó cada decisión, útil para
no reabrir discusiones ya cerradas, pero no reusable como regla general):
- La corrección del owner sobre "el circuito siempre entra por Architect, un solo camino" fue la
  que destapó y corrigió una inconsistencia real entre la Regla 8 y la Regla 10 de `03`.
- El pedido explícito de un marcador único (`[PENDIENTE-DB-PROJECTS]`) para poder hacer
  find-and-replace más adelante, en vez de dejar redacciones distintas en cada archivo, ahorra
  trabajo real dado el volumen (12 archivos, varios tocados 3+ veces cada uno).

## Decisión final

Feature 09 queda en este estado: diseño completo, commiteado en `main`, **no cerrada
formalmente** — falta la pasada de consistencia cruzada y el bump de versión a `v1.0`, que se
harán en una sesión aparte antes de considerarla terminada en los términos que exige
`06-DELIVERY-WORKFLOW.md` (Stage 7, Post-Release Review) del propio Playbook de este repo.

Esto no bloquea arrancar Feature 10 — al contrario, Feature 10 (investigación y actualización de
base de datos: tabla `projects` y persistencia de sesiones/usuarios) es la que resuelve el
pendiente real que impide cerrar Feature 09 (el marcador `[PENDIENTE-DB-PROJECTS]`). El cierre
formal de Feature 09 queda entonces, a propósito, después del cierre de Feature 10.