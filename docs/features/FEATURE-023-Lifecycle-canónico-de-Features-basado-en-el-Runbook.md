# FEATURE-023 — Lifecycle canónico de Features basado en el Runbook

## 1. Feature Identity

* **Name:** Lifecycle canónico de Features basado en el Runbook
* **Type:** Arquitectura / Workflow / Persistencia documental
* **Owner:** Asdru — Product Owner
* **Implementation Owner:** DAIA
* **Status:** Diseño validado — Approval Gate aprobado; Development habilitado
* **Priority:** P0
* **Playbook Mode:** Full
* **Template de gobernanza de FEATURE-023:** `docs/playbook/07-FEATURE-TEMPLATE.md`
* **Versión del template de gobernanza:** `v2.1`
* **Template operativo implementado:** `docs/runbook/07-FEATURE-TEMPLATE.md`
* **Versión operativa inicial:** `v1.0`
* **Template key:** `runbook-feature`
* **Descriptor key:** `runbook-feature-v1`

---

# 2. Problem Statement

## Limitación actual

El Orquestador ya puede:

* ejecutar el pipeline Architect → Functional → Planning → Developer ↔ QA;
* persistir resultados de fases como artifacts;
* conservar eventos append-only por run;
* continuar las Features de un release mediante Planning;
* commitear y publicar la subrama de una Feature;
* permitir que todos los roles descubran y lean artifacts del mismo proyecto mediante FEATURE-022.

Sin embargo, todavía no existe una identidad documental durable que represente una Feature a lo
largo de Functional, Planning, los intentos Developer ↔ QA, el cierre técnico, Git y la UI.

Actualmente:

* Functional declara una lista de Features mediante IDs locales como `f1`;
* Planning usa esos IDs dentro de `RELEASE_PLAN.featureActualId`;
* cada rol produce artifacts separados;
* los runs de continuación se enlazan mediante `featureJustCompleted`;
* no existe una representación estructurada común por Feature;
* no existe ownership aplicado por código sobre las contribuciones documentales;
* los intentos y resultados pueden reconstruirse desde artifacts y eventos, pero no proyectarse
  como un documento canónico;
* no existe una materialización obligatoria y verificada en `docs/features/`;
* la UI no puede recuperar de forma confiable el documento final publicado.

## Necesidad

Cada Feature de un producto gestionado debe tener una identidad durable, independiente de un run
concreto, y un documento operacional basado en:

```text
docs/runbook/07-FEATURE-TEMPLATE.md
Versión: v1.0
```

El documento debe:

* nacer desde la definición funcional por lote;
* recibir contribuciones atribuidas de Planning, Developer y QA;
* conservar revisiones append-only;
* distinguir resultados factuales de QA de la decisión técnica de readiness;
* impedir que el turno de readiness introduzca código no validado;
* proyectarse determinísticamente desde DB;
* materializarse en `docs/features/`;
* incluirse en el commit y push de la subrama;
* confirmar el SHA exacto de la subrama remota;
* permanecer disponible como artifact operacional;
* exponerse desde la UI sin confundir publicación, aprobación humana, merge o completitud.

## Separación obligatoria de gobernanza

Existen dos capas diferentes:

### FEATURE-023 dentro de este repositorio

Se diseña y aprueba mediante el Playbook `v2.1`.

Su Approval Gate exige aprobación humana explícita antes de implementar.

### Documento operativo de un producto gestionado

Se genera mediante el Runbook `v1.0`.

Su sección Approval Gate refleja el `approval_mode` configurado para ese producto:

* manual;
* `auto`.

El valor contractual del runtime para el modo no manual es exactamente `auto`. No se admiten
`automatic`, `automático` ni variantes equivalentes en schemas, persistencia o respuestas.

El Approval Gate humano de FEATURE-023 no debe copiarse al documento operativo ni confundirse con
la autorización humana de merge de un producto gestionado.

## Precisión: Feature documentada versus Feature completada

La existencia de:

```text
document_hash
final_commit_sha
pushed_branch
pushed_at
```

demuestra que el documento y la subrama fueron materializados y publicados correctamente.

No demuestra que la Feature:

* haya sido aceptada por el usuario;
* haya sido mergeada;
* haya sido pusheada a la rama base;
* haya sido desplegada;
* figure como `Completada` en el Release Plan.

En modo manual puede existir una subrama publicada con SHA remoto confirmado y, al mismo tiempo, un
merge humano pendiente o rechazado.

---

# 3. Functional Goal

Al finalizar FEATURE-023:

1. Functional podrá definir todas las Features del release activo en una única salida `FEATURES`.
2. El Orquestador validará el lote completo antes de persistirlo.
3. Cada definición válida producirá una identidad durable con UUID, `source_key` y
   `FEATURE-NNN`.
4. Una Feature podrá atravesar distintos runs e intentos sin cambiar de identidad.
5. Planning seleccionará la Feature activa mediante `RELEASE_PLAN.featureActualId`.
6. `runs.active_feature_id` enlazará el run con la identidad activa.
7. `RELEASE_PLAN.featureActualId` y `FEATURE_UPDATE.sourceKey` deberán coincidir exactamente.
8. Functional, Planning, Developer y QA producirán contribuciones estructuradas bajo ownership
   aplicado por el Orquestador.
9. Cada contribución aceptada producirá una o más revisiones append-only agrupadas.
10. QA registrará únicamente pruebas, resultados, evidencia, defectos, observaciones y riesgos de
    calidad.
11. QA no decidirá readiness, merge, deploy ni aprobación de la Feature.
12. Después de tests exitosos, Developer tendrá un turno específico para declarar readiness.
13. El Orquestador invalidará ese readiness si cambia branch, HEAD o el árbol commiteable.
14. Todo cambio posterior a QA requerirá un nuevo Build y una nueva validación QA.
15. El turno de readiness pertenecerá al mismo intento que el QA precedente.
16. Sólo un nuevo ciclo de implementación + Build + QA consumirá otro intento.
17. El límite actual de tres intentos permanecerá vigente.
18. La DB será la fuente operacional primaria durante el lifecycle.
19. El Markdown será una proyección unidireccional y determinística.
20. El Orquestador será el único materializador autorizado del archivo canónico.
21. El documento se generará en UTF-8 sin BOM, preservando Unicode y usando LF.
22. El slug de la ruta se limitará a ASCII seguro.
23. El archivo se incluirá en el commit de la subrama.
24. El SHA de la subrama remota deberá coincidir exactamente con el commit esperado.
25. En modo manual, el usuario decidirá únicamente el merge hacia la rama base.
26. En modo `auto`, el run se completará sólo después del merge exitoso.
27. El documento final podrá recuperarse mediante `GET /runs/:id`.
28. Todos los roles conservarán acceso read-only al artifact bajo las garantías de FEATURE-022.

Flujo esperado:

```text
Functional define Features del release
        ↓
Orquestador valida y crea identidades por lote
        ↓
Planning selecciona Feature activa y aporta diseño técnico
        ↓
Developer implementa y registra contribución
        ↓
Orquestador ejecuta Build
        ↓
QA informa resultado factual
        ↓
¿testStatus = failed?
   ├── Sí → nuevo turno Developer + nuevo intento
   └── No
        ↓
Developer declara readiness
        ↓
¿Cambió branch, HEAD o tree hash?
   ├── Sí → readiness inválido; nuevo Build + QA
   └── No
        ↓
¿not_ready o requiere cambios?
   ├── Sí → nuevo intento Developer + Build + QA
   └── No → ready | ready_with_known_risks
        ↓
Orquestador proyecta y materializa Markdown
        ↓
Commit + hash documental verificado
        ↓
Push + SHA remoto exacto
        ↓
¿Approval mode?
   ├── Manual → usuario autoriza o rechaza merge
   └── `auto` → merge ejecutado por el Orquestador
        ↓
Planning continúa el release
```

---

# 4. Scope

## Included

### Identidad durable por Feature

Cada Feature tendrá:

* UUID interno;
* `project_id`;
* `release_key`;
* `source_key`;
* `feature_code`;
* nombre;
* prioridad;
* template y snapshot;
* artifact canónico vigente;
* ruta documental;
* hechos de activación y publicación;
* timestamps.

### Creación por lote

Functional continuará definiendo todas las Features del release en una única salida.

El lote se validará y persistirá de forma atómica.

### Persistencia mínima

Se crearán únicamente:

* `features`;
* `feature_revisions`.

Se agregará únicamente a `runs`:

```text
active_feature_id
```

### Revisiones append-only

Cada respuesta aceptada podrá producir varias revisiones que compartan `contribution_id`.

Las revisiones anteriores no se editarán ni eliminarán.

### Idempotencia

Cada bloque tendrá un `source_event_key` estable derivado de un evento durable.

Reprocesar el mismo evento no duplicará revisiones.

### Descriptor fijo

La v1 soportará solamente:

```text
template_key: runbook-feature
template_version: v1.0
descriptor_key: runbook-feature-v1
```

### Ownership documental

El Orquestador validará rol, sección, operación, Feature activa e intento.

### Contratos estructurados

Se ampliará `FEATURES` y se incorporará `FEATURE_UPDATE` para:

* Planning;
* Developer durante implementación;
* QA;
* Developer durante readiness.

### Turno de readiness

Se agregará un turno Developer posterior a tests exitosos, con snapshot Git antes y después.

### Reutilización del runtime

Se reutilizarán:

* `PhaseResult`;
* artifacts;
* `run_events`;
* estados de `runs`;
* contador actual de intentos;
* escalamiento;
* `commitAllChanges`;
* `pushRunBranch`;
* `mergeFeatureBranchIntoBase`;
* `GET /runs/:id`.

### Materialización y protección

El Orquestador:

* proyectará el documento;
* validará su estructura;
* protegerá `docs/features/`;
* calculará la ruta;
* generará el archivo;
* verificará su hash antes y después del commit.

### Git y reconciliación localizada

Se persistirán:

* `document_hash`;
* `final_commit_sha`;
* `pushed_branch`;
* `pushed_at`.

Se confirmará el SHA remoto exacto y se evitarán commits duplicados ante fallos localizados de DB.

### Modos `manual` y `auto`

Se mantendrá la bifurcación actual del `approval_mode`.

### Artifact canónico

Cada contribución aceptada producirá un artifact inmutable nuevo.

`features.canonical_artifact_id` señalará el vigente.

### UI

`GET /runs/:id` incluirá un objeto derivado `featureDocument`.

El Markdown completo se devolverá hasta 64 KiB.

### Validación E2E

Se utilizará una Feature controlada creada después de implementar FEATURE-023.

## Excluded

Quedan fuera:

* lifecycle de Project Brief;
* lifecycle de Architecture;
* lifecycle de Release Plan;
* otros templates o versiones;
* parser genérico de Markdown;
* descriptor derivado por IA;
* motor genérico de templates;
* tabla relacional de releases;
* tabla adicional de lifecycle events;
* estados documentales paralelos;
* `lifecycle_status`;
* `publication_status`;
* `developer_readiness` como columna;
* `human_approval_status` como columna;
* backfill de Features, runs o artifacts históricos;
* bootstrap retroactivo de FEATURE-023;
* edición humana desde UI;
* sincronización bidireccional DB ↔ Markdown;
* filtros por Feature o Release en FEATURE-022;
* lectura parcial de artifacts;
* recuperación durable completa del loop Developer ↔ QA;
* migración de Features abiertas entre templates;
* doble E2E real por provider;
* implementar como capacidad del producto el merge hacia `main` del propio repositorio del
  Orquestador; esta exclusión no altera el workflow normal de entrega de FEATURE-023;
* deploy;
* cambios generales al Approval Model.

## Future Ideas

Fuera de esta v1 podrán evaluarse:

* lifecycle de otros documentos;
* comparación visual entre revisiones;
* lectura parcial de artifacts;
* filtros por Feature y Release;
* recuperación durable completa del loop;
* migración controlada entre versiones de template.

Ninguna de estas ideas condiciona FEATURE-023.

---

# 5. Functional Rules

## Rule 1 — Dos capas documentales

El documento oficial de FEATURE-023 usa Playbook `v2.1`.

El documento operativo generado usa Runbook `v1.0`.

Sus Approval Gates no son equivalentes.

## Rule 2 — Functional define el lote, Planning selecciona

Functional define todas las Features del release.

Planning selecciona la Feature activa mediante `featureActualId`.

Functional no decide el orden de implementación.

## Rule 3 — Identidad estable

La clave lógica es:

```text
project_id + release_key + source_key
```

Un retry o un run de continuación no crea otra Feature.

## Rule 4 — Creación atómica

Si una definición del lote Functional es inválida, no se persiste ninguna.

## Rule 5 — Numeración controlada

Los `FEATURE-NNN` se reservan dentro de la misma transacción bajo lock del proyecto.

No se crea tabla de contadores.

## Rule 6 — Planning es atómico

Debe cumplirse:

```text
RELEASE_PLAN.featureActualId === FEATURE_UPDATE.sourceKey
```

Si falla, no se persiste Release Plan, Feature activa ni contribución documental.

## Rule 7 — Revisiones append-only

Una revisión aceptada nunca se sobrescribe.

## Rule 8 — Ownership obligatorio

El rol no puede escribir fuera de sus bloques.

El modelo no decide su propia autorización.

## Rule 9 — QA es factual

QA informa:

* `testStatus`;
* pruebas;
* evidencia;
* defectos;
* observaciones;
* riesgos de calidad.

QA no aprueba Feature, readiness, merge ni deploy.

## Rule 10 — Developer declara readiness

Después de tests exitosos, Developer evalúa el estado técnico y declara:

```text
ready
not_ready
ready_with_known_risks
```

## Rule 11 — Readiness no valida código nuevo

Si cambia branch, HEAD o tree hash durante readiness, el resultado queda invalidado.

Todo cambio debe pasar nuevamente por Build y QA.

## Rule 12 — Intentos

El readiness pertenece al mismo intento que su QA.

Sólo volver al ciclo de implementación + Build + QA consume otro intento.

El límite sigue siendo tres.

## Rule 13 — Estados reutilizados

Los estados operativos permanecen en `runs.status` y `runs.current_phase`.

No se duplican en `features`.

## Rule 14 — Hechos documentales, no estado paralelo

La publicación se deriva de:

```text
document_hash
final_commit_sha
pushed_branch
pushed_at
```

## Rule 15 — Release Plan conserva la completitud funcional

`Pendiente`, `En curso` y `Completada` siguen viviendo en el Release Plan.

`pushed_at` no significa `Completada`.

## Rule 16 — DB primaria, Markdown proyectado

La DB es la fuente operacional durante el lifecycle.

El Markdown no se edita bidireccionalmente.

## Rule 17 — Snapshot inmutable

Una Feature conserva el descriptor y hash capturados al crearla.

## Rule 18 — El Orquestador materializa

Los roles producen contribuciones estructuradas.

El Orquestador produce el archivo final.

## Rule 19 — UTF-8 y Unicode

El contenido humano conserva Unicode.

Sólo el slug se translitera a ASCII.

## Rule 20 — Ruta segura

La ruta:

* se calcula una vez;
* queda persistida;
* rechaza traversal y paths absolutos;
* nunca sobrescribe silenciosamente otro documento.

## Rule 21 — Protección de `docs/features/`

Developer no puede escribir mediante `fs_write` ni `fs_edit` bajo esa ruta.

El Orquestador verifica además los cambios Git para cubrir `command_exec`.

## Rule 22 — Artifacts inmutables

Cada nueva proyección genera un artifact nuevo.

El pointer canónico se actualiza atómicamente.

## Rule 23 — Límite de FEATURE-022

Por encima de 64 KiB no se garantiza lectura completa.

No habrá fragmentación ni lectura parcial.

## Rule 24 — SHA remoto exacto

La subrama sólo se considera publicada cuando su SHA remoto coincide con `final_commit_sha`.

## Rule 25 — Publicación no es aprobación

Confirmar el SHA remoto no implica:

* aprobación humana;
* merge;
* push de rama base;
* deploy;
* Feature completada.

## Rule 26 — Modo manual

Después de publicar la subrama, el run escala para que el usuario decida el merge.

## Rule 27 — Modo `auto`

El run se marca `completed` sólo después de un merge exitoso ejecutado en modo `auto`.

## Rule 28 — Approval Gate publicado en modo manual

El Markdown registra `Human merge authorization: pending` al publicar la subrama.

La respuesta humana posterior queda en eventos y artifacts; la v1 no crea otro commit documental.

## Rule 29 — Idempotencia por evento

El mismo evento durable no puede producir dos revisiones del mismo bloque.

## Rule 30 — Fallo bloqueante

Un fallo de validación, materialización, hash, commit, push o SHA remoto impide continuar al merge.

---

# 6. Estrategia Algorítmica

Esta sección es obligatoria porque FEATURE-023 introduce decisiones determinísticas de identidad,
revisión, proyección, readiness y publicación.

## 6.1 Creación por lote

Entradas:

* `project_id`;
* release activo fijado para el run;
* `FEATURES` normalizado;
* template y descriptor activos;
* run productor.

Algoritmo:

1. iniciar transacción;
2. bloquear la fila de `projects`;
3. validar el schema completo;
4. rechazar `source_key` duplicados;
5. validar que el release permanezca vigente para el run;
6. resolver identidades existentes por `(project_id, release_key, source_key)`;
7. leer códigos `FEATURE-NNN` existentes en DB y nombres compatibles en `docs/features/`;
8. calcular el mayor número;
9. reservar consecutivamente los códigos nuevos según el orden del lote;
10. calcular una ruta segura por Feature;
11. rechazar colisiones de ruta;
12. capturar template hash y descriptor snapshot;
13. insertar identities nuevas;
14. aplicar reglas de retry Functional sobre identities existentes;
15. insertar revisiones;
16. proyectar cada documento vigente;
17. insertar artifacts canónicos;
18. actualizar pointers;
19. registrar eventos;
20. confirmar toda la transacción.

Si cualquier paso falla, se revierte el lote completo.

## 6.2 Retry Functional

Para la misma identidad:

### Contenido normalizado idéntico

No crea revisión.

### Contenido diferente antes de activación

Crea una contribución funcional nueva.

### Contenido diferente después de activación

Se rechaza y escala.

La normalización:

* ordena claves de objetos;
* conserva arrays;
* preserva Unicode;
* no translitera texto humano.

## 6.3 Selección Planning

1. normalizar `RELEASE_PLAN` y `FEATURE_UPDATE`;
2. validar ambos schemas;
3. exigir igualdad entre `featureActualId` y `sourceKey`;
4. resolver la Feature dentro del proyecto y release fijados;
5. iniciar una transacción;
6. persistir la versión completa del Release Plan;
7. fijar `runs.active_feature_id`;
8. fijar `features.activated_at` si es null;
9. insertar revisiones Planning;
10. proyectar e insertar artifact;
11. actualizar pointer;
12. registrar eventos;
13. confirmar.

No se acepta una mitad de la respuesta.

## 6.4 Secuencia de revisiones

Para cada contribución:

1. bloquear la fila Feature;
2. comprobar ownership y activación;
3. calcular `sequence = max(sequence) + 1`;
4. generar una revisión por `section_key`;
5. compartir `contribution_id`;
6. usar un `source_event_key` único por bloque;
7. insertar revisiones;
8. proyectar;
9. insertar artifact;
10. actualizar `canonical_artifact_id`;
11. registrar evento.

La constraint única resuelve replays del mismo evento.

## 6.5 Developer ↔ QA y readiness

Por cada intento:

1. Developer implementa;
2. se registra su contribución;
3. BuildExecutor ejecuta el build;
4. si falla, el siguiente intento vuelve a Developer;
5. TestExecutor ejecuta el comando Planning;
6. QA interpreta el resultado factual;
7. si `testStatus = failed`, el siguiente intento vuelve a Developer con el resultado completo;
8. si `testStatus = passed`, se captura snapshot Git;
9. Developer declara readiness;
10. se captura otro snapshot;
11. si cambió branch, HEAD o tree hash, el readiness se invalida;
12. si `not_ready` o requiere cambios, se inicia otro intento;
13. si `ready` o `ready_with_known_risks`, continúa la publicación;
14. si se requiere un cuarto intento, se escala.

## 6.6 Snapshot Git de readiness

El snapshot contiene:

```text
branch
HEAD SHA
committable tree hash
```

El tree hash se obtiene:

1. creando un índice Git temporal;
2. ejecutando `git read-tree HEAD`;
3. ejecutando `git add -A` con `GIT_INDEX_FILE` temporal;
4. ejecutando `git write-tree`;
5. eliminando el índice temporal.

No se modifica el índice real.

Se incluyen:

* tracked;
* staged;
* unstaged;
* untracked no ignorados.

Los ignorados quedan fuera porque tampoco integrarían el commit publicado.

## 6.7 Proyección

Entradas:

```text
Feature identity
template snapshot
revisions ordered by sequence
approval_mode fijado
```

Por cada bloque:

1. tomar revisiones válidas;
2. aplicar `replace_section` en secuencia;
3. conservar `append_entry`;
4. conservar cada `record_qa_result`;
5. conservar cada `record_readiness`;
6. renderizar en el orden del descriptor.

## 6.8 Determinismo

La misma identidad, snapshot y secuencia producen los mismos bytes.

La salida usa:

* UTF-8 sin BOM;
* LF;
* línea final;
* orden fijo de metadata;
* orden de revisiones por `sequence`.

No depende de:

* timestamps como desempate;
* orden accidental de queries;
* reloj del worker;
* interpretación de IA;
* filesystem como fuente documental.

## 6.9 Materialización y protección

Antes:

1. recuperar `baseCommitSha`;
2. comprobar cambios commiteados bajo `docs/features/`;
3. comprobar staged, unstaged y untracked;
4. exigir cero cambios.

Después:

1. escribir únicamente `final_document_path`;
2. verificar que sea el único cambio permitido;
3. calcular `document_hash`;
4. persistirlo.

Después del commit:

1. leer el archivo desde el commit;
2. recalcular hash;
3. exigir igualdad;
4. rechazar cualquier otra ruta modificada.

## 6.10 Publicación Git

1. materializar;
2. ejecutar commit;
3. obtener `HEAD`;
4. persistir `final_commit_sha`;
5. verificar archivo y hash;
6. pushear subrama;
7. consultar `refs/heads/<branch>`;
8. exigir SHA remoto exacto;
9. persistir branch y timestamp;
10. emitir `run_pushed` enriquecido.

## 6.11 Reconciliación localizada

Si el commit existe pero falta `final_commit_sha`:

1. comparar `document_hash` con el archivo en `HEAD`;
2. si coincide, adoptar ese SHA;
3. si no, detener.

Si el remoto recibió el commit pero falta `pushed_at`:

1. consultar la rama remota;
2. si coincide con el SHA esperado, completar hechos;
3. si no, detener.

No se crea otro commit.

## 6.12 Estado derivado

```text
document_hash null
→ no materializada

document_hash presente y final_commit_sha null
→ materializada

final_commit_sha presente y pushed_at null
→ commiteada

pushed_at presente
→ subrama publicada con SHA verificado
```

Este estado no determina la completitud funcional.

---

# 7. Technical Considerations

## 7.1 Encaje con el runtime actual

### Estados operativos

Permanecen en:

```text
runs.status
runs.current_phase
```

Se reutilizan:

```text
sin_iniciar
running
retrying
escalated
completed
failed
aborted
resolved
```

No se agregan estados equivalentes en `features`.

### Resultados

Permanecen en `PhaseResult`, definido en:

```text
src/contracts/executor.ts
```

No se modifica su forma.

### Retries

Se extiende `runDeveloperQaLoop`, sin crear otro loop.

### Escalamiento

Se reutilizan:

* `handleLinearEscalation`;
* artifact `mergeApproval`;
* `respondMergeApproval`;
* resolución o aborto del run.

### Git

Se extienden de forma localizada:

* `commitAllChanges`;
* `pushRunBranch`;
* `mergeFeatureBranchIntoBase`.

## 7.2 Modelo relacional definitivo

### Tabla `features`

```text
id uuid primary key
project_id uuid not null references projects(id)
release_key text not null
source_key text not null
feature_code text not null
name text not null
priority text not null
template_key text not null
template_version text not null
template_hash text not null
template_snapshot jsonb not null
canonical_artifact_id uuid null references artifacts(id)
final_document_path text not null
activated_at timestamptz null
document_hash text null
final_commit_sha text null
pushed_branch text null
pushed_at timestamptz null
created_in_run_id uuid not null references runs(id)
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Constraints:

```text
unique (project_id, release_key, source_key)
unique (project_id, feature_code)
```

`priority` conserva el contrato vigente de Functional y la aplicación valida el conjunto cerrado
`P0 | P1 | P2`. La columna permanece como `text`; no se introduce un enum PostgreSQL ni se aceptan
valores arbitrarios.

`release_key` es texto proveniente del roadmap versionado.

No se crea tabla `releases`.

### Tabla `feature_revisions`

```text
id uuid primary key
feature_id uuid not null references features(id)
sequence bigint not null
contribution_id text not null
source_event_key text not null
section_key text not null
operation text not null
content jsonb not null
producer_role text not null
producer_run_id uuid not null references runs(id)
attempt integer null
created_at timestamptz not null default now()
```

Constraints:

```text
unique (feature_id, sequence)
unique (feature_id, source_event_key)
check (attempt is null or attempt >= 1)
check (producer_role in ('functional', 'planning', 'developer', 'qa'))
check (operation in (
  'replace_section',
  'append_entry',
  'record_qa_result',
  'record_readiness'
))
```

### Cambio en `runs`

```text
active_feature_id uuid null references features(id)
```

Se agrega un índice.

El repository comprueba que run y Feature pertenezcan al mismo proyecto.

## 7.3 Agrupación e idempotencia

Cada `phase_finished` aceptado aporta un ID durable.

`recordRunEvent` deberá devolver el ID insertado.

Formato:

```text
contribution_id =
<run_id>:event:<phase_finished_event_id>:<purpose>:<source_key>

source_event_key =
<contribution_id>:<section_key>
```

Purposes:

```text
functional-definition
planning-update
developer-implementation
qa-result
developer-readiness
```

Una respuesta multi-bloque comparte `contribution_id`.

## 7.4 Transacciones

### Functional

Una transacción contiene:

* lock del proyecto;
* validación;
* numeración;
* identities;
* revisiones;
* artifacts;
* pointers;
* eventos.

### Planning

Una transacción contiene:

* Release Plan;
* Feature activa;
* `activated_at`;
* revisiones;
* artifact;
* eventos.

### Contribución de rol

Una transacción contiene:

* lock de Feature;
* ownership;
* secuencia;
* revisiones;
* artifact;
* pointer;
* evento.

`recordArtifact` deberá aceptar `PoolClient`.

Git y PostgreSQL no comparten transacción distribuida. La reconciliación usa hashes y SHA.

## 7.5 Normalización de providers

Claude representa etiquetas específicas como propiedades dentro de `outputArtifact`.

Codex conserva `outputArtifact` textual.

Se implementará un normalizador único que:

1. extraiga etiquetas desde objeto o texto;
2. parsee JSON;
3. valide schemas cerrados;
4. devuelva la misma representación interna.

No se modifican `PhaseInvocation` ni `PhaseResult`.

## 7.6 Schemas cerrados por momento documental

El Orquestador completa desde contexto confiable:

```text
feature_id
project_id
producer_role
producer_run_id
attempt
timestamps
contribution_id
source_event_key
```

### Functional — `FEATURES`

```json
{
  "features": [
    {
      "id": "f1",
      "nombre": "Nombre observable",
      "resumen": "Resumen breve",
      "prioridad": "P0",
      "documento": {
        "problemStatement": "string",
        "functionalGoal": "string",
        "scope": {
          "included": ["string"],
          "excluded": ["string"],
          "futureIdeas": ["string"]
        },
        "functionalRules": ["string"],
        "algorithmicStrategy": {
          "objective": "string",
          "inputs": ["string"],
          "outputs": ["string"],
          "constraints": ["string"],
          "tieBreakers": ["string"],
          "regressions": [
            {
              "scenario": "string",
              "input": "string",
              "expectedOutput": "string"
            }
          ]
        },
        "validationCriteria": [
          {
            "scenario": "string",
            "input": "string",
            "expectedOutput": "string"
          }
        ],
        "validationEvidence": "string",
        "risks": ["string"]
      }
    }
  ]
}
```

`algorithmicStrategy` admite el objeto mostrado o `null`.

No se aceptan propiedades adicionales.

### Planning — `FEATURE_UPDATE`

```json
{
  "sourceKey": "f1",
  "technicalConsiderations": {
    "affectedComponents": ["string"],
    "approach": "string",
    "dependencies": ["string"]
  },
  "validationPlan": {
    "testCommand": "node --test ...",
    "scenarios": [
      {
        "scenario": "string",
        "action": "string",
        "expected": "string"
      }
    ],
    "evidenceRequired": ["string"]
  },
  "technicalRisks": ["string"]
}
```

`validationPlan.testCommand` debe coincidir con `COMANDO_TEST`.

### Developer — implementación

```json
{
  "implementationSummary": "string",
  "filesChanged": ["string"],
  "decisions": ["string"],
  "technicalEvidence": ["string"]
}
```

El Build real lo incorpora el Orquestador desde `build_executed`.

### QA — resultado factual

```json
{
  "testStatus": "passed",
  "testsExecuted": ["string"],
  "evidence": "string",
  "defects": [],
  "observations": ["string"],
  "qualityRisks": ["string"]
}
```

`testStatus` admite:

```text
passed
failed
```

Reglas:

* `passed` coincide con exit code cero y sin timeout;
* `failed` corresponde a tests ejecutados y fallidos;
* `testsExecuted` no queda vacío;
* si no se pudo ejecutar, `PhaseResult.status = escalated`;
* QA no declara aprobación.

### Developer — readiness

```json
{
  "readiness": "ready",
  "summary": "string",
  "knownRisks": ["string"],
  "requiresCodeChanges": false,
  "finalNotes": ["string"]
}
```

Valores:

```text
ready
not_ready
ready_with_known_risks
```

Reglas:

* `ready` y `ready_with_known_risks` exigen `requiresCodeChanges = false`;
* `not_ready` vuelve al loop;
* riesgo fuera de autoridad usa `PhaseResult.status = escalated`;
* no se agregan valores a `PhaseStatus`.

## 7.7 Descriptor y render

Las diez secciones principales se conservan.

### Sección 7

* contribución Planning;
* implementación Developer;
* readiness Developer.

### Sección 8

* criterios Functional;
* plan Planning;
* resultados QA por intento.

### Sección 9

* riesgos funcionales;
* técnicos;
* calidad;
* conocidos por Developer.

### Sección 10

Modo manual:

```text
Approval mode: manual
Readiness declared by: Developer
QA result: tests passed
Human merge authorization: pending
```

Modo `auto`:

```text
Approval mode: auto
Readiness declared by: Developer
QA result: tests passed
Human merge authorization: not_required
Pipeline decision: continue
```

El documento registra el estado al publicar la subrama.

La respuesta humana posterior queda auditada en el run.

## 7.8 UTF-8 y ruta

El contenido se genera:

* UTF-8 sin BOM;
* Unicode preservado;
* LF;
* línea final.

Ejemplo:

```markdown
# FEATURE-036 — Autenticación y recuperación de contraseña
```

Ruta:

```text
docs/features/FEATURE-036-autenticacion-y-recuperacion-de-contrasena.md
```

El contenido humano nunca se translitera.

Sólo el slug se convierte a ASCII.

## 7.9 Protección de `docs/features/`

### Prevención directa

`fs_write` y `fs_edit` rechazan esa ruta para Developer.

### Verificación Git

Al iniciar el run se registra `baseCommitSha`.

Antes de materializar se revisan:

* commits desde la base;
* staged;
* unstaged;
* untracked.

Después sólo se permite `final_document_path`.

Después del commit se verifica la ruta y hash dentro del commit.

## 7.10 Artifact canónico

Forma:

```text
summary
featureId
featureCode
templateKey
templateVersion
revisionSequence
document
```

El historial permanece en `feature_revisions`.

El límite de 64 KiB de FEATURE-022 no cambia.

## 7.11 Git y modos

### Subrama

`run_pushed` se emite sólo después de confirmar SHA remoto.

### Modo manual

Después de la publicación:

* crear `mergeApproval`;
* escalar;
* usuario autoriza o aborta;
* si autoriza, reutilizar `respondMergeApproval`;
* si rechaza, no mergear ni completar el Release Plan.

### Modo `auto`

Orden:

1. merge;
2. push de rama base;
3. evento;
4. run `completed`;
5. continuación Planning.

No se marca `completed` antes del merge.

## 7.12 UI

Se extiende `GET /runs/:id`:

```json
{
  "featureDocument": {
    "featureId": "uuid",
    "featureCode": "FEATURE-036",
    "name": "string",
    "publicationState": "pushed",
    "path": "docs/features/...",
    "commitSha": "sha",
    "canonicalArtifactId": "uuid",
    "approvalMode": "manual",
    "humanMergeAuthorization": "pending",
    "markdown": "string | null",
    "complete": true,
    "reason": null
  }
}
```

`publicationState` y `humanMergeAuthorization` son derivados.

Autorización:

* se reutiliza `getRunDetailForUser`.

Contenido:

* hasta 64 KiB: Markdown completo;
* por encima: `markdown: null`, metadata, artifact ID y `CONTENT_TOO_LARGE`.

UI:

* texto escapado;
* copia;
* sin edición;
* modal al observar por primera vez la publicación;
* acción recuperable tras reload;
* espera humana sólo en modo manual cuando corresponda.

## 7.13 Bootstrap

FEATURE-023 no se importa retrospectivamente.

La validación E2E crea una Feature controlada posterior.

No se crea una segunda ruta documental para FEATURE-023.

---

# 8. Validation Criteria

## Scenario 1 — Creación atómica de dos Features

**Input**

Functional declara dos Features válidas con `source_key` distintos.

**Expected output**

* se crean dos identities;
* comparten proyecto y release;
* reciben revisiones funcionales;
* reciben artifacts canónicos;
* no existe persistencia parcial.

## Scenario 2 — Numeración consecutiva

**Input**

El proyecto ya contiene `FEATURE-004` y Functional declara dos Features nuevas.

**Expected output**

* se bloquea el proyecto;
* se reservan `FEATURE-005` y `FEATURE-006`;
* no hay códigos ni rutas duplicadas.

## Scenario 3 — Lote inválido

**Input**

Una de dos Features omite un campo obligatorio.

**Expected output**

* se rechaza todo el lote;
* no se crea ninguna identity, revisión ni artifact.

## Scenario 4 — Retry Functional idempotente

**Input**

Functional reenvía el mismo contenido normalizado.

**Expected output**

* se conserva una única proyección;
* no se crea revisión duplicada.

## Scenario 5 — Cambio Functional antes y después de activación

**Input**

Functional cambia el contenido primero antes de `activated_at` y luego intenta otro cambio después.

**Expected output**

* el primer cambio crea revisión append-only;
* el segundo se rechaza y escala;
* no se reescribe historia.

## Scenario 6 — Inconsistencia Planning

**Input**

`RELEASE_PLAN.featureActualId = "f1"` y `FEATURE_UPDATE.sourceKey = "f2"`.

**Expected output**

* se rechaza la respuesta completa;
* no se persiste Release Plan;
* no se fija `active_feature_id`;
* no se crea revisión.

## Scenario 7 — Correlación de Feature activa

**Input**

Planning selecciona una Feature existente del mismo proyecto y release.

**Expected output**

* `runs.active_feature_id` queda fijado;
* `activated_at` se establece una sola vez;
* otro proyecto o release es rechazado.

## Scenario 8 — Idempotencia de contribución

**Input**

Se reprocesa el mismo `phase_finished_event_id`.

**Expected output**

* se regeneran las mismas claves;
* no se duplican revisiones;
* contenido distinto con la misma clave se rechaza.

## Scenario 9 — Ownership

**Input**

Developer intenta modificar un resultado QA.

**Expected output**

* la mutación se rechaza;
* el resultado QA permanece intacto;
* no se crea revisión válida.

## Scenario 10 — Coherencia de QA

**Input**

QA declara `testStatus = passed`, pero TestExecutor devolvió exit code distinto de cero.

**Expected output**

* el payload se rechaza;
* QA no puede convertir el fallo en éxito;
* el pipeline no avanza a readiness.

## Scenario 11 — Readiness sin cambios

**Input**

QA informa tests passed; Developer declara `ready`; branch, HEAD y tree hash no cambian.

**Expected output**

* se registra revisión readiness;
* no se consume otro intento;
* continúa materialización.

## Scenario 12 — Readiness invalidado

**Input**

Developer cambia un archivo, HEAD o branch durante readiness.

**Expected output**

* readiness inválido;
* no se crea revisión readiness válida;
* se registra evento;
* se repiten Build y QA.

## Scenario 13 — `not_ready`

**Input**

Developer declara `not_ready` sin cambiar todavía el worktree.

**Expected output**

* se conserva la evaluación;
* el siguiente ciclo vuelve a implementación;
* el nuevo ciclo consume el siguiente intento.

## Scenario 14 — Límite de tres intentos

**Input**

El intento 3 termina requiriendo cambios después de QA.

**Expected output**

* no existe intento 4;
* se registra `loop_exhausted`;
* se usa el escalamiento actual.

## Scenario 15 — Determinismo y Unicode

**Input**

Se proyectan dos veces las mismas revisiones que contienen `Autenticación`, `niñez` y `—`.

**Expected output**

* Markdown byte a byte idéntico;
* mismo SHA-256;
* Unicode preservado;
* UTF-8 sin BOM y LF.

## Scenario 16 — Slug seguro

**Input**

Nombre con acentos y un intento de incluir `../`.

**Expected output**

* el título conserva Unicode;
* el slug válido usa ASCII;
* traversal y path absoluto se rechazan.

## Scenario 17 — Protección de `docs/features/`

**Input**

Developer intenta escribir directamente y luego mediante `command_exec`.

**Expected output**

* `fs_write` y `fs_edit` rechazan;
* la verificación Git detecta cambios indirectos;
* el cierre queda bloqueado.

## Scenario 18 — Confirmación de SHA remoto

**Input**

El push termina, pero `refs/heads/<branch>` no coincide con `final_commit_sha`.

**Expected output**

* no se persiste `pushed_at`;
* no se habilita merge;
* `run_pushed` no declara éxito.

## Scenario 19 — Retry después de commit o push

**Input**

La DB falla después del commit o después de que el remoto recibe el SHA esperado.

**Expected output**

* se adopta `HEAD` sólo si el hash documental coincide;
* se confirma el remoto por SHA;
* no se genera otro commit;
* se detiene ante cualquier divergencia.

## Scenario 20 — Modo manual

**Input**

Readiness válido y `approval_mode = manual`.

**Expected output**

* subrama publicada y verificada;
* run escalado con `mergeApproval`;
* UI muestra autorización pendiente;
* sólo una respuesta humana autorizada ejecuta el merge;
* rechazo no marca la Feature completada.

## Scenario 21 — Modo `auto`

**Input**

Readiness válido y `approval_mode = auto`.

**Expected output**

* no se crea espera humana;
* se ejecuta merge y push de rama base;
* el run se marca completed sólo después del éxito;
* un fallo de merge no deja completed;
* Planning continúa.

## Scenario 22 — Límite de 64 KiB

**Input**

El Markdown final supera 64 KiB UTF-8.

**Expected output**

* `GET /runs/:id` devuelve metadata y `canonicalArtifactId`;
* `markdown: null`;
* `complete: false`;
* `reason: CONTENT_TOO_LARGE`;
* no se introduce lectura parcial.

## Scenario 23 — Providers equivalentes

**Input**

Claude devuelve labels como propiedades y Codex dentro de texto.

**Expected output**

* ambos normalizan al mismo objeto interno;
* schemas y ownership se aplican de manera idéntica.

## Scenario 24 — Lectura universal aislada

**Input**

Otro rol del mismo proyecto lee el artifact y un run de otro proyecto intenta hacerlo.

**Expected output**

* el primer acceso funciona bajo FEATURE-022;
* el segundo recibe el error indistinguible existente;
* ninguno obtiene escritura.

## Scenario 25 — UI después de reload

**Input**

El usuario recarga después de publicar la subrama.

**Expected output**

* `GET /runs/:id` reconstruye `featureDocument`;
* “Ver documento de Feature” permanece disponible;
* el modo `manual` o `auto` se representa correctamente.

## Validation Evidence

La evidencia deberá incluir:

* tests unitarios de schemas, ownership, secuencia e idempotencia;
* tests de integración PostgreSQL para transacciones Functional y Planning;
* tests Git reales para tree hash, protección de ruta, commit y SHA remoto;
* tests de parser equivalentes para Claude y Codex;
* tests UI para límite, reload y modo;
* inspección del Markdown UTF-8 real;
* inspección del commit y subrama remota;
* lectura del artifact desde otro rol;
* un E2E real con una Feature controlada y un provider real.

El E2E deberá demostrar:

1. lote Functional;
2. identities;
3. selección Planning;
4. implementación;
5. Build;
6. resultado factual QA;
7. readiness;
8. materialización;
9. commit;
10. push;
11. SHA remoto;
12. lectura mediante FEATURE-022;
13. recuperación UI;
14. continuidad según el modo elegido.

No se requieren:

* dos E2E reales;
* backfill;
* validación retrospectiva de FEATURE-023;
* recuperación durable completa del loop;
* lectura parcial.

---

# 9. Risks

## Riesgo — Confusión entre Playbook y Runbook

**Impacto:** aplicar un Approval Gate incorrecto.

**Mitigación:** mantener template, versión y propósito separados en identidad y snapshot.

## Riesgo — Duplicación de estados

**Impacto:** divergencia entre run, Feature y Release Plan.

**Mitigación:** no crear estados paralelos; persistir sólo hechos.

## Riesgo — QA interpretado como aprobador

**Impacto:** transferir a QA una decisión técnica o humana que no le pertenece.

**Mitigación:** schema factual `testStatus` y readiness exclusivo de Developer.

## Riesgo — Código modificado después de QA

**Impacto:** publicar código no validado.

**Mitigación:** snapshots antes y después de readiness; todo cambio vuelve a Build + QA.

## Riesgo — Cuarto intento silencioso

**Impacto:** violar el límite vigente.

**Mitigación:** readiness no incrementa; volver a implementación sí; el tercero escala.

## Riesgo — Duplicación de revisiones

**Impacto:** historia incorrecta y artifacts repetidos.

**Mitigación:** IDs derivados de eventos durables y constraints únicas.

## Riesgo — Colisión de `FEATURE-NNN`

**Impacto:** dos identities o archivos con el mismo código.

**Mitigación:** lock del proyecto, máximo conjunto DB/repositorio, reserva por lote y unique
constraint.

## Riesgo — Planning parcialmente persistido

**Impacto:** Release Plan apunta a una Feature distinta del documento técnico.

**Mitigación:** validación previa y transacción única.

## Riesgo — Provider divergence

**Impacto:** Claude funciona y Codex pierde contratos específicos.

**Mitigación:** normalizador único objeto/texto y tests parametrizados.

## Riesgo — Escritura indirecta en `docs/features/`

**Impacto:** Developer suplanta al materializador.

**Mitigación:** denegación directa, commit base y verificación Git completa.

## Riesgo — Divergencia DB/Git

**Impacto:** cierre falso o commits duplicados.

**Mitigación:** hash, SHA esperado, confirmación remota y reconciliación localizada.

## Riesgo — Documento manual con autorización pendiente

**Impacto:** interpretar el Markdown publicado como desactualizado después de responder el merge.

**Mitigación:** declarar que es snapshot de publicación; la decisión posterior vive en eventos.

## Riesgo — Documento mayor a 64 KiB

**Impacto:** UI o agentes no reciben contenido completo.

**Mitigación:** metadata y artifact ID; aceptar `CONTENT_TOO_LARGE`; no ampliar alcance.

## Riesgo — Alcance excesivamente genérico

**Impacto:** convertir FEATURE-023 en plataforma documental universal.

**Mitigación:** descriptor único, dos tablas, sin backfill, otros templates ni engine genérico.

---

# 10. Approval Gate

El AI Product Architect y el owner validaron el diseño final, incluido el scope v1, el modelo
relacional, los schemas, el turno post-QA y el contador de intentos.

Condiciones de apertura de Development:

1. **Aprobación explícita del owner:** concedida el 2026-07-28.
2. **Rama:** `codex/feature-023-lifecycle`.
3. **Checkout de origen:** checkout local del owner, desde `main@4e4f2092d7355dc681890e98fc80b30486da3764`.
4. **Precisiones editoriales:** incorporadas; el modo contractual es `auto`, la exclusión de merge
   quedó acotada a una capacidad del producto y `priority` valida `P0 | P1 | P2`.
5. **Compromiso de alcance:** DAIA implementará exclusivamente el alcance documentado en
   FEATURE-023.

El merge de esta rama hacia `main` y el push de `main` permanecen sujetos al workflow normal de
entrega y a autorización posterior del owner.

**Approval Gate: APROBADO**

**Implementación: AUTORIZADA**
