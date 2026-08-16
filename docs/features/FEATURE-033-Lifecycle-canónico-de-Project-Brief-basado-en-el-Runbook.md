# FEATURE-033 — Lifecycle canónico de Project Brief basado en el Runbook

## 1. Feature Identity

* Name: Lifecycle canónico de Project Brief basado en el Runbook
* Type: Arquitectura / Workflow / Persistencia documental / UI
* Owner: Asdru — Product Owner
* Implementation Owner: DAIA
* Status: Diseño propuesto — pendiente de Approval Gate
* Priority: A confirmar/mantener según ROADMAP vigente
* Playbook Mode: Standard
* Template de gobernanza: `docs/playbook/07-FEATURE-TEMPLATE.md`
* Template operativo: `docs/runbook/01-PROJECT-BRIEF-TEMPLATE.md`
* Documento canónico del producto: `docs/project/PROJECT-BRIEF.md`
* Cardinalidad: uno por proyecto

La ruta y cardinalidad ya fueron fijadas por FEATURE-023 Parte 2.

## 2. Problem Statement

### Limitación actual

El Orquestador ya dispone de:

* artifacts genéricos por fase;
* lectura universal mediante FEATURE-022;
* infraestructura de Runbook disponible en runtime;
* lifecycle canónico completo para documentos de Feature;
* recuperación del documento de Feature desde backend/UI.

Sin embargo, Architect todavía no produce un Project Brief con identidad documental canónica y durable.

El Project Brief que prescribe `01-PROJECT-BRIEF-TEMPLATE.md` no tiene hoy lifecycle propio equivalente a su importancia dentro del Runbook.

Esto provoca que:

* el Business Case pueda pasar a fases posteriores sin quedar formalizado como Project Brief canónico;
* Architect siga produciendo un output genérico de fase;
* Functional no tenga una referencia inequívoca al Project Brief vigente;
* no exista persistencia específica del documento;
* no exista materialización obligatoria en `docs/project/PROJECT-BRIEF.md`;
* no exista una experiencia homogénea para verlo, copiarlo y descargarlo;
* el documento no participe de las capacidades documentales comunes que ya existen alrededor de Feature.

El ROADMAP define precisamente que F033 debe resolver creador, actualizadores, validación, persistencia DB, ubicación canónica, versionado, lectura F022 y UI.

## 3. Functional Goal

Al finalizar FEATURE-033:

1. Architect producirá explícitamente el Project Brief conforme a `01-PROJECT-BRIEF-TEMPLATE.md`.
2. El Orquestador validará los requisitos estructurales antes de considerar válido el documento.
3. Los datos declarativos que el template prohíbe inferir permanecerán bajo autoridad humana.
4. Si falta información obligatoria no inferible, Architect escalará en vez de inventarla.
5. Cada proyecto tendrá una identidad inequívoca de Project Brief.
6. Existirá una única versión canónica vigente.
7. El Project Brief canónico será persistido operacionalmente en DB.
8. La representación Markdown será determinística.
9. Se conservará metadata del template activo — versión, hash y snapshot— siguiendo el patrón probado por FEATURE-023.
10. El documento se registrará como artifact canónico con un `kind` específico.
11. FEATURE-022 podrá descubrirlo y leerlo sin cambios de infraestructura.
12. Functional podrá consumir la referencia canónica del Project Brief.
13. El documento podrá materializarse únicamente en `docs/project/PROJECT-BRIEF.md`.
14. El Project Brief visible en UI, descargado y materializado provendrá de la misma representación canónica.
15. La UI permitirá Ver, Copiar y Descargar `.md`.
16. La existencia y visualización del documento no constituirá aprobación humana.
17. FEATURE-023 conservará exactamente su comportamiento actual.
18. F033 extraerá únicamente capacidades documentales compartidas inequívocas.
19. No se introducirá una plataforma documental genérica.
20. Architecture y Release Plan permanecerán fuera de implementación.

## 4. Scope

### Included

#### 4.1 Producción explícita por Architect

Architect pasa a ser el productor formal del Project Brief.

El output de Architect deberá distinguir el Project Brief de cualquier otro producto arquitectónico posterior.

F033 no absorbe F034.

#### 4.2 Validación contra el template operativo

El Project Brief debe respetar `01-PROJECT-BRIEF-TEMPLATE.md`.

Especialmente, el gate declarativo del template debe considerarse parte del contrato funcional:

```
Business Case
```

    ↓
¿están los declarativos obligatorios?
    ├─ No → escalamiento humano
    └─ Sí → Architect continúa

El modelo no completa información que el template reserva al humano.

#### 4.3 Identidad durable por proyecto

Existirá como máximo un Project Brief canónico vigente por proyecto.

Su identidad no depende de un run concreto.

Un retry o reingreso de Architect no debe crear accidentalmente un segundo Project Brief para el mismo proyecto.

#### 4.4 Persistencia específica

F033 deberá tener persistencia propia de Project Brief.

No se utilizará una tabla polimórfica común para Feature/Project Brief/Architecture/Release Plan.

La investigación recomienda explícitamente Opción B / Nivel 2: capacidades compartidas y persistencias separadas.

El diseño físico exacto de tabla pertenece a Development, siempre que preserve:

* identidad por proyecto;
* referencia al artifact canónico;
* metadata de template;
* trazabilidad al run productor;
* idempotencia;
* timestamps necesarios.

#### 4.5 Versionado / correcciones

F033 no asumirá automáticamente un modelo `project_brief_revisions` equivalente a `feature_revisions`.

Project Brief no tiene evidencia de lifecycle incremental multirol comparable al documento de Feature.

Pero tampoco se define como inmutable para siempre.

La implementación deberá soportar correctamente al menos:

```
Architect
```

→ escalamiento
→ respuesta humana
→ reingreso/retry
→ Project Brief canónico válido

La estrategia mínima de historial podrá apoyarse en artifacts inmutables + referencia al vigente si eso satisface trazabilidad e idempotencia sin agregar una tabla de revisions innecesaria.

Una estructura append-only específica sólo se justificará si DAIA demuestra que el lifecycle real la necesita.

#### 4.6 Artifact canónico

Se introducirá un `kind` específico, conceptualmente:

```
project_brief_document
```

La tabla genérica `artifacts` ya soporta nuevos `kind` sin cambios estructurales. FEATURE-022 tampoco contiene lógica específica de Feature.

#### 4.7 Representación Markdown

El renderer de Project Brief será específico de `01-PROJECT-BRIEF-TEMPLATE`.

No se construirá:

* parser universal;
* DSL;
* motor genérico de templates;
* renderer dinámico por descriptor.

La estrategia será:

```
un template
```

→ un renderer determinístico

FEATURE-023 ya tomó deliberadamente la decisión de evitar una plataforma documental universal.

#### 4.8 Metadata del Runbook

Debe conservarse:

* template key;
* versión;
* SHA-256;
* snapshot utilizado.

Los assets del Runbook provienen del `RunbookProvider`, no del repositorio gestionado. FEATURE-023 Parte 2 establece además fail-closed ante asset ausente, ilegible o inválido.

#### 4.9 Ruta canónica

La materialización será exclusivamente:

```
docs/project/PROJECT-BRIEF.md
```

No se inventa otra ruta.

La pertenencia y cardinalidad ya están definidas en FEATURE-023 Parte 2.

#### 4.10 FEATURE-022

Todos los roles seguirán utilizando:

```
artifact_list
artifact_read
```

No se agregarán:

```
read_project_brief
get_project_brief
project_brief_read
```

salvo evidencia técnica que invalide FEATURE-022, cosa que la investigación no encontró.

#### 4.11 Capacidades documentales compartidas

F033 será el primer segundo consumidor real, además de Feature, de determinadas capacidades.

Se permite extraer de FEATURE-023 exclusivamente lo demostrado como reusable:

* `normalizeLf`;
* SHA-256;
* helpers de materialización segura cuando encajen realmente;
* contrato común de tamaño/truncado;
* DTO/presentación documental común;
* panel UI reutilizable;
* copiar;
* descargar Markdown.

No se extraerá lógica de dominio Feature.

La investigación identifica precisamente estas piezas como las candidatas reales de reutilización.

#### 4.12 UI

La experiencia conceptual común será:

```
Project Brief
[ Ver documento ]
```

y en el diálogo:

```
Markdown canónico
[ Copiar ] [ Descargar .md ] [ Cerrar ]
```

El panel actual de Feature ya implementa visualización, modal, copiar y truncado, aunque está acoplado a Feature y no posee descarga.

F033 podrá generalizarlo de forma localizada hacia un componente equivalente a `CanonicalDocumentPanel`.

El nombre concreto no es contractual.

#### 4.13 Integración de Feature en la experiencia común

El panel existente de Feature podrá migrarse al componente común siempre que:

* no cambie su comportamiento;
* conserve su información específica;
* conserve la autoapertura asociada a `pushed`;
* conserve sus estados y approval semantics;
* los tests actuales continúen pasando.

Feature no adopta el lifecycle de Project Brief.

Sólo reutiliza capacidades UI/documentales.

#### 4.14 Incorporación al catálogo obligatorio del Runbook

FEATURE-023 Parte 2 deja explícitamente pendiente para F033 (Rule 7 y Rule 9 de esa parte):

* incorporar `01-PROJECT-BRIEF-TEMPLATE.md` al catálogo obligatorio de `RunbookProvider`, de modo que el startup del servidor lo valide (raíz, versión, lectura, SHA-256) igual que hoy valida `07-FEATURE-TEMPLATE.md`;
* heredar el contrato de validación previa a persistencia documental (resolver template, hash y path relativo antes de abrir la transacción que persiste el Project Brief), el mismo que ya usa Functional para Feature.

Sin este ítem, el fail-closed descrito en 4.8 y validado por el Scenario 14 no tiene dónde anclarse a nivel de implementación: el catálogo obligatorio de startup hoy no conoce este asset.

### Excluded

Quedan fuera de F033:

* lifecycle de Architecture;
* lifecycle de Release Plan;
* persistencia polimórfica común;
* migración de `features`;
* migración de `feature_revisions`;
* tabla `canonical_documents`;
* tabla universal de revisions;
* motor genérico de templates;
* parser genérico de Markdown;
* edición humana del Project Brief desde UI;
* sincronización bidireccional repo → DB;
* cambio de FEATURE-022;
* nuevos filtros de artifacts;
* comparación visual entre versiones;
* aprobación humana adicional del Project Brief;
* cambios de Developer/QA;
* readiness;
* cambios al merge gate de Feature;
* cambios a `project_config_versions` para contenido canónico;
* F035 / resolución de `project_config_versions.release_plan`.

## 5. Functional Rules

### Rule 1 — Autoridad del Runbook

La estructura del Project Brief proviene únicamente de:

```
docs/runbook/01-PROJECT-BRIEF-TEMPLATE.md
```

resuelta mediante el proveedor de Runbook de runtime.

### Rule 2 — Business Case es datos, no instrucciones

El Business Case no puede alterar:

* reglas del rol;
* template;
* workflow;
* seguridad;
* ownership.

### Rule 3 — Declarativos humanos

Todo campo marcado por el template como exclusivamente declarativo debe:

* venir del humano;
* o provocar escalamiento.

Nunca será inferido para lograr que el pipeline avance.

### Rule 4 — Creador

Architect es el único creador del Project Brief en F033.

### Rule 5 — Actualizadores

F033 no introduce actualizadores de otros roles.

Functional, Planning, Developer y QA son consumidores, no productores del Project Brief.

Un reingreso posterior de Architect podrá sustituir la versión canónica cuando el workflow legítimamente lo requiera.

### Rule 6 — Identidad por proyecto

```
project_id → máximo un Project Brief vigente
```

Runs distintos del mismo proyecto no crean identidades distintas.

### Rule 7 — Idempotencia

Reprocesar el mismo resultado durable de Architect no debe producir documentos duplicados ni estados inconsistentes.

### Rule 8 — Una representación canónica

```
estado persistido
      ↓
   renderer
      ↓
Markdown canónico
   ↙    ↓     ↘
artifact UI    repo
```

UI y repo nunca generan representaciones independientes.

### Rule 9 — DB es fuente operacional

Durante el pipeline, la fuente operacional es la persistencia del Orquestador.

El archivo Markdown es una proyección materializada.

No existe sincronización inversa desde `docs/project/PROJECT-BRIEF.md`.

### Rule 10 — Artifact histórico

Actualizar el Project Brief vigente no debe destruir evidencia histórica ya persistida en `artifacts`.

### Rule 11 — FEATURE-022 es el mecanismo de lectura

Los agentes leen el documento mediante las capacidades universales ya existentes.

### Rule 12 — Exposición humana ≠ Approval

Ver, copiar o descargar el Project Brief no representa:

* aprobarlo;
* autorizar merge;
* autorizar deployment;
* completar el proyecto.

### Rule 13 — Materialización segura

La materialización debe:

* normalizar LF;
* utilizar UTF-8;
* calcular hash;
* evitar escrituras fuera de la ruta canónica;
* fallar de forma explícita ante inconsistencia.

### Rule 14 — Backward compatibility de Feature

Cualquier helper o componente común extraído desde FEATURE-023 debe conservar exactamente el comportamiento validado de Feature.

### Rule 15 — Sin generalización especulativa

Sólo se extrae código que tenga al menos los dos consumidores reales:

```
Feature
Project Brief
```

o que sea inequívocamente puro y reusable.

F034 decidirá si el patrón incremental de revisiones merece una abstracción adicional.

### Rule 16 — Catálogo obligatorio del Runbook

`01-PROJECT-BRIEF-TEMPLATE.md` debe incorporarse al catálogo obligatorio de `RunbookProvider` (FEATURE-023 Parte 2, Rule 7) y la persistencia del Project Brief debe heredar la validación previa a persistencia documental (FEATURE-023 Parte 2, Rule 9) antes de abrir su transacción.

## 6. Estrategia Algorítmica

No aplica como algoritmo de optimización.

Sí existe un flujo determinístico:

```
leer template
      ↓
validar disponibilidad/versionado
      ↓
invocar Architect
      ↓
parsear Project Brief
      ↓
validar contrato
      ↓
¿faltan declarativos humanos?
    ├─ Sí → escalamiento sin Project Brief canónico válido
    └─ No
        ↓
   persistir identidad/estado
        ↓
   render determinístico
        ↓
recordArtifact(project_brief_document)
        ↓
actualizar referencia canónica
        ↓
exponer a F022 / UI
        ↓
materializar en ruta canónica cuando corresponda
```

La validación debe preceder a los efectos persistentes que puedan dejar un Project Brief parcialmente válido.

## 7. Technical Considerations

### Arquitectura afectada

Principalmente:

* contrato/output Architect;
* runtime pipeline alrededor de Architect;
* persistencia Project Brief;
* artifact canonicalization;
* materialización;
* run view/backend;
* UI documental;
* helpers documentales compartidos;
* catálogo obligatorio de `RunbookProvider`.

### Infraestructura común aprobada

Nivel 2 / Opción B.

No hay cambios a:

```
features
feature_revisions
artifacts schema
```

La recomendación de DAIA está explícitamente sustentada en cardinalidades distintas y en el riesgo ya identificado por FEATURE-023 de convertirse en plataforma universal.

### `project_config_versions`

El contenido canónico del Project Brief no debe almacenarse allí.

Ese mecanismo queda reservado a configuración editable/operacional. La investigación advierte expresamente contra mezclar ambos planos.

### Renderer

Será específico de Project Brief.

El template define estructura y semántica; el Orquestador garantiza determinismo.

### Path

Ya resuelto:

```
docs/project/PROJECT-BRIEF.md
```

No es una decisión de implementación pendiente.

### Catálogo obligatorio de Runbook

`01-PROJECT-BRIEF-TEMPLATE.md` debe sumarse al catálogo obligatorio validado en startup por `RunbookProvider`, junto con `07-FEATURE-TEMPLATE.md`, conforme a FEATURE-023 Parte 2 (Rule 7). La persistencia de Project Brief debe resolver y validar el template antes de abrir su transacción, heredando el contrato de Rule 9 de esa misma parte.

## 8. Validation Criteria

### Scenario 1 — Business Case completo

Input: caso con todos los declarativos requeridos.
Expected: Architect genera Project Brief válido y el Orquestador persiste una única identidad canónica.

### Scenario 2 — Declarativo obligatorio ausente

Input: falta un dato que el template prohíbe inferir.
Expected: escalamiento; el dato no se inventa; no queda Project Brief falsamente válido.

### Scenario 3 — Retry idempotente

Input: reprocesamiento del mismo resultado durable.
Expected: no se crea identidad duplicada ni duplicación accidental de la versión vigente.

### Scenario 4 — Artifact canónico

Input: Project Brief válido.
Expected: existe artifact `project_brief_document` legible y asociado al proyecto correcto.

### Scenario 5 — FEATURE-022

Input: otro rol lista/lee artifacts del mismo proyecto.
Expected: descubre y lee el Project Brief sin nuevo API ni inyección completa automática.

### Scenario 6 — Aislamiento

Input: rol de otro proyecto intenta recuperar el artifact.
Expected: no puede accederlo bajo las garantías actuales de FEATURE-022.

### Scenario 7 — Renderer determinístico

Input: mismo estado documental.
Expected: mismo Markdown normalizado y mismo hash.

### Scenario 8 — Materialización

Input: Project Brief canónico válido.
Expected: archivo en:

```
docs/project/PROJECT-BRIEF.md
```

con contenido idéntico a la proyección canónica.

### Scenario 9 — UI

Input: run/proyecto con Project Brief disponible.
Expected: usuario puede abrirlo y leerlo.

### Scenario 10 — Copiar

Expected: clipboard contiene exactamente el Markdown canónico entregado por backend.

### Scenario 11 — Descargar

Expected: archivo `.md` contiene exactamente el Markdown canónico.

### Scenario 12 — Truncado

Input: contenido superior al límite común.
Expected: comportamiento consistente con el contrato documental compartido y sin divergencia con Feature/F022.

### Scenario 13 — Regresión Feature

Input: Feature actual alcanza su lifecycle normal.
Expected: permanece exactamente igual su:

* documento;
* visualización;
* autoapertura;
* copiar;
* publicación;
* approval mode;
* merge workflow.

### Scenario 14 — Runbook inválido

Input: template ausente, ilegible o fuera de la raíz permitida.
Expected: fail-closed antes de persistir un Project Brief válido, siguiendo RunbookProvider.

### Scenario 15 — Catálogo obligatorio incompleto

Input: el servidor arranca sin `01-PROJECT-BRIEF-TEMPLATE.md` disponible en el catálogo obligatorio de `RunbookProvider`.
Expected: el servidor no queda operativo (mismo comportamiento que hoy ante ausencia de `07-FEATURE-TEMPLATE.md`).

### Validation Evidence

Nivel recomendado: L3 dirigido.

Evidencia mínima:

* tests contractuales de output Architect;
* validación de gate declarativo;
* test de idempotencia;
* persistencia DB;
* artifact canónico;
* lectura FEATURE-022;
* aislamiento entre proyectos;
* renderer/hash;
* materialización exacta;
* UI Ver/Copiar/Descargar;
* regresión del documento Feature;
* validación de catálogo obligatorio de Runbook en startup;
* E2E real:

```
Business Case
      ↓
  Architect
      ↓
Project Brief canónico
      ↓
 visible/legible
      ↓
Functional continúa
```

No se requiere L4 ni regresión masiva.

## 9. Risks

**R1 — Duplicar infraestructura documental**
Impacto: F033 genera un segundo sistema paralelo.
Mitigación: Opción B, reutilizando sólo capacidades probadas.

**R2 — Sobreabstraer FEATURE-023**
Impacto: regresiones en un lifecycle ya validado.
Mitigación: no migrar persistencia ni dominio Feature.

**R3 — Inventar información para completar §0**
Impacto: Project Brief semánticamente falso.
Mitigación: gate declarativo hard requirement.

**R4 — Confundir disponibilidad con aprobación**
Impacto: UX o pipeline interpretan "Ver" como gate.
Mitigación: separación contractual explícita.

**R5 — Crear revisiones sin necesidad**
Impacto: complejidad documental prematura.
Mitigación: F033 no exige tabla append-only salvo evidencia operacional concreta.

**R6 — Drift DB / UI / repo**
Impacto: distintas versiones del Project Brief.
Mitigación: una única proyección canónica.

**R7 — Romper Feature al generalizar UI/helpers**
Impacto: regresión en producción.
Mitigación: refactor localizado + tests existentes + E2E dirigido.

**R8 — Catálogo obligatorio incompleto en startup**
Impacto: Project Brief se persiste sin garantía fail-closed real, porque `RunbookProvider` no exige el asset al arrancar.
Mitigación: incorporar `01-PROJECT-BRIEF-TEMPLATE.md` al catálogo obligatorio (Rule 7 de FEATURE-023 Parte 2) como parte del scope de F033, no como seguimiento posterior.

## 10. Future Ideas / siguientes Features

**FEATURE-034**
Validará si Architecture, por ser documento vivo, justifica generalizar más el patrón:

```
revisions
   ↓
canonical pointer
   ↓
renderer
```

fuera de Feature.

**FEATURE-035**
Resolverá Release Plan, incluida la pregunta pendiente sobre la semántica real del `release_plan` hoy persistido en `project_config_versions`.

Estas decisiones no bloquean F033.

## 11. Approval Gate

### Diseño propuesto

La decisión arquitectónica para F033 queda:

FEATURE-033 implementa el lifecycle canónico de Project Brief con persistencia de dominio propia y capacidades documentales compartidas de Nivel 2. Reutiliza FEATURE-022 para lectura, el RunbookProvider como fuente del template y extrae de FEATURE-023 sólo helpers/UX inequívocamente comunes, preservando por completo su persistencia y lifecycle.

Y:

Project Brief se materializa exclusivamente en `docs/project/PROJECT-BRIEF.md`; el Markdown de DB/artifact, UI, descarga y repo es una única representación canónica.

Y:

F033 no introduce una plataforma documental universal ni fuerza revisiones append-only si el lifecycle real de Project Brief no las necesita.

Y:

F033 incorpora `01-PROJECT-BRIEF-TEMPLATE.md` al catálogo obligatorio de `RunbookProvider` y hereda el contrato de validación previa a persistencia documental de FEATURE-023 Parte 2, para que el fail-closed prometido sea real desde el startup.

### Estado

**GO — aprobado para Development**, tras revisión y ajuste de scope (incorporación al catálogo obligatorio del Runbook, sección 4.14 / Rule 16 / Risk R8 / Scenario 15).
