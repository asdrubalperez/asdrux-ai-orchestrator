# FEATURE-042 — Cierre de diseño previo al Approval Gate

## A. Modelo de datos concreto

### A.1 Principios

El repositorio se persiste como configuración del proyecto mediante campos canónicos.

No se crea:

* tabla `repositories`;
* FK `project.repository_id`;
* repositorio reutilizable como entidad independiente.

GitHub continúa siendo la fuente de verdad de la identidad externa y los permisos actuales.

Cada proyecto conserva una copia estable de los campos necesarios para:

* mostrar el repositorio configurado;
* reconstruir su URL de clonado;
* detectar cambios o pérdida de acceso;
* iniciar runs sin depender del texto libre del caso.

### A.2 Migración propuesta

La migración deberá usar el siguiente número libre verificado al momento de implementación.

**Corrección tras validación técnica contra el esquema real** (`migrations/0002_users_projects_phase_a.sql:8-14`): la tabla `projects` actual es `id, name, repo_path, owner_id, created_at` — sin `updated_at`, y con `repo_path` declarada `not null`. El SQL original de esta sección omitía dos cosas que el resto del documento ya asume como resueltas:

* `updated_at` no existe hoy, pero `B.1` (`ProjectSummary.updatedAt`) y el orden de listado (`updated_at desc`) dependen de que exista.
* `repo_path` sigue siendo `not null`. Como `A.1` establece que un proyecto puede crearse sin repositorio, cualquier `insert` sin repositorio violaría esa constraint si no se toca. Como ningún camino nuevo va a escribir ni leer `repo_path` (GitHub es la fuente de verdad, sección A.1), se dropea directamente en vez de dejarla nullable y sin uso.

SQL de diseño (corregido):

```sql
alter table projects
  add column updated_at timestamptz not null default now();

alter table projects
  drop column repo_path;

alter table projects
  add column repository_provider text,
  add column repository_external_id text,
  add column repository_owner text,
  add column repository_name text,
  add column repository_full_name text,
  add column repository_clone_url text,
  add column repository_visibility text;

alter table projects
  add constraint projects_repository_provider_check
    check (
      repository_provider is null
      or repository_provider = 'github'
    );

alter table projects
  add constraint projects_repository_visibility_check
    check (
      repository_visibility is null
      or repository_visibility in ('public', 'private', 'internal')
    );

alter table projects
  add constraint projects_repository_fields_consistent_check
    check (
      (
        repository_provider is null
        and repository_external_id is null
        and repository_owner is null
        and repository_name is null
        and repository_full_name is null
        and repository_clone_url is null
        and repository_visibility is null
      )
      or
      (
        repository_provider is not null
        and repository_external_id is not null
        and repository_owner is not null
        and repository_name is not null
        and repository_full_name is not null
        and repository_clone_url is not null
        and repository_visibility is not null
      )
    );
```

`updated_at` debe actualizarse explícitamente en cada `update` de aplicación sobre `projects` (no hay trigger de `updated_at` automático en ningún otro lado del esquema actual, así que no se introduce uno nuevo solo para esta tabla — se sigue el mismo patrón manual que ya usa el resto del código, ej. `user_git_connections`).

`repo_path` se dropea, no se deprecia en el lugar — el único dato histórico que dependía de ella (`migrations/0003_users_projects_phase_b.sql`, el proyecto con `repo_path = '/home/asdru/ai-orchestrator'`) ya está cubierto por el plan de "Proyecto de Pruebas" de la sección A.7, que no reconstruye una identidad GitHub a partir de esa ruta.

Un proyecto puede crearse sin repositorio. Por eso los campos son nullable.

Cuando exista configuración de repositorio, todos los campos canónicos deberán estar completos.

### A.3 Prevención de duplicados accidentales

Un usuario puede crear varios proyectos sobre el mismo repositorio.

Por tanto, no se permite:

```sql
unique (owner_id, repository_external_id)
```

Sí se incorpora una protección contra doble creación accidental del mismo proyecto:

```sql
create unique index projects_owner_repo_name_unique
  on projects (
    owner_id,
    repository_external_id,
    lower(name)
  )
  where repository_external_id is not null;
```

Para proyectos todavía incompletos, se recomienda además:

```sql
create unique index projects_owner_name_without_repo_unique
  on projects (
    owner_id,
    lower(name)
  )
  where repository_external_id is null;
```

Esto no impide que dos proyectos tengan nombres diferentes sobre el mismo repositorio.

### A.4 Último proyecto seleccionado

Se agrega a `users`:

```sql
alter table users
  add column last_selected_project_id uuid;

alter table users
  add constraint users_last_selected_project_fk
    foreign key (last_selected_project_id)
    references projects(id)
    on delete set null;
```

El `ON DELETE SET NULL` es obligatorio para evitar referencias rotas.

### A.5 FK circular y orden de creación

La relación produce una dependencia circular lógica:

```text
projects.owner_id → users.id
users.last_selected_project_id → projects.id
```

Esto no impide el modelo, pero obliga a crear en dos pasos.

#### Alta de usuario

```text
1. Crear users con last_selected_project_id = null.
2. Crear el primer proyecto cuando el usuario lo solicite.
3. Actualizar users.last_selected_project_id con el proyecto creado.
```

#### Creación de proyecto adicional

```text
1. Crear proyecto con owner_id del usuario autenticado.
2. Si el proyecto debe quedar activo, actualizar last_selected_project_id.
```

No se intentará insertar usuario y primer proyecto en una única operación circular.

### A.6 Proyecto operativo

No se persiste un campo `status` para completo/incompleto.

Se deriva:

```text
Proyecto incompleto
→ repository_external_id is null

Proyecto configurado
→ todos los campos repository_* están presentes
```

El acceso actual no se persiste como estado definitivo porque puede cambiar en GitHub.

### A.7 Datos legacy

Se creará un proyecto explícito:

```text
Proyecto de Pruebas
```

Los runs y datos legacy aprobados por el owner se asociarán a este proyecto.

El `repo_path` histórico:

```text
/home/asdru/ai-orchestrator
```

no se convertirá automáticamente en una identidad GitHub.

La migración deberá:

1. crear `Proyecto de Pruebas`;
2. asociar los runs legacy seleccionados;
3. dejar la configuración GitHub incompleta hasta que el owner seleccione el repositorio real desde la UI;
4. conservar el valor legacy solo mientras sea necesario para compatibilidad o trazabilidad;
5. no utilizarlo como fuente de verdad para casos nuevos.

---

## B. Contrato de endpoints de proyectos

Todas las operaciones requieren sesión autenticada.

Toda operación valida:

```text
project.owner_id = authenticatedUser.id
```

### B.1 Listar proyectos

```http
GET /projects
```

Respuesta:

```typescript
interface ProjectSummary {
  id: string;
  name: string;
  repository: {
    provider: "github";
    externalId: string;
    owner: string;
    name: string;
    fullName: string;
    cloneUrl: string;
    visibility: "public" | "private" | "internal";
  } | null;
  isConfigured: boolean;
  isSelected: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ListProjectsResponse {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
}
```

Orden inicial:

```text
updated_at desc
name asc
```

No debe usarse el orden para seleccionar silenciosamente un proyecto.

### B.2 Crear proyecto

```http
POST /projects
```

Request:

```typescript
interface CreateProjectRequest {
  name: string;
  repositoryExternalId?: string;
}
```

Comportamiento:

* `name` es obligatorio;
* el repositorio es opcional;
* si se proporciona `repositoryExternalId`, debe validarse contra la respuesta vigente de FEATURE-026;
* solo se aceptan repositorios con `permissions.read = true`;
* para considerar el proyecto operativo debe tener también `permissions.push = true`;
* se copian los campos canónicos devueltos por GitHub;
* el proyecto recién creado queda seleccionado por defecto.

Respuesta:

```typescript
interface CreateProjectResponse {
  project: ProjectSummary;
}
```

Errores funcionales:

```text
invalid_project_name
duplicate_project
git_connection_required
repository_not_accessible
repository_read_only
```

### B.3 Obtener proyecto

```http
GET /projects/:projectId
```

Devuelve el detalle del proyecto propio.

No debe revelar si un `projectId` ajeno existe. Puede responder `404`.

### B.4 Actualizar nombre

```http
PATCH /projects/:projectId
```

Request inicial:

```typescript
interface UpdateProjectRequest {
  name?: string;
}
```

El repositorio no se modifica mediante este endpoint genérico.

### B.5 Configurar o cambiar repositorio

```http
PUT /projects/:projectId/repository
```

Request:

```typescript
interface SetProjectRepositoryRequest {
  repositoryExternalId: string;
}
```

Secuencia:

1. obtener listado vigente mediante FEATURE-026;
2. localizar `repositoryExternalId`;
3. validar lectura y push;
4. persistir campos canónicos;
5. devolver proyecto actualizado.

Errores:

```text
git_connection_required
git_connection_invalid
repository_not_accessible
repository_read_only
```

Cambiar repositorio no modifica silenciosamente casos existentes.

Los casos ya creados deben preservar el repositorio efectivo con el que fueron confirmados o quedar sujetos a la política de pinning definida en esta Feature.

### B.6 Seleccionar proyecto

```http
POST /projects/:projectId/select
```

Efecto:

```sql
update users
set last_selected_project_id = :projectId
where id = :authenticatedUserId;
```

La selección es una preferencia de navegación.

No reemplaza el envío explícito de `projectId` en operaciones de casos.

Respuesta:

```typescript
interface SelectProjectResponse {
  selectedProjectId: string;
}
```

### B.7 Casos del proyecto

```http
GET /projects/:projectId/cases
```

La consulta debe filtrar simultáneamente por:

```text
project_id
owner_id
```

No se reutilizará `listRunsForUser(userId)` como fuente de esta pantalla sin incorporar el filtro de proyecto.

### B.8 Crear caso dentro del proyecto

```http
POST /projects/:projectId/cases
```

El backend obtiene el repositorio desde el proyecto.

No acepta `business_case.repositorio` como dato editable o fuente de verdad.

El request mantiene, entre otros datos funcionales:

```typescript
interface CreateBusinessCaseRequest {
  name: string;
  description: string;
  ramaBaseTrabajo: string;
  releaseMode: "auto" | "manual";
}
```

El `projectId` se obtiene de la ruta y se persiste explícitamente.

No existe fallback a `getProjectForUser(userId)` sin `projectId`.

### B.9 Convivencia con el intake legacy — cerrado, versión mínima

Decisión de cierre (2026-08-02), deliberadamente acotada para no diseñar modos legacy,
versionado de contrato ni una estrategia de transición más amplia de la necesaria:

* Los casos nuevos se crean únicamente con `projectId` explícito.
* El repositorio se obtiene siempre desde `projects` — nunca desde el caso.
* `business_case.repositorio` deja de aceptarse para casos nuevos.
* `rama_base_trabajo` sigue perteneciendo al caso, sin cambios.
* El frontend nuevo deja de usar `POST /runs` como entrada de creación.
* `POST /intake/map` puede seguir estructurando el caso (mapeo de texto libre a campos), pero no
  decide proyecto ni repositorio — sigue siendo un paso de mapeo, no de persistencia.
* Los runs históricos se leen como están, sin migración masiva.
* Se elimina definitivamente el fallback al proyecto más antiguo
  (`getProjectForUser` sin `projectId`, `src/db/repository.ts:624-632`).

Con esto, la fila `repositorio` de `intake_field_definitions` deja de tener efecto para casos
nuevos sin necesidad de borrarla ni de agregar una columna de activo/inactivo — simplemente ningún
camino nuevo la lee. No hace falta decidir "retirar vs. legacy con fecha" como planteaba la versión
anterior de esta sección: alcanza con que la fuente de verdad del repositorio deje de ser el caso.

---

## C. Routing y contexto de proyecto en frontend

### C.1 Decisión

FEATURE-042 introducirá **React Router**.

No se ampliará el patrón actual basado exclusivamente en `useState`.

Razones:

* el proyecto activo debe sobrevivir recargas;
* debe permitir deep links;
* varias pestañas pueden tener proyectos diferentes;
* el selector de proyectos debe actualizar la URL;
* los callbacks OAuth necesitan regresar a una ruta concreta;
* los casos y settings requieren rutas jerárquicas.

### C.2 Rutas propuestas

```text
/login

/projects
/projects/new

/projects/:projectId
/projects/:projectId/cases
/projects/:projectId/cases/new
/projects/:projectId/cases/:caseId
/projects/:projectId/settings
/projects/:projectId/settings/repository

/account
/account/agents
/account/github
```

### C.3 Gate posterior al login

Después de resolver `/auth/me`:

```text
0 proyectos
→ /projects/new

1+ proyectos y last_selected_project_id válido
→ /projects/:lastSelectedProjectId/cases

1+ proyectos sin selección válida
→ /projects
```

No se inventa una selección basada en orden o antigüedad.

### C.4 Proyecto activo

El proyecto activo se obtiene exclusivamente desde:

```text
route param :projectId
```

`last_selected_project_id` sirve para decidir la entrada posterior al login, no como contexto oculto de cada request.

Al cambiar de proyecto:

1. se llama `POST /projects/:projectId/select`;
2. se navega a `/projects/:projectId/cases`.

### C.5 Validación de ruta

Si el proyecto:

* no existe;
* no pertenece al usuario;
* fue eliminado;
* dejó de estar disponible;

la UI redirige a:

```text
/projects
```

y limpia o actualiza la preferencia inválida.

### C.6 OAuth returnPath

Al iniciar OAuth desde un proyecto se enviará:

```text
/auth/github/start?returnPath=/projects/{projectId}/settings/repository
```

Después del callback, el frontend debe usar el `returnPath` saneado para volver al punto de origen.

La navegación nunca aceptará destinos externos.

### C.7 Migración de navegación existente

La incorporación de React Router deberá preservar:

* deep link de runs;
* vista de run en curso;
* SSE;
* consulta de casos;
* login/logout.

Las rutas actuales basadas en query parameters podrán redirigirse temporalmente hacia la nueva ruta canónica.

No se exige una reescritura general de toda la UI fuera de la navegación necesaria para FEATURE-042.

---

## D. Gate Git preventivo y autoritativo

### D.1 Objetivo

Evitar confirmar o iniciar casos cuya combinación:

```text
repositorio del proyecto + rama del caso
```

no pueda utilizarse con la conexión GitHub del owner.

### D.2 Capacidades nuevas requeridas

FEATURE-042 debe incorporar o completar servicios para:

```typescript
interface BranchValidationService {
  validateForCaseConfirmation(params: {
    userId: string;
    repositoryCloneUrl: string;
    branchName: string;
  }): Promise<BranchValidationResult>;

  validateForRunStart(params: {
    userId: string;
    repositoryCloneUrl: string;
    branchName: string;
  }): Promise<BranchValidationResult>;

  ensureBranchForRun(params: {
    userId: string;
    repositoryCloneUrl: string;
    branchName: string;
  }): Promise<EnsureBranchResult>;
}
```

No se asumirá que estas funciones ya existen en FEATURE-026.

### D.3 Resultado de validación

```typescript
type BranchValidationResult =
  | {
      status: "existing";
      branchName: string;
    }
  | {
      status: "creatable";
      branchName: string;
      sourceBranch: "main";
      warning: string;
    }
  | {
      status:
        | "git_connection_required"
        | "git_connection_invalid"
        | "repository_not_accessible"
        | "repository_read_only"
        | "main_missing"
        | "branch_invalid"
        | "temporary_failure";
      message: string;
    };
```

### D.4 Validación preventiva

Se ejecuta antes de confirmar el caso.

Secuencia:

1. obtener proyecto y verificar ownership;
2. comprobar que tiene repositorio;
3. resolver conexión GitHub;
4. revalidar que el repositorio sigue accesible;
5. comprobar que `main` existe;
6. validar sintaxis de la rama;
7. comprobar si la rama existe;
8. si existe, devolver `existing`;
9. si no existe y hay push, devolver `creatable`;
10. si no puede crearse, bloquear confirmación.

La validación preventiva no crea la rama.

### D.5 Advertencia

Cuando la rama no existe:

> La rama `{branch}` no existe. Se creará automáticamente a partir de `main` cuando inicies el caso de negocio.

El usuario debe confirmar con conocimiento de esta consecuencia.

### D.6 Validación autoritativa

Se ejecuta inmediatamente antes de iniciar el run.

Repite todas las comprobaciones porque pudieron cambiar:

* token;
* permisos;
* existencia de `main`;
* existencia de la rama;
* acceso al repositorio.

La validación autoritativa prevalece sobre el resultado guardado durante el intake.

### D.7 Creación de rama

Si la validación autoritativa devuelve `creatable`:

1. obtener referencias remotas;
2. verificar nuevamente que la rama no existe;
3. crear la referencia desde `main`;
4. publicarla usando `createGitProcessAuth(run.owner_id)`;
5. confirmar que la rama remota quedó disponible;
6. continuar con el clone/checkout del run.

No se crea desde:

* default branch inferida;
* master;
* rama configurada en proyecto;
* rama de otro caso.

El origen es siempre:

```text
main
```

### D.8 Carrera de concurrencia

Si la rama aparece entre comprobación y creación:

* no se sobrescribe;
* se actualizan referencias;
* se usa la rama existente si es accesible;
* se falla si apunta a una situación incompatible que requiera decisión humana.

### D.9 Nombre sugerido

El intake sugerirá:

```text
feature/<slug-del-caso>
```

Reglas mínimas:

* minúsculas;
* espacios convertidos a `-`;
* acentos normalizados;
* caracteres Git inválidos eliminados;
* sin `..`;
* sin inicio o final `/`;
* sin `.lock`;
* longitud acotada;
* editable por el usuario.

### D.10 Cableado efectivo OAuth

Al iniciar:

```text
run.owner_id
→ createGitProcessAuth(userId)
→ gitAuth
→ validación/creación de rama
→ cloneRunRepository
→ pushRunBranch
```

Para runs web, la ausencia de `gitAuth` es un error.

No se permite continuar por el camino legacy.

---

## E. Plan de UI

### E.1 Shell del workspace

La aplicación tendrá una estructura persistente:

```text
Header
├── Proyecto activo
├── Cambiar proyecto
├── Crear proyecto
└── Cuenta

Sidebar o navegación principal
├── Casos
├── Nuevo caso
└── Configuración del proyecto
```

No es necesario construir una consola administrativa completa.

### E.2 Pantalla “Mis proyectos”

Ruta:

```text
/projects
```

Muestra:

* nombre;
* repositorio o “Configuración pendiente”;
* cantidad resumida de casos, si está disponible sin coste excesivo;
* último uso o actualización;
* acción “Abrir”;
* acción “Crear proyecto”.

Estados:

* loading;
* lista vacía;
* error;
* proyectos disponibles.

### E.3 Crear proyecto

Ruta:

```text
/projects/new
```

Paso inicial:

```text
Nombre del proyecto
```

Después:

* conectar GitHub si no existe conexión;
* seleccionar repositorio;
* o guardar el proyecto sin repositorio y completarlo después.

Acciones:

```text
Crear proyecto
Crear y configurar repositorio
Cancelar
```

### E.4 Configuración del repositorio

Ruta:

```text
/projects/:projectId/settings/repository
```

Estados:

#### GitHub no conectado

* explicación;
* botón “Conectar GitHub”;
* OAuth con `returnPath`.

#### GitHub conectado

* login conectado;
* listado de repositorios;
* búsqueda local;
* visibilidad;
* permisos;
* repositorios sin push deshabilitados o marcados como solo lectura.

#### Repositorio configurado

* identidad actual;
* estado de acceso;
* acción “Cambiar repositorio”.

### E.5 Selector de proyecto

Disponible desde cualquier pantalla dentro de un proyecto.

Incluye:

* proyecto activo;
* otros proyectos;
* “Crear proyecto”;
* “Ver todos”.

Al seleccionar:

* persiste preferencia;
* navega al proyecto elegido;
* no conserva el caso o ruta interna de otro proyecto si no es compatible.

### E.6 Lista de casos

Ruta:

```text
/projects/:projectId/cases
```

Solo muestra casos del proyecto activo.

Incluye:

* “Nuevo caso”;
* estado;
* fecha;
* release;
* acción iniciar;
* acción visualizar.

No ofrece vista multi-proyecto en este alcance.

### E.7 Nuevo caso

Ruta:

```text
/projects/:projectId/cases/new
```

El repositorio se muestra como contexto no editable:

```text
Repositorio: owner/repository
```

Campos técnicos:

* rama de trabajo;
* sugerencia automática;
* modo Auto/Manual.

Antes de confirmar:

* ejecutar gate Git preventivo;
* mostrar advertencia si la rama será creada;
* bloquear ante falta de acceso.

### E.8 Proyecto incompleto

Si no tiene repositorio:

* se pueden consultar configuración y datos existentes;
* no se puede crear un caso;
* se muestra una llamada a la acción:

> Configura un repositorio de GitHub para crear casos de negocio en este proyecto.

### E.9 GitHub inválido

Si la conexión dejó de ser válida:

* no se elimina la configuración del proyecto;
* se bloquean nuevas operaciones;
* se muestra “Reconectar GitHub”;
* se vuelve al mismo proyecto después de OAuth.

---

## F. Criterios de validación adicionales

### Escenario 1 — FK circular

**Input:** usuario nuevo sin proyectos.
**Expected output:** usuario creado con `last_selected_project_id = null`; primer proyecto creado después; preferencia actualizada en un segundo paso.

### Escenario 2 — Eliminación del seleccionado

**Input:** se elimina el proyecto referenciado por `last_selected_project_id`.
**Expected output:** la FK aplica `ON DELETE SET NULL`.

### Escenario 3 — Mismo repositorio, proyectos distintos

**Input:** usuario crea dos proyectos con nombres diferentes sobre el mismo repo.
**Expected output:** ambos se crean.

### Escenario 4 — Doble creación accidental

**Input:** dos requests simultáneos con mismo owner, repo y nombre.
**Expected output:** solo uno se persiste; el otro devuelve conflicto controlado.

### Escenario 5 — Gate sin proyectos

**Input:** login de usuario sin proyectos.
**Expected output:** redirección a `/projects/new`.

### Escenario 6 — Proyecto activo por URL

**Input:** recarga de `/projects/{id}/cases`.
**Expected output:** se recupera el mismo proyecto sin depender de estado local.

### Escenario 7 — Proyecto ajeno en URL

**Input:** usuario manipula `projectId`.
**Expected output:** no obtiene información; redirección a `/projects`.

### Escenario 8 — OAuth returnPath

**Input:** conexión iniciada desde settings del proyecto.
**Expected output:** después del callback vuelve al mismo proyecto.

### Escenario 9 — Repositorio no accesible

**Input:** repo dejó de aparecer en la lista de FEATURE-026.
**Expected output:** no puede asociarse o usarse.

### Escenario 10 — Rama existente

**Input:** rama válida existente.
**Expected output:** confirmación permitida sin advertencia de creación.

### Escenario 11 — Rama inexistente

**Input:** rama válida, `main` existente y push permitido.
**Expected output:** confirmación permitida con advertencia; creación al iniciar.

### Escenario 12 — `main` inexistente

**Input:** rama no existe y repo no contiene `main`.
**Expected output:** confirmación o inicio bloqueados.

### Escenario 13 — Permisos cambiaron

**Input:** usuario podía escribir al confirmar, pero no al iniciar.
**Expected output:** gate autoritativo bloquea el run.

### Escenario 14 — OAuth real en clone

**Input:** run web de usuario conectado.
**Expected output:** `createGitProcessAuth(run.owner_id)` es invocado y `cloneRunRepository` recibe `gitAuth`.

**Ya satisfecho** por el cableado implementado en `intakeService.ts` (rama
`feature/042-cableado-github-auth-runs`, mergeada a `main`) — no es pendiente de esta ronda de
diseño, es una verificación de algo que ya existe en código.

### Escenario 15 — OAuth real en push

**Input:** run que finaliza con push.
**Expected output:** `pushRunBranch` recibe la misma identidad del owner.

### Escenario 16 — Sin fallback legacy

**Input:** run web sin conexión GitHub válida mientras la VPS conserva clave SSH funcional.
**Expected output:** el run falla; no clona ni pushea usando la clave del host.

**Ya satisfecho**, mismo motivo que el Escenario 14 — `startPendingRun` corta con
`git_connection_required` antes de intentar clonar, sin fallback.

---

## G. Estado para Approval Gate

Con estas decisiones quedan cerrados:

* modelo SQL (corregido tras validación técnica — ver A.2: `updated_at` agregada, `repo_path`
  dropeada);
* nombres de columnas;
* FK circular;
* endpoints, incluida la convivencia con el intake legacy (B.9: `business_case.repositorio` deja
  de aceptarse para casos nuevos, el repositorio se obtiene siempre desde `projects`, sin
  necesidad de retirar ni versionar `POST /runs`/`POST /intake/map` como rutas);
* routing;
* gate Git preventivo;
* gate Git autoritativo;
* creación desde `main`;
* componentes y pantallas mínimas;
* integración real con FEATURE-026;
* validación de retiro del mecanismo legacy para runs web.

No se reabren:

* absorción de FEATURE-030;
* inexistencia de entidad `Repository`;
* OAuth por usuario;
* campos canónicos en `projects`;
* responsabilidad de la rama en el caso;
* necesidad de `projectId` explícito;
* contrato ya implementado de FEATURE-026;
* convivencia con el intake legacy (B.9).

**Estado propuesto:** diseño completo, listo para Approval Gate.

La implementación continúa prohibida hasta aprobación explícita del owner.
