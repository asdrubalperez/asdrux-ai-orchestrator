# Propuesta de alcance revisado — FEATURE-042 absorbe FEATURE-030

**Estado:** FEATURE-026 ya está implementada y mergeada a `main` (`cfd89c8`). Esta pausa queda
levantada — los campos que dependían de su modelo de datos están completados en la sección 5 y en
la nueva sección 11 con el contrato real (no preliminar) disponible para consumir. Ver
`docs/research/HANDOFF-continuidad-F26-implementada-para-F42.md` para el resumen dirigido a ARIA,
incluyendo qué parte del diseño aprobado de FEATURE-026 quedó fuera de este incremento y por qué
importa para el diseño de FEATURE-042.

**Actualización — el cableado de la sección 11.2 ya está implementado**, por decisión explícita del
owner de adelantar esa pieza acotada mientras el resto de FEATURE-042 (proyecto, gate, UI) se
termina de diseñar con ARIA. Rama `feature/042-cableado-github-auth-runs`, sin mergear a `main`
todavía. Detalle completo en la sección 12 (nueva). El resto de esta propuesta (secciones 1-11)
sigue siendo el insumo de diseño para ARIA, sin cambios de fondo — lo único que dejó de ser "plan"
para pasar a ser "código real" es específicamente el cableado de `gitAuth` en los tres call-sites
identificados en 11.2.

## 1. Origen y disparador

Esta propuesta responde a una corrección de flujo hecha por el owner sobre el análisis previo
(`docs/research/...` handoff a DAIA sobre FEATURE-030 vs FEATURE-042, mismo ciclo de sesión): el
Orquestador debe exigir que el usuario **seleccione o cree explícitamente un proyecto al entrar**,
antes de habilitar la carga de casos de negocio nuevos o ver los existentes. Ese gate de entrada
no estaba en el análisis original, y cambia la conclusión sobre el orden de implementación entre
FEATURE-030 y FEATURE-042.

No se ha tocado `docs/ROADMAP.md` ni se ha implementado código de FEATURE-042. FEATURE-026 sí está
implementada y mergeada; este documento usa ese piso real como insumo de diseño, sujeto a
aprobación del owner.

## 2. Conclusión

**FEATURE-030 queda desestimada como feature independiente.** Su razón de ser — evitar que el
Orquestador reutilice silenciosamente "el proyecto más antiguo del usuario" cuando no hay
`projectId` explícito — desaparece como problema autónomo en cuanto existe un gate de entrada que
exige selección explícita: ya no hay ningún punto del flujo donde el sistema tenga que *adivinar*
un proyecto, porque el usuario lo eligió antes de llegar al intake.

**FEATURE-042 absorbe el alcance técnico útil de FEATURE-030**: separar la identidad funcional del
`Project` de la identidad canónica del repositorio GitHub utilizado por ese proyecto. Esa
separación se implementa mediante campos canónicos dentro de `projects`, no mediante una entidad
`Repository` persistida, porque FEATURE-026 ya consulta GitHub como fuente de verdad y expone la
identidad del repositorio bajo demanda.

## 3. Por qué no es simplemente "invertir el orden"

El análisis original (030 antes de 042) asumía que FEATURE-030 resuelve el proyecto
**automáticamente y en silencio**, en el momento del intake, sin involucrar al usuario. Bajo esa
premisa, 030 podía crear un `Project` sin pedir confirmación cuando detectaba un repositorio nuevo.

Si 042 introduce un gate de selección explícita *después* de que 030 ya esté creando proyectos
automáticamente, el resultado es contradictorio, no solo redundante: aparecerían en "Mis
proyectos" entradas que el usuario nunca decidió crear, producto de corridas previas. El propio
propósito del gate — que la creación de proyecto sea un acto intencional — quedaría roto desde el
primer día de 042.

Por eso no alcanza con reordenar las mismas dos features: la versión de FEATURE-030 que tenía
valor (auto-creación silenciosa) es exactamente la que FEATURE-042 tiene que impedir para cumplir
su propio objetivo. No hay una FEATURE-030 mínima que sobreviva intacta.

## 4. Qué sobrevive de FEATURE-030, y dónde vive ahora

Lo que sobrevive de FEATURE-030 es la necesidad de distinguir dos identidades hoy mezcladas:

- la identidad funcional del proyecto (`projects.id`, `name`, `owner_id`);
- la identidad canónica del repositorio GitHub que ese proyecto utiliza.

Actualmente `projects` (`migrations/0002_users_projects_phase_a.sql:8-14`) mezcla identidad de
proyecto con una conexión Git basada en `repo_path`, texto libre y sin normalización de dominio.
Además, `normalizeGitCloneUrl` (`src/isolation/worktree.ts:402-410`) solo normaliza un formato para
clonar; no define una identidad persistente del repositorio.

FEATURE-026 resolvió cómo obtener la identidad real desde GitHub: `GET
/auth/github/repositories` devuelve `externalId`, `owner`, `name`, `fullName`, `cloneUrl`,
`visibility` y permisos. Por eso FEATURE-042 no debe crear una tabla `repositories` ni una FK
`Project.repository_id`.

La solución vigente es guardar en `projects` los campos canónicos necesarios para identificar y
reconstruir el repositorio seleccionado, mientras GitHub continúa siendo la fuente de verdad.

## 5. Alcance revisado de FEATURE-042

**Flujo de producto (nuevo, reemplaza al intake actual sin gate):**

1. Usuario inicia sesión.
2. Antes de habilitar carga de casos de negocio nuevos, el sistema exige seleccionar un proyecto
   existente o crear uno nuevo. Sin proyecto seleccionado, no hay acceso a intake ni a la lista de
   casos.
3. "Mis proyectos" lista los proyectos del `owner_id` actual.
4. Crear un proyecto nuevo pide nombre y repositorio. El repositorio se selecciona desde la lista
   vigente de repositorios accesibles devuelta por `GET /auth/github/repositories`.
5. Antes de persistirlo, FEATURE-042 verifica que el repositorio continúa presente en esa respuesta
   y que `permissions.read` y `permissions.push` son suficientes. Luego guarda directamente en
   `projects` su identidad canónica y URL de clonado; no crea ni reutiliza una fila `Repository`.
6. El `project_id` seleccionado en este paso es el que se persiste en `runs.project_id` al crear
   un caso — nunca resuelto automáticamente por `getProjectForUser` sin `projectId` explícito.
7. **Cableado real con FEATURE-026, explícitamente dentro del alcance de esta Feature (no un
   follow-up aparte)**: en el punto donde `runStart.ts` arranca un run, resolver
   `run.owner_id -> createGitProcessAuth(userId)` (`src/auth/gitConnectionService.ts`) y pasar ese
   `gitAuth` a `cloneRunRepository`/`pushRunBranch` (`src/isolation/worktree.ts`), en vez de
   dejarlos correr sin él. Ver sección 11.2 para el detalle técnico completo de por qué este paso
   es indispensable, no cosmético.

**Modelo de datos (actualizado con el contrato real de FEATURE-026 — ya no preliminar):**

FEATURE-026, implementada, **no crea ninguna entidad `Repository` persistida** — decisión de
alcance real, no un detalle pendiente. La identidad de repositorio vive en GitHub y se consulta
bajo demanda vía `GET /auth/github/repositories` (`src/auth/githubOAuthClient.ts`,
`listAccessibleRepositories`), que devuelve para cada repo accesible del usuario:

```typescript
interface GitHubRepository {
  externalId: string;
  owner: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  visibility: "public" | "private" | "internal";
  permissions: { read: boolean; push: boolean; admin: boolean };
}
```

Esto resuelve la pregunta abierta de la sección 7.1 del diseño de ARIA (¿tabla `repositories`
separada o campos en `projects`?) a favor de **campos en `projects`**: no hay ninguna entidad
`Repository` de la que colgar una FK, porque GitHub ya es la fuente de verdad y F026 la expone
lista para usar. Modelo de datos recomendado para FEATURE-042:

```text
User.id
Project.id, owner_user_id → User.id, name,
  repository_external_id, repository_owner, repository_name, repository_full_name,
  repository_clone_url, repository_visibility
```

(Nombres de columna ilustrativos — mismo patrón que el propio diseño de ARIA ya proponía en su
sección 7.1 como alternativa mínima, ahora confirmado en vez de tentativo.)

- Sin restricción `UNIQUE(owner_user_id, repository_external_id)` a nivel de dominio — bajo este
  flujo, el usuario puede crear explícitamente varios proyectos sobre el mismo repositorio desde
  el principio (ej. "Plataforma principal" y "Portal administrativo" del mismo repo), que era
  precisamente el caso futuro que la política provisional de 030 iba a tener que revertir más
  adelante. Al construir el modelo final directamente, se evita esa migración descartable.
- Sí conviene un índice único a nivel técnico sobre `(owner_user_id, repository_external_id, name)`
  para evitar duplicados accidentales por doble clic o carrera de UI — no como regla de negocio,
  solo como red de seguridad de concurrencia.
- Al seleccionar un repositorio en el paso 4, FEATURE-042 debe validar que continúa apareciendo en
  la respuesta vigente de `GET /auth/github/repositories` y que tiene permisos de lectura y push
  antes de persistirlo. Los campos guardados en `projects` son un snapshot de identidad y conexión
  necesario para ejecutar el proyecto; la vigencia de acceso debe revalidarse en los momentos
  críticos del flujo.

**`getProjectForUser` y `runStart.ts`:**

- El fallback "proyecto más antiguo del usuario" (`src/db/repository.ts:624-632`,
  `order by created_at asc, name asc limit 1`) se elimina. Sin `projectId` explícito, la
  operación debe fallar — el frontend nunca debería poder llegar a ese punto sin haber pasado por
  el gate, así que un `projectId` ausente en el backend es un error de programación del cliente,
  no un caso a resolver con una heurística.
- `business_case.repositorio` deja de ser fuente de verdad para casos nuevos. El repositorio se
  obtiene exclusivamente desde los campos canónicos del proyecto activo. `rama_base_trabajo`
  permanece como configuración del caso de negocio. La eliminación o compatibilidad legacy del
  campo `business_case.repositorio` cruza con FEATURE-043, pero la regla funcional de FEATURE-042
  queda cerrada: el intake nuevo no debe pedir repositorio.

## 6. Migración de datos existentes

- Antes de activar el nuevo flujo se creará un proyecto explícito llamado **“Proyecto de
  Pruebas”** y los datos legacy que deban conservarse se asociarán a él.
- El `repo_path = '/home/asdru/ai-orchestrator'` existente es una ruta local, no una identidad
  GitHub. No se intentará inferir automáticamente un `repository_external_id` a partir de esa
  ruta.
- La configuración GitHub del “Proyecto de Pruebas” se completará de forma explícita usando un
  repositorio seleccionado desde `GET /auth/github/repositories`.
- Los proyectos legacy sin repositorio canónico podrán existir como configuración incompleta, pero
  no podrán crear ni iniciar casos hasta completar sus campos de repositorio.
- No se crearán filas `Repository`, tipos especiales `local` ni relaciones `repository_id` durante
  la migración.

## 7. Qué queda fuera de este documento

- Diseño visual detallado del gate de entrada, selector y pantalla “Mis proyectos”.
- Reportes transversales entre proyectos.
- Equipos, organizaciones o proyectos compartidos.
- Cambio de cuenta GitHub con análisis de impacto sobre proyectos existentes; el backend actual de
  FEATURE-026 todavía no lo implementa.
- Cualquier proveedor Git distinto de GitHub.

Quedan **dentro** de FEATURE-042, aunque todavía sean trabajo net-new:

- eliminar el repositorio del intake y resolverlo desde el proyecto activo;
- validar acceso y permisos en los momentos preventivo y autoritativo;
- comprobar si la rama existe;
- crearla desde `main` cuando no exista y el usuario pueda publicarla;
- integrar `returnPath` en el frontend;
- cablear `createGitProcessAuth` en el inicio y cierre real de los runs.

## 8. Actualización tras diseño de ARIA y validación técnica (misma sesión)

ARIA tomó esta propuesta y produjo un diseño completo de FEATURE-042 ("Creación, selección y
configuración de proyectos", 13 secciones, absorción explícita de FEATURE-030 confirmada). Se
validó ese diseño contra el código real — reporte completo en
`docs/research/FEATURE-042-validacion-tecnica-diseno-ARIA.md`. Resumen de lo que cambia respecto a
esta propuesta original:

- **Gate de entrada explícito**: el diseño de ARIA agrega el requisito de que el usuario deba
  seleccionar o crear un proyecto al entrar, antes de habilitar intake o lista de casos. Esto no
  estaba en la propuesta original (sección 5 de este documento) y es la pieza que efectivamente
  termina de eliminar cualquier necesidad de resolución automática — confirma y refuerza la
  desestimación de FEATURE-030 de la sección 2.
- **Confirmado sin matices contra el código real**: no hay routing formal en `web/` (peor de lo
  asumido — el query param de run actual ni siquiera es reactivo, ver validación técnica sección
  1); `listRunsForUser` no filtra por proyecto hoy; la herencia de `project_id` en child
  runs/reentrada es directa desde el run padre, sin excepciones.
- **Brecha encontrada, no prevista en la propuesta original**: `users.last_selected_project_id`
  (mecanismo propuesto para recordar el último proyecto) introduce una FK circular que no existe
  hoy en el esquema (`users` es hoy tabla hoja). Requiere `ON DELETE SET NULL` explícito y un
  orden de inserción en dos pasos al crear usuario+proyecto juntos.
- **Menos infraestructura de validación de ramas de la asumida**: no existe hoy ninguna función
  reutilizable de "¿existe esta rama?" desacoplada del clonado, ni detección de default branch
  (tampoco hace falta construirla, porque el diseño fija `main` como origen siempre). La creación
  de rama desde `main` con advertencia previa es trabajo net-new, no una extensión de
  `cloneRunRepository`.

## 9. Dependencia con FEATURE-026 — resuelta

Esto era lo pendiente antes de reabrir el diseño de FEATURE-042; se conserva como registro de la
decisión, ya no como bloqueo:

- **No era un riesgo suave, era un bloqueo funcional puntual**: hasta la implementación de
  FEATURE-026 no existía ningún concepto de identidad Git por usuario — una única clave SSH del
  host servía para todos. Eso hacía que verificar "el usuario tiene permiso de crear la rama"
  fuera literalmente inimplementable. **Esto sigue sin resolverse del todo** — ver sección 11,
  FEATURE-026 no implementó la validación/creación de ramas, solo la identidad y el transporte
  autenticado.
- **Simplificación descartada por decisión del owner**: se evaluó una simplificación temporal
  (mientras haya un solo usuario real, asumir que las ramas base siempre existen de antemano) — el
  owner la rechazó explícitamente para no construir sobre un supuesto descartable. Sigue
  descartada.
- **Decisión de esquema, resuelta**: ver sección 5 actualizada — FEATURE-026 no crea una entidad
  `Repository` persistida, así que la alternativa "campos en `projects`" queda confirmada, no solo
  recomendada.
- **Precedente reutilizado**: FEATURE-026 sí terminó necesitando ir más allá del patrón de
  FEATURE-016 (`authMode`) — ese patrón solo persistía una preferencia de modo, nunca credenciales
  reales. FEATURE-026 introdujo el primer mecanismo de cifrado reversible del proyecto
  (`src/auth/gitCredentialEncryption.ts`, AES-256-GCM) porque el precedente de FEATURE-016 no
  alcanzaba.

## 10. Impacto en el Roadmap (pendiente de aprobación, no aplicado)

Si se aprueba esta propuesta, los cambios a `docs/ROADMAP.md` serían:

- Retirar FEATURE-030 de la matriz de priorización y de la lista de 🟡 Confirmado, con una nota
  explicando que su alcance fue absorbido por FEATURE-042 (no eliminar el historial, dejar
  trazabilidad de la decisión y la fecha).
- Ampliar la entrada de FEATURE-042 con el alcance de esta sección 5, y promoverla de "prioridad
  por definir" a una prioridad concreta, ya que ahora resuelve tanto el bug operativo activo como
  la capacidad de producto nueva.

No se aplica ningún cambio hasta que el owner lo confirme.


## 10.1 Criterios de cierre incorporados a FEATURE-042

FEATURE-042 no se considera completa hasta validar, como mínimo:

1. Un usuario no puede crear ni consultar casos sin un proyecto activo explícito.
2. Crear un caso sin `projectId` falla; no se selecciona el proyecto más antiguo.
3. El intake nuevo no pide repositorio y lo obtiene desde el proyecto activo.
4. La lista de casos queda filtrada por `owner_id + project_id`.
5. Un proyecto sin repositorio canónico o sin acceso GitHub suficiente bloquea casos nuevos.
6. La rama del caso se valida preventivamente y nuevamente antes de iniciar.
7. Si la rama no existe y el usuario puede publicar, se advierte y se crea desde `main`.
8. Un run web con conexión GitHub activa recibe `gitAuth` y clona/pushea con la credencial de su
   owner.
9. Un run web sin conexión válida falla con un estado distinguible y accionable (mismo criterio
   que `repo_clone_failed`) — nunca un error 500 genérico — incluso si la VPS conserva una clave
   SSH legacy funcional.
10. `gitAuth.dispose()` se ejecuta tanto en éxito como en error.

## 11. Contrato real de FEATURE-026 disponible para FEATURE-042 (mergeado a `main`, `cfd89c8`)

### 11.1 Endpoints HTTP

Todos requieren sesión (`requireSession`), salvo el redirect a GitHub que la conserva vía cookie.

```text
GET  /auth/github/start?returnPath=<ruta interna>   -> redirect 302 a GitHub
GET  /auth/github/callback?code=&state=             -> 200 { connection: GitConnectionSummary }
GET  /auth/github/status                            -> 200 { connection: GitConnectionSummary }
POST /auth/github/disconnect                        -> 200 { ok: true }
GET  /auth/github/repositories                      -> 200 { repositories: GitHubRepository[] }
                                                        409 { error: "git_connection_required" }
```

```typescript
type GitConnectionSummaryStatus = "not_connected" | "connected" | "invalid" | "revoked";
interface GitConnectionSummary {
  status: GitConnectionSummaryStatus;
  externalLogin: string | null;
  scopes: string[];
  connectedAt: string | null;
}
```

`returnPath` (sección 5 del flujo de ARIA, "el usuario vuelve al proyecto que estaba
configurando") ya está resuelto por FEATURE-026 a nivel de persistencia (`oauth_states.return_path`,
saneado contra open-redirect en `sanitizeReturnPath`) — falta que FEATURE-042 lo lea y redirija tras
el callback; hoy el callback solo devuelve el JSON de la conexión, no hace la redirección final.

### 11.2 Contexto de credenciales para clonar/pushear (Regla 8 y sección 7.9 del diseño de ARIA)

```typescript
// src/auth/gitConnectionService.ts
async function createGitProcessAuth(userId: string): Promise<GitProcessAuth>;
// GitProcessAuth: { authEnv: NodeJS.ProcessEnv; cloneUrl(repoUrl): string; dispose(): Promise<void> }
```

```typescript
// src/isolation/worktree.ts -- firmas ya actualizadas, gitAuth es opcional (compatibilidad
// retroactiva: sin él, comportamiento legacy idéntico al de antes de FEATURE-026).
cloneRunRepository({ runId, repoUrl, baseRef, gitAuth? }): Promise<RunWorktree>;
pushRunBranch(worktree, gitAuth?): Promise<void>;
```

Esto es exactamente lo que la sección 11 del diseño de ARIA de FEATURE-026 pedía como contrato
(`Run Service -> run.owner_id -> UserGitConnectionService -> GitProcessAuth -> Worktree`), ya
implementado como primitiva reutilizable.

**Cerrar la integración real es alcance obligatorio de FEATURE-042, no un follow-up posterior.**
Hoy `gitAuth` es opcional en `cloneRunRepository`/`pushRunBranch` deliberadamente — al implementar
FEATURE-026 no existía todavía de dónde resolver el repositorio del proyecto (esa resolución es
precisamente lo que construye FEATURE-042), así que sin ese parámetro ambas funciones siguen
usando la clave SSH legacy del host, exactamente el comportamiento de antes de FEATURE-026.

Sin este cableado, la Feature queda incompleta de una forma que no se nota a simple vista: la UI de
"Conectar GitHub" funcionaría de punta a punta (login, callback, estado "conectado", listado de
repos), pero **sin ningún efecto real sobre los runs** — seguirían clonando y pusheando con la
clave SSH del host, igual que hoy, porque nadie invoca `createGitProcessAuth`. Es lo que
efectivamente jubila el mecanismo de clave SSH compartida — la UI de conexión sola no lo hace. Por
eso este paso pertenece al Scope §4.1 de esta Feature, con sus propios Escenarios de Validation
Criteria.

**Corrección tras validación técnica post-mergeo de FEATURE-026** (ver
`docs/features/FEATURE-042-validacion-tecnica-diseno-ARIA.md`, addendum): el texto anterior de esta
sección decía "en el punto donde `runStart.ts` arranca un run" — es incorrecto. Los call-sites
reales son tres, en dos archivos distintos, con complejidad desigual:

1. **Clon — `src/cli/intakeService.ts:156`, dentro de `startPendingRun({ runId, userId })`.**
   Único call-site de `cloneRunRepository` en todo el repo (`runStart.ts` no lo llama nunca).
   `userId` ya está disponible como parámetro de la función. Ya existe manejo de error
   (`try/catch RunRepoCloneError`, líneas 157-162) al que hay que sumar el caso de conexión
   GitHub ausente/inválida (ver punto 3).
2. **Push — `runStart.ts:1160`, dentro de `continueReleaseAfterFeatureApproved`.** `userId` ya
   está en la firma de la función. Cableado directo.
3. **Push — `runStart.ts:1885`, dentro de `finishRun(repoRoot, runId, worktree, finalResult,
   opts)`.** Esta función **no recibe `userId`** hoy. El dato existe una función más arriba
   (`executePipelineRun`), pero hace falta agregar el parámetro a la firma de `finishRun` y
   propagarlo en sus **7 call-sites** (`runStart.ts:477, 545, 550, 585, 589, 621, 637`). Es
   trabajo de plomería real, no un cableado trivial.

Los child runs (reingreso/escalamiento) no vuelven a clonar — usan `createRunWorktree` sobre el
repo ya clonado del run padre — pero sí terminan pasando por los puntos 2 y 3 al invocar
`executePipelineRun` recursivamente, con `userId` ya threadeado correctamente. No hace falta
cableado adicional específico para child runs una vez resuelto el punto 3.

**Manejo de errores de conexión GitHub — net-new, no reutilizable.**
`createGitProcessAuth(userId)` lanza `GitConnectionRequiredError`/`GitConnectionInvalidError`
*antes* de tocar git. Hoy no existe ningún manejo de esos errores en el flujo de arranque/push de
runs — sin agregarlo explícitamente, caerían en el catch-all genérico (`next(err)` → 500) en vez
de traducirse a un estado distinguible como ya pasa con `RunRepoCloneError` → `repo_clone_failed`
(422, ver `POST /runs/:id/start`). El precedente correcto ya existe en el propio código
(`src/server/app.ts:200`, endpoint `/auth/github/repositories`, responde 409
`git_connection_required`) — hay que llevar ese mismo criterio al flujo de runs, no inventarlo,
pero sí escribirlo. El criterio de cierre 9 de la sección 10.1 debe exigir explícitamente un estado
distinguible ante conexión ausente/inválida, no solo "que falle".

### 11.3 Qué NO quedó implementado del diseño aprobado de FEATURE-026 (importante para el diseño de FEATURE-042)

FEATURE-026 se implementó como incremento parcial, deliberado y ya comunicado en su momento. Esto
es lo que el diseño aprobado (v3) especifica pero **no existe en el código todavía**:

- **`validateRepositoryAccess` / capacidades por repositorio** (sección 7.7 del diseño de
  FEATURE-026, `RepositoryAccessResult`): no existe como función ni endpoint separado. La única
  fuente de permisos hoy es el campo `permissions: { read, push, admin }` que ya viene embebido en
  cada `GitHubRepository` de `GET /auth/github/repositories` — alcanza para que FEATURE-042 decida
  si un repo es utilizable sin necesitar una llamada adicional, pero no hay validación en el
  momento de confirmar/iniciar un caso (Gate Git preventivo/autoritativo, Reglas 18-19 de
  FEATURE-026).
- **Validación y creación de ramas** (Reglas 12/18-20 del diseño de FEATURE-026, sección 6.3
  "Rama inexistente"): completamente sin implementar. No hay función que verifique si una rama
  existe de forma desacoplada del clonado, ni lógica de "crear desde `main` con advertencia previa".
  **FEATURE-042 no debe asumir que el Gate Git preventivo/autoritativo de su propio diseño (Reglas
  18-19, mensajes de la sección 7.13) ya tiene soporte de backend** — es trabajo pendiente, no
  cubierto por este incremento de FEATURE-026.
- **Cambio de cuenta GitHub** (Reglas 27-30 del diseño de FEATURE-026): no implementado. Hoy
  `completeGitHubOAuth` siempre reemplaza la conexión existente del usuario sin ningún análisis de
  impacto sobre proyectos ya asociados a repositorios de la cuenta anterior — no hay endpoint
  `/auth/github/change` diferenciado de una reconexión simple.
- **UI**: no existe ningún componente de React para "Conectar GitHub" — solo el backend. La
  navegación a `/auth/github/start` hoy tiene que hacerse manualmente (pegar la URL en el browser).

Estos huecos no invalidan el diseño, pero tampoco pueden quedar como capacidades supuestamente
resueltas ni como follow-ups indefinidos. Para cerrar el alcance funcional de FEATURE-042 deben
implementarse dentro del mismo incremento o mediante trabajo explícitamente coordinado y entregado
antes de su Approval Gate técnico. En particular, la validación preventiva/autoritativa de acceso,
la comprobación de ramas y la creación desde `main` son requisitos del flujo de proyecto/caso que
FEATURE-042 introduce.

## 12. Cableado implementado (rama `feature/042-cableado-github-auth-runs`, sin mergear)

Alcance deliberadamente acotado a los tres call-sites identificados en la corrección de la sección
11.2 — no incluye proyecto, gate ni UI, que siguen pendientes de diseño con ARIA.

### 12.1 Qué se implementó

- **`src/cli/intakeService.ts`, `startPendingRun`**: antes de `cloneRunRepository`, resuelve
  `createGitProcessAuth(params.userId)`. Si el usuario no tiene conexión GitHub válida
  (`GitConnectionRequiredError`/`GitConnectionInvalidError`), corta técnicamente con un nuevo
  resultado `{ kind: "git_connection_required", message }` — mismo patrón que el `repo_clone_failed`
  ya existente (`finalizeRun` a `failed` + `recordRunEvent`), nunca un 500 genérico. Si hay
  conexión válida, `gitAuth` se pasa a `cloneRunRepository` y se descarta con `gitAuth.dispose()`
  en un `finally`, se haya podido clonar o no.
- **`src/cli/commands/runStart.ts`, `continueReleaseAfterFeatureApproved`**: antes del
  `pushRunBranch` condicional (solo cuando `remoteSha !== commitSha`), resuelve
  `createGitProcessAuth(userId)` y lo pasa al push, con `dispose()` en `finally`. Sin manejo
  especial de `GitConnectionRequiredError`/`GitConnectionInvalidError` acá — se propagan como
  cualquier otro error de este punto medio del pipeline (mismo criterio que ya regía para
  cualquier fallo de `pushRunBranch` antes de este cambio; no se inventó un estado distinguible
  nuevo a mitad de pipeline, eso queda fuera de este alcance acotado).
- **`src/cli/commands/runStart.ts`, `finishRun`**: se agregó `userId: string` como último
  parámetro de la función y se propagó en sus 7 call-sites (todos dentro de `executePipelineRun`,
  donde `userId` ya estaba en scope). Dentro de `finishRun`, el mismo patrón de
  `createGitProcessAuth` + `dispose()` en `finally` alrededor de su `pushRunBranch` interno. Nota:
  hoy los 7 call-sites pasan siempre `pushAndClean: false`, así que esta rama es código inerte en
  la práctica actual — se cableó igual porque es parte explícita del contrato identificado en la
  validación técnica, no una invención.
- **`src/server/app.ts`**: `POST /runs/:id/start` traduce `git_connection_required` a `409
  { error: "git_connection_required", message }` — mismo status code que ya usa
  `GET /auth/github/repositories` para este mismo tipo de error.

### 12.2 Qué NO se implementó (deliberado)

- **Cobertura de test automatizada para el camino nuevo.** `intakeService.ts` no tenía archivo de
  test antes de este cambio. Se intentó agregar uno con `node:test` `mock.module`, pero
  `intakeService.ts` importa estáticamente `runStart.ts` (para `executePipelineRun`), que a su vez
  importa decenas de funciones de `repository.ts` — mockear el módulo completo de forma sostenible
  requeriría mockear ese universo entero, no solo lo que usa `startPendingRun`, lo cual es frágil
  (se rompe con cualquier cambio en los imports de `runStart.ts`) y no representa cobertura real.
  Una alternativa legítima —convertir el import de `executePipelineRun` en dinámico para des
  acoplar la carga eager— quedó identificada pero fuera de este alcance acotado (es un cambio de
  arquitectura de testing, no parte del cableado pedido). El código nuevo está verificado por
  `tsc --noEmit` + lectura + los 255 tests existentes (que no ejercitan estos call-sites, así que
  tampoco los rompieron), pero no por un test dedicado. Validación real pendiente: E2E en VPS.
- **Ningún estado distinguible nuevo para fallas de conexión a mitad de pipeline** (push en
  `continueReleaseAfterFeatureApproved`/`finishRun`) — solo se agregó en el punto de arranque
  (`startPendingRun`), que es donde ya existía el precedente (`repo_clone_failed`). Diseñar cómo
  debería comportarse un fallo de credencial a mitad de pipeline (¿escalamiento? ¿reintentable?)
  es una decisión de producto que corresponde al diseño completo de FEATURE-042 con ARIA, no a
  este cableado acotado.
- Todo lo demás del alcance de FEATURE-042 (proyecto, gate de entrada, UI, validación/creación de
  ramas, listado/selección de repositorio) — sin tocar, como se acordó.
