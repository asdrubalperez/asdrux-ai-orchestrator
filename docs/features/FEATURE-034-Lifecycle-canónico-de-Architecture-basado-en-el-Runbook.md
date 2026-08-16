# FEATURE-034 — Lifecycle canónico de Architecture basado en el Runbook

## 1. Feature Identity

* Name: Lifecycle canónico de Architecture basado en el Runbook
* Type: Arquitectura / Workflow / Persistencia documental / UI
* Owner: Asdru — Product Owner
* Implementation Owner: DAIA
* Status: Implementada y validada E2E en vivo (VPS) — pendiente de merge a `main` por decisión del owner
* Priority: según ROADMAP vigente
* Playbook Mode: Standard
* Template de gobernanza: `docs/playbook/07-FEATURE-TEMPLATE.md`
* Template operativo: `docs/runbook/02-ARCHITECTURE-TEMPLATE.md`
* Documento canónico: `docs/architecture/ARCHITECTURE.md`
* Cardinalidad: uno por proyecto
* Producer: Architect
* Consumers: Functional y el resto del pipeline

Architecture es un documento vivo por producto, inicializado por Architect y actualizable
posteriormente cuando surjan nuevas decisiones técnicas. El Runbook también establece que el
Roadmap de Releases forma parte de su sección 0.

## 2. Problem Statement

### Current limitation

FEATURE-033 ya convirtió Project Brief en un documento canónico persistido, materializado y
disponible vía UI/F022.

Architecture todavía no tiene ese lifecycle.

Actualmente Architect produce:

* `ARTEFACTO`
* `ROADMAP`
* `PROJECT_BRIEF`

donde:

* `PROJECT_BRIEF` ya tiene lifecycle canónico;
* `ARTEFACTO` sigue siendo una propuesta técnica genérica;
* `ROADMAP` es un contrato operacional independiente utilizado por el Approval Gate existente.

Esto genera una brecha respecto del Runbook:

```
Project Brief canónico
        ↓
Architecture canónica
        ↓
Functional
```

hoy se comporta aproximadamente como:

```
Project Brief canónico
        ↓
ARTEFACTO genérico + ROADMAP operacional
        ↓
Functional
```

Además, Architecture debe poder evolucionar a lo largo de la vida del producto sin convertirse en
una plataforma documental genérica ni alterar el workflow existente.

### Business need

El sistema necesita:

* una identidad durable de Architecture por proyecto;
* una versión canónica vigente;
* historial preservado;
* representación Markdown determinística;
* materialización en la ruta definida por el Runbook;
* lectura mediante FEATURE-022;
* exposición en UI;
* coherencia entre el Roadmap aprobado y la sección 0 de `ARCHITECTURE.md`;
* preservación estricta del Approval Gate actual de Roadmap.

El circuito actual de aprobación depende directamente del tag plano `ROADMAP` emitido por
Architect: `extractRoadmapApproval()` lo lee desde el `outputArtifact`, y esa extracción es
utilizada para reconocer el gate antes del retry genérico.

Por tanto, F034 no debe reemplazar ese contrato operacional.

## 3. Functional Goal

Al finalizar FEATURE-034:

1. Architect producirá explícitamente un payload estructurado `ARCHITECTURE`.
2. `ARCHITECTURE` representará las secciones técnicas de `02-ARCHITECTURE-TEMPLATE.md`.
3. Architect continuará declarando `ROADMAP:` mediante el contrato actual.
4. `ARCHITECTURE` no volverá a declarar el Roadmap.
5. El Roadmap aprobado persistido en `project_config_versions.release_roadmap` será utilizado por
   el renderer para construir la sección 0 del documento canónico.
6. `extractRoadmapApproval`, la clasificación del gate y el circuito actual de aprobación
   conservarán su comportamiento.
7. Existirá una única identidad de Architecture por proyecto.
8. Existirá una única versión canónica vigente.
9. Cada actualización real producirá un nuevo artifact histórico `architecture_document`.
10. Actualizar la versión vigente no destruirá artifacts anteriores.
11. F034 v1 no introducirá `architecture_revisions`.
12. Architecture se materializará únicamente en `docs/architecture/ARCHITECTURE.md`.
13. El contenido será una proyección determinística.
14. FEATURE-022 podrá descubrirlo y leerlo sin cambios.
15. La UI permitirá Ver, Copiar y Descargar Architecture.
16. F034 añadirá también Descargar al documento de Feature.
17. Feature y Project Brief conservarán sus lifecycles existentes.
18. Las primitivas documentales realmente comunes podrán extraerse a un módulo neutral.
19. El shell visual común de documentos podrá generalizarse.
20. No se introducirá un lifecycle documental universal.
21. No se añadirá una invocación automática de Architect después de cada Feature.
22. F035 permanecerá fuera de alcance.

## 4. Scope

### Included

#### Architecture como output explícito de Architect

El contrato de Architect incorporará un payload estructurado:

```
ARCHITECTURE:
{
  "analisisTecnico": {...},
  "componentes": [...],
  "riesgos": [...],
  "hallazgos": "..."
}
```

El naming exacto puede ajustarse durante Development siempre que permanezca:

* estructurado;
* determinístico;
* provider-agnostic;
* validable sin depender de wording literal.

#### Roadmap operacional existente

Architect seguirá produciendo `ROADMAP:` exactamente para el circuito de aprobación existente.

F034 no sustituirá ese tag por `ARCHITECTURE.roadmap`.

Esto protege:

* `extractRoadmapApproval`;
* clasificación `roadmap_approval`;
* persistencia de `release_roadmap`;
* reentrada de Architect tras aprobación.

El mecanismo actual está explícitamente acoplado al tag `ROADMAP`.

#### Composición de la sección 0

El documento final (`docs/architecture/ARCHITECTURE.md`) contendrá:

* §0 Roadmap de Releases
* §1 Análisis Técnico
* §2 Componentes Técnicos
* §3 Análisis de Riesgo
* §4 Hallazgos y Anomalías
* §5 Chequeo Interno Antes de Entrega

Pero §0 no provendrá de una segunda copia generada por el modelo. El renderer combinará
`ARCHITECTURE` payload + `project_config_versions.release_roadmap`.

El Runbook exige que Architecture siempre contenga un Roadmap y al menos un release activo.

#### Persistencia propia

F034 tendrá persistencia específica de Architecture. Conceptualmente `architectures`, con
garantías mínimas de: `project_id` único; `source_event_key`; template key/version/hash/snapshot;
`canonical_artifact_id`; `final_document_path`; `document_hash`; trazabilidad a runs; timestamps.

No se creará una tabla polimórfica común.

#### Historial

No se crean `architecture_revisions` en v1. El historial se conserva mediante: artifact anterior,
artifact nuevo, `canonical_artifact_id` → vigente.

Architecture es viva, pero el template deja abierto el mecanismo concreto de actualización dentro
del ciclo de una Feature. No existe evidencia suficiente para introducir contribuciones por
sección o revisiones multirol en esta versión.

#### Artifact canónico

Nuevo `kind`: `architecture_document`. El artifact deberá conservar al menos: summary; projectId;
templateKey; templateVersion; payload técnico; Roadmap aprobado utilizado; Markdown canónico.

#### Renderer específico

Se implementará un renderer específico de Architecture. No se introducirá DSL, template engine
universal, parser Markdown genérico ni renderer dinámico por descriptor.

#### RunbookProvider

`02-ARCHITECTURE-TEMPLATE.md` deberá incorporarse al catálogo obligatorio del `RunbookProvider`.
La resolución del template y su metadata ocurrirá antes de persistir el documento, siguiendo el
patrón fail-closed ya utilizado por F033.

#### Materialización

Ruta única: `docs/architecture/ARCHITECTURE.md`. Debe preservar: UTF-8; LF; SHA-256; protección
contra path traversal; actualización segura; hash persistido.

#### Capacidades comunes

F034 podrá extraer primitivas realmente comunes ya usadas por Feature y Project Brief, por
ejemplo: `normalizeLf`; `sha256`; contrato común de truncado; materialización segura reutilizable
cuando no arrastre lógica de dominio.

Actualmente Project Brief ya importa `normalizeLf` y `sha256` desde el módulo documental de
Feature, demostrando que esas primitivas ya tienen más de un consumidor real.

#### UI común

Con Feature + Project Brief + Architecture existirán tres usos reales. F034 podrá reemplazar
duplicación visual por un shell reutilizable equivalente a `CanonicalDocumentPanel`, sin mover los
lifecycles específicos al componente común.

El panel deberá admitir: título; metadata; path; Markdown; truncado; Copiar; Descargar;
comportamiento opcional de autoapertura.

Feature conservará su lógica especial de autoapertura asociada a `pushed`.

#### Descargar Feature

Incluido explícitamente. `FeatureDocumentPanel` deberá ofrecer: Ver; Copiar; Descargar `.md`. El
helper `downloadMarkdown` ya existe por F033. La tarea `task_e3770415` queda absorbida por F034.

#### FEATURE-022

Sin cambios. Architecture se leerá mediante `artifact_list`/`artifact_read`, igual que el resto de
artifacts del proyecto.

### Excluded

Quedan fuera:

* Release Plan / F035;
* `architecture_revisions`;
* tabla universal de documentos;
* tabla universal de revisiones;
* migración de features;
* migración de project_briefs;
* motor universal de templates;
* editor humano de Architecture;
* diff visual;
* repo → DB;
* nuevos APIs de lectura por documento;
* cambios en FEATURE-022;
* invocación automática de Architect tras cada Feature;
* cambios al Approval Gate general;
* cambios de Developer/QA;
* resolución de `project_config_versions.release_plan`;
* reescritura de `extractRoadmapApproval` salvo incompatibilidad real descubierta durante
  Development.

## 5. Functional Rules

**Rule 1 — Producer.** Architect es el único productor de Architecture en F034.

**Rule 2 — Cardinalidad.** Existe como máximo una identidad Architecture por proyecto.

**Rule 3 — Roadmap permanece operacional.** `ROADMAP:` conserva su contrato actual. No se mueve
dentro de `ARCHITECTURE`.

**Rule 4 — Roadmap canónico.** La sección 0 de `ARCHITECTURE.md` se renderiza desde el
`release_roadmap` aprobado persistido operacionalmente.

**Rule 5 — No duplicación.** El modelo no genera dos copias del Roadmap.

**Rule 6 — Persistencia sólo tras estado válido.** Architecture canónica se persiste cuando
Architect completa legítimamente su fase siguiendo el gate existente. La primera propuesta
escalada de Roadmap no genera todavía una Architecture canónica definitiva. F033 ya utiliza este
criterio para Project Brief.

**Rule 7 — Roadmap requerido.** Si Architect llega a `completed` pero no existe un
`release_roadmap` operacional válido: fail closed. No se genera Architecture sin sección 0.

**Rule 8 — Una representación canónica.**

```
ARCHITECTURE payload
+
release_roadmap aprobado
        ↓
     renderer
        ↓
Markdown canónico
   ↙       ↓       ↘
artifact   UI      repo
```

**Rule 9 — DB como fuente operacional.** El archivo del repo es una proyección. No existe
sincronización inversa repo → DB.

**Rule 10 — Idempotencia.** Mismo evento durable no crea duplicados.

**Rule 11 — Contenido equivalente.** Si un nuevo evento produce exactamente el mismo contenido
canónico: no crear una versión documental innecesaria. La comparación deberá considerar tanto
Architecture técnica como Roadmap aprobado.

**Rule 12 — Cambio real.** Si cambia Architecture técnica o cambia legítimamente el Roadmap
aprobado: crear nuevo artifact; actualizar `canonical_artifact_id`.

**Rule 13 — Historial.** Artifacts históricos no se eliminan al cambiar la versión vigente.

**Rule 14 — Sin revisions v1.** No se introduce granularidad de revisiones por sección sin
evidencia real.

**Rule 15 — Riesgo determinístico.** La severidad se obtiene de la matriz del Runbook, no de
criterio libre.

**Rule 16 — Prompt mapping explícito.** El prompt debe indicar de dónde provienen los datos
estructurados relevantes. No confiar en nombres conceptuales del template como única guía.

**Rule 17 — Reentradas.** La generación/corrección de Architecture no dependerá del concepto
ambiguo de "primera invocación".

**Rule 18 — Cuándo declarar `ARCHITECTURE` (agregada en revisión — mismo bug real que F033 Bug
#2).** Architect debe declarar `ARCHITECTURE` en la **misma respuesta donde declara `ROADMAP` con
contenido real** (la propuesta inicial escalada) — no diferirlo al reingreso. Al reingresar con
`ESTADO: completed` tras la aprobación humana, debe **conservar exactamente el mismo
`ARCHITECTURE` ya propuesto** (mismo criterio que la Regla 5 de `architect.txt` para
`ARTEFACTO`/`ROADMAP`/`PROJECT_BRIEF`), no regenerarlo ni dejarlo `null`. Esta regla existe porque
en F033 la ambigüedad equivalente sobre "cuándo corresponde declarar el documento" hizo que
`PROJECT_BRIEF` saliera `null` en un reintento legítimo — se cierra acá en el diseño en vez de
redescubrirse en producción.

**Rule 19 — Validación estructural.** El parser valida estructura, enums, cardinalidad y
consistencia. No exige wording literal salvo cuando el wording sea dato contractual.

**Rule 20 — FEATURE-022.** Es el mecanismo universal de lectura.

**Rule 21 — Backward compatibility.** Feature y Project Brief deben preservar comportamiento
validado.

**Rule 22 — Approval Gate protegido.** F034 no cambiará deliberadamente el circuito existente de
`ROADMAP:`.

## 6. Estrategia Algorítmica

No aplica como optimización, pero existe lógica determinística relevante.

### Flujo documental

```
Project Brief válido
        ↓
Architect produce:
ARCHITECTURE técnica (Rule 18: declarada ya en esta pasada)
+
ROADMAP operacional
        ↓
ROADMAP abre Approval Gate existente
        ↓
humano aprueba
        ↓
release_roadmap persistido
        ↓
Architect reingresa → completed
        ↓
(Rule 18: mismo ARCHITECTURE conservado, no regenerado)
        ↓
parse ARCHITECTURE
        ↓
leer release_roadmap aprobado
        ↓
validar Architecture
        ↓
componer §0 + §1-§5
        ↓
render determinístico
        ↓
recordArtifact(architecture_document)
        ↓
actualizar canonical_artifact_id
        ↓
materializar
        ↓
F022 / UI
```

### Matriz de severidad

El runtime valida esta matriz exacta:

| Riesgo | Impacto | Severidad |
|---|---|---|
| Bajo | Bajo | Baja |
| Bajo | Medio | Baja |
| Bajo | Alto | Media |
| Medio | Bajo | Baja |
| Medio | Medio | Alta |
| Medio | Alto | Alta |
| Alto | Bajo | Media |
| Alto | Medio | Alta |
| Alto | Alto | Alta |

Coincide con el Runbook (verificado contra `docs/runbook/02-ARCHITECTURE-TEMPLATE.md` §3).

La acción recomendada debe respetar además: Baja → Aceptar; Media → Gestionar o Transferir; Alta →
Mitigar, Reducir o Eliminar.

### Idempotencia canónica

La comparación relevante será conceptualmente:

```
canonicalJson({
  architecturePayload,
  approvedReleaseRoadmap
})
```

No únicamente el payload técnico de Architect.

## 7. Technical Considerations

### Componentes afectados

Previsiblemente: `src/executor/roles/architect.txt`; parser/contracts de Architect;
`runStart.ts`; nuevo lifecycle/document renderer de Architecture; migration para identidad
Architecture; `RunbookProvider`; run view/backend; `RunDetailPage.tsx`; helpers documentales
comunes; tests.

### Approval Gate — área sensible

`extractRoadmapApproval()` busca directamente `ROADMAP` en el output crudo de Architect. Por eso
F034 adopta la estrategia de menor riesgo: mantener `ROADMAP` operativo + componer §0 en renderer,
en vez de reescribir la clasificación del gate.

### Prompt engineering

Aplicar desde diseño las lecciones de F033: mapping explícito desde contexto real; no condicionar
a "primera invocación"; validar estructura en vez de wording innecesario; y (Rule 18) declarar el
documento en la propuesta inicial y conservarlo en el reingreso, no diferirlo.

### Persistencia

Mantener Opción B / Nivel 2: capacidades comunes, persistencias separadas. No introducir
plataforma documental universal.

### Actualización futura de Architecture

El Runbook define Architecture como viva, pero deja abierto exactamente cuándo se retroalimenta
durante una Feature. F034 no modifica ese workflow. Actualiza Architecture sólo cuando Architect
sea invocado legítimamente por mecanismos ya existentes (incluidas las transiciones de release ya
soportadas por FEATURE-018/036, que ya vuelven a invocar a Architect sin que F034 tenga que
inventar un nuevo disparador).

## 8. Validation Criteria

**Scenario 1 — Architecture inicial.** Input: Project Brief válido y Business Case suficiente.
Expected: Architect produce `ARCHITECTURE` técnica y `ROADMAP` en la misma respuesta (Rule 18).

**Scenario 2 — Approval Gate.** Input: Architect devuelve `ESTADO: escalated` + `ROADMAP` válido.
Expected: `extractRoadmapApproval()` lo reconoce; se clasifica como `roadmap_approval`; no entra
al retry genérico; se presenta al humano.

**Scenario 3 — Aprobación.** Input: humano aprueba Roadmap. Expected: `release_roadmap` queda
persistido; Architect reingresa conservando el mismo `ARCHITECTURE` (Rule 18); llega a `completed`.

**Scenario 4 — Composición canónica.** Input: Architecture técnica + Roadmap aprobado. Expected:
`ARCHITECTURE.md` contiene §0 exactamente a partir del Roadmap operacional aprobado.

**Scenario 5 — No duplicación.** Expected: `ARCHITECTURE` no incluye otra copia del Roadmap.

**Scenario 6 — Roadmap ausente.** Input: Architect `completed`, pero no existe Roadmap
operacional válido. Expected: fail-closed; no Architecture canónica parcial.

**Scenario 7 — Matriz de riesgo.** Para las nueve combinaciones Riesgo×Impacto: Expected:
severidad exacta según Runbook.

**Scenario 8 — Idempotencia.** Input: mismo evento durable. Expected: no nuevo artifact.

**Scenario 9 — Contenido idéntico.** Input: evento distinto con mismo Architecture + mismo
Roadmap. Expected: no nueva versión documental innecesaria.

**Scenario 10 — Cambio técnico.** Input: Architecture técnica cambia legítimamente. Expected:
nuevo artifact + puntero vigente actualizado.

**Scenario 11 — Cambio de Roadmap.** Input: contenido técnico igual, Roadmap aprobado diferente
por transición legítima. Expected: nueva versión canónica.

**Scenario 12 — Persistencia.** Expected: máximo una identidad Architecture por proyecto.

**Scenario 13 — Materialización.** Expected: sólo `docs/architecture/ARCHITECTURE.md`, contenido
idéntico al artifact canónico.

**Scenario 14 — FEATURE-022.** Expected: roles del mismo proyecto pueden descubrir y leer
Architecture; otros proyectos no.

**Scenario 15 — UI Architecture.** Expected: Ver + Copiar + Descargar.

**Scenario 16 — UI Feature.** Expected: Feature incorpora Descargar sin alterar: autoapertura;
estado de publicación; approval mode; merge semantics.

**Scenario 17 — Project Brief.** Expected: ninguna regresión.

**Scenario 18 — Runbook inválido.** Expected: fail-closed antes de persistencia.

**Scenario 19 — E2E real.**

```
Business Case
→ Architect
→ Project Brief
→ Architecture + ROADMAP
→ Approval Gate
→ humano aprueba
→ Architect completed
→ Architecture canónica
→ Functional
```

Validar: DB; artifacts; `release_roadmap`; archivo; hash; F022; UI; descarga.

### Validation Evidence

Nivel recomendado: L3 dirigido. No L4 ni regresión masiva.

## 9. Risks

| # | Riesgo | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|---|
| R1 | Romper Approval Gate de Roadmap | Media | Alto | Alta | Conservar el tag `ROADMAP:` y evitar reescribir el circuito ya validado |
| R2 | Duplicación/divergencia de Roadmap | Media | Alto | Alta | `ARCHITECTURE` no declara Roadmap; el renderer toma el aprobado desde configuración operacional |
| R3 | Architecture canónica sin Roadmap válido | Baja | Alto | Media | Fail-closed antes de persistencia |
| R4 | Sobreingeniería mediante `architecture_revisions` | Media | Medio | Alta | Artifacts históricos + puntero vigente en v1; reevaluar sólo con evidencia |
| R5 | Generalización excesiva de lifecycles | Media | Alto | Alta | Generalizar sólo primitivas y shell UI, no persistencia ni dominio |
| R6 | Regresión del panel Feature | Media | Medio | Alta | Refactor localizado y escenarios de regresión específicos |
| R7 | Prompt ambiguo (incluye Rule 18) | Media | Alto | Alta | Mapping explícito, reentradas semánticas y parser estructural |
| R8 | Drift entre DB/artifact/repo/UI | Baja | Alto | Media | Una única proyección canónica |
| R9 | Inventar actualización automática de Architecture | Baja | Medio | Baja | No alterar el workflow; el Runbook deja ese mecanismo abierto |

## 10. Approval Gate

### Diseño propuesto para aprobación

* **D1** — Architecture es un documento canónico vivo, uno por proyecto, producido exclusivamente
  por Architect.
* **D2** — El contrato operacional `ROADMAP:` existente se mantiene sin cambios. `ARCHITECTURE`
  no duplica el Roadmap; el renderer compone la sección 0 desde
  `project_config_versions.release_roadmap` ya aprobado.
* **D3** — `release_roadmap` continúa siendo la fuente operacional autoritativa del Roadmap
  aprobado.
* **D4** — F034 v1 no introduce `architecture_revisions`; conserva historial mediante artifacts
  inmutables y puntero canónico vigente.
* **D5** — F034 no añade una invocación automática de Architect después de cada Feature.
* **D6** — Se mantiene Opción B / Nivel 2: capacidades comunes, persistencias de dominio
  separadas.
* **D7** — F034 extrae sólo primitivas documentales realmente comunes y puede generalizar el
  shell UI, no los lifecycles.
* **D8** — FEATURE-022 permanece sin cambios.
* **D9** — F034 agrega Descargar al panel de Feature como parte obligatoria del alcance.
* **D10** — El Approval Gate actual de Roadmap se considera comportamiento protegido por
  regresión.
* **D11** (agregada en revisión) — Architect debe declarar `ARCHITECTURE` en la propuesta inicial
  escalada junto con `ROADMAP`, y conservarlo sin cambios en el reingreso `completed` — no
  diferirlo a la segunda invocación (Rule 18).

### Estado

**GO — aprobado para Development**, tras revisión que confirmó la matriz de riesgo exacta contra
el Runbook y agregó D11/Rule 18 para prevenir en diseño el mismo bug real que F033 encontró en
producción (Project Brief `null` en un reintento legítimo).

## 11. Resultado de Validación E2E

**Fecha:** 2026-08-16. **Rama:** `feature/FEATURE-034-architecture-lifecycle`. **Entorno:** VPS
real (`asdru@179.197.79.99`, servicio `ai-orchestrator.service`, Postgres real vía Docker), caso
de negocio real corrido por el owner a través del frontend en Vercel.

### Qué se validó

Con un caso de negocio real, el flujo corrió de punta a punta sin necesidad de iterar sobre bugs
de prompt (a diferencia de F033) — la Rule 18 agregada en la revisión de diseño previno en el
primer intento el bug que en F033 recién se encontró en producción:

1. Architect declaró `ARCHITECTURE` junto con `ROADMAP` en la propuesta inicial escalada
   (verificado antes de aprobar, como pedía el plan de prueba).
2. El owner aprobó el Roadmap; Architect reingresó con `ESTADO: completed`, conservando el mismo
   `ARCHITECTURE` ya propuesto (Rule 18/Scenario 3).
3. `persistArchitecture` se disparó correctamente; §0 del documento canónico coincide exactamente
   con el Roadmap aprobado por el humano (Scenario 4), sin una segunda copia divergente del
   modelo (Scenario 5).
4. El documento quedó materializado en `docs/architecture/ARCHITECTURE.md`; contenido íntegro (5
   secciones, tabla de riesgos con severidad correctamente derivada — Medio+Alto→Alta, Bajo+Medio→Baja,
   confirmando la matriz también en producción, no sólo en tests).
5. El panel "Architecture" apareció en el Run Detail junto a Project Brief, con
   Ver/Copiar/Descargar funcionando.
6. El pipeline continuó **sin regresión** a través de Functional, Planning, Developer y QA hasta
   el gate de aprobación de merge (Modo Manual) — evidencia más profunda que la validación de
   F033, que no había llegado tan lejos en el pipeline.
7. Project Brief (F033) siguió funcionando sin cambios (Scenario 17), visible en el mismo Run
   Detail junto a Architecture y Feature.

El owner decidió no aprobar el merge de esta corrida de prueba (no aportaba evidencia adicional
relevante para el alcance de F034) — la validación se dio por completa en el paso 6.

### Bug encontrado y corregido durante la validación en vivo

Uno solo, cosmético — la infraestructura documental funcionó correctamente desde el primer
intento gracias a Rule 18/D11 haber sido incorporadas en el diseño antes de implementar:

1. **Inconsistencia de texto entre paneles.** El botón del panel de Feature decía "Ver documento
   de Feature" (texto original de FEATURE-023, previo a que existieran otros paneles de
   documento), mientras Project Brief y Architecture dicen sólo "Ver documento" — el título de la
   card ya identifica de qué documento se trata. **Fix:** unificado a "Ver documento" en los tres
   paneles. Sin tests que dependieran del texto anterior.

### Conclusión

FEATURE-034 queda validada end-to-end contra infraestructura real, con evidencia de pipeline
completo (incluido Developer/QA) y sin regresión sobre FEATURE-023/FEATURE-033. La regla agregada
en la revisión de diseño (Rule 18/D11) demostró su valor: el bug que en F033 recién se detectó en
producción no se repitió acá porque ya estaba prevenido en el diseño. Pendiente de decisión del
owner sobre el merge a `main`.
