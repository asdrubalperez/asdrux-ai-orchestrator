# FEATURE-041 — Creación y gestión de cuentas de usuario (self-service)

## 1. Feature Identity

- **Name:** Creación y gestión de cuentas de usuario (self-service)
- **Type:** Product / Security / Identity
- **Owner:** Asdru
- **Status:** Diseño — Approval Gate abierto
- **Priority:** Alta
- **Playbook Mode:** Standard
- **Template:** `docs/playbook/07-FEATURE-TEMPLATE.md` v2.1

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

**Cuenta:**

- email, contraseña y nombre visible;
- rol y estado;
- API keys de proveedores de IA;
- conexiones OAuth de Claude y Codex.

**Proyecto:**

- conexión GitHub seleccionada para ese proyecto;
- repositorio asociado;
- proveedor y modo predeterminados;
- overrides por agente o rol.

**Caso o run:**

- rama base específica del caso.

La pantalla de configuración de agentes del proyecto:

- muestra en modo lectura qué proveedores están disponibles para la cuenta;
- no permite editar credenciales de cuenta;
- ofrece acceso directo al módulo de cuenta para agregar, quitar o reconectar credenciales;
- mantiene la edición de preferencias de uso del proyecto.

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
- Un proyecto puede existir sin repositorio.
- No puede operar hasta tener:
  - una conexión GitHub válida seleccionada;
  - un repositorio configurado;
  - una preferencia global de IA resoluble;
  - una credencial válida para el proveedor finalmente resuelto.
- La configuración global es suficiente mientras ningún rol tenga un override incompatible.

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

### 5.9 Último acceso

- La fecha de último acceso es informativa.
- Debe actualizarse mediante un evento de autenticación exitoso claramente definido.
- No debe depender de cada request ni generar escrituras innecesarias.

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
- rate limiting.

No se aprueba todavía ninguna tabla, endpoint o librería concreta.

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
13. Confirmar si `user_agent_config` es realmente por proyecto o solo por usuario y rol.
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
- **Expected output:** datos permitidos en modo lectura, sin secretos ni acciones operativas.

### Escenario 15 — Rate limiting

- **Input:** exceso de intentos de login, registro, recuperación o reenvío.
- **Expected output:** rechazo temporal consistente, sin afectar permanentemente la cuenta.

### Escenario 16 — Proyecto sin configuración

- **Input:** usuario crea proyecto sin conexión GitHub ni repositorio.
- **Expected output:** proyecto creado pero marcado/no presentado como operativo; no puede iniciar casos.

### Escenario 17 — Configuración de agentes

- **Input:** usuario abre configuración de proyecto.
- **Expected output:** preferencias editables; disponibilidad de credenciales mostrada en lectura; enlace a configuración de cuenta.

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
  - separación visual cuenta/proyecto.

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

---

## 10. Approval Gate

**Estado: ABIERTO.**

La creación de este documento no autoriza implementación.

Antes de aprobar se requiere:

1. revisión técnica de DAIA contra `main` y datos reales;
2. respuesta explícita a las revalidaciones obligatorias;
3. ajuste del documento cuando los hallazgos invaliden alguna consideración técnica;
4. revisión final de alcance por ARIA y el owner;
5. aprobación humana explícita del owner.

Hasta ese momento queda prohibido implementar FEATURE-041.
