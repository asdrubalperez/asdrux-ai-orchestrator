# Validación técnica del diseño de ARIA — FEATURE-042

Contraste del diseño "Creación, selección y configuración de proyectos" (traído por el owner tras
revisión con ARIA) contra el código real de `asdrux-ai-orchestrator`. No se implementó nada, no se
tocó `docs/ROADMAP.md`.

## Addendum — validación del plan de cableado (sección 11.2 de la propuesta de alcance, post FEATURE-026 mergeada)

Con FEATURE-026 ya en `main`, se validó contra el código real el plan de cableado descrito en
`docs/features/FEATURE-042-propuesta-de-alcance-revisado-absorbe-FEATURE-030.md`, sección 11.2
("en el punto donde `runStart.ts` arranca un run, resolver `run.owner_id -> createGitProcessAuth`
y pasar `gitAuth` a `cloneRunRepository`/`pushRunBranch`"). Esa premisa es **fácticamente
incorrecta** en un punto central y debe corregirse antes de usarse como base de implementación.

### Corrección 1 — `cloneRunRepository` no se llama desde `runStart.ts`

Hay un único call-site en todo el repo: **`src/cli/intakeService.ts:156`**, dentro de
`startPendingRun({ runId, userId })` (línea 126) — el punto real donde un run pasa de
`sin_iniciar` a `running` (invocado desde `POST /runs/:id/start`, `src/server/app.ts:351`).
`runStart.ts` **nunca llama a `cloneRunRepository`**; solo usa `pushRunBranch`. El cableado del
clon va en `intakeService.ts`, no en `runStart.ts` como dice la sección 11.2.

Buena noticia dentro de la corrección: `userId` ya está disponible ahí directamente como parámetro
de `startPendingRun`, y ya existe manejo de error (`try/catch RunRepoCloneError`, líneas 157-162)
al que hay que sumarle el caso de conexión GitHub ausente/inválida (ver Corrección 3).

### Corrección 2 — el cableado de `pushRunBranch` no es "un solo lugar"

Dos call-sites reales, ambos en `runStart.ts`, con complejidad distinta:

- **`runStart.ts:1160`**, dentro de `continueReleaseAfterFeatureApproved` — `userId` ya está en la
  firma de la función. Cableado directo.
- **`runStart.ts:1885`**, dentro de `finishRun(repoRoot, runId, worktree, finalResult, opts)` —
  **esta función no recibe `userId`**. El dato existe una función más arriba
  (`executePipelineRun`, línea 309/334) pero hay que agregar el parámetro a `finishRun` y
  propagarlo en sus **7 call-sites** (`runStart.ts:477, 545, 550, 585, 589, 621, 637`). Es trabajo
  de plomería real, no un cableado trivial de un punto único.

Los child runs (reingreso/escalamiento) no vuelven a clonar — usan `createRunWorktree` (git
worktree add sobre el repo ya clonado del run padre), confirmado en `runStart.ts` (líneas
1268-1325, 1336+) y `respondService.ts:304`. Sí terminan pasando por los mismos dos call-sites de
`pushRunBranch` al invocar `executePipelineRun` recursivamente, con `userId` ya threadeado
correctamente a través de esos params — no hace falta cableado adicional específico para child
runs una vez resuelto el punto de `finishRun`.

### Corrección 3 — manejo de errores de conexión GitHub: net-new, no reutilizable

`createGitProcessAuth(userId)` lanza `GitConnectionRequiredError`/`GitConnectionInvalidError`
*antes* de tocar git (`resolveActiveConnection`, `gitConnectionService.ts:142-149`). Hoy no existe
ningún manejo de esos errores en el flujo de arranque/push de runs — `runStart.ts` no importa nada
de `gitConnectionService.ts`. Si se cablea sin agregar manejo explícito, esos errores caerían en el
catch-all genérico (`next(err)` → 500), en vez de traducirse a un estado distinguible como ya pasa
hoy con `RunRepoCloneError` → `repo_clone_failed` (422). El precedente a replicar ya existe
(`src/server/app.ts:200`, el endpoint `/auth/github/repositories` sí distingue estos dos errores
con un 409 `git_connection_required`) — hay que llevar ese mismo criterio al flujo de runs, no
inventarlo de cero, pero sí escribirlo.

### Impacto sobre la sección 10.1 (Criterios de cierre)

El criterio 9 ("Un run web sin conexión válida falla incluso si la VPS conserva una clave SSH
legacy funcional") es alcanzable, pero conviene endurecerlo: no alcanza con que "falle" — tiene que
fallar con un estado distinguible y accionable para el usuario (mismo criterio que
`repo_clone_failed`), no como un error 500 genérico indistinguible de un bug. Vale la pena que el
criterio lo diga explícitamente.

### Veredicto

Nada de esto invalida el diseño de fondo — el cableado sigue siendo alcanzable y sigue perteneciendo
al Scope de FEATURE-042. Pero la sección 11.2 de la propuesta describe un plan de implementación
más simple del que es en realidad, y en el lugar equivocado del código. Antes de que esto pase a
Approval Gate, la sección 11.2 debería corregirse: el punto de entrada real es
`intakeService.ts:startPendingRun` para el clon, y `runStart.ts` tiene dos puntos distintos para el
push, uno de los cuales requiere modificar una firma de función y sus 7 llamadores.

## Veredicto general

El diseño está bien fundado en varios puntos que confirman exactamente lo que el código hace hoy
(ver sección "Confirmado sin matices"). Encontré **una brecha estructural no mencionada** (FK
circular en `users.last_selected_project_id`), **una subestimación real del alcance de la
dependencia con FEATURE-026** (no es un riesgo suave, varias reglas de validación de rama son
literalmente inimplementables sin ella hoy), y **menos infraestructura de la asumida** para
validación de ramas. Nada de esto invalida el diseño — todo es corregible antes del Approval Gate.

## Confirmado sin matices

- `listRunsForUser` (`src/db/repository.ts:283-288`) no filtra por `project_id` — trae todo por
  `owner_id`. La UI de casos (`web/src/intake/CasesList.tsx:22-30`) consume `GET /runs` sin ningún
  parámetro de proyecto. El diseño identifica correctamente que esto es hoy "transversal", no por
  proyecto.
- No hay router formal en `web/` — confirmado, `package.json` no tiene `react-router`. Peor de lo
  que el diseño describe: el query param `?run=` no es reactivo, solo se lee una vez al montar
  (`web/src/main.tsx:114`) y se escribe con `replaceState` (no `pushState`, sin historial real).
  No existe ningún parámetro de proyecto en la URL hoy. Esto refuerza, no debilita, la necesidad
  de introducir routing real — la Regla 6 no es opcional si se quieren deep links funcionales.
- Ownership: cada función de acceso (`getRunDetailForUser`, `getRunEventsAfterForUser`,
  `forceUserEscalation`, `listRunsForUser`, `getProjectForUser`) compara `owner_id` contra el
  usuario de sesión de forma ad-hoc, función por función — no hay un middleware central de
  autorización de recursos. Esto **no está mencionado como riesgo/esfuerzo en el diseño** y debería
  estarlo: agregar `project_id` como segundo filtro (Regla 4) implica tocar cada una de estas
  funciones individualmente, no un punto único.
- Herencia de `project_id` en child runs/reentrada: confirmado sin excepciones. El único origen es
  `parentRun.project_id` propagado directo (`src/cli/respondService.ts:135-138,310,328`),
  `getProjectForUser` nunca se vuelve a invocar fuera de creación de run nuevo desde intake
  (`intakeService.ts:52`) o el comando CLI standalone (`runStart.ts:187`). La Regla 15 es correcta
  tal cual está escrita.

## Brecha 1 — `users.last_selected_project_id` introduce una FK circular que no existe hoy

`users` es hoy una tabla "hoja" en el grafo de FKs: nada le apunta hacia adentro
(`migrations/0002_users_projects_phase_a.sql:1-6`, sin columnas más allá de
`id, handle, password_hash, created_at`; confirmado que ninguna migración posterior le agrega
columnas). En cambio `projects.owner_id → users(id)` sí existe (0002:12).

Agregar `users.last_selected_project_id → projects(id)` (opción recomendada en la sección 7.2 del
diseño) crea un ciclo `users → projects → users` que hoy no existe. Dos consecuencias concretas que
el diseño no resuelve:

1. **Borrado**: ninguna FK existente en el esquema declara `on delete` (todas usan el default
   `NO ACTION`). Sin `ON DELETE SET NULL` explícito en `last_selected_project_id`, borrar un
   proyecto seleccionado como "último" rompería el borrado o quedaría huérfano.
2. **Orden de inserción**: crear un usuario junto con su primer proyecto en una sola transacción
   deja de ser trivial — no se puede insertar `users` con un `project_id` que todavía no existe.
   Requiere dos pasos (insert user sin selección → insert project → update user), que hoy no hace
   falta porque `users` no referencia nada.

Esto no descarta la opción (sigue siendo mejor que `localStorage`, como recomienda el diseño), pero
la decisión pendiente #4 de la sección 12 debería incluir explícitamente `ON DELETE SET NULL` y el
orden de inserción en dos pasos como parte de la respuesta, no dejarlo abierto.

## Brecha 2 — la dependencia con FEATURE-026 es más fuerte de lo que el diseño reconoce

El diseño trata esto como "Riesgo 1" (soft risk, con tres opciones de secuenciación). La evidencia
dice que es más restrictivo: **hoy no existe ningún concepto de identidad Git por usuario.**

- Confirmado en el propio código (`src/isolation/worktree.ts:390-392`, docstring): *"se asume la
  misma configuración ambiente de git del host/VPS... SSH agent / credential helper ya
  configurado. No se introduce manejo de tokens/API keys de git."*
- Es una única clave SSH compartida a nivel de host/VPS, para todos los usuarios y todos los
  proyectos. `normalizeGitCloneUrl` reescribe HTTPS→SSH explícitamente porque "la VPS solo tiene
  configurada una clave SSH" (worktree.ts:396-401).
- Ninguna migración ni tabla contempla credenciales Git por usuario (grep negativo sobre
  "credential" en `migrations/`).

Consecuencia directa sobre el diseño: la **Regla 12, paso 2** ("se verificará que la identidad Git
del usuario pueda crear ramas") y el **Escenario 13** ("rama inexistente y usuario sin permiso de
creación") **no son implementables como están escritos hoy** — no hay forma de distinguir "este
usuario no tiene permiso" de "el repo es privado y la clave SSH del host no alcanza", porque solo
existe una identidad Git, la del host, compartida por todos. Cualquier implementación de FEATURE-042
sin FEATURE-026 tendría que:
- o bien tratar "permiso de creación" como una propiedad del host (todo o nada, no por usuario) y
  documentar esa limitación explícitamente en el propio Escenario 13,
- o bien aceptar que ese escenario específico queda fuera de alcance de FEATURE-042 hasta que
  FEATURE-026 exista.

Recomendación: la decisión pendiente #3 (orden con FEATURE-026) debería resolverse a favor de
"FEATURE-026 antes, o al menos su primitiva mínima de identidad Git por usuario junto con
FEATURE-042" — no como una opción simétrica a "FEATURE-042 acepta capacidad parcial", porque esa
capacidad parcial no es "menos completa", es conceptualmente distinta (control por host, no por
usuario) y puede generar una falsa sensación de seguridad si se implementa sin dejarlo explícito en
la UI.

## Brecha 3 — menos infraestructura de validación de ramas de la asumida

De las Reglas 11-14, lo único reutilizable hoy es:
- `remoteBranchSha` (`worktree.ts:178-187`) — chequeo de existencia vía `git ls-remote --heads`,
  usado hoy solo post-push, no en intake.
- El comportamiento de fallo de `git clone --branch <baseRef> --single-branch`
  (`cloneRunRepository`, `worktree.ts:412-452`) — si la rama no existe, el clon falla y se envuelve
  en `RunRepoCloneError`.

**No existe** (confirmado con grep, cero coincidencias en todo `worktree.ts`):
- Una función de "¿existe esta rama?" reutilizable sin clonar/crear.
- Ninguna detección de default branch del remoto (`git remote show origin`, `symbolic-ref`, etc.).
  El `"main"` que aparece en `ReviewModal.tsx:16-18,29` es un hardcode del frontend, no una consulta
  real al repo.
- Ninguna operación independiente de "crear rama desde main antes de clonar" — hoy la única
  creación de rama para intake es el `checkout -b` posterior al clon, que asume que `--branch`
  resolvió algo válido.

Nota a favor del diseño: la Regla 13 (fijar siempre `main` como origen, nunca usar la default
branch reportada por Git) **elimina la necesidad de construir detección de default branch** —
coincide con que hoy no existe esa lógica, así que no hay que construirla. Pero el resto (chequeo
de existencia desacoplado del clonado, creación explícita desde `main` con advertencia previa al
usuario) sí es trabajo net-new, no una extensión de algo existente. Vale la pena que la estimación
de esfuerzo de FEATURE-042 lo refleje así, no como "ajustar" `cloneRunRepository`.

## `intake_field_definitions` — confirma el plan, con un detalle de mecanismo

Los 12 campos existen tal como los describe el diseño (`migrations/0009_intake_field_definitions.sql`,
`field_order` 1-12). Confirmado: no hay ninguna columna de "activo/inactivo" en
`intake_field_definitions` — sacar `repositorio` del intake exige un `DELETE` de esa fila o una
migración de esquema, no un flag. `rama_base_trabajo` solo tiene su default `"main"` hardcodeado en
el frontend (`ReviewModal.tsx:16-29`), no en la base — si `repositorio` se retira, la validación de
completitud (`completenessPercent`, ReviewModal.tsx:32-39, exige 100% de todos los campos activos)
debería seguir funcionando sola una vez borrada la fila, sin cambios adicionales de esa lógica.

## Respuesta con evidencia a 4 de las 12 decisiones pendientes (sección 12 del diseño)

- **#3 (orden con FEATURE-026)**: ver Brecha 2 — recomiendo no tratarlas como independientes.
- **#4 (persistencia de `last_selected_project_id`)**: ver Brecha 1 — server-side sigue siendo
  correcto, pero cerrar explícitamente `ON DELETE SET NULL` y el orden de inserción en dos pasos.
- **#5 (¿router formal?)**: la evidencia empuja a sí — el estado actual ni siquiera sostiene
  correctamente el caso de uso existente de "run" (sin `pushState`, sin reactividad a cambios de
  URL). Extenderlo con `projectId` sin resolver esto de raíz acumula la misma deuda dos veces.
- **#1 (campos de repo en `projects` vs. tabla `repositories`)**: sin evidencia nueva que cambie la
  recomendación preliminar del propio diseño (campos en `projects`) — la ausencia total de
  credenciales por usuario/repo hoy (Brecha 2) significa que no hay ninguna necesidad concreta
  todavía que justifique una tabla separada; la lista de disparadores que el propio diseño enumera
  en 7.1 ("credenciales separadas", "reutilización explícita") sigue sin cumplirse hasta que
  FEATURE-026 exista.

## Lo que no alcancé a verificar

No revisé código de tests existentes para estimar cobertura de regresión del bug de FEATURE-030
(Escenario final de validación), ni el detalle completo de `requireSession` línea por línea. Si es
relevante para cerrar el Approval Gate, puedo profundizar en una pasada adicional.
