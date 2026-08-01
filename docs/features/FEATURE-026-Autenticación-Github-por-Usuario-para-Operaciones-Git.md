# FEATURE-026 — Autenticación GitHub por usuario para operaciones Git

Versión de plantilla utilizada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

---

# 1. Feature Identity

* **Name:** Autenticación GitHub por usuario para operaciones Git
* **Type:** Backend + Seguridad + Integración GitHub + Persistencia + UI de configuración
* **Owner:** Asdru
* **Status:** Diseño completo — pendiente de aprobación
* **Priority:** P1
* **Playbook Mode:** Standard

## Features relacionadas

* **FEATURE-016:** configuración de proveedor y modo de autenticación de los agentes IA.
* **FEATURE-041:** creación y gestión de usuarios del Orquestador.
* **FEATURE-042:** creación, selección y configuración de proyectos.
* **FEATURE-043:** evolución del intake y separación entre datos funcionales y configuración técnica.
* **FEATURE-030:** absorbida por FEATURE-042.

## Dependencia principal

FEATURE-026 debe diseñarse antes de cerrar FEATURE-042 porque esta última necesita determinar si el usuario autenticado:

* puede acceder al repositorio de un proyecto;
* puede leer sus ramas;
* puede crear una rama;
* puede publicar cambios.

FEATURE-042 permanece en pausa hasta que FEATURE-026 tenga definido, como mínimo, su modelo de datos y contrato interno de autenticación Git.

---

# 2. Problem Statement

Actualmente las operaciones Git remotas del Orquestador utilizan una única identidad configurada en la VPS.

No existe una relación efectiva entre:

* el usuario que inicia sesión en el Orquestador;
* su identidad en GitHub;
* los repositorios a los que ese usuario tiene acceso;
* sus permisos reales sobre cada repositorio;
* los runs y proyectos que le pertenecen.

Las operaciones actuales de clonado y push heredan la configuración Git o las credenciales globales del servidor. Como consecuencia:

1. Todos los usuarios operan potencialmente con la misma identidad Git.
2. El sistema no puede comprobar si el owner de un run tiene acceso real al repositorio.
3. No puede distinguir entre acceso de lectura y escritura por usuario.
4. No puede determinar si el usuario puede publicar una rama nueva.
5. Un usuario podría provocar una operación ejecutada con permisos superiores a los que él posee.
6. La incorporación de un segundo usuario real obligaría a rediseñar el flujo ya implementado.
7. FEATURE-042 no puede aplicar correctamente sus reglas de validación y creación de ramas.

FEATURE-016 no resuelve este problema. Esa Feature persiste qué proveedor de IA y qué modo de autenticación utilizar, pero las credenciales reales continúan siendo recursos compartidos del servidor. FEATURE-026 debe introducir una autorización GitHub real, independiente y asociada a cada usuario.

## Necesidad del producto

Un usuario autenticado en el Orquestador debe poder autorizar al sistema para leer y escribir en los repositorios GitHub sobre los que ya posee permisos, con la menor fricción razonable.

La solución debe priorizar:

* la necesidad del usuario;
* la simplicidad del flujo;
* la identidad real del owner del run;
* la seguridad de la credencial;
* la ausencia de fallbacks silenciosos.

No debe introducir instalación de aplicaciones por repositorio ni gobernanza adicional de terceros salvo cuando una organización propietaria del repositorio imponga sus propias restricciones.

---

# 3. Functional Goal

Después de implementar FEATURE-026:

1. Cada usuario autenticado podrá conectar una cuenta GitHub.
2. La conexión se realizará mediante una GitHub OAuth App.
3. El usuario autorizará al Orquestador para leer y escribir en los repositorios sobre los que ya tenga permisos.
4. La conexión GitHub quedará asociada al `users.id` del usuario autenticado.
5. El token OAuth se almacenará cifrado.
6. El usuario podrá consultar qué cuenta GitHub tiene conectada.
7. Podrá desconectar, reconectar o cambiar la cuenta conectada.
8. El sistema podrá listar los repositorios accesibles para ese usuario.
9. Podrá comprobar acceso de lectura y capacidad de push sobre un repositorio.
10. Todas las operaciones Git remotas de un run web utilizarán la conexión GitHub de su owner.
11. Las credenciales no llegarán a agentes, prompts, artefactos, worktrees ni contenedores de ejecución.
12. No existirá fallback silencioso a la identidad global de la VPS.
13. Una conexión inválida o revocada bloqueará las operaciones y solicitará reconexión.
14. FEATURE-042 podrá utilizar un contrato estable para seleccionar repositorios y validar ramas.
15. La conexión se realizará una sola vez por usuario y se reutilizará en todos sus proyectos.
16. La validez y permisos se comprobarán preventivamente al confirmar un caso y autoritativamente antes de iniciarlo.

## Modelo conceptual

```text
Usuario del Orquestador
├── Perfil básico
├── Configuración de agentes IA
└── Conexión GitHub
      ├── identidad externa
      ├── autorización OAuth
      └── token cifrado

Proyecto
└── repositorio GitHub configurado

Caso de negocio
└── rama de trabajo
```

---

# 4. Scope

## Included

### 4.1 Conexión GitHub

* Registrar una GitHub OAuth App para el Orquestador.
* Acción “Conectar GitHub”.
* Inicio del flujo OAuth.
* Callback OAuth.
* Protección mediante `state`.
* Intercambio del código de autorización por token.
* Consulta de identidad básica del usuario GitHub.
* Persistencia cifrada del token.
* Consulta del estado de conexión.
* Reconexión.
* Desconexión.
* Cambio de cuenta GitHub.

### 4.2 Permisos

Se solicitará el scope:

```text
repo
```

El Orquestador necesita acceso de lectura y escritura porque realiza:

* clone;
* fetch;
* consulta de referencias;
* checkout;
* creación de ramas;
* commits locales;
* push de ramas y resultados.

La autorización OAuth no concede permisos que el usuario no tenga previamente en GitHub.

Conceptualmente:

```text
Permisos efectivos =
permisos reales del usuario en GitHub
∩
scope concedido a la OAuth App
```

### 4.3 Persistencia por usuario

Se almacenará una conexión GitHub por usuario del Orquestador.

La conexión incluirá:

* usuario interno;
* proveedor;
* identificador externo;
* login de GitHub;
* token cifrado;
* scopes concedidos;
* estado;
* fechas de conexión y validación.

### 4.4 Listado de repositorios

FEATURE-026 incluirá una operación para listar los repositorios accesibles al usuario.

La lista permitirá que FEATURE-042:

* muestre repositorios válidos;
* evite depender de URLs escritas manualmente;
* guarde una identidad canónica;
* determine permisos básicos.

### 4.5 Validación de acceso

El sistema podrá verificar:

* acceso de lectura;
* capacidad de push;
* existencia de `main`;
* existencia de una rama;
* posibilidad efectiva de publicar una rama nueva.

### 4.6 Operaciones Git autenticadas

Se adaptarán todos los puntos actuales que realizan operaciones remotas, como mínimo:

* clonado inicial;
* consulta de referencias remotas;
* publicación de una rama;
* push de la rama del run;
* push realizado durante la inicialización técnica existente.

### 4.7 Integración con el flujo web

La conexión podrá iniciarse:

* desde “Mi cuenta”;
* durante la configuración de un proyecto;
* al detectar que un proyecto necesita acceso GitHub.

Aunque se inicie desde un proyecto, la conexión pertenecerá siempre al usuario.

### 4.8 Validación en casos de negocio

Antes de confirmar un caso:

* se realizará una validación preventiva.

Antes de iniciar el caso:

* se repetirá una validación autoritativa.

### 4.9 Compatibilidad temporal con CLI

El CLI técnico podrá conservar temporalmente la identidad legacy del servidor mediante un modo explícito.

El flujo web utilizará exclusivamente OAuth por usuario.

---

## Excluded

* GitHub App.
* Instalación de Apps en cuentas, organizaciones o repositorios.
* GitLab.
* Bitbucket.
* Azure DevOps.
* GitHub Enterprise Server.
* Varias cuentas GitHub simultáneas por usuario.
* PAT como flujo principal.
* Claves SSH personales.
* Deploy keys por usuario.
* Equipos dentro del Orquestador.
* Proyectos compartidos.
* Administración de organizaciones GitHub.
* Bypass de restricciones organizacionales.
* Vault externo.
* Auditoría histórica completa de tokens.
* Rotación automatizada de la clave maestra de cifrado.
* Sincronización permanente de todos los repositorios.
* Creación y administración de proyectos.
* Selección de la rama del caso.
* Configuración de agentes Claude/Codex.
* Autenticación de proveedores IA.
* Selección del modo Auto o Manual de releases.
* Creación de Pull Requests mediante API, salvo que el flujo actual ya lo requiera.
* Cambio de identidad de autoría de commits.

---

## Future Ideas

* Soporte para GitLab, Bitbucket u otros proveedores.
* Varias cuentas GitHub por usuario.
* PAT como mecanismo alternativo.
* GitHub Enterprise Server.
* Vault o servicio externo de secretos.
* Auditoría detallada de accesos.
* Webhooks de revocación.
* Identidad de bot verificable en GitHub.
* Rotación administrada de la clave de cifrado.
* Gestión avanzada de restricciones SAML o empresariales.
* Eliminación completa del modo Git legacy del CLI.

---

# 5. Functional Rules

## Regla 1 — Usuario del Orquestador

“Usuario” significa la persona que inicia sesión en el Orquestador y está identificada por:

```text
users.id
```

La conexión GitHub pertenece a ese usuario.

```text
user_git_connections.user_id → users.id
```

---

## Regla 2 — Una conexión por usuario

En esta versión se permite una sola conexión GitHub activa por usuario.

```text
UNIQUE(user_id, provider)
```

El único proveedor permitido inicialmente es:

```text
github
```

---

## Regla 3 — Identidad externa única

Una misma identidad GitHub no podrá asociarse simultáneamente a dos usuarios diferentes del Orquestador.

```text
UNIQUE(provider, external_user_id)
```

Si la cuenta ya está vinculada a otro usuario, no se revelarán sus datos.

---

## Regla 4 — OAuth App

La conexión se realizará mediante una GitHub OAuth App.

No se utilizará una GitHub App ni se requerirá instalación por repositorio.

Flujo:

```text
Usuario autenticado
→ Conectar GitHub
→ Autorizar OAuth App
→ Callback
→ Persistir token cifrado
→ Conexión activa
```

---

## Regla 5 — Lectura y escritura

El diseño no asumirá acceso de solo lectura.

El Orquestador requiere lectura y escritura para completar el pipeline.

El scope inicial será:

```text
repo
```

---

## Regla 6 — Conexión reutilizable

El usuario autoriza GitHub una vez.

La conexión se reutiliza en todos sus proyectos.

No se solicitará OAuth:

* por cada proyecto;
* por cada repositorio;
* por cada caso;
* por cada run.

Solo se repetirá cuando:

* no exista conexión;
* el token sea inválido;
* haya sido revocado;
* el usuario elija reconectar;
* el usuario cambie de cuenta.

---

## Regla 7 — Separación entre usuario, proyecto y caso

```text
Conexión GitHub
→ propiedad del usuario

Repositorio
→ configuración del proyecto

Rama
→ configuración del caso
```

FEATURE-026 no decide qué repositorio ni qué rama usar.

Determina si el usuario puede realizar la operación solicitada.

---

## Regla 8 — Identidad del owner del run

Toda operación Git remota de un run utilizará la conexión GitHub de su owner.

```text
run.owner_id
→ user_git_connection
→ credencial efímera
→ operación Git
```

No se resolverá la identidad desde:

* usuario del sistema operativo;
* configuración global de Git;
* deploy key de la VPS;
* owner textual del repositorio;
* proyecto sin verificar el owner del run.

---

## Regla 9 — Sin fallback silencioso

Si la conexión:

* no existe;
* está inválida;
* está revocada;
* no tiene acceso;
* no permite escribir;

la operación debe detenerse.

Nunca se utilizará automáticamente:

* la clave SSH del servidor;
* un PAT global;
* una deploy key global;
* la conexión de otro usuario;
* acceso anónimo para continuar parcialmente.

---

## Regla 10 — Repositorios públicos

La conexión GitHub será obligatoria para crear casos operativos incluso cuando el repositorio sea público.

Motivos:

* el pipeline necesita hacer push;
* puede necesitar crear una rama;
* evita mezclar identidad anónima y autenticada;
* evita aceptar un caso que inevitablemente fallará al publicar resultados.

La exploración pública sin conexión puede considerarse en el futuro.

---

## Regla 11 — State OAuth

Todo flujo OAuth deberá usar un `state`:

* aleatorio;
* asociado al usuario;
* asociado a la sesión;
* de un solo uso;
* con expiración corta.

El callback no confiará en un `userId` proporcionado por el navegador.

---

## Regla 12 — Conexión exitosa

Después del callback:

1. Se valida `state`.
2. Se intercambia el código por token.
3. Se consulta la identidad GitHub.
4. Se valida la unicidad de esa identidad.
5. Se cifra el token.
6. Se crea o actualiza la conexión.
7. Se marca como `connected`.
8. Se muestra la cuenta vinculada.

---

## Regla 13 — Token cifrado

El token nunca se almacenará en texto plano.

La clave de cifrado:

* estará fuera de PostgreSQL;
* se suministrará como secreto del servidor;
* no se reutilizará como contraseña;
* no aparecerá en logs.

---

## Regla 14 — Prohibición de exposición

El token no puede aparecer en:

* URL persistida;
* argumentos visibles de procesos;
* `.git/config`;
* remote URL;
* stdout;
* stderr;
* logs;
* `run_events`;
* artefactos;
* prompts;
* metadata de Executors;
* mensajes de escalamiento;
* worktrees;
* contenedores de agentes.

---

## Regla 15 — Transporte HTTPS

Las operaciones autenticadas utilizarán HTTPS.

URL válida:

```text
https://github.com/owner/repository.git
```

URL prohibida:

```text
https://usuario:token@github.com/owner/repository.git
```

---

## Regla 16 — Credencial efímera

El token se entregará a Git mediante:

```text
GIT_ASKPASS
```

o un mecanismo temporal equivalente.

El helper:

* será de uso acotado;
* tendrá permisos mínimos;
* no persistirá la credencial;
* será eliminado después de la operación;
* no estará disponible para los agentes.

---

## Regla 17 — Entorno mínimo

Los procesos Git no heredarán `process.env` completo.

Se utilizará una allowlist basada en el patrón existente `runtimeEnvironment()`.

Variables candidatas:

```text
PATH
HOME
USERPROFILE
TEMP
TMP
TMPDIR
SystemRoot
windir
LANG
LC_ALL
GIT_TERMINAL_PROMPT
GIT_ASKPASS
```

La validación técnica confirmó que ese patrón ya existe y puede reutilizarse. También confirmó que `gitNoPromptEnv()` y `cloneRunRepository` heredan actualmente más entorno del necesario.

---

## Regla 18 — Validación preventiva

Antes de confirmar un caso se comprobará:

1. Conexión GitHub activa.
2. Acceso al repositorio.
3. Capacidad de lectura y escritura.
4. Existencia de `main`.
5. Existencia de la rama indicada.
6. Si no existe, posibilidad de publicarla.

Esta validación informa al usuario y permite confirmar el caso.

---

## Regla 19 — Validación autoritativa

Antes de iniciar el caso se repetirá la validación.

```text
Confirmación
→ validación preventiva

Inicio
→ validación autoritativa
```

La segunda prevalece porque los permisos o ramas pueden haber cambiado.

---

## Regla 20 — Rama inexistente

Cuando la rama no exista:

1. `main` debe existir.
2. El usuario debe poder escribir.
3. Se mostrará una advertencia.
4. La rama se creará desde `main` al iniciar el caso.

Mensaje:

> La rama `{branch}` no existe. Se creará automáticamente a partir de `main` cuando inicies el caso de negocio.

Si `main` no existe o no puede publicarse la rama, el inicio se bloquea.

---

## Regla 21 — Token OAuth persistente y revocable

Los tokens de una OAuth App tradicional no utilizan el esquema de access token de ocho horas más refresh token propio de las GitHub Apps.

FEATURE-026 no almacenará:

* refresh token;
* expiración inventada;
* proceso periódico de refresh.

El token seguirá utilizándose hasta que sea revocado o invalidado.

GitHub puede revocar tokens OAuth, entre otras causas, por revocación del usuario o la aplicación, exposición pública, un año de inactividad o exceso de tokens para la misma combinación usuario/aplicación/scopes. Un token revocado no puede restaurarse; se requiere una nueva autorización.

---

## Regla 22 — Validación del token

No habrá polling ni tarea en background.

La validez se comprobará:

* durante las operaciones funcionales;
* mediante el endpoint oficial de comprobación cuando sea necesario.

Resultados:

```text
token válido
→ connected

token inválido
→ invalid
→ reconexión requerida
```

GitHub ofrece un endpoint para comprobar tokens y otro para revocar un token individual.

---

## Regla 23 — Reconexión

Ante un token inválido:

1. Se marca la conexión como `invalid`.
2. Se bloquea la operación.
3. Se solicita reconexión.
4. El nuevo flujo OAuth reemplaza el token anterior.
5. No se intenta restaurar el token revocado.
6. No se aplica fallback.

---

## Regla 24 — Desconexión

Al desconectar:

1. Se intentará revocar remotamente el token individual.
2. Independientemente del resultado remoto, el token local será eliminado o inutilizado.
3. La conexión se marcará como `revoked`.
4. Los proyectos y casos permanecerán.
5. Las operaciones Git quedarán bloqueadas hasta reconectar.

---

## Regla 25 — Restricciones organizacionales

Una organización puede restringir el acceso de OAuth Apps y requerir aprobación de un owner.

El Orquestador:

* no intentará evitar esa política;
* informará que es una restricción externa;
* permitirá elegir otro repositorio;
* permitirá volver a comprobar el acceso.

GitHub confirma que las organizaciones pueden restringir OAuth Apps y que, en esos casos, los usuarios pueden necesitar aprobación del owner.

---

## Regla 26 — SAML

Si una organización exige SAML SSO, el usuario puede necesitar una sesión SAML activa al autorizar la OAuth App.

El sistema mostrará una instrucción clara para autenticarse en GitHub y volver a conectar.

---

## Regla 27 — Cambio de cuenta

Cambiar de cuenta GitHub no debe:

* eliminar proyectos;
* modificar repositorios;
* migrar casos;
* eliminar runs históricos;
* asumir permisos equivalentes.

Antes de confirmar el cambio, el sistema verificará la nueva cuenta contra los repositorios configurados.

Clasificación:

```text
Accesible con escritura
Accesible solo para lectura
Sin acceso
No comprobado
```

---

## Regla 28 — Cambio permitido con impacto

El usuario podrá confirmar el cambio aunque algunos proyectos queden bloqueados.

Los proyectos afectados:

* podrán consultarse;
* conservarán casos e historial;
* no permitirán crear o iniciar casos;
* no permitirán clone ni push.

El estado se derivará de la conexión y los permisos actuales; no se persistirá inicialmente una máquina de estados adicional.

---

## Regla 29 — Sustitución segura de cuenta

La cuenta anterior solo se revocará después de:

1. completar OAuth con la nueva cuenta;
2. cifrar y persistir el nuevo token;
3. analizar el impacto;
4. recibir confirmación final.

Si el flujo se cancela o falla, la cuenta anterior permanece activa.

---

## Regla 30 — Misma cuenta reconectada

Si el `external_user_id` nuevo coincide con el actual:

* se trata como reconexión;
* se reemplaza el token;
* no se procesa como cambio de identidad;
* se conservan todos los proyectos.

---

## Regla 31 — Autoría de commits

La autorización para hacer push no implica autoría humana.

Se mantiene:

```text
user.name = ai-orchestrator-bot
user.email = ai-orchestrator-bot@localhost
```

La trazabilidad del usuario queda en:

* `run.owner_id`;
* `project_id`;
* eventos y auditoría.

La validación técnica confirmó que esa identidad ya está fijada en `commitAllChanges` y `mergeFeatureBranchIntoBase`.

---

## Regla 32 — CLI legacy

El flujo web utilizará siempre OAuth por usuario.

El CLI podrá conservar temporalmente un modo explícito:

```text
user_oauth
server_legacy
```

Reglas:

* nunca se selecciona legacy automáticamente;
* nunca funciona como fallback;
* debe quedar claramente documentado;
* su retiro se evaluará después de migrar el flujo operativo.

---

# 6. Estrategia Algorítmica

No aplica como algoritmo de optimización.

La Feature introduce flujos determinísticos de resolución y autorización.

## 6.1 Resolución de conexión

**Entrada:**

* `userId`;
* proveedor;
* operación solicitada.

**Salida:**

* conexión activa;
* conexión ausente;
* conexión inválida;
* conexión revocada.

**Secuencia:**

1. Buscar conexión exacta del usuario y proveedor.
2. Rechazar si no existe.
3. Rechazar si no está `connected`.
4. Descifrar únicamente durante la operación.
5. Crear contexto efímero.
6. Ejecutar.
7. Destruir contexto.
8. No utilizar defaults ni fallbacks.

---

## 6.2 Validación de repositorio

**Entrada:**

* usuario;
* repositorio;
* capacidad solicitada.

**Capacidades:**

```text
read_repository
push_branch
```

**Resultados:**

```text
allowed
connection_required
connection_invalid
repository_not_accessible
read_only
organization_restricted
temporary_failure
```

---

## 6.3 Rama inexistente

**Entrada:**

* repositorio;
* `main`;
* rama del caso;
* conexión del owner.

**Secuencia:**

1. Confirmar acceso.
2. Confirmar existencia de `main`.
3. Confirmar que la rama no existe.
4. Confirmar capacidad de push.
5. Crear localmente desde `main`.
6. Publicar con la credencial del owner.
7. Si la rama apareció concurrentemente, actualizar referencias y evitar sobrescritura.
8. Si falla, detener sin fallback.

---

# 7. Technical Considerations

## 7.1 Modelo de datos

Siguiente migración disponible:

```text
0015
```

La validación técnica confirmó que las migraciones actuales llegan hasta `0014`.

### Tabla `user_git_connections`

```sql
create table user_git_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  provider text not null,
  external_user_id text not null,
  external_login text not null,
  access_token_ciphertext text not null,
  granted_scopes text[] not null default '{}',
  status text not null default 'connected',
  connected_at timestamptz not null default now(),
  last_validated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_git_connections_provider_check
    check (provider = 'github'),

  constraint user_git_connections_status_check
    check (status in ('connected', 'invalid', 'revoked'))
);

create unique index one_git_connection_per_user_provider
  on user_git_connections(user_id, provider);

create unique index one_orchestrator_user_per_external_git_identity
  on user_git_connections(provider, external_user_id);
```

No se almacenan:

* refresh token;
* fecha de expiración artificial;
* repositorios del usuario;
* credenciales dentro de proyectos.

---

## 7.2 Persistencia de OAuth state

Se utilizará una tabla de estados de vida corta:

```sql
create table oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  session_id uuid not null references sessions(id),
  provider text not null,
  state_hash text not null,
  return_path text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint oauth_states_provider_check
    check (provider = 'github')
);

create unique index oauth_states_state_hash_unique
  on oauth_states(state_hash);
```

Reglas:

* almacenar hash, no el state original;
* expiración corta;
* consumo atómico;
* uso único;
* limpieza periódica;
* `return_path` limitado a rutas internas permitidas.

---

## 7.3 Configuración de servidor

```text
GITHUB_OAUTH_CLIENT_ID
GITHUB_OAUTH_CLIENT_SECRET
GITHUB_OAUTH_CALLBACK_URL
GIT_CREDENTIAL_ENCRYPTION_KEY
```

La OAuth App es una configuración del Orquestador.

Los tokens obtenidos pertenecen a los usuarios.

---

## 7.4 Cifrado

Se utilizará:

```text
AES-256-GCM
```

Mediante `node:crypto`.

Requisitos:

* clave de 256 bits;
* IV aleatorio por cifrado;
* authentication tag;
* formato versionado;
* detección de manipulación;
* errores sanitizados.

Formato conceptual:

```text
v1.<iv>.<authTag>.<ciphertext>
```

La validación técnica confirmó que no existe actualmente un mecanismo reversible reutilizable en el repositorio.

---

## 7.5 Endpoints

```text
GET  /auth/github/start
GET  /auth/github/callback
GET  /auth/github/status
POST /auth/github/disconnect
POST /auth/github/change
GET  /auth/github/repositories
```

Las rutas encajan con el patrón plano actual de `/auth/login`, `/auth/logout` y `/auth/me`. La validación confirmó también que `state` será infraestructura nueva.

---

## 7.6 Cliente HTTP

Se utilizará inicialmente `fetch` nativo.

Operaciones previstas:

* intercambio OAuth;
* consulta de usuario;
* listado paginado de repositorios;
* consulta de permisos;
* comprobación de token;
* revocación.

No se incorporará Octokit salvo necesidad demostrada.

---

## 7.7 Contrato de aplicación

```typescript
interface UserGitConnectionService {
  getConnectionStatus(
    userId: string
  ): Promise<GitConnectionStatus>;

  completeGitHubOAuth(params: {
    userId: string;
    sessionId: string;
    code: string;
    state: string;
  }): Promise<GitConnectionSummary>;

  disconnect(
    userId: string
  ): Promise<void>;

  listAccessibleRepositories(
    userId: string
  ): Promise<AccessibleRepository[]>;

  validateRepositoryAccess(params: {
    userId: string;
    repository: GitRepositoryIdentity;
    capability: GitCapability;
  }): Promise<RepositoryAccessResult>;

  createGitProcessAuth(params: {
    userId: string;
    repository: GitRepositoryIdentity;
  }): Promise<GitProcessAuth>;
}
```

---

## 7.8 Repositorio accesible

```typescript
interface AccessibleRepository {
  provider: "github";
  externalId: string;
  owner: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  visibility: "public" | "private" | "internal";
  permissions: {
    read: boolean;
    push: boolean;
    admin?: boolean;
  };
}
```

La lista se obtiene bajo demanda.

No se sincroniza permanentemente.

---

## 7.9 Contexto Git efímero

```typescript
interface GitProcessAuth {
  env: NodeJS.ProcessEnv;
  dispose(): Promise<void>;
}
```

La capa de aplicación:

1. conoce el run;
2. obtiene `owner_id`;
3. resuelve la conexión;
4. crea `GitProcessAuth`;
5. invoca `worktree.ts`;
6. ejecuta `dispose()`.

---

## 7.10 Firmas Git actualizadas

```typescript
cloneRunRepository({
  runId,
  repoUrl,
  baseRef,
  gitAuth,
});

pushRunBranch({
  worktree,
  gitAuth,
});
```

`worktree.ts`:

* no recibe `userId`;
* no consulta PostgreSQL;
* no descifra tokens;
* no conoce OAuth;
* ejecuta Git usando un entorno ya preparado.

La validación técnica confirmó que las firmas actuales no reciben identidad alguna y que esta decisión debe formar parte explícita del contrato.

---

## 7.11 Entorno mínimo reutilizable

Se reutilizará o extraerá el patrón de:

```text
src/executor/isolated-tools/roleRuntime.ts
runtimeEnvironment()
```

También se corregirán:

* `gitNoPromptEnv()`;
* el entorno duplicado dentro de `cloneRunRepository`.

---

## 7.12 Integración con el TO-BE de interfaz

Flujo completo:

```text
1. Usuario crea cuenta.
2. Completa datos básicos.
3. Configura agentes IA.
4. Entra al workspace.
5. Crea o selecciona proyecto.
6. Conecta GitHub si hace falta.
7. Selecciona repositorio.
8. Crea caso.
9. Define rama.
10. Se valida Git preventivamente.
11. Selecciona modo Auto o Manual.
12. Confirma.
13. Caso queda sin_iniciar.
14. Decide iniciarlo.
15. Se revalida Git autoritativamente.
16. Se crea la rama si corresponde.
17. Se clona y ejecuta.
18. Se publican resultados con la conexión del owner.
```

---

## 7.13 Mensajes funcionales principales

### No conectado

**Título:** Conecta tu cuenta de GitHub

> Para configurar repositorios y ejecutar casos de negocio, conecta una cuenta de GitHub con permisos de lectura y escritura sobre los repositorios que utilizarás.

### Antes de autorizar

**Título:** Autorizar acceso a GitHub

> El Orquestador necesita leer y escribir en los repositorios a los que tu cuenta ya tiene acceso. Esto permite clonar, consultar ramas, crear la rama del caso y publicar resultados.

> La autorización no concede permisos que tu usuario de GitHub no tenga.

### Conexión exitosa

> La cuenta `{github_login}` quedó conectada. Puedes utilizar sus repositorios en tus proyectos.

### Token inválido

**Título:** Vuelve a conectar GitHub

> La autorización de GitHub ya no es válida. Vuelve a conectar tu cuenta para continuar trabajando con tus repositorios.

### Sin acceso

> La cuenta `{github_login}` no tiene acceso al repositorio `{repository_full_name}`, o GitHub no permite que el Orquestador lo consulte.

### Solo lectura

> Puedes leer `{repository_full_name}`, pero no publicar ramas. Necesitas permisos de escritura para crear y ejecutar casos de negocio.

### Restricción organizacional

> La organización `{organization}` no permite actualmente que el Orquestador acceda a este repositorio mediante tu autorización de GitHub. Puede ser necesaria la aprobación de un administrador.

### SAML

> GitHub requiere una sesión activa de la organización `{organization}`. Inicia sesión en esa organización desde GitHub y vuelve a conectar tu cuenta.

### Rama inexistente

> La rama `{branch}` no existe. Se creará automáticamente a partir de `main` cuando inicies el caso de negocio.

### Error temporal

> GitHub no respondió correctamente. Tu configuración no fue modificada. Vuelve a intentarlo.

---

# 8. Validation Criteria

## Escenario 1 — Conexión exitosa

**Input:** usuario autenticado completa OAuth.
**Expected output:** identidad correcta, token cifrado y estado `connected`.

---

## Escenario 2 — State inválido

**Input:** callback con state inexistente, vencido, consumido o asociado a otra sesión.
**Expected output:** conexión rechazada y ningún token persistido.

---

## Escenario 3 — Token cifrado

**Input:** autorización válida.
**Expected output:** el valor almacenado no contiene el token legible y puede descifrarse únicamente con la clave correcta.

---

## Escenario 4 — Conexión ausente

**Input:** intento de crear un caso operativo sin conexión GitHub.
**Expected output:** operación bloqueada y acción “Conectar GitHub”.

---

## Escenario 5 — Listado de repositorios

**Input:** usuario conectado.
**Expected output:** repositorios accesibles, paginados y con permisos relevantes.

---

## Escenario 6 — Repositorio con escritura

**Input:** usuario con lectura y escritura.
**Expected output:** validación, clone y push exitosos con su conexión.

---

## Escenario 7 — Repositorio de solo lectura

**Input:** usuario sin permiso de push.
**Expected output:** lectura posible, pero caso operativo bloqueado.

---

## Escenario 8 — Sin acceso

**Input:** repositorio no accesible.
**Expected output:** acceso denegado sin revelar información innecesaria.

---

## Escenario 9 — Token revocado

**Input:** GitHub rechaza el token.
**Expected output:** conexión marcada `invalid`, operación detenida y reconexión requerida.

---

## Escenario 10 — Restricción organizacional

**Input:** organización bloquea la OAuth App.
**Expected output:** mensaje de restricción externa, sin fallback.

---

## Escenario 11 — Dos usuarios

**Input:** dos usuarios con cuentas GitHub distintas.
**Expected output:** cada run utiliza exclusivamente la conexión de su owner.

---

## Escenario 12 — Identidad GitHub duplicada

**Input:** una cuenta GitHub ya vinculada a otro usuario.
**Expected output:** conexión rechazada sin revelar identidad del otro usuario.

---

## Escenario 13 — Token ausente de logs

**Input:** clone y push reales.
**Expected output:** token ausente de argumentos, logs, errores, remotos, eventos y worktree.

---

## Escenario 14 — Rama existente

**Input:** rama accesible existente.
**Expected output:** validación exitosa y uso de la rama.

---

## Escenario 15 — Rama inexistente y creable

**Input:** `main` existe, rama no existe y usuario puede escribir.
**Expected output:** advertencia preventiva y creación desde `main` al iniciar.

---

## Escenario 16 — Rama inexistente sin escritura

**Input:** usuario sin permiso de push.
**Expected output:** ejecución bloqueada sin identidad global.

---

## Escenario 17 — `main` inexistente

**Input:** rama no existe y repositorio no tiene `main`.
**Expected output:** ejecución bloqueada; no se elige otra rama automáticamente.

---

## Escenario 18 — Validación cambió entre confirmación e inicio

**Input:** permisos válidos al confirmar y revocados antes de iniciar.
**Expected output:** validación autoritativa bloquea el inicio.

---

## Escenario 19 — Desconexión

**Input:** usuario desconecta GitHub.
**Expected output:** token local inutilizado, intento de revocación remota y proyectos conservados.

---

## Escenario 20 — Cambio compatible

**Input:** nueva cuenta con escritura sobre todos los repositorios.
**Expected output:** cambio permitido y proyectos operativos.

---

## Escenario 21 — Cambio parcialmente incompatible

**Input:** nueva cuenta sin acceso a algunos repositorios.
**Expected output:** resumen de impacto; cambio permitido tras confirmación; proyectos afectados bloqueados.

---

## Escenario 22 — Cambio OAuth cancelado

**Input:** usuario cancela el nuevo flujo.
**Expected output:** conexión anterior continúa activa.

---

## Escenario 23 — Regresión del acceso global

**Input:** run web sin conexión válida mientras la VPS tiene credencial global funcional.
**Expected output:** el run falla y no utiliza la credencial global.

---

## Validation Evidence

### Evidencia funcional

* Cuenta GitHub conectada visible en UI.
* Login externo mostrado.
* Listado real de repositorios.
* Desconexión y reconexión.
* Cambio de cuenta con impacto por proyecto.
* Mensajes de permisos y organización.
* Advertencia de creación de rama.

### Evidencia Git

* Clone real mediante OAuth.
* Push real mediante OAuth.
* Rama creada desde `main`.
* Usuario de solo lectura bloqueado.
* Dos usuarios utilizando credenciales diferentes.
* Ausencia de uso de la clave global del host.

### Evidencia de seguridad

* Ciphertext en PostgreSQL.
* Token ausente de logs.
* Token ausente de `run_events`.
* Token ausente de `.git/config`.
* Token ausente de argumentos visibles.
* Helper temporal eliminado.
* Entorno construido por allowlist.
* State de un solo uso.
* Rechazo de state vencido o reutilizado.

### Evidencia automatizada

* Tests de AES-GCM.
* Tests de manipulación de ciphertext.
* Tests de ownership.
* Tests del flujo OAuth.
* Tests de state.
* Tests de conexión inválida.
* Tests de no fallback.
* Tests de aislamiento entre usuarios.
* Tests de construcción del entorno Git.
* Tests canario de fuga de secretos.
* Tests de cambio de cuenta.
* Tests de validación preventiva y autoritativa.

---

# 9. Risks

## Riesgo 1 — Scope amplio

El scope `repo` concede acceso amplio a los repositorios privados a los que el usuario ya tiene acceso.

Es un tradeoff funcional aceptado porque el pipeline necesita leer y escribir.

La UI debe explicarlo claramente.

---

## Riesgo 2 — Compromiso del token

Un token comprometido puede afectar múltiples repositorios.

Mitigaciones:

* AES-256-GCM;
* clave fuera de DB;
* entorno mínimo;
* helper efímero;
* token fuera de URLs;
* ausencia en logs y eventos;
* desconexión;
* revocación.

---

## Riesgo 3 — Clave maestra única

Una clave de servidor permite descifrar todos los tokens.

Para el MVP se acepta este modelo, evitando introducir un vault prematuramente.

Debe documentarse un procedimiento de recuperación y rotación futura.

---

## Riesgo 4 — Restricciones organizacionales

Una organización puede bloquear OAuth Apps o exigir aprobación.

El Orquestador no puede garantizar acceso en contra de esa política.

Debe tratarse como una restricción externa y mostrarse claramente.

---

## Riesgo 5 — SAML

Una sesión SAML ausente puede impedir autorización o acceso.

El usuario deberá autenticarse en la organización desde GitHub y reintentar.

---

## Riesgo 6 — Token revocado por inactividad o exceso

GitHub puede revocar tokens OAuth por un año de inactividad o por superar límites de tokens para una misma combinación usuario/aplicación/scopes.

El sistema debe evitar iniciar OAuth innecesariamente y solicitar reconexión cuando corresponda.

---

## Riesgo 7 — Compatibilidad legacy

Mantener temporalmente la identidad global para CLI puede generar confusión.

Mitigación:

* modo explícito;
* prohibido en web;
* sin fallback;
* retiro futuro documentado.

---

## Riesgo 8 — Exposición mediante errores de Git

Los errores Git pueden incluir información del remote o del entorno.

La credencial no deberá formar parte de la URL y los errores se sanitizarán.

---

## Riesgo 9 — Cambio de cuenta

Una nueva cuenta puede dejar proyectos sin acceso.

El cambio:

* mostrará impacto;
* exigirá confirmación;
* preservará proyectos;
* bloqueará operaciones incompatibles.

---

## Riesgo 10 — Carrera de ramas

Una rama puede aparecer entre la validación y el inicio.

La operación debe actualizar referencias y evitar sobrescrituras silenciosas.

---

## Riesgo 11 — API de GitHub

Usar `fetch` nativo evita dependencias, pero exige implementar correctamente:

* headers;
* paginación;
* rate limits;
* errores;
* versionado de API.

---

## Riesgo 12 — Autoría y autorización

El usuario autoriza el push, pero el commit seguirá atribuido al bot.

Esta diferencia debe ser entendible y quedar respaldada por la trazabilidad del run.

---

## Riesgo 13 — Eliminación de la conexión anterior

Durante un cambio de cuenta, revocar demasiado pronto la conexión anterior podría dejar al usuario sin ninguna conexión válida.

Por eso la sustitución debe ser transaccional desde el punto de vista funcional: la anterior se conserva hasta completar y confirmar la nueva.

---

# 10. Approval Gate

## Estado del diseño

* Problem Statement: completo.
* Functional Goal: completo.
* Scope: completo.
* Functional Rules: completas.
* Estrategia determinística: definida.
* Modelo de datos: definido.
* OAuth App: definida.
* Scope `repo`: definido.
* Cifrado: definido.
* State OAuth: definido.
* Ciclo de vida del token: verificado.
* Listado de repositorios: definido.
* Validación de permisos: definida.
* Inyección de credenciales: definida.
* Integración con `worktree.ts`: definida.
* Entorno mínimo: definido.
* Integración con onboarding: definida.
* Integración con FEATURE-042: definida.
* UX principal: definida.
* Cambio de cuenta: definido.
* Validaciones: definidas.
* Riesgos: documentados.
* Validación técnica contra el código: completada.

La validación técnica concluyó que el diseño es sólido y que los ajustes encontrados no invalidan su arquitectura.

## Approval Status

**Pendiente de aprobación explícita del owner.**

La implementación está prohibida hasta esa aprobación.

No deben realizarse todavía:

* creación de rama;
* migración `0015`;
* endpoints;
* cambios en `worktree.ts`;
* configuración de OAuth;
* cambios de UI;
* commits;
* modificación del Roadmap.

Una vez aprobado, deberá prepararse un handoff de implementación para el asistente IA de desarrollo.
