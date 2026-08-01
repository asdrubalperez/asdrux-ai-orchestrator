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
  documentada en `docs/features/FEATURE-012-implementation-results.md`. **Matiz (2026-07-29)**:
  persiste el contexto de continuación, pero no unifica un único contrato de reentrada — conviven
  `EscalationContext` (retry en el lugar) y `ReentryContext` (reingreso vía run hijo o cruce de
  pipeline), con campos distintos. Ver Lecciones Aprendidas en
  `docs/features/lecciones-aprendidas/`.
- Feature 09 — Runbook para el Orquestador AI automático: 12 archivos en `docs/runbook/`, v1.0,
  marcador `[PENDIENTE-DB-PROJECTS]` reemplazado por la referencia real a
  `project_config_versions` (FEATURE-011), pasada de consistencia cruzada completa
- Evolución del Playbook: declaración de rama/checkout de origen movida de Stage 6 a Stage 3 en
  `06-DELIVERY-WORKFLOW.md` (v1.2), Lessons Learned de Feature 10
- FEATURE-013 — Capa de UI "Run en curso": 013A backend read-only + UI/SSE, 013B sesiones web,
  013C respuesta a escalamiento desde modal, con validación real en navegador/VPS y documentos de
  diseño/resultados en `docs/features/`
- FEATURE-014 — Autenticación unificada CLI + Web: tabla `sessions`, hash SHA-256 y revocación
  server-side compartidos, TTL único de 48 horas y validación real en VPS; resultados en
  `docs/features/FEATURE-014-implementation-results.md`
- FEATURE-015 — Egress y aislamiento de credenciales OAuth: 015A y 015B ✅ Ejecutadas,
  aceptadas con tests, evidencia real en VPS y revisión conjunta Architect + owner. Las 10
  combinaciones rol/proveedor usan catálogos cerrados sin tools nativas. Diseños y resultados en
  `docs/features/FEATURE-015-egress-aislamiento-oauth-parte-015a-arquitectura-holder-worker.md` y
  `docs/features/FEATURE-015B-Wiring-real-por-rol-y-por-proveedor.md`.
- FEATURE-016 — Modo de autenticación por cuenta personal (OAuth) para Executors: tabla
  `user_agent_config` (global + override por rol), `authMode` (`api_key`/`cli_session`) en ambos
  Executors, flag de CLI `--auth-mode` y resolución de precedencia en `runStart.ts`. Aprobada por
  el owner, verificada independientemente por el Architect y mergeada a `main` (commits `133509d`
  implementación, `fa42d0e` merge). Diseño y evidencia en
  `docs/features/FEATURE-016-auth-oauth-executors.md`.
- FEATURE-017 — Capa de UI — Disparo (intake de caso de negocio asistido por IA): estado nuevo
  `sin_iniciar` en `runs`, mapeo directo al proveedor sin tools, clonado real y aislado del repo
  del caso de negocio, cancelación real reusando el escalamiento de FEATURE-013C, timeouts finales
  por rol. Aprobada por el owner, validada técnicamente por el DAIA y mergeada a `main` (commit
  `eed5e88` implementación principal, `14693c8` merge). Diseño y evidencia en
  `docs/features/FEATURE-017-Capa-de-UI-Disparo-intake-de-caso-de-negocio-asistido-por-IA.md`.
- FEATURE-018 (antes FEATURE-017, antes FEATURE-015) — Wiring real del ciclo Roadmap de Releases
  (Architect) + Release Plan (Planning): Architect declara siempre un Roadmap de Releases (mínimo
  un release MVP) y escala para aprobación humana reusando el mecanismo de escalamiento existente
  (atomicidad real vía `client` compartido en `setProjectConfig`); Planning recibe el release activo
  como contexto y escala si no hay ninguno aprobado; `ReleasePlanPanel` conectado a datos reales;
  6 documentos de gobernanza del Runbook actualizados. Aprobada por el owner tras 3 rondas de
  validación técnica del DAIA y verificación independiente del Architect, mergeada a `main` (commit
  `458c159` implementación, `411f73d` merge). **Alcance final, ajustado durante el
  cierre**: no incluye el disparo automático de "release completo → Architect propone el
  siguiente" (Functional Goal original de la Feature) — se descubrió que el motor de pipeline no
  tiene hoy ningún concepto de "Feature" como dato rastreable ni de múltiples Features ejecutándose
  en secuencia dentro de un release, lo cual excede el alcance de wiring de esta Feature. Ver
  Lecciones Aprendidas más abajo y FEATURE-019/021. Diseño y evidencia en
  `docs/features/FEATURE-018-Wiring-real-del-ciclo-Roadmap-de-Releases-(Architect)-+-Release-Plan-(Planning).md`.
- FEATURE-019 — Modelo de circuitos anidados para el ciclo de releases: Architect gobierna el
  avance entre releases del Roadmap, Planning gobierna la iteración de Features dentro del release
  activo (Developer siempre vuelve a Planning al terminar una Feature, en vez de autogobernarse).
  Implementada y mergeada (commits `2c85221`, `f361a96`). Validación end-to-end incompleta —
  encontró un bug crítico preexistente de pérdida de contexto en reintentos de escalamiento, que
  bloqueó seguir probando y derivó en FEATURE-020. Ver Lecciones Aprendidas en
  `docs/features/FEATURE-019-*.md`.
- FEATURE-020 — Rediseño de cómo se arma el contexto entre roles: lectura de artefactos
  persistidos por referencia (DB) en vez de acumulación en el contexto que viaja entre fases.
  Implementada y mergeada (commit `9d066a8`, más fix de `ramaBaseTrabajoFromBusinessCase` y ajuste
  de texto). Validación end-to-end real: Circuito 1/2/3 funcionaron de punta a punta (incluida la
  primera aprobación de merge en Modo Manual) — encontró un problema real y distinto en el paso de
  build de QA (no relacionado con el diseño de esta Feature), que derivó en FEATURE-021 (ver
  abajo). Ver Lecciones Aprendidas en `docs/features/FEATURE-020-*.md`.
- FEATURE-021 — Build determinístico garantizado por el Orquestador entre Developer y QA:
  build obligatorio separado del test, fallos devueltos a Developer, agotamiento explícito y
  rechazo de operadores de shell en `COMANDO_TEST`. Implementada y cubierta por pruebas; el
  contrato pendiente entre output compilado y ruta de test queda separado en FEATURE-029.
- FEATURE-022 — Lectura universal de artifacts por todos los roles: todos los roles pueden
  descubrir y leer bajo demanda cualquier artifact del proyecto del run actual mediante
  `artifact_list` y `artifact_read`, con aislamiento por proyecto, acceso read-only y sin
  acumulación automática de contexto. Implementada, validada técnicamente y mergeada a `main`
  (`4e4f209`). Validación funcional punta a punta completada junto con FEATURE-023 Parte 1 y
  Parte 2 mediante prueba E2E real del owner (2026-07-29, caso de negocio real), después del
  bloque correctivo de runtime de circuitos — ver Lecciones Aprendidas en
  `docs/features/lecciones-aprendidas/`. Ver
  `docs/features/FEATURE-022-Lectura-universal-de-artifacts-por-todos-los-roles.md` y
  `docs/features/FEATURE-022-implementation-results.md`.
- FEATURE-023 — Parte 1 — Lifecycle canónico de Features basado en
  `docs/runbook/07-FEATURE-TEMPLATE.md`: implementación y validación automatizada completas.
  E2E real completado por el owner el 2026-07-29 (caso de negocio real), después de resolver
  FEATURE-023 Parte 2 y el bloque correctivo de runtime de circuitos.
- FEATURE-023 — Parte 2 — Distribución, versionado y disponibilidad del Runbook en runtime:
  implementada. Validada por evidencia empírica real en la prueba E2E conjunta del 2026-07-29 —
  el Approval Gate de diseño formal nunca se cerró explícitamente (ver
  `docs/research/FEATURE-023-revision-tecnica-y-validacion.md`, bloqueos B1-B10 sin resolución
  documentada), pero el comportamiento quedó validado contra un caso real. Queda como deuda
  documental cerrar formalmente ese Gate o registrar por qué se considera superado por la
  evidencia.
- FEATURE-024 (antes FEATURE-023, antes FEATURE-022, antes FEATURE-021, antes FEATURE-019, antes
  FEATURE-018, antes FEATURE-017, antes FEATURE-014) — Milestone 2 — Validación end-to-end con
  caso de negocio real: ejecutada mediante prueba de usuario real (2026-07-29, proyecto
  `tempo-auto-planner`), sin necesidad de una Feature de producto nueva. Validó de punta a punta
  el circuito completo (merge de Feature → run hijo → Planning → Gate de cierre → proyecto
  cerrado). Ver Lecciones Aprendidas en `docs/features/lecciones-aprendidas/`.
- FEATURE-031 — Mapping confiable de `tipo_solucion` y simplificación de `canales`: reglas de
  clasificación explícitas (negación, distinción entre solución objeto de la iniciativa y
  soluciones de terceros/sistemas relacionados, ambigüedad → vacío) inyectadas al prompt del
  mapper, más validación de dominio en código para `tipo_solucion` (`nueva`/`mejora_existente`/
  vacío, sin importar lo que devuelva el modelo). `canales` pasa de `field_type = list` a
  `textarea` — sin lógica de compatibilidad histórica: se confirmó contra la base real que ningún
  caso persistido tiene `canales` como array antes de implementar, evitando esa parte del alcance
  original propuesto por el diseño. Validada por el owner en VPS (2026-07-30) además de la suite
  automatizada. Diseño original de ARIA (AI Product Architect).
- FEATURE-029 — Contrato determinístico entre build output y `COMANDO_TEST`: prevalidación entre
  el build y la invocación de QA (`src/testing/testCommandContract.ts`), soporta script de
  `package.json` y `node --test` con rutas explícitas. Validada con 13 tests automatizados
  (unitarios + integración del loop); dos intentos de validación E2E real (2026-07-30) no
  reprodujeron el escenario — ver detalle abajo sobre por qué. Diseño original de ARIA (AI Product
  Architect), con una corrección aplicada antes de implementar (el mensaje de error no debe
  sugerirle a Developer tocar `COMANDO_TEST` — Regla 4 de `developer.txt` se lo prohíbe
  explícitamente).
- FEATURE-032 — Instalación determinística de dependencias antes del build: nuevo
  `DependencyInstaller` (`src/testing/dependencyInstaller.ts`) corre entre Developer y
  `BuildExecutor`, con acceso a red y caché npm escribible explícita; `npm ci` con lockfile,
  `npm install` sin él; nuevo motivo `dependencyInstallationFailureReason`, primero en la cadena de
  exclusión mutua del loop. Ampliación aprobada antes de implementar: timeouts configurables para
  los tres pasos del loop (`BUILD_TIMEOUT_MS`, `TEST_TIMEOUT_MS`, `DEPENDENCY_INSTALL_TIMEOUT_MS`).
  Validada con suite automatizada (5 tests unitarios + 1 de integración) y con una prueba E2E real
  en VPS (2026-07-30, proyecto `pruebas-ia`) que ejercitó tanto el camino de fallo (un
  `package.json` con BOM inválido, correctamente atribuido a instalación y no a build) como el
  camino exitoso (instalación real de `typescript` vía `npm ci`, build con `tsc` real, y un fallo
  de build genuino y distinto — `TS2307`— correctamente atribuido por separado), hasta la
  aprobación de QA y el escalamiento de merge. Diseño original de ARIA (AI Product Architect).
- FEATURE-036 — Release activo nominal tras cierre de proyecto sin release siguiente:
  `activeReleaseId` pasa de `string` a `string | null`; el validador de `RoadmapApprovalPayload`
  exige el invariante cruzado (ID no nulo ⇒ exactamente un release `Activo` con ese ID; `null` ⇒
  cero releases `Activo`); `activeReleaseFromRoadmap` filtra también por estado; el cierre del
  último release (sin siguiente pendiente) persiste `activeReleaseId: null` en vez de dejarlo
  apuntando al release recién completado; `runView.ts`/`ReleasePlanPanel.tsx` muestran "Sin release
  activo" sin usar el último release como fallback. Validada con 14 tests automatizados y con E2E
  real en VPS (2026-07-30/31, proyecto `pruebas-ia`, Roadmap de dos releases): primer intento
  reprodujo el bug original (Orquestador apuntando por error a otra rama sin el fix), repetido en la
  rama correcta confirmó el cierre correcto de punta a punta. Incluye una corrección aparte
  descubierta durante esa misma validación (`getReleasePlansByRelease` mezclaba historial de ciclos
  de prueba no relacionados — acotado ahora por `root_run_id`). Diseño original de ARIA (AI Product
  Architect), aprobado con una corrección de orden (revisar datos reales antes de endurecer el
  validador — 0 roadmaps vigentes inconsistentes encontrados). Detectó además dos hallazgos
  separados del ciclo de vida del Release Plan: Features de un release anterior reapareciendo en el
  siguiente (scope de FEATURE-028) y el último Feature de un release nunca marcado `Completada`
  (FEATURE-038, ver abajo).
- FEATURE-038 — Persistencia del estado final del Release Plan al cerrar un release:
  `persistReleasePlanIfDeclared` solo actuaba con `status = completed`, así que el `RELEASE_PLAN`
  final que Planning declaraba correctamente al cerrar (`RELEASE_COMPLETO`, `status = escalated`)
  nunca se persistía — la última Feature quedaba `"En curso"` para siempre pese a la aprobación de
  QA. Nueva función pura `validateFinalReleasePlanTransition` valida el cierre contra el Release
  Plan vigente de entrada (mismo objeto que ya vio Planning, sin relectura de la base — sin ventana
  de carrera); cierre inconsistente escala con `FeatureLifecycleEscalationError`, nunca error
  genérico. Validada con 16 tests automatizados y con E2E real en VPS (2026-07-31, proyecto
  `pruebas-ia`): consulta directa a `project_config_versions` confirmó el `RELEASE_PLAN` final
  persistido con la Feature `"Completada"` segundos antes de la respuesta humana al Gate, tanto para
  el cierre de un release intermedio como del último release del proyecto. Diseño original de ARIA
  (AI Product Architect), Discovery cerrado junto con FEATURE-028 (que absorbe el otro síntoma —
  Features de un release anterior reapareciendo en el siguiente).
- FEATURE-028 — Release Plan asociado inequívocamente al Release activo: `withRoleContext` armaba
  `activeRelease`/`releasePlan` de fuentes independientes sin verificar que pertenecieran al mismo
  release. Nueva consulta `getReleasePlanAssociationCandidate` (reutiliza el CTE `current_epoch` de
  `getReleasePlansByRelease`, FEATURE-036) resuelve el `activeReleaseId`/`root_run_id` pinneados en
  el run que escribió el `release_plan` vigente; nueva función pura
  `resolveReleasePlanForActiveRelease` exige coincidencia de release **y** de ciclo de negocio —
  `releasePlan: null` cuando no coincide, sin borrar ni alterar el historial. No se agregó
  `releaseId` al contrato de Planning. Validada con 7 tests automatizados y con E2E real en VPS
  (2026-07-31, mismo caso de propinas que en un intento anterior había disparado la contaminación
  cruzada): la propia bitácora de Planning confirmó textualmente *"Es la primera invocación para el
  release r2 (releasePlan viene null...)"*, sin ningún rastro de Features del release anterior.
  Diseño original de ARIA (AI Product Architect), Discovery cerrado junto con FEATURE-038.
- FEATURE-037 — Entrega gobernada de reglas del Runbook a Planning, Developer y QA: en cada
  invocación relevante, Planning recibe `governance.testingPolicy` (`04-TESTING-POLICY.md`, del
  cual es dueño/consultor directo) para traducirlo al Test Plan de la Feature; Developer recibe
  `governance.codingStandards` (`05-CODING-STANDARDS.md`, del cual es dueño/consultor directo) en
  cada intento incluido el turno de readiness; QA solo recibe el Test Plan vigente, sin ninguno de
  los dos documentos completos — evita múltiples fuentes normativas simultáneas. Entrega fresca sin
  caché entre invocaciones; `TESTING_POLICY_ASSET`/`CODING_STANDARDS_ASSET` agregados a
  `REQUIRED_RUNBOOK_ASSETS` (fallo cerrado si faltan); namespace `governance` protegido contra
  sobrescritura por contexto no confiable; auditoría por evento con solo metadata (rol, path,
  versión, hash). Validada con 20 tests automatizados y con E2E real en VPS (2026-07-31, caso real
  de `tempo-auto-planner` con integración externa): el evento `runbook_governance_delivered` se
  registró en cada invocación de Planning y Developer a lo largo de tres Features, confirmando
  entrega fresca y consistente. Diseño original de ARIA (AI Product Architect), aprobado con dos
  correcciones de redacción (la entrada original del Roadmap era ambigua, no decía literalmente lo
  que el diseño corregía; el patrón de `runbookProvider.readText` para Functional no es precedente
  de inyección pre-invocación — FEATURE-037 introduce ese patrón).

**🟡 Confirmado**
- FEATURE-025 — Selección de proveedor/modelo/credenciales por rol (promovida de ⚪ Tentativo)
- FEATURE-026 — Credenciales git por usuario para el Orquestador (promovida de ⚪ Tentativo)
- FEATURE-027 — Continuidad durable del loop Developer ↔ QA. Prioridad P0.
- FEATURE-030 — Proyecto del Orquestador asociado correctamente al repositorio gestionado.
  Prioridad P1.
- FEATURE-033 — Lifecycle canónico de `01-PROJECT-BRIEF-TEMPLATE`.
- FEATURE-034 — Lifecycle canónico de `02-ARCHITECTURE-TEMPLATE`.
- FEATURE-035 — Lifecycle canónico de `09-RELEASE-PLAN-TEMPLATE`.
- FEATURE-039 — La Regla 11 de `04-TESTING-POLICY.md` ("Riesgo de Contrato Externo No Resuelto
  Escala, No Se Re-anota") no se aplica estructuralmente — nada en el runtime detecta que el mismo
  riesgo de contrato externo se repite entre Features y fuerza un escalamiento; queda enteramente a
  criterio del LLM en cada turno. Detectado en la validación E2E de FEATURE-037 (2026-07-31, caso
  real de `tempo-auto-planner`): el mismo riesgo (endpoint/campo real de Tempo para autorización,
  diferido a "validación experimental") se repitió sin resolución entre `f1` y `f3`, y QA lo aceptó
  como "known risk" ambas veces sin escalar. Prioridad por definir.
- FEATURE-040 — Los Gates de gobernanza que no son ambigüedad/Roadmap (aprobación de merge,
  cierre de release sin release siguiente) son binarios: cualquier respuesta no-abort los ejecuta
  incondicionalmente, sin reinyectar el texto de la respuesta humana a ningún rol para pedir una
  corrección — a diferencia de las escalaciones genéricas, que sí se reinyectan vía el mecanismo de
  reingreso. En `respondMergeApproval` el texto al menos queda guardado como metadata de auditoría;
  en el cierre de release sin release siguiente (`respondService.ts:190`, evento `project_closed`)
  ni siquiera eso — el texto no se persiste en ningún lado. No hay forma de "rechazar con feedback y
  reintentar" en ninguno de los dos. Detectado durante la validación de FEATURE-037 (2026-07-31,
  caso `tempo-auto-planner`, primero en el Gate de merge y confirmado de nuevo en el Gate de cierre
  de release). Prioridad por definir.
- FEATURE-041 — Creación y gestión de cuentas de usuario (self-service). Hoy no existe ningún flujo
  de registro real — el único mecanismo es `seed:user` (comando CLI de administración manual, sin
  UI). La tabla `users` no tiene columnas de perfil (correo, nombre, apellido), solo `id`, `handle`,
  `password_hash`, `created_at`. Prioridad por definir.
- FEATURE-042 — Creación y gestión de proyectos ("Mis proyectos"). Hoy no existe ningún flujo de
  creación de proyectos — el único `insert into projects` en todo el código es un backfill de
  migración (`migrations/0003_users_projects_phase_b.sql`) que crea un único proyecto fijo. Cada run
  reutiliza ese proyecto (o el más antiguo del usuario, ver FEATURE-030) sin que exista una forma de
  crear uno nuevo explícitamente. Relacionado con FEATURE-030, que corrige el síntoma de reuso
  incorrecto pero no resuelve la ausencia de un flujo de creación. Prioridad por definir.
- FEATURE-043 — Separar el caso de negocio del repositorio/rama en el formulario de intake. Hoy los
  12 campos de `intake_field_definitions` (10 descriptivos del caso de negocio + `repositorio` +
  `rama_base_trabajo`) viven en la misma tabla plana, mismo `field_order` secuencial, renderizados
  juntos en el mismo modal (`ReviewModal.tsx`), sin ninguna separación estructural — son
  conceptualmente dos cosas distintas: la descripción del caso de negocio y la configuración técnica
  del repositorio destino. Prioridad por definir.

**⚪ Tentativo**
- Escalamiento optimizado sin reinicio completo
- Planning valida la Feature de Functional antes de diseñar el Release Plan — hoy Stage 2 de
  `docs/runbook/06-DELIVERY-WORKFLOW.md` dice que Planning "parte de los 3 escenarios que Functional
  entregó — no los redefine desde cero", sin un paso explícito de análisis/validación de lo que
  Functional entregó antes de diseñar el cómo. Propuesta a explorar en Discovery aparte: que
  Planning analice y valide activamente la Feature de Functional (ambigüedades, dependencias entre
  Features del release, huecos) antes de diseñar el Release Plan. Complementa (no reemplaza) al
  ítem "Escalamiento optimizado sin reinicio completo".
- Approval Model por Release
- Concurrencia de runs simultáneos
- Limpieza automática de worktrees/branches vencidos
- `PreToolUse` hooks como defensa en profundidad (QA)
- Creación real de PR vía API de GitHub / merge automático
- Deployment Strategy y separación dev/staging/prod
- Capa de UI — Historial/admin (listado de runs, sin diseñar)
- Notificación Slack/webhook complementaria a la UI de monitoreo (post FEATURE-013, si hace falta
  alertas fuera de cuando se está mirando activamente)
- Limpieza de persistencia de codigo versionado: `artifacts.commit_ref` existe en schema pero no se
  puebla nunca; los commits reales quedan hoy solo en `run_events`.

---

## Priorización — Matriz Esfuerzo × Impacto

Ponderación de los ítems 🟡 Confirmado (más FEATURE-028/029/032/036/037/038, ya ✅ Ejecutado,
dejados aquí como referencia histórica de la corrida de priorización). Ordenada por Ponderación
(Alta → Media → Baja) y, dentro de cada nivel, por Impacto y luego por Esfuerzo.

| Elemento | Esfuerzo | Impacto | Ponderación |
|---|---|---|---|
| FEATURE-028 — Release Plan asociado al Release activo (P1) | Medio | Alto | Alta |
| FEATURE-030 — Proyecto asociado al repositorio gestionado (P1) | Medio | Alto | Alta |
| FEATURE-025 — Selección proveedor/modelo/credenciales por rol | Medio | Medio | Alta |
| FEATURE-032 — Instalación determinística de dependencias (P2) | Medio | Medio | Alta |
| FEATURE-037 — Entrega gobernada de reglas del Runbook a Planning/Developer/QA (nuevo) | Medio | Medio | Alta |
| FEATURE-038 — Persistencia del estado final del Release Plan al cerrar un release (nuevo) | Medio | Medio | Alta |
| FEATURE-039 — Regla 11 de Testing Policy (riesgo de contrato externo repetido) no se aplica estructuralmente (nuevo) | Medio | Medio | Alta |
| FEATURE-040 — Gates de merge/cierre de release sin camino de rechazo con feedback correctivo (nuevo) | Medio | Medio | Alta |
| FEATURE-027 — Continuidad durable Developer↔QA (P0) | Alto | Alto | Alta |
| FEATURE-041 — Creación y gestión de cuentas de usuario (self-service) (nuevo) | Alto | Alto | Alta |
| FEATURE-042 — Creación y gestión de proyectos ("Mis proyectos") (nuevo) | Alto | Alto | Alta |
| FEATURE-026 — Credenciales git por usuario | Alto | Medio | Alta |
| FEATURE-033 — Lifecycle 01-PROJECT-BRIEF-TEMPLATE | Alto | Bajo | Media |
| FEATURE-034 — Lifecycle 02-ARCHITECTURE-TEMPLATE | Alto | Bajo | Media |
| FEATURE-035 — Lifecycle 09-RELEASE-PLAN-TEMPLATE | Alto | Bajo | Media |
| FEATURE-036 — Release activo nominal tras cierre (P1) | Bajo | Medio | Baja |
| FEATURE-029 — Contrato build output / COMANDO_TEST (P1) | Bajo | Bajo | Baja |
| FEATURE-043 — Separar caso de negocio de repositorio/rama en el intake (nuevo) | Bajo | Bajo | Baja |

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

### ✅ FEATURE-014 — Autenticación unificada CLI + Web (48h, mecanismo server-side compartido)
CLI y web usan la misma tabla `sessions`, generación/hash de token, validación server-side y TTL
de 48 horas. El CLI conserva el secreto en `~/.orquestador/session.json`, pero la identidad y
vigencia se determinan desde DB. Validado con 24/24 tests, build completo y flujo real en VPS:
login, `run:status`, logout y rechazo de una copia restaurada del archivo después de revocar la
fila. Ver `docs/features/FEATURE-014-implementation-results.md`.

### ✅ FEATURE-015 — Egress y aislamiento de credenciales OAuth

Estado: 015A ✅ Ejecutada; 015B ✅ Ejecutada. FEATURE-015 completa y aceptada; el prerequisito de FEATURE-016 está satisfecho.

Reemplaza al ítem Tentativo anterior "Egress de red con allowlist fino (Developer)". Ya no está
acotada a Developer — corrección respecto a la formulación original.

**Hallazgo que motivó la corrección**: el canal de fuga relevante no es solo "Bash + egress sin
restricción" (el que motivó la investigación original). Existe además un **canal de respuesta**:
cualquier rol con herramientas de lectura (`Read`/`Grep`/`Glob`) puede ser inducido, vía prompt
injection, a leer el caché de credenciales OAuth y devolverlo dentro de su propia respuesta de
texto al proveedor — sin que haya tráfico de red de por medio. Este canal aplica a los 5 roles
(Architect, Functional, Planning, QA, Developer) por igual, con o sin Bash.

**Asimetría histórica corregida entre proveedores**: antes de 015B, Codex mantenía
`shell_tool` para Architect/Functional/Planning y Claude Code carecía de tools de red para esos
roles. 015B eliminó ambas discrepancias: todos los roles usan el runtime aislado y ningún
proveedor conserva tools nativas ejecutables.

**Requisito funcional confirmado por el owner**: Architect, Functional y Planning deben poder
investigar en internet como parte de su rol — en los dos proveedores por igual, protegido (vía
holder/worker), no bloqueado.

Desdoblada en dos partes **secuenciales** (015B depende de 015A, a diferencia del intento fallido
de desdoblar FEATURE-016 en partes independientes — ver abajo):

- **✅ 015A — Arquitectura holder/worker genérica — Ejecutada**: protocolo holder↔worker,
  adaptador Claude Code (holder ejecutado con `--tools ""` + MCP remoto expuesto por el worker),
  adaptador Codex (holder vía `codex app-server` + `dynamicTools`, sin
  `command/exec`/`process/spawn`). Validada con spikes acotados, sin credenciales reales. No
  habilita ningún rol real todavía — es la base de la que depende 015B.
- **✅ 015B — Wiring real por rol y por proveedor — Ejecutada**: las 5 combinaciones de rol
  × 2 proveedores usan el catálogo cerrado aprobado. Architect/Functional/Planning disponen de
  `fs_read`, `fs_search`, `fs_glob`, `web_search` y `web_fetch`; QA conserva solo las tres
  tools de lectura; Developer agrega `fs_write`, `fs_edit` y `command_exec`. Validada con 55/55
  tests en VPS, ocho smokes reales con Tavily y pipelines completos Claude/Codex. Ver
  `docs/features/FEATURE-015B-part1-results.md`, `part2-results.md` y `part3-results.md`.

Prerequisito de FEATURE-016 completo: satisfecho. El bloqueo por dependencia de FEATURE-015 queda
levantado — ver detalle de FEATURE-016 más abajo (✅ Ejecutada).

### ✅ FEATURE-016 — Modo de autenticación por cuenta personal (OAuth) para Executors
**Se revierte el desdoblamiento anterior en 016A/016B**: asumía que Architect/Functional/Planning/
QA no tenían el mismo perfil de riesgo que Developer por no tener Bash, y que por eso una parte de
la Feature podía implementarse sin depender de FEATURE-015. Esa premisa era incorrecta (ver
FEATURE-015, arriba: canal de respuesta + asimetría real de Bash entre proveedores). Vuelve a ser
una sola Feature, completa, dependiente de FEATURE-015 (015A+015B) sin excepciones por rol.

La investigación empírica ya confirmó reuso headless entre procesos y portabilidad del archivo de
credenciales desde un `HOME` alternativo. Ver
`docs/research/investigacion-auth-cuenta-personal-executors.md` v1.1.

Forma arquitectónica ya resuelta en el análisis (no reabrir sin motivo): NO crear Executors
nuevos por proveedor — agregar un parámetro `authMode` (`"api_key"` | `"cli_session"`) a las
opciones ya existentes de `ClaudeCodeExecutor`/`CodexExecutor`, default `"api_key"` sin cambiar
nada del comportamiento actual. El contrato `Executor` (`src/contracts/executor.ts`) no cambia.

El diseño formal (v2, aprobado) queda en `docs/features/FEATURE-016-auth-oauth-executors.md` (el
archivo de diseño de 016A generado en una sesión anterior, evaluado y no aprobado, queda como
referencia histórica de un alcance descartado — ver
`docs/features/FEATURE-016-auth-oauth-executors-parte-016a-infraestructura-roles-sin-bash.md`, no
se elimina, pero no representa el alcance vigente). El prerequisito FEATURE-015 (015A+015B) para
`cli_session` ya está satisfecho.

**Estado (2026-07-25): ✅ Ejecutada.** Aprobada por el owner, implementada en la rama
`feature/016-auth-oauth-executors` (commit `133509d`), verificada de forma independiente por el
Architect (migración, repositorio, ambos Executors, `runStart.ts`, typecheck y 53/55 tests
re-corridos, no solo el reporte del DAIA) y mergeada a `main` en `fa42d0e` ("Merge FEATURE-016:
modo de autenticación por cuenta personal (OAuth) para Executors"). La rama se conserva como
referencia histórica, mismo criterio que `feature/015a-*`/`feature/015b-*`.

Qué se implementó: tabla `user_agent_config` (migración `0008_user_agent_config.sql`, global +
override por rol), funciones de repositorio (`resolveAgentConfig` aplica la precedencia), rama
`authMode` en ambos Executors (mount de solo lectura del caché OAuth dedicado, `CODEX_HOME` +
`type:"chatgpt"` para Codex, sin `--bare` + `--setting-sources ""` para Claude Code), flag de CLI
`--auth-mode` y resolución de precedencia (flag > override de rol > global > default) en
`runStart.ts`.

Dos ítems quedan documentados como pendientes en `docs/features/FEATURE-016-auth-oauth-executors.md`
(secciones 8 y 9) — no bloquearon este merge, pero son los primeros a resolver antes de usar
`cli_session` en un run real de producción: (1) todavía no se corrió un turno real end-to-end
dentro de contenedor con una sesión OAuth real montada como caché; (2) `CODEX_HOME` se monta
íntegro de solo lectura y Codex también lo usa para logs/sqlite — riesgo de que falle al intentar
escribir ahí, sin probar todavía con un turno real de Codex en `cli_session`.

### ✅ FEATURE-018 (antes FEATURE-017, antes FEATURE-015) — Wiring real del ciclo Roadmap de Releases + Release Plan
Implementada, validada (3 rondas de validación técnica del DAIA + verificación independiente del
Architect contra el repo real, incluyendo typecheck y suite completa de tests corridos de forma
independiente) y mergeada a `main` (commit `458c159` implementación, `411f73d` merge). Distinto de
"Approval Model por Release" (ese es sobre quién aprueba el avance de etapas; este es sobre qué
contenido de planificación de releases se genera y muestra).

**Alcance final entregado**: Architect declara siempre un Roadmap de Releases (mínimo un release
MVP) como parte de su salida normal, y escala para aprobación humana — reusando el mecanismo de
escalamiento existente, distinguido por contenido (`ROADMAP` presente en `outputArtifact`, mismo
patrón que `comandoTest`) en vez de un tipo de acción nuevo. La aprobación persiste la nueva versión
en `project_config_versions` (`config_key = "release_roadmap"`) y crea el child run en una única
transacción real (`setProjectConfig` acepta `client?: PoolClient`, mismo patrón que
`getCurrentProjectConfigs`/`createRun`). Planning recibe el release activo como contexto
(`activeRelease`) y escala si no hay ninguno aprobado. `ReleasePlanPanel` conectado a datos reales
vía `GET /runs/:id` extendido (sin ruta nueva). 6 documentos de gobernanza del Runbook actualizados
para reflejar que el roadmap ya no es condicional.

**Excluido del alcance final** (ajuste hecho al cierre, no estaba en el documento de Diseño
original): el disparo automático de "release completo → Architect propone el release siguiente"
(Functional Goal original de la Feature). Se descubrió, ya con la implementación validada, que:
- El motor de pipeline (`src/pipelines/definitions.ts`) no tiene ningún concepto de "Feature" como
  dato rastreable — hoy es prosa dentro del artefacto de texto de Planning, no un registro con
  estado.
- El loop de fases (`PipelineSpec.definition.loop`) es deliberadamente de un solo tipo
  (Developer↔QA, decisión de FEATURE-005) — no soporta hoy que Planning itere múltiples Features
  de un release, ni que Architect sea re-invocado automáticamente al cerrar uno.
- El texto de Developer en `08-CODE-SYSTEM-PROMPT.md` ("si hay Feature siguiente, continúa por su
  cuenta") tiene además una tensión real con la Regla 10 (Ownership de Artefactos: el Release Plan
  es propiedad de Planning, no de Developer).

**Lecciones Aprendidas**: este hallazgo, surgido en la revisión de cierre de FEATURE-018, derivó en
una Feature nueva — FEATURE-019 (rediseño del ciclo de ejecución de releases/Features, con
Planning gobernando la iteración y Architect gobernando el avance entre releases). La adaptación de
esta Feature al mecanismo resultante (originalmente reservada bajo el número FEATURE-021) terminó
absorbida sin trabajo propio por la implementación real de FEATURE-019/020 — verificado en
`08-CODE-SYSTEM-PROMPT.md`/`06-DELIVERY-WORKFLOW.md`, ya reflejan el modelo nuevo; ese número se
reutilizó para una Feature distinta (ver FEATURE-021 actual). El patrón de reusar mecanismos ya
probados (atomicidad vía `client` compartido, distinción de escalamiento por contenido en vez de
un campo nuevo) siguió dando resultado en esta Feature, igual que en ciclos anteriores.

### ✅ FEATURE-019 — Modelo de circuitos anidados para el ciclo de Releases y Features
Surge de la revisión de cierre de FEATURE-018 (ver Lecciones Aprendidas ahí). Modelo acordado con
el owner (diagramas AS IS / TO BE, tres circuitos anidados):
- Circuito 1 (Roadmap de Releases): Architect → Functional → Circuito 2. Salida natural (no hay
  más releases) → Usuario (proyecto cerrado). Architect gobierna el avance entre releases.
- Circuito 2 (Release Plan): Planning → Circuito 3, repetido por cada Feature del release activo.
  Salida natural (no hay más Features) → Architect (dispara la propuesta/aprobación del release
  siguiente). Planning gobierna la iteración de Features — Developer nunca se autogobierna entre
  Features, siempre vuelve a Planning (resuelve la tensión con la Regla 10, Ownership de
  Artefactos, que tenía el texto actual de Developer en `08-CODE-SYSTEM-PROMPT.md`).
- Circuito 3 (Feature Implementation): Developer↔QA, sin cambios respecto al loop ya existente.
  Salida natural (QA aprueba, Developer commitea y pushea) → Planning, no termina el run.
- Reintento (hasta 3) y Escalada a humano se mantienen exactamente iguales a hoy (Regla 8.3/8.4),
  aplicando uniformemente sin importar en qué circuito ocurra el problema — no se toca ese
  mecanismo, solo se generaliza su punto de entrada.

Implementada (commit `2c85221`), con 2 correcciones propias encontradas durante la implementación
y ya incluidas (commit `f361a96`): `projectRepoRoot` ambiguo (bug preexistente de FEATURE-018) y
colisión de worktree en `mergeFeatureBranchIntoBase`. Mergeada a `main`. Validación end-to-end
incompleta: la prueba real del owner validó Circuito 1 pero encontró un bug crítico preexistente
en el mecanismo genérico de reintento de escalamiento (pérdida del `business_case` original), que
bloqueó seguir validando Circuito 2/3 de punta a punta. Ver Lecciones Aprendidas en
`docs/features/FEATURE-019-*.md` y FEATURE-020 (rediseño derivado del hallazgo).

**Corrección de runtime (2026-07-29)**: la prueba E2E real detectó que el retry automático de
escalamiento (`handleLinearEscalation`) no podía volver a Architect cuando ocurría dentro de
`PLANNING_TO_QA` (Circuito 2/3, sin esa fase) — reiniciaba el propio pipeline en el lugar en vez
de cruzar hacia Architect. Corregido en el bloque correctivo de runtime de circuitos (rama
`fix/circuit-escalation-context-and-gates`). Ver Lecciones Aprendidas en
`docs/features/lecciones-aprendidas/`.

### ✅ FEATURE-020 — Rediseño de armado de contexto entre roles (lectura por referencia desde DB)
Surge de un hallazgo real durante la prueba E2E de FEATURE-019 (ver su Lecciones Aprendidas): el
mecanismo genérico de reintento de escalamiento pierde el `business_case` original porque
`buildEscalationContext`/`currentInitialContext` reemplazan el contexto completo en vez de
mergearlo. El owner señaló que el problema es más general: cualquier borde entre roles que dependa
de contexto acumulado en vez de leer artefactos persistidos por referencia tiene el mismo riesgo —
ej. Developer↔QA (QA le devuelve a Developer un error puntual; Developer necesita poder recuperar
la Feature completa, no solo el error, sin que se la tengan que re-adjuntar a mano).

Principio de diseño a aplicar: escritura de un artefacto es de su rol dueño (Regla 10, Ownership de
Artefactos); lectura debería estar abierta a cualquier rol que la necesite, resuelta por el
orquestador al armar el contexto de cada invocación (no por acumulación). El patrón ya existe
parcialmente — `withActiveReleaseContext` (FEATURE-018) resuelve esto para Planning, leyendo
`release_roadmap` fresco de la DB en cada invocación en vez de esperar que venga arrastrado.
Generalizar este patrón a los demás bordes: reintento de escalamiento (cualquier rol), Developer↔QA,
y cualquier otro punto donde hoy se pase contenido completo en vez de una referencia resuelta.

Implementada y mergeada (commit `9d066a8` implementación, más el fix de
`ramaBaseTrabajoFromBusinessCase` y el ajuste de terminología "el humano" → "el usuario",
`docs/features/FEATURE-020-*.md`). 4 rondas de validación técnica (Go condicionado en las 2
primeras, Go técnico limpio en la 3ª) más un hallazgo real durante la implementación (Planning
nunca pasa el contexto de reingreso — alimenta al loop Developer↔QA, Regla 10b) resuelto con el
owner antes de mergear. Validación end-to-end real del owner contra la VPS: los tres circuitos
(Roadmap/Architect, Release Plan/Planning, Feature Implementation/Developer↔QA) funcionaron de
punta a punta, incluida la primera aprobación de merge real en Modo Manual — algo que FEATURE-019
no había llegado a probar. La prueba encontró un problema real y no relacionado con el diseño de
esta Feature (el paso de compilación de `COMANDO_TEST` no puede correr en el sandbox de solo
lectura de QA), que derivó en FEATURE-021 (ver abajo). Ver Lecciones Aprendidas en
`docs/features/FEATURE-020-*.md` para el detalle completo de los 3 hallazgos de implementación.

**Corrección de runtime (2026-07-29)**: la prueba E2E real (después de este bloque de fixes)
confirmó que `withRoleContext` envolvía `{ featureJustCompleted }` dentro de `functionalArtifact`,
violando la Regla 5 de `planning.txt` (exige el campo a nivel raíz). Corregido junto con la
clasificación de Approval Gates antes del retry genérico y la paridad Codex de los extractores de
Gate. Ver Lecciones Aprendidas en `docs/features/lecciones-aprendidas/`.

### ✅ FEATURE-021 — Build determinístico garantizado por el Orquestador entre Developer y QA
Surge de un hallazgo real durante la prueba E2E de FEATURE-020: `COMANDO_TEST` (declarado por
Planning) incluía un paso de compilación (`npm run build && node --test dist/...`). El sandbox de
QA es intencionalmente de solo lectura (`qaPolicy.ts`, `qaRuntime.ts`, Regla 10 — QA valida, no
produce) — cualquier intento de recompilar ahí falla con `EROFS`, sin importar que Developer ya
haya compilado en su propio turno (mismo `worktree.worktreePath`, sin clon separado). Además, el
`&&` en `COMANDO_TEST` expone un bug real y confirmado en `parseTestCommand`
(`src/testing/testExecutor.ts:104`): divide el comando solo por espacios, sin soporte de shell real
(`spawn(..., { shell: false })`, deliberado desde FEATURE-006 por seguridad — nunca debe
reintroducirse un shell real que interprete `COMANDO_TEST` como string, reabriría el riesgo de
inyección que esa Feature cerró) — npm reenvía los tokens sobrantes al script `build`, causando
`TS5042` cada vez que `COMANDO_TEST` tiene `&&`, en cualquier proyecto con paso de compilación.

Se evaluaron 3 opciones (análisis completo de Claude Code):
- QA puede escribir/compilar: descartada — no aporta nada que la opción elegida no dé gratis, y
  amplía la superficie de un rol cuyo valor específico (FEATURE-006, resuelve H14) es ser el
  extremo minimal/read-only del pipeline.
- QA nunca recompila, confía en lo que Developer dejó: viable a corto plazo (Developer ya tiene
  `command_exec`/escritura en su propio turno) pero reintroduce disciplina de prompt sin garantía
  estructural — un `dist/` desactualizado generaría un falso positivo de aprobación, no un
  escalamiento visible. Riesgo más alto que otras convenciones H12 ya toleradas.
- El Orquestador garantiza el build, como infraestructura (elegida): un componente nuevo (no
  reusar `TestExecutor`, que también es `:ro`) monta el worktree con `:rw` entre el turno de
  Developer y el de QA, corre `npm run build` por convención (si existe `scripts.build` en el
  `package.json` del worktree — no un campo nuevo que Planning tenga que declarar bien, eso
  reintroduciría el mismo riesgo que se busca eliminar), no-op limpio si no hay paso de
  compilación. Un build roto se trata como responsabilidad de Developer (Regla 10) — alimenta el
  error al mismo Developer en el mismo intento, reusando el contador de `maxAttempts` ya existente,
  sin gastar un turno de QA.

Con esta opción, `COMANDO_TEST` deja de necesitar `&&` por construcción — el disparador del bug de
`parseTestCommand` desaparece. Queda como ítem chico de deuda técnica (no bloqueante, incluido en
el alcance de esta misma Feature): que `parseTestCommand` rechace explícito (`throw`) si detecta
`&&`/`;`/`|` en el string, en vez de pasarlo tal cual a `spawn` con resultados confusos.

Implementada y cubierta por pruebas. FEATURE-021 resolvió la ejecución obligatoria del build entre
Developer y QA, la separación build/test, el rechazo de operadores de shell y el tratamiento del
fallo de build como responsabilidad de Developer. No resolvió la coherencia semántica entre la
ruta que genera el build y la ruta declarada en `COMANDO_TEST`; ese trabajo queda separado en
FEATURE-029.

**Nota de numeración**: este número (FEATURE-021) reemplaza al ítem viejo "Adaptación de
FEATURE-018 al mecanismo de FEATURE-019" — verificado (owner + Architect) que ese trabajo quedó
absorbido sin trabajo propio por la implementación real de FEATURE-019/020
(`08-CODE-SYSTEM-PROMPT.md:157`, `06-DELIVERY-WORKFLOW.md:200,232,271-279` ya reflejan el modelo
nuevo: continuación automática a Planning, "Modo Manual" renombrado, cierre de release escalando a
Architect vía humano). No se abre como Feature separada; el número se reutiliza acá.

### ✅ FEATURE-022 — Lectura universal de artifacts por todos los roles
Implementada, validada técnicamente y mergeada a `main` (`4e4f209`).

Todos los roles pueden descubrir y leer bajo demanda cualquier artifact del proyecto del run
actual mediante `artifact_list` y `artifact_read`, con aislamiento por proyecto, acceso read-only
y sin acumulación automática de contexto. Diseño y contrato en
`docs/features/FEATURE-022-Lectura-universal-de-artifacts-por-todos-los-roles.md`.
Resultados en `docs/features/FEATURE-022-implementation-results.md`.

La próxima validación funcional punta a punta se ejecutará conjuntamente con FEATURE-023 Parte 1
y FEATURE-023 Parte 2.

### ✅ FEATURE-023 — Parte 1 — Lifecycle canónico de Features basado en el Runbook

**Estado:** Implementada y validada, incluyendo E2E real del owner (2026-07-29, caso de negocio
real), después de resolver FEATURE-023 Parte 2 y el bloque correctivo de runtime de circuitos.

**Prioridad:** P0.

Debe implementar el lifecycle del documento canónico de Feature usando obligatoriamente
`docs/playbook/07-FEATURE-TEMPLATE.md`:

1. Functional crea la versión original.
2. Planning la perfecciona según el Release y agrega el plan técnico.
3. Developer implementa y actualiza evidencia técnica y decisiones reales.
4. QA registra validación, evidencia y veredicto.
5. Developer aplica correcciones y consolida la versión final.
6. El Orquestador valida el documento contra el template activo del Runbook.
7. La versión final se guarda obligatoriamente en `docs/features/`.
8. El documento se incluye en el commit y push de la rama de la Feature.
9. Después del push confirmado, la UI muestra un modal con el Markdown completo para revisión y
   copia.

La primera prueba E2E real detectó que el runtime buscaba
`docs/runbook/07-FEATURE-TEMPLATE.md` dentro del repositorio gestionado. El owner suspendió las
pruebas de esta Parte 1 hasta definir e implementar la disponibilidad propia del Runbook en
FEATURE-023 Parte 2.

**Cierre (2026-07-29)**: la prueba E2E conjunta con FEATURE-022 y FEATURE-023 Parte 2 se ejecutó
con un caso de negocio real (`tempo-auto-planner`), después del bloque correctivo de runtime de
circuitos. Cubrió artifacts operativos en DB, resolución del Runbook independiente del repositorio
gestionado, evolución del documento canónico, persistencia del Markdown en repo, commit y push,
continuación real de Feature a cierre de Release y cierre de proyecto. Ver Lecciones Aprendidas en
`docs/features/lecciones-aprendidas/`.

La primera implementación se centra en `07-FEATURE-TEMPLATE`. Los lifecycles de
`01-PROJECT-BRIEF-TEMPLATE`, `02-ARCHITECTURE-TEMPLATE` y `09-RELEASE-PLAN-TEMPLATE` quedan fuera
de su alcance inicial y registrados separadamente en FEATURE-033, FEATURE-034 y FEATURE-035.

### ✅ FEATURE-023 — Parte 2 — Distribución, versionado y disponibilidad del Runbook en runtime

**Estado:** Implementada. Validada por evidencia empírica en la prueba E2E real conjunta del
2026-07-29 (ver FEATURE-023 Parte 1, FEATURE-022 y FEATURE-024). El Approval Gate de diseño formal
nunca se cerró explícitamente — `docs/research/FEATURE-023-revision-tecnica-y-validacion.md`
había dejado bloqueos B1-B10 sin resolución documentada. El comportamiento quedó validado contra
un caso real; cerrar formalmente ese Gate (o registrar por qué se considera superado por la
evidencia) queda como deuda documental, no como bloqueo funcional.

**Prioridad:** P0.

El Runbook es un activo propio de Asdrux AI Orchestrator. No pertenece al repositorio que el
usuario proporciona para desarrollar su caso de negocio y no puede depender de que ese repositorio
contenga `docs/runbook/`.

Esta Parte 2 definió e implementó:

1. fuente autoritativa del Runbook instalada con el producto;
2. mecanismo de resolución independiente del `cwd` y del worktree gestionado;
3. distribución y disponibilidad en desarrollo, VPS y futura instalación productiva;
4. versión activa, manifiesto, integridad y compatibilidad;
5. comportamiento fail-closed cuando el Runbook falte o sea incompatible;
6. separación entre baseline del Orquestador, configuraciones por proyecto y documentos
   materializados en el repositorio gestionado;
7. estrategia de actualización del Runbook al desplegar una nueva versión del producto.

El documento oficial conserva el número FEATURE-023 y expresa “Parte 2” en el título y nombre
del archivo. No se renumeraron FEATURE-024 ni las Features posteriores.

La validación conjunta de FEATURE-022 + FEATURE-023 Parte 1 + FEATURE-023 Parte 2 se ejecutó el
2026-07-29 (ver Cierre en FEATURE-023 Parte 1, arriba).

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
  Validación server-side del token CLI y unificación con sesión web: ver FEATURE-014.
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

**Matiz (2026-07-29)**: "paridad completa" cubre aislamiento, secuencia y pipeline — no cubría
paridad semántica de los artifacts de gobernanza (Roadmap/Release Plan/Release Completo), donde
Codex está forzado por su propio `PHASE_RESULT_SCHEMA` a que `outputArtifact` sea siempre
`string | null`. Ese gap quedó corregido en el bloque correctivo de runtime de circuitos (ver
Lecciones Aprendidas en `docs/features/lecciones-aprendidas/`). Queda sin verificar con test la
paridad de forma para FEATURES/QA_RESULT/READINESS: el código en `features/contracts.ts` soporta
ambas formas, pero ningún test ejercita la rama string real de Codex para esos tres contratos —
deuda de cobertura, no de comportamiento.

### ⚪ Escalamiento optimizado sin reinicio completo
La v1 ya diseñada en Feature 09 (`03-AI-CONSTITUTION.md`, Reglas 8 y 10) resuelve el escalamiento
con una vía única: todo hallazgo entra por Architect y avanza en el orden normal del pipeline
hasta llegar al dueño real, llevando el contexto acumulado — no reinicia todo desde cero, pero sí
recorre secuencialmente los pasos intermedios aunque no tengan nada que resolver. Este ítem es la
optimización futura: permitir que el circuito llegue directo al dueño real sin recorrer los pasos
intermedios, cuando el costo de la v1 secuencial resulte un problema real en la práctica.

### 🟡 FEATURE-025 — Selección de proveedor/modelo/credenciales por rol
Promovido de ⚪ Tentativo a 🟡 Confirmado.
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
- El paso de mapeo del intake (FEATURE-017, `mapBusinessCase.ts`) hoy usa una llamada directa fija
  (Claude Haiku + API key, sin pasar por `authMode`/`resolveAgentConfig`) — decisión explícita del
  owner de que, a futuro, este paso también debe respetar la misma configuración de agente/authMode
  que el resto de los roles, no quedar como excepción fija. Pendiente de diseño técnico (el mapeo no
  usa Executor/holder-worker hoy, por no necesitar tools — ver FEATURE-017 Regla 5 y Risks).

### 🟡 FEATURE-026 — Credenciales git por usuario para el Orquestador
Promovido de ⚪ Tentativo a 🟡 Confirmado.
Hoy el clonado de repos (FEATURE-017, `cloneRunRepository`) usa una única identidad git fija a
nivel de servidor — la clave SSH del usuario del sistema que corre el proceso del Orquestador.
Funciona porque hoy hay un solo usuario real (el owner) trabajando sobre sus propios repos. Para
que cualquier otro usuario pueda usar sus propios repos privados sin intervención manual (agregar
deploy keys a mano, repo por repo), hace falta un mecanismo de autenticación por usuario — la misma
idea que ya resolvió FEATURE-016 para los modelos de IA (`authMode`: API key vs OAuth, por usuario),
pero aplicada al acceso a Git: cada usuario debería poder autenticar su propia cuenta de GitHub
(patrón tipo GitHub App, o al menos una clave SSH/token por usuario en vez de una fija del
servidor), de forma similar a como ya se pide autenticación de cuenta personal para Claude/Codex.
No diseñado todavía — Discovery pendiente.

### 🟡 FEATURE-027 — Continuidad durable del loop Developer ↔ QA

**Estado:** Confirmada. Prioridad P0.

El loop conserva en memoria el intento actual y su causa inmediata. Los artifacts persistidos
permiten auditoría, pero no reconstruir ni continuar el ciclo después de una caída del proceso.
La Feature deberá hacer reanudables y auditables el intento actual, el último resultado de
Developer, el último veredicto de QA, el último fallo de build y el motivo inmediato del retry.

### ✅ FEATURE-028 — Release Plan asociado al Release activo

**Estado:** Implementada y validada con suite automatizada y E2E real en VPS (2026-07-31).
Prioridad P1. Diseño original de ARIA (AI Product Architect), aprobado con dos ajustes: (1) la
garantía de "como máximo un `release_roadmap` pinneado por run" queda documentada como dependiente
de la disciplina del código llamador, no de una constraint de DB; (2) la comparación final se
implementa como función pura y testeable, separada de la consulta SQL (mismo criterio que
FEATURE-038). Diseño completo en
`docs/features/FEATURE-028-Release-Plan-asociado-inequivocamente-al-Release-activo.md`.

`withRoleContext` combinaba el `release_roadmap` y el `release_plan` vigentes de forma
independiente, sin verificar que pertenecieran al mismo release — al activar un release nuevo,
Planning podía recibir el `activeRelease` correcto junto con el plan completo del release anterior.

**Mecanismo implementado**: no se agregó `releaseId` a `ReleasePlanPayload` — se reutiliza la
relación auditable ya persistida: `project_config_versions.release_plan.changed_in_run_id` → el run
que la escribió → su `release_roadmap` pinneado (`run_config_versions`) → el `activeReleaseId`
vigente en ese momento, comparado contra el release activo actual. Nueva función de repositorio
`getReleasePlanAssociationCandidate` (reutiliza el mismo CTE `current_epoch` que
`getReleasePlansByRelease`, FEATURE-036) resuelve el candidato; nueva función pura
`resolveReleasePlanForActiveRelease` decide si corresponde (mismo `activeReleaseId` **y** mismo
`root_run_id`/ciclo de negocio) — `withRoleContext` entrega `releasePlan: null` cuando no coincide,
sin borrar ni alterar el plan histórico. Refuerzo mínimo en `planning.txt`: `releasePlan: null` tras
un cambio de release es la primera invocación de ese release, nunca pérdida de datos.

**Validación E2E real (2026-07-31, proyecto `pruebas-ia`, mismo caso de propinas que en un intento
anterior había disparado la contaminación cruzada original)**: la bitácora de Planning, en su
primera invocación del release `r2`, declaró textualmente *"Es la primera invocación para el
release r2 (releasePlan viene null y functionalArtifact trae features). El release r2 contiene una
única Feature (f2: Prorrateo de propina entre comensales)"* — confirmación directa, no inferida, de
que `withRoleContext` entregó `releasePlan: null` al cruzar de release, sin ningún rastro de
`f1`/`calculateTip` del release anterior.

### ✅ FEATURE-029 — Contrato determinístico entre build output y `COMANDO_TEST`

**Estado:** Implementada y validada con 13 tests automatizados (unitarios de
`testCommandContract.ts` + integración del loop en `runStart.test.ts`). Prioridad P1. Diseño
original de ARIA (AI Product Architect).

No duplica FEATURE-021: el build obligatorio, su separación del test, el rechazo de operadores de
shell y los retries por fallo ya estaban resueltos. Esta Feature agrega una prevalidación entre el
build y la invocación de QA (`src/testing/testCommandContract.ts`) que verifica que `COMANDO_TEST`
sea consistente con lo que el proyecto realmente produjo — soporta script de `package.json`
(`npm test`/`npm run <script>`) y `node --test` con rutas explícitas (existencia + confinamiento
al worktree). Cualquier otra forma conserva el comportamiento previo.

Se agregó `testCommandFailureReason` como campo de contexto para Developer, mutuamente excluyente
con `buildFailureReason`/`qaRejectionReason`. Corrección aplicada al diseño original antes de
implementar: el mensaje de error no le sugiere a Developer "alinear el comando" — solo alinear el
*output* que genera — porque `developer.txt` (Regla 4) le prohíbe explícitamente tocar
`COMANDO_TEST`, propiedad exclusiva de Planning.

**Intentos de validación E2E real (2026-07-30, proyecto `pruebas-ia`) — no reproducidos**:

1. Primer intento: proyecto con `package.json` declarando un `scripts.build` no-op
   (`mkdir -p dist`) y un caso de negocio describiendo el proyecto como TypeScript. Developer, al
   no encontrar evidencia real de TypeScript en el repo (sin `tsconfig.json` ni dependencia
   `typescript`), escribió el archivo de test directamente en `.mjs` ejecutable — una decisión
   razonable de su parte, no un error — evitando por completo el circuito `dist/` y, con eso, el
   escenario que la Feature valida.
2. Segundo intento: se agregó `tsconfig.json` y la dependencia `typescript` real al repo. Esta vez
   Planning y Developer sí siguieron la ruta `dist/` como se esperaba, pero Developer reemplazó el
   `scripts.build` no-op por un `tsc` real (decisión también razonable) — y como el contenedor de
   build corre con `--network none` y nadie instaló `node_modules` (gap ya conocido, ver
   FEATURE-032), el build falló con `tsc: not found` antes de llegar a la prevalidación de esta
   Feature. El loop se agotó por el mecanismo de fallo de build ya existente (FEATURE-021), sin
   invocar nunca a QA — comportamiento correcto, pero de una Feature distinta.

**Conclusión**: forzar este escenario específico en un E2E real depende de que un agente con
permisos de escritura totales tome una decisión imperfecta muy puntual, y en los dos intentos
tomó decisiones razonables que lo evitaron — buena señal del sistema, pero no reproducible a
demanda. La validación queda sostenida por los tests automatizados (deterministas, sin depender
del comportamiento de un LLM), que sí ejercitan el mecanismo directamente. Diseño completo y
detalle de los intentos en
`docs/features/FEATURE-029-Contrato-determinístico-entre-build-output-y-COMANDO_TEST.md`.

### 🟡 FEATURE-030 — Proyecto asociado correctamente al repositorio gestionado

**Estado:** Confirmada. Prioridad P1.

El Orquestador puede reutilizar el proyecto más antiguo del usuario para casos dirigidos a
repositorios distintos, mezclando Roadmaps, Release Plans y estado persistido. La identidad del
proyecto deberá distinguir correctamente el repositorio gestionado y evitar esa reutilización
accidental.

### ✅ FEATURE-031 — Mapping confiable de `tipo_solucion` y simplificación de `canales`

**Estado:** Implementada, validada con suite automatizada y con prueba manual del owner en VPS
(2026-07-30). Prioridad P2. Diseño original de ARIA (AI Product Architect), revisado y ajustado
antes de implementar. Diseño completo en
`docs/features/FEATURE-031-Mapping-confiable-de-tipo_solucion-y-canales.md`.

Estos campos del intake se mapeaban con menor confiabilidad que el resto de los diez campos
descriptivos: `tipo_solucion` (`select`) podía clasificarse por palabras aisladas ("existe") sin
considerar negaciones ni distinguir la solución objeto de la iniciativa de soluciones de terceros
o sistemas relacionados; `canales` estaba definido como `list` sin que ningún código lo tratara
distinto de un campo de texto libre.

**Ajuste al diseño original, antes de implementar**: el diseño de ARIA incluía una capa de
compatibilidad para leer `canales` histórico como `string | string[]`. Se verificó contra
`mapBusinessCase.ts` (el parser trata todo campo como `string | null` sin excepción) y
`ReviewModal.tsx` (renderiza `textarea` y `list` en la misma rama) que ningún camino de código
produce `canales` como array, y se confirmó contra la base de datos real que no existe ningún
caso persistido con esa forma — esa parte del alcance se descartó por no tener evidencia que la
sostuviera, dejando el cambio de `canales` acotado a una migración de metadata.

Qué se implementó: reglas de clasificación de `tipo_solucion` (negación, "mejora_existente" exige
existencia + modificación simultáneas, terceros/sistemas relacionados no cuentan, ambigüedad →
vacío) inyectadas al prompt del mapper solo cuando ese campo está presente
(`src/intake/mapBusinessCase.ts`); validación de dominio en código para `tipo_solucion` (descarta
cualquier valor fuera de `nueva`/`mejora_existente` que el modelo pudiera devolver, en vez de
confiar únicamente en que el prompt se respete); `canales` cambia de `field_type = list` a
`textarea` (`migrations/0014_canales_field_type_textarea.sql`, más el seed de `0009` actualizado
para instalaciones nuevas).

### ✅ FEATURE-032 — Instalación determinística de dependencias antes del build

**Estado:** Implementada y validada con suite automatizada y con prueba E2E real del owner en VPS
(2026-07-30). Prioridad P2. Diseño original de ARIA (AI Product Architect), ampliado antes de
implementar con timeouts configurables para los tres pasos del loop (`BUILD_TIMEOUT_MS`,
`TEST_TIMEOUT_MS`, `DEPENDENCY_INSTALL_TIMEOUT_MS`). Diseño completo en
`docs/features/FEATURE-032-Instalacion-determinística-de-dependencias-antes-del-build.md`.

El pipeline asumía que `node_modules` está disponible. Se observó un fallo real (`tsc: not found`)
durante la validación E2E de FEATURE-029 — el nuevo `DependencyInstaller`
(`src/testing/dependencyInstaller.ts`) corre entre Developer y `BuildExecutor`, con acceso a red y
caché npm escribible explícita (el contenedor de Developer no la tiene). Nuevo motivo
`dependencyInstallationFailureReason`, primero en la cadena de exclusión mutua del loop.

**Validación E2E real (2026-07-30, proyecto `pruebas-ia`, rama
`pruebas-ai-orchestratror-feature-029`)**: el run ejecutó tres intentos sobre el mismo caso de
negocio. Primer intento: Developer escribió un `package.json` con BOM inválido; el evento
`dependency_install_executed` registró el fallo de instalación (JSON inválido, Regla 7) y el loop
lo atribuyó correctamente como `dependencyInstallationFailureReason`, sin invocar `BuildExecutor`
ni QA. Segundo intento: Developer corrigió el `package.json`, la instalación real de `typescript`
vía `npm ci` corrió con éxito (`node_modules/.bin/tsc` disponible), pero el build con `tsc` real
falló por un error de tipos genuino y distinto (`TS2307`, módulo no encontrado) — atribuido
correctamente como `buildFailureReason`, no como fallo de instalación, confirmando la exclusión
mutua entre ambos motivos. Tercer intento: Developer corrigió el problema de tipos; instalación,
build, contrato de `COMANDO_TEST` y tests corrieron limpios, QA aprobó, y el run llegó al
escalamiento de merge. Evidencia real y específica de los tres componentes de la Feature actuando
correctamente en secuencia sobre un run genuino con Docker y red real.

### 🟡 FEATURE-033 — Lifecycle de `01-PROJECT-BRIEF-TEMPLATE`

**Estado:** Confirmada; posterior a FEATURE-023 Parte 2, prioridad por definir.

Deberá definir rol creador, roles actualizadores, validación, persistencia DB, ubicación canónica
en repo, versionado, lectura mediante FEATURE-022 y exposición en UI cuando corresponda. No se
diseña en detalle en esta actualización.

### 🟡 FEATURE-034 — Lifecycle de `02-ARCHITECTURE-TEMPLATE`

**Estado:** Confirmada; posterior a FEATURE-023 Parte 2, prioridad por definir.

Deberá definir el lifecycle del documento de arquitectura que incluye el Roadmap de Releases:
creación, actualización, validación, persistencia DB, ubicación, versionado, lectura mediante
FEATURE-022 y exposición en UI. No se diseña en detalle en esta actualización.

### 🟡 FEATURE-035 — Lifecycle de `09-RELEASE-PLAN-TEMPLATE`

**Estado:** Confirmada; posterior a FEATURE-023 Parte 2, prioridad por definir.

Deberá definir creación, actualización, validación, persistencia DB, ubicación canónica,
versionado, lectura mediante FEATURE-022 y exposición en UI del Release Plan. No se diseña en
detalle en esta actualización.

### ✅ FEATURE-036 — Release activo nominal tras cierre de proyecto sin release siguiente

**Estado:** Implementada y validada con suite automatizada y E2E real en VPS (2026-07-30/31).
Prioridad P1. Diseño original de ARIA (AI Product Architect), aprobado con una corrección de orden:
la revisión de datos reales se corrió como primer paso de la implementación, antes de tocar el
validador (0 roadmaps vigentes inconsistentes encontrados). Diseño completo en
`docs/features/FEATURE-036-Release-activo-nominal-tras-cierre-de-proyecto.md`.

Detectado en la prueba E2E real del 2026-07-29 (FEATURE-024): cuando se aprueba el cierre del
último Release de un proyecto y no hay Release siguiente pendiente, `respondService.ts` marcaba el
Release actual `Completado` pero conservaba `activeReleaseId` apuntando a ese mismo Release ya
completado, en vez de representar explícitamente que no hay ningún Release activo, y
`activeReleaseFromRoadmap` tampoco comprobaba el estado del release encontrado. `activeReleaseId`
pasa a ser `string | null`; el validador exige el invariante cruzado (ID no nulo ⇒ exactamente un
release `Activo` con ese ID; `null` ⇒ cero releases `Activo`); el cierre sin release siguiente
ahora persiste `activeReleaseId: null` y garantiza por estado (no por coincidencia de ID) que
ningún release quede `Activo`; `runView.ts`/`ReleasePlanPanel.tsx` muestran "Sin release activo" en
vez de reutilizar el último release completado como fallback. Relacionado con FEATURE-028 (Release
Plan asociado al Release activo) — mismo tipo de invariante, distinto momento del ciclo de vida.

**Validación E2E real (2026-07-30/31, proyecto `pruebas-ia`, Roadmap de dos releases —
`calculateTip`/r1, `calculateSplitTip`/r2)**: primer intento con el Orquestador apuntando por error
a la rama de FEATURE-032 (sin el fix) reprodujo el bug original tal cual — `activeReleaseId` de r2
seguía `"Activo"` después de `project_closed` — confirmando el diagnóstico antes de repetir en la
rama correcta. Repetido en `feature/036-release-activo-consistente`: r1 se cerró y activó r2
correctamente; al cerrar r2 sin release pendiente, `project_closed` se registró con
`activeReleaseId: null` persistido, y la UI mostró "Sin release activo" sin usar el release
completado como fallback. Durante esa misma validación se descubrió y corrigió aparte un bug de
`getReleasePlansByRelease` (ver sección técnica arriba) y se documentaron dos hallazgos separados
sobre el ciclo de vida del Release Plan: Features de un release anterior reapareciendo en el
siguiente (no disparado en la corrida final — comportamiento no determinístico del LLM; scope de
FEATURE-028) y el último Feature nunca marcado `Completada` (FEATURE-038, sí reproducido).

### ✅ FEATURE-038 — Persistencia del estado final del Release Plan al cerrar un release

**Estado:** Implementada y validada con suite automatizada y E2E real en VPS (2026-07-31).
Prioridad P1. Diseño original de ARIA (AI Product Architect), aprobado con dos ajustes: (1) los
cierres inconsistentes usan
`FeatureLifecycleEscalationError` explícitamente, nunca `throw new Error()` genérico; (2) la
validación compara `featureJustCompleted` contra el Release Plan vigente de **entrada** (el que
Planning recibió como contexto), nunca contra el `RELEASE_PLAN` declarado de salida. Diseño completo
en `docs/features/FEATURE-038-Persistencia-del-estado-final-del-Release-Plan-al-cerrar-un-release.md`.

Detectado durante la validación E2E de FEATURE-036 (2026-07-30, proyecto `pruebas-ia`): el
`release_plan` persistido solo cambiaba cuando Planning declaraba un `RELEASE_PLAN` con
`status = completed`. Cuando Planning declaraba `RELEASE_COMPLETO`, su resultado tenía
`status = escalated` (es un Approval Gate, no un error) — así que el `RELEASE_PLAN` final que
Planning sí declaraba correctamente (última Feature `Completada`, `featureActualId: null`) nunca
llegaba a persistirse. La UI mostraba la última Feature con el ícono "en curso" para siempre, pese
a que QA ya la había aprobado y el release estaba efectivamente cerrado.

`persistReleasePlanIfDeclared` (`src/cli/commands/runStart.ts`) ahora persiste también cuando
`status = escalated` con `RELEASE_COMPLETO = true`, siempre que el cierre sea coherente: nueva
función pura `validateFinalReleasePlanTransition` valida contra el Release Plan vigente de entrada
(el mismo objeto que ya vio Planning, sin relectura de la base — elimina de fábrica cualquier
ventana de carrera) que `featureJustCompleted` coincida con la Feature que estaba `"En curso"`,
que todas las Features finales queden `Completada` sin altas/bajas/duplicados de identidad, y que
`COMANDO_TEST`/`FEATURE_UPDATE` vengan nulos. Un cierre inconsistente no se persiste y escala
explícitamente vía `FeatureLifecycleEscalationError` (reutilizado de `src/features/lifecycle.ts`),
nunca como error genérico de infraestructura ni como un Approval Gate engañoso.

**Discovery cerrado con ARIA**: el hallazgo original de FEATURE-036 traía dos síntomas — Features
del release anterior reapareciendo en el siguiente (causa distinta: `withRoleContext` entrega el
`release_plan` vigente a Planning sin verificar que pertenezca al mismo release que `activeRelease`)
y el síntoma que corrige esta Feature. El primero queda explícitamente dentro del alcance ya
confirmado de **FEATURE-028** (Release Plan asociado inequívocamente al Release activo) — con un
mecanismo preferido derivado del Discovery: resolver el release vigente cuando se escribió cada
versión de `release_plan` vía `changed_in_run_id → run_config_versions → release_roadmap pinneado`
(la misma relación auditable ya usada por el fix de `getReleasePlansByRelease`), en vez de agregar
`releaseId` al contrato de Planning.

**Validación E2E real (2026-07-31, proyecto `pruebas-ia`, caso de negocio con dos releases —
`calculateTip`/r1, `calculateSplitTip`/r2)**: consulta directa a `project_config_versions` durante
la corrida confirmó, al cerrar r1, una nueva versión de `release_plan` con `valid_from` exactamente
en el `phase_finished` de Planning — 21 segundos antes de la respuesta humana al Gate — conteniendo
`f1` en `"Completada"` y `featureActualId: null`; la versión inmediatamente anterior seguía
mostrando `f1` `"En curso"`, confirmando el contraste directo con el estado obsoleto que quedaba
persistido antes del fix. Al cerrar el proyecto completo (r2, última Feature del release final), la
UI mostró "Sin release activo" y ambas Features con el check verde de "Completada" — antes del fix,
la última Feature de cada release quedaba indefinidamente con el ícono "en curso".

### ✅ FEATURE-037 — Entrega gobernada de reglas del Runbook a Planning, Developer y QA

**Estado:** Implementada y validada con suite automatizada y E2E real en VPS (2026-07-31).
Prioridad P1. Diseño original de ARIA (AI
Product Architect), aprobado con dos correcciones de redacción (sin cambios de alcance): la entrada
original del Roadmap era genérica, no decía literalmente "inyectar ambos documentos completos a
QA/Developer"; y el patrón previo de `runbookProvider.readText` (Functional) resuelve el asset
después de que la fase completó, para persistencia — no es precedente de inyección pre-invocación,
que es lo que introduce esta Feature. Diseño completo en
`docs/features/FEATURE-037-Entrega-gobernada-de-reglas-del-Runbook-a-Planning-Developer-y-QA.md`.

Ni Planning, ni Developer, ni QA tenían garantía estructural de recibir las reglas de gobernanza del
Runbook que les corresponde aplicar. El ownership vigente (`04-TESTING-POLICY.md:6`: *"Dueño y único
consultor directo: Planning"*; `05-CODING-STANDARDS.md:6-8`: *"Dueño y consultor directo:
Developer"*) distingue responsabilidades — inyectar ambos documentos completos a todos los roles
habría contradicho ese ownership y creado múltiples fuentes normativas simultáneas.

**Mecanismo implementado**: Planning recibe `governance.testingPolicy` en cada invocación
(`withRoleContext`, `runStart.ts`), leído fresco vía `RunbookProvider`, para traducirlo al Test Plan
de la Feature. Developer recibe `governance.codingStandards` en cada intento del loop
Developer↔QA, incluido el turno de readiness post-QA (`loadDeveloperGovernance`, nuevo servicio
inyectable `runbookProvider`) — su presencia no autoriza cambios de código en readiness. QA no
recibe ninguno de los dos documentos completos, solo el Test Plan vigente ya existente. Namespace
`governance` protegido: `shapeRoleContext` aplica `shared` siempre al final del merge, así que un
campo `governance` falso en el contexto entrante nunca sobrescribe el real. `TESTING_POLICY_ASSET`/
`CODING_STANDARDS_ASSET` agregados a `REQUIRED_RUNBOOK_ASSETS` — el Orquestador falla al arrancar si
el paquete está incompleto (fallo cerrado, Regla 13). Auditoría vía evento
`runbook_governance_delivered` con metadata (rol, path, versión, hash), sin persistir el contenido
completo. Refuerzo mínimo de `planning.txt`/`developer.txt`/`qa.txt` según ownership, sin cambiar el
formato de respuesta de ningún rol.

**Validación E2E real (2026-07-31, proyecto reutilizado por FEATURE-030, caso de negocio real de
`tempo-auto-planner` con integración externa a Tempo/Jira)**: primer intento no ejercitó el fix
(rama equivocada, mismo tipo de olvido de checkout ya visto en otras features). Repetido en la rama
correcta: el evento `runbook_governance_delivered` se registró en cada invocación de Planning y de
Developer (incluidos los turnos de readiness) a lo largo de las tres Features del release —
confirma entrega fresca y consistente. Validación cruzada: 0 eventos de este tipo existían en la
base antes de correr en la rama correcta, confirmando que el primer intento efectivamente no había
ejercitado el mecanismo. Ver FEATURE-039/040 para el hallazgo adicional detectado durante esta misma
validación (la entrega funciona, pero el cumplimiento de reglas específicas de la política —
Regla 11 — no está garantizado estructuralmente).

### ⚪ Approval Model por Release
Feature 09 (`06-DELIVERY-WORKFLOW.md`, Stage 6) ya diseñó la v1: Modo Manual (default — automático
hasta el push de cada Feature, humano revisa antes del merge a la rama principal) y Modo Auto
(también el merge es automático; solo el deploy a producción requiere humano, sin excepción, por
la Regla 9 de `03-AI-CONSTITUTION.md`).

Lo que queda Tentativo: exponer el rigor (Modo Manual / Modo Auto) como configuración
parametrizable real para el usuario final — hoy es fijo, decidido por quienes operan el
Orquestador. Aplica cuando el Orquestador opere sobre proyectos externos.

### ⚪ Concurrencia de runs simultáneos
H9 (FEATURE-003): solo se probaron invocaciones secuenciales; comportamiento bajo múltiples runs
concurrentes desde un proceso Node persistente no está validado.

### ⚪ Limpieza automática de worktrees/branches vencidos
Política de retención a 21 días para runs escalados y no retomados — sin diseñar todavía.

### ⚪ `PreToolUse` hooks como defensa en profundidad (QA)
Prioridad muy baja, no descartado del todo. Dependen de una API específica de Claude Code — no
portan a Codex.

### ⚪ Creación real de PR vía API de GitHub / merge automático
Hoy el flujo termina en rama lista, sin apertura de PR ni merge automatizado a `main`. La política
que este código futuro debería seguir ya quedó diseñada en Feature 09 (`06-DELIVERY-WORKFLOW.md`,
Stage 6, Modo Manual / Modo Auto) — este ítem es la implementación real, todavía sin código.

### ⚪ Deployment Strategy y separación dev/staging/prod
Sin diseñar.

### ✅ FEATURE-013 — Capa de UI — "Run en curso"
Cerrada en tres incrementos:
- 013A: backend read-only, UI básica y SSE.
- 013B: sesiones web reales.
- 013C: respuesta a escalamiento desde modal, con navegación al run hijo por SSE.

Documentos de diseño:
- `docs/features/Feature-013-interfaz-ui-parte-013a-backend-read-only-ui-sse-basico.md`
- `docs/features/Feature-013-interfaz-ui-parte-013b-sesiones-web.md`
- `docs/features/Feature-013-interfaz-ui-parte-013c-respuesta-escalamiento.md`

Documentos de resultados:
- `docs/features/Feature-013-interfaz-ui-parte-013a-implementation-results.md`
- `docs/features/Feature-013-interfaz-ui-parte-013b-implementation-results.md`
- `docs/features/Feature-013-interfaz-ui-parte-013c-implementation-results.md`

Disparo (FEATURE-017, ✅ Ejecutada) e Historial/admin quedan fuera de esta Feature — Historial/admin
sigue Tentativo, ver su detalle más abajo.

### ✅ FEATURE-017 — Capa de UI — Disparo (intake de caso de negocio asistido por IA)
Pantalla para crear un run nuevo: el usuario pega texto o carga un archivo con el relevamiento del
caso de negocio, el Orquestador lo mapea (sin inventar, sin diálogo con el usuario) contra una
estructura de 12 campos predeterminados, más Repositorio y Rama Base de Trabajo (ambos siempre
requeridos, Rama Base con default `main`). El usuario confirma o edita en un modal con % de
completitud antes de poder iniciar el run. Introduce, por primera vez en el proyecto, un estado
previo al arranque de un run (`sin_iniciar`) y una cancelación real desde la lista "mis casos",
reusando el mecanismo de escalamiento de FEATURE-013C. Separada de Historial/admin por ser
funcionalmente independiente.

**Estado (2026-07-25): ✅ Ejecutada.** Validada técnicamente por el DAIA (chequeo de cancelación
pre-fase, decisión de fijar `pipeline_definition_id` en la confirmación en vez del arranque),
aprobada por el owner, implementada en la rama `feature/017-ui-disparo-intake` (commit `eed5e88`,
implementación principal) y mergeada a `main` en `14693c8`
("Merge FEATURE-017: intake de caso de negocio asistido por IA"). La rama se conserva como
referencia histórica, mismo criterio que `feature/016-*`.

Qué se implementó: migraciones `0009_intake_field_definitions.sql` (12 campos, seed) y
`0010_runs_sin_iniciar.sql` (`runs.business_case`); mapeo directo al proveedor sin tools
(`src/intake/mapBusinessCase.ts`, Claude Haiku + API key fija — ver ítem Tentativo "Selección de
proveedor/modelo/credenciales por rol" para la excepción pendiente de resolver); orquestación en
`src/cli/intakeService.ts` (confirmar/iniciar/cancelar); clonado real y aislado del repositorio del
caso de negocio (`cloneRunRepository`/`removeRunClone`, normalización HTTPS→SSH para GitHub — ver
ítem Tentativo "Credenciales git por usuario para el Orquestador" para la limitación conocida y
aceptada); chequeo de cancelación pre-fase (`haltIfCancelledExternally`) en `runStart.ts`; timeouts
finales por rol (`ARCHITECT_TIMEOUT_MS`/`FUNCTIONAL_TIMEOUT_MS`/`PLANNING_TIMEOUT_MS` en 600000ms,
`DEVELOPER_TIMEOUT_MS`/`QA_TIMEOUT_MS` en 900000ms, subidos de 300000ms tras una corrida real y una
investigación de timeouts de mercado) y registro de duración real por fase (`durationMs`);
frontend `web/src/intake/` (Disparo, ReviewModal, CasesList), sin router, con `Badge` de color
compartido para el estado (`statusDisplay.ts`, reusado también en la pantalla de detalle de
FEATURE-013A).

Mejoras identificadas para cuando se diseñe Historial/admin, ver detalle de esa Feature abajo.

Diseño y evidencia completos:
`docs/features/FEATURE-017-Capa-de-UI-Disparo-intake-de-caso-de-negocio-asistido-por-IA.md`.

### ⚪ Capa de UI — Historial/admin
Listado de runs propios o del equipo (si admin), con estado/dueño/fase/tiempo transcurrido — dato
que ya existe en `runs`/`run_events`, sin necesidad de ningún mecanismo nuevo de intake. Mencionada
en `02-ARCHITECTURE.md` (Frontend Principles) como fuera del alcance de FEATURE-017 — sin diseño
propio todavía. Mejoras puntuales ya identificadas para
cuando se diseñe (surgidas durante las pruebas reales de FEATURE-017):
- La lista de "mis casos" hoy muestra el Run ID (UUID) como identificador visible — debería mostrar
  el título tentativo del caso (derivado del caso de negocio mapeado, ej. de la sección "Visión" o
  un campo de título dedicado a agregar), con el Run ID como dato secundario/técnico.
- El error de `repo_clone_failed` (corte técnico antes del Architect, FEATURE-017 sección 7.4) se
  muestra hoy como texto plano en rojo pegado arriba de la lista — debería mostrarse en un modal o
  componente de error más prolijo, consistente con el resto de la UI.

### ⚪ Notificación Slack/webhook complementaria
Evaluada en la misma sesión que "Run en curso" como alternativa de monitoreo — se descartó como
primera opción porque, a esfuerzo comparable, una UI mínima de solo lectura daba más valor y era
reusable hacia la Capa de UI completa. Queda como complemento futuro si hace falta alertas push
(fase completada/fallida) fuera de cuando alguien está mirando la UI activamente.

### ✅ FEATURE-024 (antes FEATURE-023, antes FEATURE-022, antes FEATURE-021, antes FEATURE-019, antes FEATURE-018, antes FEATURE-017,
antes FEATURE-014) — Milestone 2 — Validación end-to-end con caso de negocio real
Necesario y ya decidido antes de sumar al resto del equipo. Ejecutada mediante prueba de usuario
real (2026-07-29, proyecto `tempo-auto-planner`), sin necesidad de una Feature de producto nueva.

**Resultado**: validó de punta a punta el circuito completo — Architect → Functional → Planning →
Developer ↔ QA → merge de Feature (Modo Manual) → run hijo `PLANNING_TO_QA` → Planning reconoce
`featureJustCompleted` en raíz → `RELEASE_COMPLETO` reconocido como Approval Gate sin retry
automático previo → aprobación humana → cierre de proyecto (`project_closed`). La primera corrida
había fallado antes del bloque correctivo de runtime de circuitos (ver Lecciones Aprendidas en
`docs/features/lecciones-aprendidas/`); repetida después del fix, funcionó de punta a punta.

**Hallazgo pendiente, no bloqueante**: el proyecto cerrado (sin release siguiente) conserva
`activeReleaseId` apuntando al release ya completado — ver FEATURE-036.
