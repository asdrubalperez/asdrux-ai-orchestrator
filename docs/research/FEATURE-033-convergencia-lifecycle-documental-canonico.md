# Investigación — Convergencia de lifecycle documental canónico (FEATURE-023 ↔ F033/F034/F035)

**Tipo:** Investigación + recomendación. No implementa, no modifica schema/código/UI.
**Fecha:** 2026-08-16
**Alcance:** Feature (FEATURE-023, ya implementada), Project Brief (F033), Architecture (F034), Release Plan (F035).

---

## 1. Estado actual — cómo funciona Feature hoy

FEATURE-023 implementa un lifecycle documental **específico y deliberadamente no genérico** para el documento canónico de Feature. Piezas principales:

**Identidad** — tabla `features` (`migrations/0013_feature_lifecycle.sql:2-26`), clave única `(project_id, release_key, source_key)` + `(project_id, feature_code)`. El código `FEATURE-NNN` se reserva bajo lock transaccional del proyecto (`src/features/lifecycle.ts:60-65`), cruzando tanto la DB como `docs/features/` en disco para evitar colisiones con features materializadas pero no commiteadas (`lifecycle.ts:564-573`).

**Revisiones append-only** — tabla `feature_revisions` (`0013_feature_lifecycle.sql:28-46`), con `unique(feature_id, source_event_key)` como mecanismo de idempotencia (ver más abajo) y `check(producer_role in ('functional','planning','developer','qa'))`.

**Artifact canónico** — `features.canonical_artifact_id` es un puntero **único y mutable** (no historial) hacia la fila más reciente de `artifacts` con `kind = "feature_document"`. Cada `refreshCanonicalArtifact` (`lifecycle.ts:467-506`) relee todas las revisiones, renderiza el Markdown completo, inserta una **nueva** fila en `artifacts` (tabla genérica, sin cambios de FEATURE-023) y reapunta el FK. El historial de contenido vive en `feature_revisions`, no en múltiples filas de `artifacts`.

**Renderer** — `renderFeatureDocument` en `src/features/document.ts:69-187` está **hardcodeado** a la estructura exacta de `07-FEATURE-TEMPLATE.md` (headers de sección literales, funciones de sub-renderizado por rol). No es genérico ni template-driven, pese a que `functionalTemplateMetadata` captura un `descriptor.sections` que sugiere esa posibilidad — ese descriptor se guarda pero **nunca se consume** para dirigir el render.

**Idempotencia** — dos capas: `contributionKey` (`lifecycle.ts:586-593`, deriva de `runId + phaseFinishedEventId + purpose + sourceKey`) y el `on conflict (feature_id, source_event_key) do nothing` de `insertRevision` (`lifecycle.ts:426-465`). Adicional: shortcut de idempotencia a nivel de contenido para Functional (`canonicalJson` comparación, líneas 109-113).

**Materialización a repo** — `materializeActiveFeatureDocument` (`lifecycle.ts:299-328`) escribe a `docs/features/FEATURE-{code}-{slug}.md`, con `flag: "wx"` en la primera escritura (falla si ya existe) y `"w"` en escrituras posteriores, calcula `sha256` y lo persiste en `features.document_hash`.

**Commit/push** — `recordFeatureCommit`/`recordFeaturePush` (`lifecycle.ts:330-356`) usan `UPDATE ... WHERE document_hash = $x` condicional: sólo confirman si el estado de DB todavía coincide con lo que se acaba de materializar; si no, lanzan error en vez de sobreescribir silenciosamente.

**Lectura backend para UI** — `getFeatureDocumentForRun` (`lifecycle.ts:373-409`) hace join `runs → features → artifacts` vía `runs.active_feature_id` y `feature.canonical_artifact_id`, aplica un límite de 64 KiB (`complete`/`reason: "CONTENT_TOO_LARGE"`) **reimplementado de forma independiente** del límite de FEATURE-022 (mismo valor, código separado). Expuesto en `GET /runs/:id` (`src/server/app.ts:1037-1057`) vía el DTO `FeatureDocumentView`.

**UI** — `web/src/runs/RunDetailPage.tsx`, componente `FeatureDocumentPanel` (líneas 188-250): card con código/nombre/estado, botón "Ver documento de Feature" que abre un `Dialog` con el Markdown en `<pre>`, botón "Copiar" (`navigator.clipboard`), advertencia de truncado. **No existe botón "Descargar"** en ningún punto del archivo. Auto-apertura del dialog la primera vez que `publicationState === "pushed"`, vía `sessionStorage` — lógica atada al concepto Feature-específico de "push a subrama".

**Lectura por agentes (FEATURE-022)** — `artifact_list`/`artifact_read`, implementados en `src/db/artifactRepository.ts` y `src/executor/isolated-tools/*`. Operan sobre la tabla genérica `artifacts` filtrando por `kind` como string libre, **sin ninguna lógica específica de Feature**. El propio documento de FEATURE-022 excluye explícitamente el lifecycle de los cuatro documentos del Runbook de su alcance (líneas 214-238).

**Dato relevante para F035**: hoy, `persistPlanningFeatureSelection` persiste algo llamado `release_plan` en `project_config_versions` (`lifecycle.ts:203-209`), no como artifact canónico. No está confirmado con evidencia de código si ese valor corresponde al documento completo de `09-RELEASE-PLAN-TEMPLATE.md` (con Enfoque Técnico + Test Plan por Feature) o sólo a la secuencia/selección interna de features del release. **Esto debe aclararse al diseñar F035** antes de asumir que ya existe persistencia parcial del Release Plan.

---

## 2. Mapa de responsabilidades

### A. Lógica documental potencialmente común (patrón, no necesariamente código compartido)

| Elemento | Ubicación actual | Grado de reutilización real |
|---|---|---|
| Patrón identidad + revisión append-only + puntero canónico + materialización con guard de hash + commit/push condicional | `src/features/lifecycle.ts` completo | **Patrón de diseño reutilizable**, no código — está entrelazado con columnas específicas de `features` |
| Snapshot de metadata de template (key/version/hash/snapshot) | `document.ts:27-42`, columnas `features.template_*` | Patrón reutilizable; constantes (`FEATURE_TEMPLATE_KEY`) son Feature-específicas |
| `sha256`, `normalizeLf` | `document.ts:206-212` | Reutilizable **como código**, son funciones puras sin acoplamiento |
| Contrato de truncado 64 KiB (`complete`/`reason: "CONTENT_TOO_LARGE"`) | Duplicado en `lifecycle.ts:387` y `artifactRepository.ts` | Ya es un contrato compartido de facto (mismo valor, dos implementaciones) — candidato a unificar |
| Lectura genérica por agentes (`artifact_list`/`artifact_read`) | FEATURE-022 completo | **Ya es común, sin cambios necesarios** — funciona para cualquier `kind` nuevo |
| Panel de documento canónico en UI (header + Ver + Copiar + Dialog + aviso de truncado) | `RunDetailPage.tsx:188-250` (`FeatureDocumentPanel`) | Forma reutilizable; implementación actual está tipada 1:1 a Feature |
| `CopyableMetadataItem` | `RunDetailPage.tsx:558-586` | **Genérico y reutilizable tal cual** |
| Convención de "Chequeo Interno Antes de Entrega" (self-review, no gate humano) | Presente en los 4 templates del Runbook | Convención transversal, candidata a UI/checklist compartida |

### B. Lógica exclusivamente de dominio Feature

- `renderFeatureDocument` y toda `src/features/document.ts` (secciones hardcodeadas 1-10, funciones de sub-render por rol).
- `src/features/contracts.ts` (payloads de Functional/Planning/Developer/QA).
- Clave de unicidad `(project_id, release_key, source_key)` y el concepto `active_feature_id` en `runs`.
- `getFeatureDocumentForRun` — hardcodea el join vía `runs.active_feature_id`.
- `approvalMode` / `humanMergeAuthorization` — gate de merge específico del flujo Developer→QA→merge de Feature.
- `publicationState` en su variante `pushed` + lógica de auto-apertura por `sessionStorage` — atada a "push a subrama de Feature".
- Todo lo relacionado con Developer attempts, QA, readiness, branch, commit, push, merge, autorización humana de merge — no aplica a Project Brief/Architecture/Release Plan según los templates actuales.

---

## 3. Comparación con F033/F034/F035

| Capacidad | Feature (actual) | Project Brief (F033) | Architecture (F034) | Release Plan (F035) | ¿Común? |
|---|---|---|---|---|---|
| Identidad documental | `features` (project_id+release_key+source_key) | Nueva — 1 por proyecto | Nueva — 1 por producto (vivo) | Nueva — 1 por release | **Patrón sí, tabla no** |
| Template metadata (key/version/hash/snapshot) | `features.template_*` | Necesario | Necesario | Necesario | Patrón sí, columnas específicas |
| Revisiones append-only | `feature_revisions`, multi-productor | Dudoso — parece producirse una vez por Architect | **Fuerte candidato** — doc explícitamente "vivo", se retroalimenta Feature a Feature | Posible — §2 tiene sub-bloques por Feature, análogo a secciones | Depende del documento — no asumir que los 4 lo necesitan igual |
| Idempotencia (source_event_key) | Sí, vía `contributionKey` | Sí, si hay reintentos de fase | Sí | Sí | Patrón común |
| Renderer | Hardcodeado a `07-FEATURE-TEMPLATE` | Nuevo, hardcodeado a `01-...` | Nuevo, hardcodeado a `02-...` | Nuevo, hardcodeado a `09-...` (con sub-render por Feature en §2) | No reutilizable como código; sí como patrón de "una función renderer por template" |
| Artifact canónico (`kind` + puntero) | `feature_document` | `project_brief_document` (propuesto) | `architecture_document` (propuesto) | `release_plan_document` (propuesto) | Común — `artifacts` genérica ya soporta esto sin cambios |
| Historial | Vía `feature_revisions`, no vía múltiples `artifacts` | Igual patrón aplicable | Igual patrón aplicable, más relevante por ser "vivo" | Igual patrón aplicable | Patrón común |
| Markdown | Sí | Sí | Sí | Sí | Común (formato), no el contenido |
| FEATURE-022 (lectura por agentes) | Ya soportado, `kind="feature_document"` | **Sin cambios necesarios** | **Sin cambios necesarios** | **Sin cambios necesarios** | **Sí, ya es común** |
| UI "Ver" | `FeatureDocumentPanel` | Reutilizable si se generaliza | Reutilizable si se generaliza | Reutilizable si se generaliza | Sí, con generalización |
| Copiar | `navigator.clipboard`, botón dedicado | Reutilizable | Reutilizable | Reutilizable | Sí |
| Descargar | **No existe hoy** | A definir | A definir | A definir | Nueva capacidad — construir una vez, común desde el inicio |
| Materialización repo | `docs/features/FEATURE-NNN-slug.md`, `wx`/`w` guard | Path TBD (Project Brief "no es un documento del Runbook en sí" según su propio template) | Path TBD | Path TBD | Patrón común, paths específicos |
| Hash | `features.document_hash`, sha256 | Aplicable | Aplicable | Aplicable | Función común (`sha256`/`normalizeLf`) |
| Commit/push | `recordFeatureCommit`/`recordFeaturePush`, guard condicional | Dudoso si aplica igual (Project Brief puede no vivir en una subrama por-instancia) | Dudoso — es "vivo", ¿se commitea en cada actualización o sólo al aprobar roadmap? | Dudoso — igual pregunta que Architecture | **No asumir que aplica igual** — requiere diseño específico por documento |
| Approval / gate humano | Merge gate (`approvalMode`/`humanMergeAuthorization`) | Gate distinto: §0 declarativo (bloqueo por campos faltantes) | Gate distinto: aprobación de Roadmap (§0), no merge gate | Gate distinto: §0 tamaño/riesgo del release | **No común** — cada uno tiene su propio gate, con semántica distinta |
| Developer/QA attempts | Sí, propio de Feature | No aplica | No aplica | No aplica | No común |
| Readiness | Sí, propio de Feature | No aplica | No aplica | No aplica | No común |

**Hallazgo clave de la matriz**: la cardinalidad y el patrón de actualización difieren materialmente entre los tres documentos nuevos. Architecture es la que más se parece al modelo de Feature (documento vivo, incrementalmente revisado). Project Brief parece más cercana a un documento de una sola pasada. Release Plan tiene una forma compuesta (un documento con N sub-bloques por Feature) que no mapea limpiamente a ninguno de los otros dos patrones.

---

## 4. Opciones

### Opción A — Mantener FEATURE-023 separada; tres implementaciones independientes
Cada feature (F033/F034/F035) crea su propia tabla de identidad, su propia tabla de revisiones (si aplica), su propio renderer, su propio módulo de lifecycle — sin compartir código más allá de lo que ya es común gratis (`artifacts`, FEATURE-022, tabla `artifacts.kind`).

- **Impacto**: bajo riesgo para FEATURE-023 (cero cambios). Alta velocidad de entrega por feature individual.
- **Costo**: 3x duplicación de la lógica de materialización/hash/commit-guard, UI con 4 paneles de documento no relacionados entre sí, deriva de comportamiento entre documentos con el tiempo (ej. un fix de bug en la lógica de truncado de Feature no se propaga a los otros).

### Opción B — Compartir comportamiento y helpers de servicio, persistencia separada (Nivel 2)
Extraer del código actual de `lifecycle.ts`/`document.ts` las piezas genéricas identificadas en la sección 2.A como funciones/módulos reutilizables (no una tabla única): un helper `refreshCanonicalDocumentArtifact(kind, renderFn, ...)` parametrizado, un helper de materialización con guard de hash reutilizable, un componente de UI `CanonicalDocumentPanel` parametrizado por tipo de documento (consumiendo `CopyableMetadataItem` y el contrato de truncado), y consolidar el límite de 64 KiB en un solo lugar. Cada documento (Project Brief, Architecture, Release Plan) conserva su propia tabla de identidad (y su propia tabla de revisiones sólo si su cardinalidad realmente lo justifica, según la matriz de la sección 3).

- **Impacto**: cero cambios a `features`/`feature_revisions`. FEATURE-023 no se toca, sólo se refactoriza para consumir los helpers extraídos (comportamiento idéntico, verificable con los tests existentes).
- **Costo**: exige diseñar la interfaz de los helpers antes de tener 2-3 casos de uso reales — riesgo de abstraer de más si se hace en un solo paso. Mitigable extrayendo incrementalmente (ver Secuencia sugerida).

### Opción C — Persistencia documental común para los cuatro (Nivel 3)
Una tabla `canonical_documents` + `canonical_document_revisions` con discriminador `document_type`, migrando `features`/`feature_revisions` a esa estructura.

- **Impacto**: requiere migrar datos de producción de un sistema ya validado y con release plan real. Requiere resolver polimorfismo de claves de unicidad muy distintas entre los 4 documentos (project-level, product-level "vivo", release-level, release-level-compuesto) — probablemente derivando en columnas nullable/condicionales que erosionan las garantías actuales (`unique(project_id, release_key, source_key)`, `check` constraints por `producer_role`, etc.).
- **Riesgo**: alto para FEATURE-023. El propio documento de diseño de FEATURE-023 (`FEATURE-023-Lifecycle-canónico-de-Features...md`, §9 Riesgos, líneas 1870-1875) identificó explícitamente "alcance excesivamente genérico → convertir FEATURE-023 en plataforma documental universal" como un riesgo y lo mitigó deliberadamente **evitando** un motor genérico de templates. La Opción C revierte esa decisión de diseño ya tomada, sin evidencia nueva que la justifique.

---

## 5. Recomendación

**Opción B — Nivel 2: infraestructura de servicio y UI común, persistencia separada por documento.**

Razones, con evidencia:

1. FEATURE-022 (lectura por agentes) **ya es infraestructura común** sin cambios — es la prueba de que el nivel "común por diseño desde el principio" ya funciona en este sistema para el caso de lectura. No hay necesidad de replicar esto en persistencia de escritura.
2. La cardinalidad real de los 4 documentos difiere (sección 3) lo suficiente como para que una tabla polimórfica única introduzca complejidad condicional que el proyecto no necesita hoy — esto es exactamente el tipo de sobreingeniería que la investigación pide evitar.
3. FEATURE-023 ya documentó y ejecutó la decisión de no construir un motor genérico, como mitigación de riesgo explícita. Nivel 3 revertiría esa decisión sin que haya evidencia nueva (los 3 documentos nuevos no comparten estructura de sección, ni gate humano, ni relación con commit/push) que la justifique.
4. Lo que sí es código genuinamente reutilizable (helpers puros de hash/materialización, componente de UI de panel de documento, contrato de truncado unificado) puede extraerse con riesgo bajo porque son funciones sin estado y aditivas — se pueden validar contra los tests de FEATURE-023 sin tocar su comportamiento.

---

## 6. Impacto

- **DB**: sin cambios a `features`/`feature_revisions`/`artifacts`. F033/F034/F035 añaden sus propias tablas de identidad (y de revisión, sólo donde la cardinalidad lo justifique — ver secuencia sugerida). `project_config_versions` **no** debe usarse como almacenamiento de contenido documental canónico — su rol se mantiene acotado a configuración editable (`approval_mode`, `release_roadmap`); esto es consistente con la crítica que el propio diseño de FEATURE-011 hizo sobre mezclar "output de fase" con "estado operativo" (`FEATURE-011-project-config-versions.md:9-14`). El uso actual de `project_config_versions` para `release_plan` (`lifecycle.ts:203-209`) debe revisarse en el diseño de F035 para confirmar si es contenido documental (en cuyo caso debería migrar a la infraestructura documental de F035) o estado interno de selección (en cuyo caso se mantiene donde está).
- **Backend**: nuevo módulo de helpers extraído de `lifecycle.ts`/`document.ts`, consumido tanto por Feature (refactor sin cambio de comportamiento) como por los tres nuevos lifecycles.
- **Roles**: Architect gana responsabilidad formal de productor de Project Brief y Architecture en DB (hoy sólo produce prosa vía template, sin lifecycle registrado — ningún `recordArtifact` con semántica canónica existe hoy para Architect). Planning gana responsabilidad formal de productor de Release Plan.
- **UI**: `RunDetailPage.tsx` se generaliza para soportar múltiples paneles de documento por tipo (no sólo `featureDocument`), reutilizando `CopyableMetadataItem` y añadiendo la capacidad de "Descargar" que hoy no existe para ningún documento.
- **FEATURE-022**: sin cambios de código — sólo se agregan nuevos valores de `kind` al llamar `recordArtifact`.
- **Repo**: rutas canónicas **ya fijadas** por `docs/features/FEATURE-023-Distribución-versionado-y-disponibilidad-del-Runbook-en-runtime-parte-2.md:120-132` (tabla "Documentos del producto gestionado"): Project Brief → `docs/project/PROJECT-BRIEF.md` (uno por proyecto); Architecture → `docs/architecture/ARCHITECTURE.md` (uno por proyecto, incluye el Roadmap de Releases); Release Plan → `docs/releases/<release-key>/RELEASE-PLAN.md` (uno por release). *(Corrección respecto a la versión previa de este documento: los subagentes de investigación no habían revisado FEATURE-023 Parte 2, que ya resuelve estas rutas — no son una decisión pendiente de F033/034/035.)* Esa misma Parte 2 (Rule 7, líneas 211-212) deja explícito que **al implementarse F033/034/035, sus templates deben incorporarse al catálogo obligatorio del `RunbookProvider`**, y (Rule 9, líneas 227-239) que deben heredar la validación previa a persistencia documental ya construida para Feature — ambos son requisitos técnicos concretos, no opcionales.

---

## 7. Riesgos

- **Opción C (no recomendada) — regresión en FEATURE-023**: migración de datos de producción, riesgo sobre garantías de idempotencia y revisión append-only ya validadas.
- **Opción A — deuda por triplicación**: sin convergencia, cada fix o mejora (ej. agregar "Descargar") debe repetirse 4 veces; UX inconsistente entre los 4 documentos.
- **Opción B — riesgo de abstraer prematuramente**: si los helpers se diseñan antes de tener un segundo caso de uso real implementado, se corre el riesgo de generalizar mal. Mitigación: extraer incrementalmente, validando con F034 (el caso estructuralmente más parecido a Feature) antes de generalizar más.
- **Riesgo transversal — asumir que el gate humano es igual entre documentos**: Feature tiene gate de merge; Project Brief tiene gate declarativo §0; Architecture tiene gate de aprobación de Roadmap; Release Plan tiene gate de tamaño/riesgo §0. Ninguno de estos gates es intercambiable — el diseño de F033/F034/F035 debe tratarlos como dominio-específicos desde el principio, no como parte de la infraestructura común.
- **Riesgo de UI**: generalizar `RunDetailPage.tsx` toca un componente ya validado en producción — requiere refactor cuidadoso, no reescritura, con verificación de que el comportamiento de Feature no cambia.

---

## 8. Secuencia sugerida

1. **F033 (Project Brief) — extraer sólo lo inequívocamente reutilizable, sin forzar el patrón de revisión append-only**: dado que Project Brief parece producirse en una sola pasada por Architect (no hay evidencia en el template de contribuciones incrementales multi-rol como Feature), no asumir que necesita `project_brief_revisions`. Usar F033 para extraer y validar: helper de materialización+hash reutilizable, contrato de truncado unificado, componente de UI `CanonicalDocumentPanel` genérico (consumido tanto por el nuevo panel de Project Brief como, en un refactor de bajo riesgo, por el panel existente de Feature), y capacidad de "Descargar" (nueva, construida una sola vez).
2. **F034 (Architecture) — validar el patrón de revisión append-only fuera de Feature**: Architecture es el caso estructuralmente más parecido a Feature (documento vivo, incrementalmente actualizado). Usar F034 para decidir si el patrón `revisions` + `canonical pointer` se generaliza como helper compartido (ya con dos implementaciones reales para guiar la abstracción) o si se mantiene como código propio de cada documento.
3. **F035 (Release Plan) — resolver la forma compuesta**: Release Plan tiene un patrón distinto (un documento, N sub-bloques por Feature). Diseñar su granularidad de revisión después de tener evidencia de F033 y F034, y resolver primero la pregunta abierta sobre `project_config_versions.release_plan` (sección 1) antes de definir su persistencia.

No se recomienda diseñar una capa común de persistencia (Opción C) en ningún punto de esta secuencia salvo que, tras implementar F033-F035, aparezca evidencia concreta de que las tres tablas de identidad son estructuralmente idénticas — lo cual la matriz de la sección 3 no sugiere hoy.

---

## 9. Evidencia (archivos, funciones, tablas, líneas)

- `src/features/lifecycle.ts` — módulo completo (601 líneas): identidad (46-171), activación (173-250), contribuciones (252-297), materialización (299-328), commit/push (330-356), lectura UI (373-409), idempotencia (426-465, 586-593), artifact canónico (467-506), config pineado (522-562).
- `src/features/document.ts` — renderer hardcodeado (69-187), constantes de template (11-12), metadata snapshot (27-42), path convention (189-193), primitivas puras (206-212).
- `src/features/contracts.ts` — contratos de payload por rol (373 líneas).
- `migrations/0013_feature_lifecycle.sql` — tablas `features` (2-26), `feature_revisions` (28-46), columna `runs.active_feature_id` (48-51).
- `migrations/0001_init.sql:42-52` — tabla `artifacts` (genérica, sin cambios).
- `migrations/0004_project_config_versions.sql` — tabla `project_config_versions` (1-18), `run_config_versions` (20-24).
- `src/db/repository.ts:1410-1423` — `recordArtifact` (genérico), `1396-1408` — `recordRunEvent`.
- `src/cli/commands/runStart.ts` — puntos de llamada a `recordArtifact` por fase (445-450, 682-687, 844-858, 1291-1296, 1639-1644, 1819-1825); único call site con semántica canónica es vía `lifecycle.ts:480-494`.
- `src/db/artifactRepository.ts` — `listArtifactsForRunProject` (80-141), `readArtifactForRunProject` (143-183); sin lógica específica de `kind`.
- `docs/features/FEATURE-022-Lectura-universal-de-artifacts-por-todos-los-roles.md` — exclusión explícita del lifecycle de los 4 documentos del Runbook (líneas 214-238), Regla 6 (310-314).
- `web/src/runs/RunDetailPage.tsx` — `FeatureDocumentPanel` (188-250), `CopyableMetadataItem` (558-586), `RunViewModel.featureDocument` (78-91), sin botón de descarga (confirmado por revisión completa del archivo).
- `src/server/app.ts:1037-1057` — endpoint `GET /runs/:id`; `src/server/runView.ts:120,132-146` — `buildRunViewModel`.
- `docs/features/FEATURE-023-Lifecycle-canónico-de-Features-basado-en-el-Runbook.md` — exclusiones explícitas (§4, líneas 342-349, 374-386), riesgo de alcance genérico evitado deliberadamente (§9, líneas 1870-1875).
- `docs/runbook/01-PROJECT-BRIEF-TEMPLATE.md`, `02-ARCHITECTURE-TEMPLATE.md`, `07-FEATURE-TEMPLATE.md`, `09-RELEASE-PLAN-TEMPLATE.md` — estructura, ownership y cardinalidad resumidos en la sección 3.
- `docs/ROADMAP.md:1220-1242, 322-324, 389-391` — estado actual de F033/F034/F035 ("Confirmada; posterior a FEATURE-023 Parte 2, prioridad por definir"; ninguna menciona reutilizar la UI/backend de FEATURE-023 hoy).
- `docs/features/FEATURE-011-project-config-versions.md:9-14, 117-126` — alcance de `project_config_versions`, crítica a mezclar lifecycles.
- Búsqueda completa de `canonical_artifact_id` en el repo: 8 referencias en `src/features/lifecycle.ts`, 1 en `RunDetailPage.tsx` (no renderizada en UI), resto en documentos de diseño — confirma que el concepto está acotado a Feature y no contamina código compartido.
