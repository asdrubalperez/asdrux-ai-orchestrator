# FEATURE-035 — Lifecycle canónico de Release Plan basado en el Runbook

## 1. Feature Identity

* Name: Lifecycle canónico de Release Plan basado en el Runbook
* Type: Arquitectura / Workflow / Persistencia documental / UI
* Owner: Asdru — Product Owner
* Implementation Owner: DAIA
* Status: Diseño aprobado — GO para Development
* Playbook Mode: Standard
* Template de gobernanza: `docs/playbook/07-FEATURE-TEMPLATE.md`
* Template operativo: `docs/runbook/09-RELEASE-PLAN-TEMPLATE.md`
* Documento canónico: `docs/releases/<release-key>/RELEASE-PLAN.md`
* Cardinalidad: uno por release
* Identidad: `project_id + release_key`
* Producer: Planning
* Consumers: Developer (implementa dentro del enfoque técnico), QA (ejecuta contra el Test Plan)

La ruta y cardinalidad ya quedaron fijadas por FEATURE-023 Parte 2. A diferencia de Project Brief
y Architecture, Release Plan pertenece a un release concreto, no al proyecto entero.

## 2. Problem Statement

El Orquestador dispone hoy de un contrato llamado `RELEASE_PLAN`, pero no es el documento Release
Plan que define el Runbook.

El contrato operacional actual de Planning (`src/executor/roles/planning.txt`) mantiene:

```
features: [{ id, nombre, estado }]
featureActualId
```

y sirve exclusivamente para saber qué Features pertenecen al release, cuál está activa y cuáles
quedan pendientes/completadas. Ese estado alimenta mecanismos ya validados y sensibles —
`extractReleasePlanDeclaration`, `isReleaseCompletionEscalation` (clasificación del gate
`release_completion` antes del retry genérico), y la validación cruzada de cierre de release de
FEATURE-038 (`persistReleasePlanIfDeclared`, `src/cli/commands/runStart.ts`).

`09-RELEASE-PLAN-TEMPLATE.md`, en cambio, exige un documento más rico: evaluación de tamaño/riesgo
del release (§0), secuencia con justificación (§1), y un bloque de Enfoque Técnico + Test Plan por
cada Feature (§2) — más Hallazgos (§3) y Chequeo Interno (§4).

```
RELEASE_PLAN operacional        ✅ existe
Release Plan canónico Runbook   ❌ no existe
```

F035 debe crear el segundo sin romper ni reemplazar el primero — mismo criterio que F034 aplicó
con `ROADMAP`/Architecture.

## 3. Functional Goal

Al finalizar F035:

1. Planning producirá explícitamente el contenido rico de `09-RELEASE-PLAN-TEMPLATE.md`.
2. El tag operacional `RELEASE_PLAN:` conserva su contrato y comportamiento exactamente igual.
3. El contenido canónico rico usa una declaración separada, `RELEASE_PLAN_DOCUMENT:`.
4. El modelo no duplica dentro del documento rico lo que ya pertenece autoritativamente al estado
   operacional (secuencia/estados de Feature) cuando puede componerse determinísticamente.
5. §0 (evaluación de tamaño) y §1 (secuencia con justificación) se declaran completos en la
   primera invocación de Planning para el release — hace falta un orden para todas las Features
   antes de que arranque cualquier trabajo.
6. §2 (Enfoque Técnico + Test Plan por Feature) se construye **incrementalmente**: cada invocación
   de Planning declara sólo el bloque de la Feature que está asignando en ese momento — igual que
   hoy ya hace con `FEATURE_UPDATE`. No se le pide al modelo resolver todas las Features de una
   sola vez.
7. El runtime acumula los bloques de §2 ya declarados en versiones anteriores del documento
   canónico — el modelo nunca tiene que redeclarar bloques de Features ya planificadas.
8. Existirá una identidad única por `(project_id, release_key)`.
9. Existirá un único artifact canónico vigente por release.
10. Los artifacts anteriores conservan el historial documental.
11. F035 v1 no crea `release_plan_revisions` — el contenido técnico por Feature ya persistido por
    FEATURE-023 (`feature_revisions.planning_update`) no se duplica en una segunda fuente
    append-only.
12. El documento se materializa exclusivamente en `docs/releases/<release-key>/RELEASE-PLAN.md`.
13. FEATURE-022 lo lee sin cambios.
14. La UI permite Ver, Copiar y Descargar.
15. Los cuatro documentos canónicos (Feature, Project Brief, Architecture, Release Plan) comparten
    un shell UI documental (`CanonicalDocumentPanel`) — con 4 consumidores reales, ya no es
    prematuro extraerlo.
16. El gate de tamaño del release (§0) llega al humano sin retries automáticos genéricos, mismo
    tratamiento que `roadmap_approval`/`release_completion`.
17. El cierre de release (`release_completion`) conserva su circuito íntegro; se agrega sólo una
    proyección canónica final del hecho ya ocurrido (todas las Features completadas).
18. Feature, Project Brief y Architecture mantienen sus lifecycles actuales sin cambios.

## 4. Scope

### Included

#### 4.1 Mantener `RELEASE_PLAN:` operacional sin cambios

No se sustituye ni reinterpreta. Sigue gobernando la secuenciación operacional del release,
protegiendo `extractReleasePlanDeclaration`, `isReleaseCompletionEscalation` y
`persistReleasePlanIfDeclared` tal como están.

#### 4.2 Nuevo contrato documental — construcción incremental

Planning declara `RELEASE_PLAN_DOCUMENT:` en la misma respuesta donde declara `RELEASE_PLAN` con
contenido real (mismo criterio de "declaración conjunta" que F034 validó sin bugs en producción
con `ARCHITECTURE`/`ROADMAP`). Forma conceptual:

```json
{
  "evaluacionTamano": {
    "cantidadFeatures": 3,
    "factoresRiesgo": ["..."],
    "conclusion": "Riesgo razonable | Riesgo real"
  },
  "secuencia": [
    { "sourceKey": "f1", "motivoOrden": "..." }
  ],
  "featurePlan": {
    "sourceKey": "f1",
    "technicalApproach": { "affectedComponents": ["..."], "impact": "...", "alternativesConsidered": ["..."] },
    "testPlan": {
      "level": "L1 | L2 | L3 | L4",
      "scenarios": [{ "scenario": "...", "action": "...", "expected": "..." }],
      "evidenceRequired": ["..."],
      "validationEnvironment": "...",
      "externalWrites": null
    }
  },
  "hallazgos": "..."
}
```

`evaluacionTamano` y `secuencia` se redeclaran completos en cada invocación (igual que Planning ya
redeclara el estado completo de `RELEASE_PLAN`, Regla 6 de `planning.txt` — no un diff). `featurePlan`
es singular: sólo el bloque de la Feature que se está asignando en esta invocación, no un array con
todas — el runtime lo acumula (ver 4.3). `featurePlan` es `null` cuando Planning declara
`RELEASE_COMPLETO` (no hay Feature nueva que asignar).

El contrato definitivo (naming exacto de campos) lo cierra Development siguiendo el template, esta
es la forma conceptual mínima.

#### 4.3 Acumulación en el runtime, no en el modelo

Al persistir, el runtime toma el `featurePlan` recién declarado y lo agrega/actualiza (por
`sourceKey`) sobre el conjunto de bloques ya acumulados en la versión canónica anterior del
Release Plan — nunca le pide al modelo repetir bloques de Features ya planificadas. Esto es lo que
reemplaza la necesidad de `release_plan_revisions`: el historial vive en los artifacts inmutables
sucesivos (cada uno ya es la proyección completa acumulada hasta ese punto), no en una tabla de
revisiones separada.

```
snapshot n-1: { f1: plan_f1 }
        + featurePlan declarado ahora: { f2: plan_f2 }
        ↓ merge en el runtime
snapshot n:   { f1: plan_f1, f2: plan_f2 }
```

#### 4.4 Cobertura de Features — validada al cierre, no en cada paso intermedio

Rule 14: el conjunto final de bloques debe cubrir exactamente las Features de `secuencia`, sin
faltantes ni ajenas. Esto se valida estrictamente recién cuando Planning declara
`RELEASE_COMPLETO` (el documento converge a completo cuando el release termina, que es también
cuando el Chequeo Interno del template exige que esté completo). En pasos intermedios sólo se
valida que el `featurePlan` declarado corresponda a una Feature real de `secuencia` de ese mismo
`(project_id, release_key)` — no que falten otras todavía.

#### 4.5 Sin `release_plan_revisions`

Ya cubierto por 4.3 — el mecanismo de acumulación por snapshot sucesivo hace innecesaria una tabla
de revisiones dedicada. `feature_revisions.planning_update` conserva su ownership actual sobre el
detalle técnico por Feature; F035 no lo duplica ni lo reemplaza.

#### 4.6 Persistencia propia

Tabla `release_plans`, con `unique(project_id, release_key)` (no `unique(project_id)` — es la
diferencia real de cardinalidad respecto de Project Brief/Architecture). Garantías mínimas: mismas
que `project_briefs`/`architectures` (source event key, template key/version/hash/snapshot,
canonical_artifact_id, final_document_path, document_hash, run de creación, timestamps).

#### 4.7 Artifact canónico

Nuevo `kind`: `release_plan_document`. FEATURE-022 lo descubre sin cambios.

#### 4.8 Ruta

Única: `docs/releases/<release-key>/RELEASE-PLAN.md`.

#### 4.9 RunbookProvider

`09-RELEASE-PLAN-TEMPLATE.md` se incorpora al catálogo obligatorio (mismo patrón fail-closed que
F033/F034).

#### 4.10 Capacidades comunes

Usar directamente `src/features/canonicalDocument.ts` (`sha256`, `normalizeLf`,
`isWithinDocumentSizeLimit`) — no reimplementar.

#### 4.11 UI — generalizar el shell ahora

Con Feature + Project Brief + Architecture + Release Plan son 4 implementaciones casi idénticas de
`[Ver documento] → Dialog → [Copiar][Descargar][Cerrar]` en `RunDetailPage.tsx`. F035 extrae
`CanonicalDocumentPanel` (título, metadata, path, Markdown, truncado, Copiar, Descargar, Cerrar,
autoapertura opcional) y migra los 4 paneles existentes a consumirlo, preservando exactamente el
comportamiento específico de cada uno (la autoapertura de Feature en `pushed`, el approval mode,
etc. quedan fuera del componente común, como props/comportamiento inyectado).

#### 4.12 Gate de tamaño del release — nuevo, protegido explícitamente

Se agrega una señal inequívoca para distinguir este gate de una ambigüedad genérica, mismo patrón
que `roadmap_approval`/`release_completion`: nuevo tag `RELEASE_SIZE_RISK: true` en
`planning.txt` (declarado sólo en la primera invocación del release, cuando `evaluacionTamano.conclusion`
es "Riesgo real"), y una nueva función `isReleaseSizeRiskEscalation` en `src/cli/escalation.ts`
(mismo shape que `isReleaseCompletionEscalation`), agregada como tercera rama de
`classifyGateEscalation`/`GateKind` (`"roadmap_approval" | "release_completion" | "release_size_risk"`).
`classifyGateEscalation` hoy es una cadena de `if` (no un switch exhaustivo) y su único consumidor
es un `if (gateKind)` genérico en `runStart.ts` — agregar una tercera rama es aditivo, no requiere
tocar los otros dos casos. No se modifica `extractRoadmapApproval` ni `isReleaseCompletionEscalation`.

#### 4.13 Cierre de release — excepción de snapshot final

Cuando se reconoce `release_completion` válido (mismo mecanismo ya usado por
`persistReleasePlanIfDeclared`, que ya persiste sobre `ESTADO: escalated` en este caso específico —
no es un mecanismo nuevo, es el mismo patrón existente extendido a la proyección documental), el
runtime refresca la proyección canónica del Release Plan con el estado operacional final ya
validado (todas las Features completadas) antes de/junto con el cierre. No es una propuesta sin
aprobar — es el registro de un hecho ya ocurrido (todas las Features terminaron); la aprobación
humana posterior autoriza cerrar el release, no modifica retroactivamente ese estado.

### Excluded

* Cambiar la semántica de `RELEASE_PLAN:` o `FEATURE_UPDATE`.
* Reescribir FEATURE-023/`feature_revisions`.
* `release_plan_revisions`.
* Tabla polimórfica documental común.
* Motor de templates genérico.
* Nuevos APIs de lectura específicos por documento (FEATURE-022 sin cambios).
* Editor humano del Release Plan; diff visual; sincronización repo → DB.
* Replantear los gates de Roadmap o el approval model general.
* Rediseñar el loop Release/Feature completo.
* Mecanismo de feedback no bloqueante entre roles (Developer/QA → Functional/Architect/Planning) —
  hueco real identificado durante este diseño, deliberadamente fuera de alcance; queda como
  investigación separada (ver `docs/research/` cuando esa tarea se ejecute).

## 5. Functional Rules

1. **Producer.** Planning es el único productor del Release Plan.
2. **Identidad.** `project_id + release_key`, `unique(project_id, release_key)`.
3. **`RELEASE_PLAN` se protege.** Sin cambios de contrato ni comportamiento.
4. **Contrato documental separado.** `RELEASE_PLAN_DOCUMENT` es una declaración propia, no anidada
   dentro de `RELEASE_PLAN`.
5. **Declaración conjunta.** Cuando Planning declara `RELEASE_PLAN` operacional real (asignando o
   confirmando el cierre), declara también `RELEASE_PLAN_DOCUMENT` en la misma respuesta — no lo
   difiere. Regla escrita explícitamente en `planning.txt`, mismo patrón que F034 validó sin bugs.
6. **Construcción incremental, no "nace completo".** §0/§1 se declaran completos desde la primera
   invocación; §2 se construye Feature por Feature — cada invocación aporta sólo el bloque de la
   Feature que asigna en ese momento, el runtime acumula.
7. **Cobertura validada al cierre.** Ver 4.4 — no se exige completitud de §2 en pasos intermedios,
   sólo que cada bloque nuevo pertenezca a una Feature real de la secuencia.
8. **Snapshot vivo.** Cada transición real de Feature dispara una evaluación de refresco del
   Release Plan canónico.
9. **No artifact inútil.** Si el contenido canónico efectivo (estado operacional + payload rico)
   no cambió, no se crea una versión nueva.
10. **Estado operacional participa en el hash semántico.** Un cambio de estado de Feature (ej.
    "En curso" → "Completada") cambia el Release Plan canónico aunque el enfoque técnico no
    cambie.
11. **Historial.** Artifacts anteriores no se eliminan al cambiar la versión vigente.
12. **Sin revisions v1.** Ver 4.5.
13. **Consistencia de identidad.** Todo `sourceKey` documental debe pertenecer al mismo
    `project_id + release_key`.
14. **Consistencia con `FEATURE_UPDATE`.** Para la Feature actual, los campos que se solapan entre
    `FEATURE_UPDATE` y el bloque correspondiente de `RELEASE_PLAN_DOCUMENT` no pueden
    contradecirse.
15. **Gate de tamaño.** "Riesgo real" detiene a Planning antes de secuencia/desarrollo y va al
    humano sin retry genérico (ver 4.12).
16. **Gate de cierre.** `release_completion` conserva su circuito actual (ver 4.13).
17. **DB es fuente operacional.** El archivo del repo es una proyección; no hay sincronización
    inversa.
18. **FEATURE-022** es el único mecanismo universal de lectura.
19. **UI.** Ver/Copiar/Descargar muestran siempre la misma representación canónica.

## 6. Estrategia Algorítmica

### Creación inicial + primera Feature

```
Features del release (ya persistidas por FEATURE-023)
        ↓
Planning invocación 1
        ↓
§0 evaluar tamaño
    ├─ Riesgo real → RELEASE_SIZE_RISK: true → gate humano (Rule 15), no continúa
    └─ Riesgo razonable
           ↓
    §1 definir secuencia completa (todas las Features, con motivoOrden)
           ↓
    §2 planificar SÓLO la primera Feature (Enfoque Técnico + Test Plan)
           ↓
    RELEASE_PLAN operacional + RELEASE_PLAN_DOCUMENT (evaluacionTamano + secuencia + featurePlan[f1])
           ↓
    persistir identidad release_plans + artifact release_plan_document v1
           ↓
    Developer↔QA sobre Feature 1
```

### Transición Feature a Feature

```
Feature A completada
        ↓
Planning invocación N
        ↓
RELEASE_PLAN: A→Completada, B→En curso
RELEASE_PLAN_DOCUMENT: evaluacionTamano + secuencia (redeclaradas) + featurePlan[B]
        ↓
runtime: merge featurePlan[B] sobre snapshot anterior (que ya tenía featurePlan[A])
        ↓
validar (Rule 14 parcial — B pertenece a secuencia)
        ↓
render snapshot vN
        ↓
Developer↔QA sobre Feature B
```

### Cierre

```
última Feature completada
        ↓
Planning: RELEASE_PLAN (todas Completada) + RELEASE_COMPLETO: true, featurePlan: null
        ↓
release_completion gate reconocido (isReleaseCompletionEscalation, sin cambios)
        ↓
refresh snapshot final (Rule 14 completa: todas las Features tienen bloque)
        ↓
humano autoriza cierre (circuito existente, sin cambios)
```

## 7. Technical Considerations

* **Componentes afectados:** `src/executor/roles/planning.txt`; nuevo
  `src/features/releasePlanContracts.ts`/`releasePlanDocument.ts`/`releasePlanLifecycle.ts`
  (mismo patrón que `architectureContracts.ts`/`architectureDocument.ts`/`architectureLifecycle.ts`);
  `src/cli/escalation.ts` (nueva `isReleaseSizeRiskEscalation`, `GateKind` extendido); `runStart.ts`;
  migración `release_plans`; `RunbookProvider`; `run view`/backend; `RunDetailPage.tsx` (más la
  extracción de `CanonicalDocumentPanel`); tests.
* **Gate de tamaño — área sensible nueva.** Debe cubrirse con regresión explícita verificando que
  `roadmap_approval`, `release_completion` y `merge_approval` siguen clasificándose exactamente
  igual después de agregar la tercera rama.
* **Prompt engineering:** aplicar Rule 5 (declaración conjunta) explícitamente en `planning.txt`,
  sin depender de "primera invocación" — mismo criterio que F034. No exigir wording literal en
  `hallazgos`/`motivoOrden` (lección de F033).
* **`FEATURE_UPDATE`:** permanece vigente sin cambios; sólo se valida consistencia con el bloque
  correspondiente de `RELEASE_PLAN_DOCUMENT` para la Feature actual (Rule 14 de Functional Rules).

## 8. Validation Criteria

1. **Identidad.** Dos releases del mismo proyecto generan dos identidades distintas; el mismo
   release nunca genera dos.
2. **Primera invocación.** §0/§1 completos, §2 sólo con la primera Feature.
3. **Feature ajena rechazada.** Un `featurePlan.sourceKey` que no pertenece a la secuencia de ese
   `(project_id, release_key)` se rechaza.
4. **`RELEASE_PLAN` protegido.** Parsing/persistencia del tag operacional sin cambios de
   comportamiento.
5. **`FEATURE_UPDATE` protegido.** Selección/actualización de Feature actual sigue funcionando.
6. **Consistencia.** `FEATURE_UPDATE.sourceKey`, `RELEASE_PLAN.featureActualId` y
   `featurePlan.sourceKey` coinciden.
7. **Acumulación Feature a Feature.** Tras cerrar A y asignar B, el snapshot canónico contiene los
   bloques de A y B, sin que el modelo haya vuelto a declarar el de A.
8. **Historial.** El artifact anterior sigue existiendo tras una nueva versión.
9. **Idempotencia.** Reprocesar el mismo evento no crea otro artifact.
10. **Contenido idéntico.** Evento nuevo con documento efectivo idéntico no crea versión inútil.
11. **Cambio técnico legítimo.** Ajustar el enfoque/Test Plan de una Feature ya planificada genera
    nueva versión canónica.
12. **Gate de tamaño.** Riesgo real → sin Feature seleccionada, sin Developer, gate humano
    inmediato, sin retry genérico.
13. **Gate de tamaño resuelto.** Tras resolución humana, Planning completa §1/§2 y continúa.
14. **Cierre final.** Última Feature completada → `RELEASE_PLAN` todas "Completada",
    `release_completion` reconocido igual que hoy, snapshot final con cobertura completa (Rule 14
    estricta), luego el Approval Gate de cierre existente.
15. **Regresión de otros gates.** `roadmap_approval`, `release_completion` (cierre normal, sin
    tamaño de riesgo) y `merge_approval` siguen clasificándose igual que antes de F035.
16. **FEATURE-022.** Legible por roles del mismo proyecto, aislado de otros proyectos.
17. **Materialización.** Sólo `docs/releases/<release-key>/RELEASE-PLAN.md`.
18. **UI.** Ver/Copiar/Descargar en Release Plan; los 4 paneles migrados a `CanonicalDocumentPanel`
    sin regresión de comportamiento específico (autoapertura de Feature, approval mode, etc.).
19. **Regresión documental.** Feature, Project Brief y Architecture mantienen su comportamiento.
20. **E2E real multi-Feature.** Imprescindible con al menos 2 Features en el release — es el único
    escenario que prueba el requisito central (acumulación incremental sin redeclaración):
    `Planning → Release Plan inicial (Feature A) → Developer/QA → Planning actualiza (Feature B) →
    Developer/QA → Planning marca release completo → snapshot final → cierre`.

### Validation Evidence

L3 dirigido + E2E real con al menos 2 Features (no alcanza con una sola para probar el requisito
central de este diseño).

## 9. Risks

| # | Riesgo | Mitigation |
|---|---|---|
| R1 | Duplicar estado operacional en el documento rico | `RELEASE_PLAN` sigue siendo la única fuente de orden/estado; el documento rico no lo repite salvo `evaluacionTamano`/`secuencia`, que son baratos de redeclarar y no generan drift real (mismo criterio que hoy usa Regla 6 de `planning.txt`) |
| R2 | Segunda fuente de verdad para el detalle técnico por Feature | Sin `release_plan_revisions`; `feature_revisions.planning_update` conserva su ownership |
| R3 | Romper el circuito de cierre de release | `RELEASE_PLAN`/`RELEASE_COMPLETO` sin cambios; regresión explícita de FEATURE-038 |
| R4 | Gate de tamaño nuevo interfiere con los gates existentes | Regresión explícita de `roadmap_approval`/`release_completion`/`merge_approval` (Scenario 15) |
| R5 | Documento stale entre Features | Refresh obligatorio tras cada transición real (Rule 8) |
| R6 | Sobreingeniería vía `release_plan_revisions` | Artifacts sucesivos con acumulación en runtime; reevaluar sólo con evidencia nueva |
| R7 | Generalización excesiva de UI | Sólo el shell View/Copy/Download; comportamientos específicos quedan fuera del componente común |
| R8 | Cobertura incompleta al cerrar el release | Validación estricta de Rule 14 exclusivamente en el cierre (`release_completion`) |

## 10. Approval Gate

* **D1** — Release Plan es uno por release; identidad `(project_id, release_key)`.
* **D2** — `RELEASE_PLAN:` conserva intacta su función operacional; el documento rico usa
  `RELEASE_PLAN_DOCUMENT:`, contrato separado.
* **D3** — El Release Plan canónico se construye **incrementalmente**: §0/§1 completos desde la
  primera invocación, §2 Feature por Feature, acumulado por el runtime — no se le exige a Planning
  resolver todas las Features de una sola vez (corrección sobre la propuesta original de ARIA, que
  proponía "nace completo"; revisado en esta sesión porque (a) contradice cómo Planning ya trabaja
  hoy — una Feature por invocación —, (b) Developer nunca necesita el plan de una Feature que
  todavía no le toca, y (c) es inconsistente con el criterio ya adoptado para Architecture, que sí
  se retroalimenta incrementalmente).
* **D4** — F035 v1 no crea `release_plan_revisions`; la acumulación por snapshots sucesivos la
  hace innecesaria.
* **D5** — El renderer combina estado operacional + payload documental rico acumulado; nunca le
  pide al modelo dos fuentes equivalentes.
* **D6** — `FEATURE_UPDATE` permanece vigente; los campos solapados con el documento se validan
  por consistencia, no se derivan automáticamente uno del otro.
* **D7** — El gate de tamaño del release es un gate humano esperado, clasificado explícitamente
  (`isReleaseSizeRiskEscalation`, tercera rama de `classifyGateEscalation`/`GateKind`), no un
  retry genérico.
* **D8** — El cierre del release conserva íntegramente el mecanismo actual; existe únicamente una
  excepción documental (ya con precedente en `persistReleasePlanIfDeclared`) para producir el
  snapshot factual final.
* **D9** — FEATURE-022 y `canonicalDocument.ts` se reutilizan sin cambios.
* **D10** — F035 generaliza el shell UI de los cuatro documentos canónicos (`CanonicalDocumentPanel`)
  — con 4 consumidores reales, ya no es prematuro.
* **D11** — El mecanismo de feedback no bloqueante entre roles (hallazgo real de esta sesión de
  diseño) queda explícitamente fuera de alcance de F035, como investigación separada.

### Estado

**GO — aprobado para Development.** Diseño original de ARIA revisado y ajustado en dos puntos: D3
(construcción incremental en vez de "nace completo", sección 4.3/4.4/4.6) y D7 (nombres de
archivo/función explícitos para el gate de tamaño nuevo, para no dejarlo implícito en una zona ya
sensible por historia de bugs — "corrección del runtime de circuitos").
