# FEATURE-041 — Creación y gestión de cuentas de usuario (self-service)

## 1. Feature Identity

- **Name:** Creación y gestión de cuentas de usuario (self-service)
- **Type:** Product / Security / Identity
- **Owner:** Asdru
- **Status:** Diseño — revalidación técnica DAIA completada (2026-08-04) — Approval Gate abierto
- **Priority:** Alta
- **Playbook Mode:** Standard
- **Template:** `docs/playbook/07-FEATURE-TEMPLATE.md` v2.1
- **Rama de trabajo:** `feature/041-cuentas-de-usuario-self-service`

---

## 2. Problem Statement

El sistema ya dispone de usuarios, contraseñas, sesiones web/CLI, proyectos y conexiones personales, pero el alta y la gestión de cuentas no son self-service.

La experiencia actual tampoco separa con suficiente claridad:

- los datos y credenciales que pertenecen a la cuenta;
- las preferencias y conexiones que pertenecen a un proyecto;
- los datos específicos de un caso o run.

La apertura pública del producto requiere un capability mínimo completo y seguro que permita:

- registrarse;
- verificar el email;
- recuperar el acceso;
- completar el perfil obligatorio;
- gestionar la contraseña;
- administrar cuentas y roles con una jerarquía simple;
- proteger las operaciones públicas frente a abuso básico.

La Feature debe reutilizar la infraestructura existente y evitar construir un framework genérico de identidad o RBAC.

---

## 3. Functional Goal

Después de implementar FEATURE-041:

1. cualquier persona podrá registrarse públicamente con email y contraseña;
2. la cuenta solo podrá utilizarse después de verificar el email;
3. el usuario podrá recuperar su contraseña por email;
4. el usuario deberá completar un nombre visible antes de acceder al resto de la aplicación;
5. el usuario podrá crear proyectos explícitamente, sin proyecto automático por defecto;
6. la cuenta y la configuración de proyecto estarán separadas conceptualmente en la UI;
7. administradores y superadministrador podrán gestionar cuentas y roles según las reglas definidas;
8. las rutas públicas sensibles estarán protegidas por rate limiting;
9. la solución extenderá las tablas y servicios existentes con el cambio mínimo necesario.

---

## 4. Scope

### Included

#### Registro público y activación

- Registro público con:
  - email;
  - contraseña;
  - confirmación de contraseña.
- Política de contraseña con:
  - longitud mínima;
  - mayúsculas;
  - minúsculas;
  - números;
  - símbolos.
- Creación de cuenta pendiente de verificación.
- Envío de email de verificación.
- Token de verificación:
  - aleatorio;
  - persistido únicamente como hash;
  - con expiración;
  - de un solo uso;
  - revocable mediante reenvío.
- Reenvío self-service desde login.
- Reenvío manual por administrador.
- Verificación sin inicio automático de sesión.
- Redirección a login después de verificar.

#### Perfil y onboarding

- Registro inicial solo con email y contraseña.
- Nombre visible obligatorio después del primer login.
- Mientras el nombre esté pendiente:
  - acceso permitido al módulo de cuenta;
  - resto de la aplicación bloqueado.
- Nombre visible editable posteriormente.
- Email visible en modo lectura y no editable.
- No se introduce `username`.
- No se crea automáticamente un proyecto.

#### Contraseña y sesiones

- Recuperación de contraseña por email.
- Token de recuperación con las mismas propiedades de seguridad que el token de verificación.
- Redirección a login después del restablecimiento.
- Revocación de todas las sesiones al:
  - cambiar contraseña;
  - recuperar contraseña;
  - suspender una cuenta.
- Cambio de contraseña autenticado incluido solo si puede implementarse de forma simple reutilizando la infraestructura existente; si requiere cambios amplios, el usuario utilizará el flujo de recuperación.
- Sesiones con expiración fija.
- Conservación del TTL actual si la revisión técnica confirma que sigue siendo razonable.
- Sin expiración deslizante.

#### Administración de cuentas

- Tres niveles efectivos:
  - usuario;
  - administrador;
  - superadministrador.
- No se implementa RBAC genérico.
- Administrador:
  - crea usuarios;
  - suspende y reactiva usuarios normales;
  - promueve usuarios normales a administrador;
  - reenvía verificaciones;
  - no modifica a otros administradores;
  - no modifica su propio rol;
  - no suspende su propia cuenta;
  - no modifica al superadministrador.
- Superadministrador:
  - ejecuta todas las acciones de administrador;
  - suspende, reactiva y degrada administradores;
  - no puede ser suspendido, degradado ni perder su rol desde la aplicación.
- La cuenta protegida del superadministrador corresponde al owner Asdru.
- La protección debe depender de una marca técnica estable, nunca del nombre visible.
- Cuentas creadas por administrador:
  - no reciben contraseña temporal;
  - reciben correo de activación;
  - establecen su propia contraseña;
  - verifican el email dentro del mismo flujo de activación.
- El enlace de activación expira y puede reenviarse.
- Suspensión inmediata:
  - revoca todas las sesiones;
  - bloquea nuevos logins;
  - conserva proyectos, credenciales e historial.
- Reactivación:
  - conserva los datos;
  - exige nuevo login.

#### Visibilidad administrativa

- Listado de usuarios con, al menos:
  - email;
  - nombre visible;
  - rol;
  - estado;
  - fecha de creación;
  - fecha de verificación;
  - fecha de último acceso.
- Administradores y superadministrador pueden consultar proyectos de otros usuarios en modo lectura.
- La consulta no permite:
  - ejecutar casos o runs;
  - modificar proyectos;
  - cambiar configuraciones;
  - utilizar credenciales;
  - conectar repositorios;
  - suplantar usuarios.
- Indicadores no sensibles de credenciales de IA y conexiones GitHub se incluyen solo si pueden obtenerse con cambios pequeños y sin descifrar secretos.

#### Separación cuenta / proyecto / caso

**[Corrección DAIA, 2026-08-04]** La revalidación técnica obligatoria (punto 13 de la sección 7)
confirmó que `user_agent_config` es hoy exclusivamente por (`user_id`, `role`) — no existe, ni
existió nunca, ninguna noción de proyecto en esa tabla. La configuración de agentes (proveedor,
modo, modelo por rol) es y era de **cuenta**, no de proyecto. Discutido con el owner: en vez de
migrar a una configuración arbitraria por proyecto (alto esfuerzo, rompe la separación
cuenta/proyecto ya definida para credenciales), se adopta el modelo de **perfiles de configuración
nombrados**, ver detalle en la subsección siguiente y en la Regla 5.10.

**Cuenta:**

- email, contraseña y nombre visible;
- rol y estado;
- API keys de proveedores de IA;
- conexiones OAuth de Claude y Codex;
- configuración **Global** de agente: una única combinación de asistente o proveedor de IA, modelo
  y método de autenticación que se aplica a Architect, Functional, Planning, Developer y QA, así
  como al Asistente de Entrada;
- hasta 3 perfiles de configuración de agente, cada uno con:
  - nombre editable por el usuario;
  - personalización por agente, en el orden visible del pipeline: Asistente de Entrada, Architect,
    Functional, Planning, Developer y QA.

Aunque el Asistente de Entrada no es técnicamente un rol del pipeline, a efectos de configuración y
experiencia del usuario se comporta como una unidad configurable equivalente y se presenta primero
porque es el primer agente con el que interactúa el usuario.

**Proyecto:**

- conexión GitHub seleccionada para ese proyecto;
- repositorio asociado;
- selección de exactamente una opción de configuración de cuenta: **Global** o uno de los perfiles
  personalizados disponibles.

**Caso o run:**

- rama base específica del caso.

La pantalla de configuración de agentes del proyecto:

- muestra en modo lectura qué proveedores están disponibles para la cuenta;
- no permite editar credenciales de cuenta ni el contenido de Global o de los perfiles (eso se
  edita exclusivamente en el módulo de cuenta);
- ofrece acceso directo al módulo de cuenta para agregar, quitar o reconectar credenciales, y para
  crear/editar/borrar perfiles;
- permite seleccionar, para este proyecto puntual, **Global** o uno de los perfiles personalizados.

**Resolución al ejecutar un agente:** configuración específica del agente dentro del perfil
seleccionado → configuración Global de la cuenta → default técnico del sistema. Cuando el proyecto
usa Global, los seis agentes utilizan la misma combinación de asistente de IA, modelo y método de
autenticación.

#### Configuración Global

- **Global siempre existe** como opción del selector del proyecto.
- Todo proyecto nuevo queda con **Global preseleccionada**.
- Global representa una única combinación de cuenta compuesta por:
  - asistente o proveedor de IA;
  - modelo;
  - método de autenticación.
- Esa misma combinación se aplica a Architect, Functional, Planning, Developer y QA, así como al
  **Asistente de Entrada**, que no es técnicamente un rol del pipeline, pero a efectos de
  configuración y experiencia del usuario se comporta como uno.
- Global puede estar incompleta.
- La cuenta y el proyecto pueden existir aunque Global todavía no esté lista.
- El proyecto no podrá operar mientras la resolución de asistente de IA, modelo y método de
  autenticación no conduzca a una configuración válida y a una credencial disponible.

#### Perfiles personalizados

- Alta, edición y borrado de hasta 3 perfiles por cuenta.
- Los perfiles personalizados son la superficie que permite definir configuraciones distintas por
  agente.
- Cada perfil puede establecer una combinación específica de asistente de IA, modelo y método de
  autenticación para:
  - Asistente de Entrada;
  - Architect;
  - Functional;
  - Planning;
  - Developer;
  - QA.
- Aunque el Asistente de Entrada no sea técnicamente un rol del pipeline, se trata como una unidad
  configurable equivalente desde la perspectiva del usuario, y se mantiene primero porque en ese
  orden van apareciendo los agentes en el pipeline.
- El selector de configuración del proyecto lista **Global** como opción explícita, junto con los
  perfiles personalizados que el usuario tenga creados — nunca queda "sin selección" de forma
  implícita.
- Cambiar de Global a un perfil personalizado es una decisión consciente y visible del usuario, no
  un default oculto.
- Al borrar un perfil que algún proyecto tiene seleccionado, ese proyecto pasa automáticamente a
  **Global** (`agent_config_profile_id = null`) — sin estado de bloqueo intermedio ni acción manual
  requerida.
- El límite de 3 perfiles se valida en el servicio de aplicación, no requiere constraint de base de
  datos.

#### Migración de configuración existente

La configuración actual incluye una fila global (`role IS NULL`) y configuraciones específicas por
rol.

Durante la migración:

- la fila global actual (`role IS NULL`) pasa a ser la nueva configuración **Global**;
- las configuraciones específicas por rol existentes **se eliminan**;
- esos overrides **no se incorporan a Global ni se migran a perfiles personalizados**;
- no se crea un perfil personalizado artificial;
- no se reasignan proyectos actuales a perfiles;
- todos los proyectos existentes quedan usando Global;
- los perfiles personalizados comienzan vacíos y solo se crean de forma voluntaria por el usuario.

Esta pérdida de overrides no es accidental ni silenciosa: constituye una decisión explícita y
aceptada por el owner para simplificar el modelo y evitar trasladar automáticamente la
configuración histórica por rol al nuevo sistema de perfiles (ver Riesgo 15).

#### Rate limiting

Protección inicial sin CAPTCHA para:

- registro público;
- login;
- recuperación de contraseña;
- reenvío de verificación;
- activación y validación de tokens sensibles.

Los límites concretos se definirán durante implementación a partir de la infraestructura existente y deberán poder configurarse sin crear un framework nuevo.

### Excluded

- Cambio de email.
- Eliminación o desactivación voluntaria de cuenta.
- Hard delete, soft delete, anonimización o transferencia de ownership.
- Gestión de dispositivos o sesiones activas desde UI.
- MFA.
- CAPTCHA.
- Impersonación.
- RBAC genérico.
- Edición administrativa de nombre, email, contraseña, credenciales o proyectos.
- Creación automática de proyecto.
- Operación de proyectos ajenos por administradores.
- Términos, política de privacidad o consentimiento legal, salvo decisión posterior explícita.

### Future ideas

- MFA.
- Gestión de sesiones y dispositivos.
- Cambio de email con reverificación.
- Lifecycle de baja y retención.
- CAPTCHA adaptativo si aparece abuso real.
- Auditoría administrativa ampliada.
- Indicadores administrativos enriquecidos de conexiones y preparación.

---

## 5. Functional Rules

### 5.1 Estados funcionales de cuenta

La solución debe representar, al menos, estas condiciones observables:

1. pendiente de verificación;
2. activa;
3. suspendida.

El diseño técnico puede usar columnas simples si son suficientes; no se exige una máquina de estados ni una tabla de historial.

### 5.2 Acceso

- Cuenta no verificada: no puede iniciar sesión operativa.
- Cuenta suspendida: no puede iniciar sesión.
- Cuenta activa sin nombre visible: solo accede al módulo de cuenta.
- Cuenta activa con nombre visible: accede al resto de la aplicación.
- La ausencia de proyecto, repositorio o credenciales no impide iniciar sesión.

### 5.3 Preparación del proyecto

- El usuario crea explícitamente cada proyecto.
- Un proyecto puede existir sin repositorio ni configuración de IA completa.
- Todo proyecto nuevo queda con **Global preseleccionada**.
- Un proyecto no puede operar hasta tener:
  - una conexión GitHub válida seleccionada;
  - un repositorio configurado;
  - una selección de configuración válida: Global o un perfil personalizado perteneciente al
    propietario del proyecto;
  - una resolución válida de asistente de IA, modelo y método de autenticación;
  - una credencial disponible para el método de autenticación finalmente resuelto.
- Cuando el proyecto usa Global, todos los agentes utilizan la misma combinación de asistente de
  IA, modelo y método de autenticación.
- Cuando usa un perfil personalizado, cada agente puede resolver una combinación específica; si el
  perfil no define una configuración para un agente, cae a Global y luego al default técnico del
  sistema.

### 5.4 Email y enumeración

- Los mensajes de registro, recuperación y reenvío deben evitar revelar innecesariamente si una cuenta existe.
- El email debe normalizarse para comparación sin destruir el valor que se muestra al usuario.
- El email no puede cambiarse en esta Feature.

### 5.5 Tokens

- Nunca se persisten tokens sensibles en texto plano.
- Todo token tiene expiración y uso único.
- Un reenvío invalida el token anterior.
- Los tokens no deben aparecer en logs, eventos ni mensajes de error.

### 5.6 Contraseñas

- Se valida la política en registro, activación, recuperación y cambio autenticado.
- La contraseña nunca se registra ni se devuelve.
- La confirmación de contraseña se valida antes de crear la cuenta.
- Se reutiliza el mecanismo de hash existente si sigue siendo seguro y correcto.

### 5.7 Ownership

- El `user_id` autoritativo procede de la sesión del servidor.
- Nunca se confía en un `user_id` enviado por el cliente.
- Los administradores solo acceden a datos permitidos por endpoints administrativos explícitos.
- El perfil seleccionado por un proyecto debe pertenecer al mismo usuario propietario del proyecto;
  nunca se acepta un `profileId` de otra cuenta aunque el cliente lo envíe.

### 5.8 Jerarquía administrativa

| Acción | Usuario | Administrador | Superadministrador |
|---|---:|---:|---:|
| Gestionar su nombre visible | Sí | Sí | Sí |
| Cambiar o recuperar su contraseña | Sí | Sí | Sí |
| Crear usuarios | No | Sí | Sí |
| Suspender/reactivar usuario normal | No | Sí | Sí |
| Promover usuario normal a administrador | No | Sí | Sí |
| Suspender/reactivar administrador | No | No | Sí |
| Degradar administrador | No | No | Sí |
| Modificar su propio rol | No | No | No |
| Suspender su propia cuenta | No | No | No |
| Modificar al superadministrador | No | No | No |
| Ver proyectos ajenos en modo lectura | No | Sí | Sí |
| Ejecutar o modificar proyectos ajenos | No | No | No |

Los administradores que consultan proyectos ajenos en modo lectura pueden ver el nombre de la
opción de configuración seleccionada y el estado de preparación, pero no editar Global, perfiles,
credenciales ni valores secretos.

### 5.9 Último acceso

- La fecha de último acceso es informativa.
- Debe actualizarse mediante un evento de autenticación exitoso claramente definido.
- No debe depender de cada request ni generar escrituras innecesarias.

### 5.10 Configuración Global y perfiles personalizados

- Un usuario puede tener hasta 3 perfiles de configuración de agente, cada uno con nombre propio y
  personalización de los seis agentes configurables: Asistente de Entrada, Architect, Functional,
  Planning, Developer y QA.
- El límite de 3 se valida en el servicio de aplicación, no en la base de datos.
- Global siempre existe como una opción explícita y todo proyecto nuevo la tiene preseleccionada.
- Global contiene una única combinación de asistente de IA, modelo y método de autenticación que se
  aplica a los seis agentes.
- Global puede estar incompleta; esto no impide crear la cuenta ni el proyecto, pero sí operar hasta
  que la resolución conduzca a una combinación válida y a una credencial disponible.
- Un proyecto selecciona exactamente una opción: Global o uno de los perfiles personalizados de su
  propietario.
- Al borrar un perfil, todo proyecto que lo tuviera seleccionado pasa automáticamente a Global
  (`agent_config_profile_id = null`) sin estado de bloqueo intermedio.
- Resolución al ejecutar un agente: configuración específica del agente dentro del perfil
  seleccionado → configuración Global de la cuenta → default técnico del sistema.
- Los perfiles, Global y las credenciales se editan únicamente desde el módulo de cuenta. El
  proyecto solo elige cuál opción aplica.

---

## 6. Estrategia Algorítmica (Opcional)

No aplica como algoritmo de optimización.

Sí debe existir una resolución determinística de autorización:

1. validar sesión;
2. validar estado de cuenta;
3. validar onboarding obligatorio;
4. validar rol requerido por la operación;
5. validar restricciones de actor y objetivo;
6. ejecutar la operación o rechazarla sin efectos parciales.

Para acciones administrativas, la autorización debe evaluarse en backend y nunca depender solo de la UI.

---

## 7. Technical Considerations

### Baseline confirmado en `main`

- Existen tablas `users` y `projects` desde FEATURE-010.
- Existen sesiones server-side compartidas por CLI y Web desde FEATURE-014.
- El Roadmap documenta TTL fijo de 48 horas como baseline actual.
- Existen `user_agent_config`, credenciales personales de IA y conexiones OAuth por usuario.
- Existen `user_git_connections` y campos de repositorio en `projects`.
- FEATURE-025 Parte 3 está mergeada en `main` y validada E2E.

### Cambios esperados, sujetos a revisión técnica

La implementación deberá determinar el cambio mínimo necesario en:

- tabla `users`;
- tokens de verificación, activación y recuperación;
- revocación de sesiones;
- servicios de login/logout;
- middleware de sesión y autorización;
- rutas públicas de autenticación;
- UI de cuenta y administración;
- servicio de email;
- rate limiting;
- tabla nueva `agent_config_profiles` (perfiles de configuración de agente por cuenta, hasta 3);
- columna `projects.agent_config_profile_id` (FK a `agent_config_profiles`, `ON DELETE SET NULL`;
  `null` representa la selección Global);
- `resolveAgentConfig` (`src/db/repository.ts:662-668`) pasa a recibir `profileId` además de
  `userId`/`role`, con la nueva precedencia perfil por agente → Global de cuenta → default técnico;
- migración de la fila global actual (`role IS NULL`) hacia la nueva configuración Global;
- eliminación de las configuraciones específicas por rol existentes durante la migración -- no se
  incorporan a Global ni se migran a perfiles, no se crea ningún perfil personalizado artificial ni
  se reasignan proyectos a perfiles;
- todos los proyectos existentes quedan usando Global y los perfiles personalizados comienzan
  vacíos, creados únicamente por decisión del usuario.

No se aprueba todavía ninguna tabla, endpoint o librería concreta.

### Resultado de la revalidación técnica DAIA (2026-08-04)

Los 17 puntos de "Revalidaciones obligatorias para DAIA" fueron confirmados contra `main` real
(migraciones y código, no documentación aspiracional). Sin sorpresas relevantes salvo el punto 13
(ver más abajo). Resumen de los hallazgos que sí importan al diseño:

- `users.password_hash` es nullable desde el schema original (`0002_users_projects_phase_a.sql`) —
  no hay constraint que impida hoy una fila sin password.
- Hash de contraseñas: `bcryptjs`, cost 12 (`src/auth/password.ts`). Único punto de escritura hoy
  es el CLI `seed:user` — no existe endpoint HTTP de alta/cambio de password.
- `sessions`: TTL fijo 48h (`src/auth/sessionCore.ts:3`), revocación vía `revoked_at`, token crudo
  nunca persistido (solo su hash). Confirmado razonable, se conserva.
- No existe CSRF ni rate limiting genérico. La mitigación real es `requireAllowedOrigin` llamado a
  mano en cada ruta mutante (`src/auth/webSession.ts:182-186`) — cualquier endpoint nuevo de esta
  Feature debe replicarlo explícitamente. Rate limiting solo existe hoy para login (en memoria, 5
  intentos/15min); el resto de rutas nuevas de esta Feature necesitan su propia protección.
- `last_login_at` no existe en ningún lado del código — hay que crearlo desde cero.
- `user_git_connections` es 1:1 por (usuario, proveedor) — no hay multi-conexión que resolver, la
  ambigüedad que el diseño original insinuaba no existe en la práctica.
- 9 tablas tienen FK hacia `users.id` — deben revisarse todas antes de tocar constraints de `users`
  (listado completo disponible en el handoff de la sesión de validación).
- **Punto 13 (crítico):** `user_agent_config` es exclusivamente por (`user_id`, `role`) — sin
  ninguna columna `project_id` en ninguna migración (`0008`, `0021`, `0022`) ni en
  `resolveAgentConfig`/`repository.ts:624-706`. La sección 4 original de este documento asumía
  incorrectamente que era por proyecto. Resuelto mediante el modelo de perfiles nombrados (ver
  sección 4 y Regla 5.10) — evaluado contra la alternativa de config arbitraria por proyecto real
  (esfuerzo 8/10 vs. 5/10 de perfiles, descartada por desproporcionada para el caso de uso real).

### Revalidaciones obligatorias para DAIA

1. Revisar la definición real de `users`, migraciones y datos existentes.
2. Confirmar el hash actual de contraseñas y su reutilización.
3. Confirmar el contrato real de `sessions`, TTL, revocación y cookies.
4. Confirmar CSRF y rate limiting existentes, si los hay.
5. Confirmar rutas públicas/privadas y middleware actual.
6. Confirmar cómo se identifica y crea hoy el usuario inicial.
7. Definir una marca técnica estable para el superadministrador sin depender de email editable, nombre visible o username.
8. Validar la migración de la cuenta existente de Asdru a superadministrador protegido.
9. Revisar todas las foreign keys hacia `users` antes de introducir estado o restricciones nuevas.
10. Confirmar cómo se calcula `last_login_at` sin escrituras por request.
11. Revalidar la relación entre `user_git_connections` y `projects`:
    - si `projects` guarda la conexión seleccionada;
    - cómo se resuelve una conexión cuando el usuario tiene varias;
    - qué ocurre al eliminar o reconectar una conexión;
    - si el modelo actual satisface una conexión y un repositorio por proyecto.
12. Determinar si la discrepancia GitHub pertenece a FEATURE-041, FEATURE-042 o una Feature separada; no ampliarla automáticamente.
13. ~~Confirmar si `user_agent_config` es realmente por proyecto o solo por usuario y rol.~~
    **[RESUELTO 2026-08-04, ver "Resultado de la revalidación técnica DAIA" más abajo]**
14. Evaluar si el cambio autenticado de contraseña es pequeño; de no serlo, excluirlo y reutilizar recuperación.
15. Evaluar el costo real de indicadores administrativos no sensibles; excluirlos si exigen agregaciones o cambios amplios.
16. Revisar código y documentación de FEATURE-010, 013B, 014, 025, 026 y 042.
17. Validar `main` y no trabajar desde una rama histórica.

### Seguridad

- No almacenar secretos ni tokens en logs o eventos.
- No interpolar email, tokens, IDs o nombres en comandos shell.
- Preferir APIs y argumentos estructurados; `shell: false` cuando aplique.
- Tratar todos los textos como UTF-8 sin BOM.
- Evitar enumeración de cuentas.
- Aplicar rate limiting con una clave y política que no permita bypass trivial.
- Las respuestas de error no deben filtrar cuerpos internos del servicio de correo o de la base.
- Toda mutación administrativa debe ser atómica.

### Migración

La migración deberá:

- preservar todas las cuentas, proyectos, sesiones y credenciales existentes;
- definir valores y backfill para filas actuales;
- convertir de forma explícita la cuenta del owner en superadministrador protegido;
- no invalidar sesiones existentes salvo que el diseño aprobado lo requiera;
- migrar la fila global actual (`role IS NULL`) a la nueva configuración Global;
- eliminar las configuraciones específicas por rol existentes -- no se incorporan a Global ni se
  migran a perfiles personalizados, no se crea ningún perfil artificial;
- dejar todos los proyectos existentes seleccionando Global;
- validar datos reales antes de endurecer constraints;
- ser reversible cuando sea razonable o disponer de un procedimiento de rollback documentado.

---

## 8. Validation Criteria

### Escenario 1 — Registro público

- **Input:** email nuevo, contraseña válida y confirmación coincidente.
- **Expected output:** cuenta pendiente, password hasheada, correo enviado, sin sesión creada.

### Escenario 2 — Contraseña inválida

- **Input:** contraseña que incumple una regla.
- **Expected output:** rechazo antes de crear la cuenta, con mensaje accionable.

### Escenario 3 — Registro duplicado

- **Input:** email ya registrado.
- **Expected output:** respuesta neutra que no exponga innecesariamente la existencia de la cuenta.

### Escenario 4 — Verificación válida

- **Input:** token vigente y no usado.
- **Expected output:** email verificado, token invalidado, redirección a login, sin sesión automática.

### Escenario 5 — Token vencido o reutilizado

- **Input:** token vencido, revocado o usado.
- **Expected output:** rechazo seguro y opción de solicitar reenvío.

### Escenario 6 — Primer acceso sin nombre

- **Input:** login válido de cuenta verificada sin nombre visible.
- **Expected output:** acceso limitado al módulo de cuenta.

### Escenario 7 — Completar nombre

- **Input:** nombre visible válido.
- **Expected output:** onboarding completado y acceso normal habilitado.

### Escenario 8 — Recuperación de contraseña

- **Input:** solicitud con email registrado o no registrado.
- **Expected output:** respuesta neutra; solo la cuenta existente recibe token válido.

### Escenario 9 — Restablecimiento

- **Input:** token válido y nueva contraseña válida.
- **Expected output:** contraseña actualizada, token invalidado, todas las sesiones revocadas y redirección a login.

### Escenario 10 — Suspensión

- **Input:** administrador suspende usuario normal.
- **Expected output:** estado suspendido, sesiones revocadas y login bloqueado sin borrar datos.

### Escenario 11 — Jerarquía administrativa

- **Input:** administrador intenta modificar otro administrador.
- **Expected output:** rechazo sin cambios.

### Escenario 12 — Gestión por superadministrador

- **Input:** superadministrador degrada o suspende administrador.
- **Expected output:** operación permitida y sesiones revocadas cuando corresponda.

### Escenario 13 — Protección del superadministrador

- **Input:** cualquier actor intenta degradar o suspender la cuenta protegida.
- **Expected output:** rechazo en backend sin cambios parciales.

### Escenario 14 — Lectura administrativa de proyectos

- **Input:** administrador consulta proyectos de un usuario.
- **Expected output:** datos permitidos en modo lectura, incluyendo nombre de la opción de
  configuración seleccionada y estado de preparación, sin secretos ni acciones operativas.

### Escenario 15 — Rate limiting

- **Input:** exceso de intentos de login, registro, recuperación o reenvío.
- **Expected output:** rechazo temporal consistente, sin afectar permanentemente la cuenta.

### Escenario 16 — Proyecto sin configuración

- **Input:** usuario crea proyecto sin conexión GitHub, repositorio o configuración Global completa.
- **Expected output:** proyecto creado con Global preseleccionada pero marcado/no presentado como
  operativo; no puede iniciar casos.

### Escenario 17 — Configuración de agentes

- **Input:** usuario abre configuración de proyecto.
- **Expected output:** disponibilidad de credenciales mostrada en lectura; Global o perfil
  seleccionado de forma visible; enlace a configuración de cuenta para editar Global, perfiles y
  credenciales.

### Escenario 18 — Crear perfil de configuración

- **Input:** usuario con menos de 3 perfiles crea uno nuevo con nombre y configuración por agente.
- **Expected output:** perfil creado, disponible para selección en cualquiera de sus proyectos.

### Escenario 19 — Límite de perfiles

- **Input:** usuario con 3 perfiles ya creados intenta crear un cuarto.
- **Expected output:** rechazo con mensaje accionable, ningún perfil creado.

### Escenario 20 — Selección de perfil por proyecto

- **Input:** usuario selecciona un perfil existente para un proyecto.
- **Expected output:** al ejecutar un agente de ese proyecto con configuración definida en el perfil,
  se usa esa combinación; los agentes sin configuración específica en el perfil caen a Global.

### Escenario 21 — Borrado de un perfil seleccionado

- **Input:** usuario borra un perfil que un proyecto tiene seleccionado.
- **Expected output:** el proyecto pasa automáticamente a Global (`agent_config_profile_id = null`)
  sin bloqueo ni acción manual previa.

### Escenario 22 — Global incompleta

- **Input:** proyecto con Global seleccionada y cuenta cuya combinación Global de asistente de IA,
  modelo o método de autenticación está incompleta o no dispone de credencial válida.
- **Expected output:** el proyecto existe pero no puede operar; el sistema muestra un gate técnico
  explícito y accionable, no un default silencioso indefinido.

### Escenario 23 — Migración de configuración existente

- **Input:** cuenta existente con una fila global (`role IS NULL`) y configuraciones específicas
  por rol.
- **Expected output:** la fila global existente pasa a ser la nueva configuración Global; los
  overrides por rol se eliminan; no se crea ningún perfil artificial; todos los proyectos
  existentes quedan usando Global; no aparecen perfiles personalizados hasta que el usuario los
  cree voluntariamente.

### Validation Evidence

La validación deberá incluir:

- pruebas automatizadas unitarias e integración para tokens, roles, estados y revocación;
- pruebas de rutas HTTP y middleware;
- pruebas de concurrencia para uso único de tokens cuando aplique;
- inspección de base para confirmar que tokens y contraseñas no están en claro;
- validación E2E real en VPS de:
  - registro;
  - recepción de email;
  - verificación;
  - login;
  - onboarding de nombre;
  - recuperación;
  - suspensión y reactivación;
  - jerarquía administrativa;
  - rate limiting;
  - separación visual cuenta/proyecto;
  - Global preseleccionada e incompleta;
  - creación, selección y borrado de perfiles;
  - migración de una cuenta existente sin perfil artificial.

Las pruebas automatizadas no sustituyen la evidencia E2E real.

---

## 9. Risks

1. La Feature puede crecer hacia un sistema completo de identidad; debe mantenerse el alcance aprobado.
2. La entrega de email puede introducir dependencia operativa y configuración de infraestructura aún no inventariada.
3. Una migración incorrecta puede bloquear la cuenta existente del owner.
4. Una identificación débil del superadministrador puede permitir degradación accidental.
5. Revocar sesiones incorrectamente puede dejar accesos activos o cerrar sesiones de usuarios equivocados.
6. Los mensajes públicos pueden permitir enumeración si no se diseñan de forma consistente.
7. El rate limiting puede bloquear usuarios legítimos o ser ineficaz si la clave elegida no corresponde a la topología real de proxy/VPS.
8. La discrepancia entre conexión GitHub por usuario y selección por proyecto puede ampliar indebidamente esta Feature.
9. `user_agent_config` puede no representar hoy preferencias por proyecto; debe confirmarse antes de diseñar UI o migraciones.
10. El nombre obligatorio posterior al registro requiere middleware consistente para no dejar rutas accesibles por error.
11. Mostrar proyectos ajenos a administradores aumenta la superficie de autorización y debe excluir secretos y acciones.
12. La política de contraseña podría romper flujos existentes si se aplica retroactivamente a hashes actuales; solo debe exigirse al definir una contraseña nueva.
13. El cambio autenticado de contraseña puede añadir complejidad innecesaria; es una capacidad condicionada por esfuerzo.
14. Los indicadores administrativos de conexiones son opcionales y no deben forzar descifrado ni agregaciones complejas.
15. **[RESUELTO 2026-08-04, confirmado explícitamente por el owner]** La configuración actual admite
    overrides por rol, mientras la nueva Global es una única combinación para todos los agentes. El
    owner confirmó que hoy puede tener overrides por rol en proyectos actuales y que acepta
    conscientemente perderlos durante la migración: la regla determinística es la ya descrita en
    "Migración de configuración existente" — la fila global actual (`role IS NULL`) se convierte en
    la nueva Global; cualquier override por rol existente se descarta sin migrarse a ningún perfil;
    no se crea ningún perfil artificial; todos los proyectos existentes quedan usando Global. No es
    una pérdida silenciosa: queda documentada aquí como decisión explícita del owner, no como un
    default no revisado.
16. Global puede existir incompleta. El gate operativo debe distinguir claramente entre proyecto
    creado y proyecto listo para ejecutar, sin bloquear el onboarding ni aplicar un default
    silencioso que oculte la falta de configuración o credencial.

---

## 10. Approval Gate

**Estado: ABIERTO.**

La creación de este documento no autoriza implementación.

Antes de aprobar se requiere:

1. ~~revisión técnica de DAIA contra `main` y datos reales~~ **Completada 2026-08-04.**
2. ~~respuesta explícita a las revalidaciones obligatorias~~ **Completada 2026-08-04, los 17 puntos
   respondidos, ver sección 7.**
3. ~~ajuste del documento cuando los hallazgos invaliden alguna consideración técnica~~
   **Completado 2026-08-04** — el punto 13 invalidaba la sección 4 original (config "por
   proyecto" no existe en el código real); corregido con el modelo de perfiles de configuración
   nombrados (sección 4, Regla 5.10).
4. revisión final de alcance por ARIA y el owner — **re-revisión DAIA del ajuste de Global/perfiles/
   migración completada 2026-08-04** (Riesgo 15 resuelto con confirmación explícita del owner: los
   overrides por rol actuales se eliminan durante la migración, no se incorporan a Global ni se
   migran a ningún perfil). Corrección de consistencia aplicada 2026-08-04 a pedido de ARIA:
   eliminadas todas las referencias residuales a "consolidar"/"incorporar" los overrides dentro de
   Global en Scope, Technical Considerations (Cambios esperados y Migración) y Escenario 23 — las
   cuatro secciones ahora usan de forma uniforme "se eliminan / no se incorporan". No quedan
   bloqueos arquitectónicos o funcionales identificados por ARIA. Queda pendiente únicamente la
   aprobación humana explícita del owner (punto 5).
5. aprobación humana explícita del owner — **pendiente**.

Hasta ese momento queda prohibido implementar FEATURE-041.

Trabajo realizado en la rama `feature/041-cuentas-de-usuario-self-service`, no en `main` — toda
Feature se trabaja en su propia rama salvo excepción explícita del owner.
