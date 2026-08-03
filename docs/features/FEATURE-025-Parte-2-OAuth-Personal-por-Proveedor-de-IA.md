# FEATURE-025-Parte-2 — OAuth personal por usuario y proveedor de IA

# 1. Feature Identity

* **Name:** OAuth personal por usuario y proveedor de IA
* **Type:** Autenticación / aislamiento de credenciales / integración de proveedores
* **Owner:** Asdrubal Pérez
* **Status:** Cerrada — validada end-to-end en vivo en el VPS (2026-08-03)
* **Priority:** Alta
* **Approval Gate:** Cerrado — aprobado por el owner tras cerrar el hallazgo de la capa holder/worker (sección 7.11); validación E2E real con cuentas de Claude y Codex completada
* **Dependencia principal:** FEATURE-025 Parte 1
* **Spike técnico:** Cerrado satisfactoriamente

---

# 2. Problem Statement

FEATURE-016 incorporó el modo:

```text
authMode = api_key | cli_session
```

y permitió configurar por usuario y por rol qué proveedor y modo de autenticación utilizar.

Sin embargo, el mecanismo actual de `cli_session` no representa todavía una conexión personal aislada por usuario.

En la práctica:

* Claude Code utiliza un caché OAuth dedicado pero global del Orquestador;
* Codex utiliza también un estado autenticado administrado fuera del modelo de usuario;
* varios usuarios podrían terminar utilizando la misma cuenta personal;
* la identidad y el consumo no pertenecen necesariamente al owner del run;
* la conexión no puede administrarse desde la UI;
* no existe persistencia cifrada por usuario;
* el refresh actualizado por el CLI no se incorpora a un estado canónico en base de datos;
* logout y desconexión no tienen un ciclo de vida de producto;
* permanecen dependencias de directorios y variables legacy de la VPS.

Esto contradice el modelo de propiedad establecido por FEATURE-025 Parte 1:

> Las credenciales utilizadas por una ejecución deben pertenecer al usuario dueño del run.

FEATURE-025 Parte 2 debe reemplazar el caché global de `cli_session` por conexiones OAuth personales asociadas a:

```text
user_id + provider
```

Cada usuario deberá autenticar su propia cuenta de Claude o ChatGPT mediante el flujo oficial del proveedor.

La conexión resultante debe:

* almacenarse cifrada;
* reutilizarse en todos los proyectos del usuario;
* refrescarse sin intervención mientras el proveedor lo permita;
* reconstruirse en un directorio temporal exclusivo por ejecución;
* mantenerse fuera del worker aislado;
* desconectarse de forma segura;
* no tener fallback hacia ningún caché global.

---

# 3. Functional Goal

Después de implementar esta Feature:

1. El usuario podrá conectar desde la aplicación:

   * su cuenta Claude;
   * su cuenta ChatGPT/Codex.

2. La conexión pertenecerá al usuario y proveedor:

```text
(user_id, provider)
```

3. Una única conexión del usuario podrá utilizarse en todos sus proyectos.

4. La selección de `cli_session` en la configuración global o de un rol utilizará exclusivamente la conexión OAuth del owner del run.

5. Si el usuario no dispone de una conexión válida:

   * el run no se ejecutará;
   * no se utilizará el caché global legacy;
   * no se utilizará una API key como fallback;
   * se devolverá `not_connected` o `reauth_required`, según corresponda.

6. La sesión se almacenará como un blob opaco cifrado.

7. Cada invocación reconstruirá un caché temporal, exclusivo y escribible.

8. El holder recibirá el material OAuth.

9. El worker aislado no recibirá:

   * access token;
   * refresh token;
   * archivo de sesión;
   * directorio OAuth;
   * variables de autenticación.

10. El CLI podrá actualizar su caché durante un refresh.

11. El estado actualizado será recogido, cifrado y promovido como nueva versión canónica.

12. Las ejecuciones normales podrán mantenerse en paralelo.

13. El refresh de una misma conexión se coordinará por usuario y proveedor.

14. El usuario podrá desconectar la conexión desde la UI.

15. La desconexión:

* bloqueará nuevas ejecuciones;
* coordinará los runs activos;
* ejecutará logout oficial best-effort;
* eliminará siempre el estado local cifrado.

16. El mecanismo global legacy de OAuth dejará de utilizarse.

17. Como parte del cutover, los datos legacy del Orquestador serán eliminados de la VPS mediante un procedimiento controlado.

---

# 4. Scope

## Included

### Conexiones personales

* Conexión OAuth personal para Claude Code.
* Conexión OAuth personal para Codex.
* Una conexión por usuario y proveedor.
* Reutilización de la conexión en todos los proyectos del usuario.
* Uso desde configuración global o por rol.
* Resolución mediante el owner del run.
* Eliminación de cualquier fallback global.

### Interfaz de usuario

* Estado de conexión por proveedor.
* Acción **Autenticar**.
* Acción **Desconectar**.
* Presentación de URL y código cuando corresponda.
* Envío del código de Claude al backend.
* Cancelación del intento de conexión.
* Indicación de conexión válida.
* Indicación de reautenticación requerida.
* Prevención de dos intentos de conexión simultáneos para el mismo usuario y proveedor.

### Login Claude Code

* Ejecución oficial:

```text
claude auth login --claudeai
```

* `CLAUDE_CONFIG_DIR` aislado.
* Captura de URL.
* Recepción del código mediante endpoint autenticado.
* Escritura única del código en `stdin`.
* Confirmación mediante:

  * exit code exitoso;
  * `claude auth status --json`.

### Login Codex

* Uso de Codex app-server.
* Preferencia inicial por:

```text
chatgptDeviceCode
```

* Presentación de:

  * URL;
  * código de usuario;
  * vencimiento.
* Confirmación mediante:

  * `account/login/completed`;
  * `account/read`.

### Persistencia

* Tabla de conexiones OAuth.
* Blob opaco cifrado.
* `session_version`.
* Estado persistente mínimo.
* Metadata no sensible.
* AES-256-GCM.
* Uso de `AI_CREDENTIAL_ENCRYPTION_KEY`.
* Provider y versión del envelope como AAD.

### Runtime

* Resolución por `(owner_user_id, provider)`.
* Materialización temporal por invocación.
* Directorios modo `0700`.
* Archivos sensibles modo `0600`.
* Caché temporal escribible.
* Recolección exclusiva del artefacto mínimo.
* Persistencia posterior al refresh.
* Compare-and-swap.
* Single-flight de refresh.
* Limpieza en `finally`.

### Claude

* Persistencia exclusiva de `.credentials.json`.
* Refresh coordinado.
* Conservación de las restricciones descubiertas en FEATURE-016.
* Pin de versión del CLI.
* Contract tests.

### Codex

* Persistencia exclusiva de `auth.json`.
* `CODEX_HOME` temporal y escribible.
* Corrección del uso incorrecto de `account/login/start` durante cada run.
* Uso de `account/read` para sesiones ya materializadas.
* Pin de versión y schema.
* Contract tests.

### Concurrencia

* Usuarios distintos en paralelo.
* Mismo usuario con runs paralelos.
* Temporales distintos.
* Coordinación de refresh.
* CAS para promoción de sesión.
* Protección contra sobrescritura de una sesión más nueva.

### Desconexión

* Bloqueo de nuevas ejecuciones.
* Coordinación con runs activos.
* Logout oficial best-effort.
* Eliminación local garantizada.
* Eliminación de temporales conocidos.
* Transición posterior a `not_connected`.

### Cutover y cleanup legacy

* Retirada del uso productivo de:

  * `CLAUDE_OAUTH_CACHE_DIR`;
  * `CODEX_OAUTH_CACHE_DIR`;
  * cualquier directorio global equivalente.
* Confirmación de ausencia de fallback.
* Validación del nuevo flujo antes de eliminar los datos legacy.
* Logout oficial sobre las sesiones legacy cuando sea posible.
* Eliminación controlada de archivos y directorios legacy.
* Retirada de variables de entorno legacy.
* Reinicio y validación posterior.
* Evidencia de que los runs continúan usando las conexiones personales.

## Excluded

* Guardar contraseñas de Claude, ChatGPT, Anthropic u OpenAI.
* Automatizar páginas web de autenticación.
* Eludir controles de seguridad del proveedor.
* Crear un proveedor OAuth genérico.
* Crear nuevos Executors.
* Migrar automáticamente la sesión global legacy a la cuenta personal del usuario.
* Reparar o reautenticar el caché global legacy.
* Compartir una conexión entre usuarios.
* Crear conexiones distintas por proyecto.
* Versionar indefinidamente todos los estados históricos de una sesión.
* Conservar tokens antiguos después de una rotación.
* Hacer fallback de OAuth a API key.
* Hacer fallback de OAuth a un caché global.
* Cambiar el comportamiento del rol `intake`.
* Soporte OAuth para el Asistente de Entrada, que pertenece a FEATURE-025 Parte 3.
* Browser callback dinámico de Codex como flujo inicial.
* Revocación de todas las sesiones personales del usuario fuera del Orquestador.
* Resolución legal definitiva de los términos de Claude para un producto público.

## Future ideas

* Browser callback de Codex cuando device code no esté habilitado.
* Gestión de múltiples conexiones del mismo proveedor para un mismo usuario.
* Selección de cuenta por proyecto.
* Historial de conexiones y auditoría avanzada.
* Alertas proactivas antes de `reauth_required`.
* Panel administrativo de salud de conexiones.
* Soporte de otros proveedores.

---

# 5. Functional Rules

## 5.1 Propiedad de la conexión

1. Toda conexión OAuth pertenece a un usuario.
2. Toda conexión OAuth pertenece a un proveedor.
3. Debe existir como máximo una conexión vigente por:

```text
(user_id, provider)
```

4. Una conexión no pertenece a un proyecto.
5. Una conexión no pertenece a un rol.
6. Todos los proyectos del usuario pueden reutilizarla.
7. Los roles configurados con el mismo proveedor pueden reutilizar la misma conexión.
8. Ningún usuario puede consultar o utilizar la conexión de otro.

## 5.2 Resolución de la conexión

Para un run con `authMode = cli_session`:

1. Obtener el owner del run.
2. Obtener el proveedor efectivo del rol.
3. Resolver la conexión por:

```text
owner_user_id + provider
```

4. Si no existe fila:

   * devolver `not_connected`;
   * no ejecutar al agente.
5. Si la conexión está en `reauth_required`:

   * devolver `reauth_required`;
   * no ejecutar al agente.
6. Nunca consultar el caché global legacy.
7. Nunca utilizar una API key como fallback.

## 5.3 Relación con la configuración de agentes

1. FEATURE-025 Parte 1 determina:

   * provider;
   * model;
   * auth mode.
2. Parte 2 determina únicamente la conexión OAuth efectiva.
3. Elegir `cli_session` no crea automáticamente una conexión.
4. La UI debe permitir autenticar el proveedor cuando el usuario selecciona OAuth.
5. Un rol puede quedar configurado con OAuth aunque la conexión todavía no exista.
6. En ese caso, la UI debe señalar la configuración como incompleta.
7. El runtime debe bloquear la ejecución hasta que exista una conexión válida.

## 5.4 Estados persistentes

Estados persistentes mínimos:

```text
connected
reauth_required
```

La ausencia de fila representa:

```text
not_connected
```

No deben persistirse como estado permanente:

```text
connecting
refreshing
disconnecting
```

Estos estados son transitorios y pertenecen al proceso o registry de coordinación.

## 5.5 Intentos de conexión

1. Solo puede existir un intento activo por:

```text
(user_id, provider)
```

2. Un segundo intento debe devolver:

```text
connection_in_progress
```

3. Todo intento tendrá TTL.
4. Al vencer el TTL:

   * terminar el proceso;
   * cancelar el login cuando exista comando oficial;
   * eliminar el temporal;
   * permitir un nuevo intento.
5. Cancelar un intento no debe crear una conexión.
6. La identidad del usuario se toma de la sesión web.
7. El cliente no puede enviar libremente otro `user_id`.

## 5.6 Login Claude

1. El backend ejecuta el login oficial.
2. El proceso puede funcionar sin TTY.
3. La URL se muestra al usuario.
4. El usuario completa la autorización en el navegador.
5. El usuario entrega el código a la UI.
6. La UI envía el código al backend autenticado.
7. El backend lo escribe una sola vez en `stdin`.
8. La conexión solo se considera válida cuando:

   * el proceso termina correctamente;
   * `auth status` confirma sesión iniciada.
9. La credencial mínima es `.credentials.json`.
10. No se persisten:

    * settings;
    * transcripts;
    * logs;
    * backups;
    * `.claude.json`;
    * directorios completos.

## 5.7 Login Codex

1. El backend inicia Codex app-server con `CODEX_HOME` aislado.
2. El flujo inicial preferido es `chatgptDeviceCode`.
3. La UI muestra:

   * verification URL;
   * user code;
   * deadline.
4. La conexión solo se considera válida tras:

   * `account/login/completed` exitoso;
   * `account/read` con cuenta válida.
5. El artefacto mínimo es `auth.json`.
6. Debe forzarse el almacenamiento en archivo.
7. No se persisten:

   * `config.toml`;
   * logs;
   * rollouts;
   * SQLite;
   * estado operativo.
8. Cuando device code esté deshabilitado, se devuelve un error accionable.
9. El browser callback alternativo queda fuera del alcance inicial.

## 5.8 Almacenamiento cifrado

1. El blob de sesión se cifra antes de persistirse.
2. Se utiliza `AI_CREDENTIAL_ENCRYPTION_KEY`.
3. El cifrado es AES-256-GCM.
4. Debe autenticarse mediante AAD como mínimo:

   * versión de envelope;
   * provider.
5. El contenido se trata como opaco.
6. No se extraen tokens a columnas separadas.
7. El plaintext no se almacena en base de datos.
8. El blob no se registra en logs.
9. El blob no se devuelve a la UI.
10. Backups y observabilidad forman parte del límite de confianza.

## 5.9 Materialización temporal

Para cada invocación:

1. Leer la conexión canónica.
2. Descifrarla.
3. Crear un directorio temporal exclusivo.
4. Aplicar modo `0700`.
5. Crear el archivo mínimo.
6. Aplicar modo `0600`.
7. Configurar:

   * `CLAUDE_CONFIG_DIR`, o
   * `CODEX_HOME`.
8. Entregar el directorio al holder.
9. No entregarlo al worker.
10. Permitir escritura al holder.
11. Recoger el artefacto mínimo al terminar.
12. Eliminar todo el temporal en `finally`.

Nunca se comparte un directorio escribible entre runs.

## 5.10 Refresh

1. Mientras el refresh sea válido, el usuario no debe volver a autenticarse.
2. El CLI puede renovar:

   * access token;
   * refresh token;
   * expiraciones;
   * otros campos internos.
3. El Orquestador no modifica tokens manualmente.
4. El Orquestador debe persistir el artefacto actualizado.
5. El estado actualizado pasa a ser canónico únicamente mediante CAS.
6. Si el refresh falla de forma irreparable:

   * marcar `reauth_required`;
   * impedir nuevas ejecuciones OAuth;
   * solicitar autenticación nuevamente.
7. El umbral proactivo se calcula a partir de:

   * duración máxima posible del run;
   * margen operativo.
8. Las duraciones observadas en el spike son referencias, no contratos.

## 5.11 Coordinación de refresh

1. La coordinación ocurre por:

```text
(user_id, provider)
```

2. No se bloquea todo el run.
3. Los runs con token válido pueden mantenerse paralelos.
4. Claude requiere single-flight para refresh.
5. Codex puede utilizar el mismo single-flight por simplicidad y uniformidad.
6. Después de adquirir el lock:

   * releer `session_version`;
   * comprobar si otro proceso ya refrescó;
   * evitar un refresh duplicado innecesario.
7. Toda promoción utiliza compare-and-swap.
8. Si el CAS pierde:

   * descartar la rama local;
   * recargar la versión canónica;
   * no sobrescribirla.
9. Se permite un único reintento por error de autenticación después de recargar la versión canónica.

## 5.12 Concurrencia

### Usuarios diferentes

1. Cada usuario tiene blob, temporal y conexión distintos.
2. Las ejecuciones pueden ser simultáneas.
3. No se utilizan variables globales mutables.
4. El cleanup de un usuario no afecta a otro.

### Mismo usuario

1. Dos runs pueden materializar copias independientes.
2. Los runs normales no se bloquean.
3. El refresh se coordina.
4. Cada run recoge únicamente su propio artefacto.
5. Solo una versión se promueve como canónica.
6. Ningún cleanup elimina el temporal de otro run.

## 5.13 Holder y worker

1. El holder es el único componente que recibe OAuth.
2. El worker no recibe el caché.
3. El worker no recibe variables OAuth.
4. El worker no puede leer el archivo de sesión.
5. Debe preservarse la arquitectura holder/worker de FEATURE-015.
6. Los cambios no deben ampliar el catálogo de tools.
7. Claude debe continuar funcionando con MCP.
8. Codex debe continuar funcionando con dynamic tools.

## 5.14 Reglas específicas de Claude

1. No utilizar `--bare`.
2. No utilizar `CLAUDE_CODE_SIMPLE=1`.
3. No utilizar `--safe-mode`.
4. Mantener `--setting-sources ""` según el diseño vigente.
5. Pinear la versión utilizada.
6. Ejecutar contract tests antes de upgrades.
7. El refresh de una conexión debe ser single-flight.
8. Persistir únicamente `.credentials.json`.

## 5.15 Reglas específicas de Codex

1. `CODEX_HOME` debe ser temporal y escribible.
2. Persistir únicamente `auth.json`.
3. Un run con sesión materializada debe consultar `account/read`.
4. `account/login/start` solo pertenece al adaptador de conexión.
5. No iniciar login durante cada run.
6. Mantener pin de versión y schema.
7. Verificar contracts antes de upgrades.
8. La divergencia de dos ramas de refresh se resuelve mediante CAS.

## 5.16 Desconexión

1. El usuario inicia la desconexión desde la UI.
2. Deben impedirse nuevos runs que necesiten esa conexión.
3. Si existen runs activos, la UI debe:

   * informar su existencia;
   * permitir esperar;
   * o permitir cancelarlos.
4. El logout no se ejecuta mientras haya consumidores activos.
5. Cuando no queden consumidores:

   * materializar una copia privada;
   * ejecutar logout oficial best-effort;
   * eliminar siempre la fila y blob local;
   * eliminar temporales conocidos.
6. Si el logout remoto falla:

   * la desconexión local igualmente se completa;
   * se informa la limitación;
   * futuras ejecuciones fallan como `not_connected`.
7. No se afirma que logout cierre otras concesiones independientes de la cuenta.

## 5.17 Reintentos

1. Los reintentos conservan:

   * provider;
   * model;
   * auth mode.
2. La conexión OAuth no se congela ni se copia en eventos.
3. El reintento resuelve la conexión canónica vigente del usuario.
4. Si la conexión fue renovada, usa la renovada.
5. Si fue desconectada, falla como `not_connected`.
6. Si requiere reautenticación, falla como `reauth_required`.
7. Los eventos nunca contienen el blob OAuth.

## 5.18 Cutover legacy

1. Parte 2 no migra la sesión global legacy.
2. Parte 2 no intenta repararla.
3. Parte 2 no la utiliza como fallback.
4. El cutover solo puede ejecutarse después de validar al menos:

   * conexión personal Claude;
   * conexión personal Codex, cuando se vaya a utilizar;
   * ejecución real mediante el nuevo camino;
   * ausencia de lecturas legacy.
5. La limpieza debe limitarse a directorios confirmados como dedicados al Orquestador.
6. No se elimina de forma genérica:

   * `~/.claude`;
   * `~/.codex`;
   * el HOME personal del operador.
7. Deben retirarse las variables legacy.
8. Tras el cleanup debe reiniciarse el servicio.
9. La validación posterior debe confirmar que el nuevo camino sigue funcionando.
10. El cierre de la Feature requiere evidencia de limpieza o una justificación explícita de por qué aún no se ejecutó.

---

# 6. Estrategia Algorítmica

## 6.1 Conexión inicial

```text
Usuario solicita conectar
        ↓
Validar sesión web y provider
        ↓
Reservar intento por user + provider
        ↓
Crear temporal 0700
        ↓
Iniciar adaptador oficial
        ↓
Entregar URL/código a UI
        ↓
Esperar confirmación
        ↓
Validar sesión
        ↓
Recoger archivo mínimo
        ↓
Cifrar
        ↓
Persistir versión 1
        ↓
Eliminar temporal
```

## 6.2 Ejecución normal

```text
Resolver provider + auth mode
        ↓
Resolver conexión del owner
        ↓
Verificar estado
        ↓
Leer blob + session_version
        ↓
Determinar si necesita refresh proactivo
        ↓
Materializar temporal exclusivo
        ↓
Ejecutar holder
        ↓
Recoger archivo mínimo
        ↓
Comparar con estado inicial
        ↓
Persistir cambio mediante CAS
        ↓
Eliminar temporal
```

## 6.3 Refresh coordinado

```text
Sesión próxima a vencer
        ↓
Adquirir lock corto user + provider
        ↓
Releer versión canónica
        ↓
¿Otro proceso ya refrescó?
   ├─ Sí → usar versión nueva
   └─ No → ejecutar refresh oficial
              ↓
           validar sesión
              ↓
           cifrar estado nuevo
              ↓
           CAS por session_version
              ↓
           liberar lock
```

## 6.4 Promoción reactiva

Aunque no se haya ejecutado refresh proactivo, el CLI puede modificar el archivo durante el run.

Al terminar:

1. calcular si el artefacto cambió;
2. cifrar el estado actualizado;
3. ejecutar CAS;
4. si pierde CAS:

   * descartar la rama;
   * conservar la versión canónica.

## 6.5 Desconexión

```text
Usuario solicita desconectar
        ↓
Bloquear nuevos consumidores
        ↓
Detectar runs activos
        ↓
Esperar o cancelar
        ↓
Materializar copia privada
        ↓
Logout oficial best-effort
        ↓
Eliminar blob local
        ↓
Eliminar temporales
        ↓
Liberar bloqueo
        ↓
Estado not_connected
```

## 6.6 Cutover

```text
Validar nueva conexión personal
        ↓
Validar ejecución real
        ↓
Confirmar cero fallback legacy
        ↓
Detener nuevos runs
        ↓
Esperar finalización de activos
        ↓
Logout legacy best-effort
        ↓
Eliminar archivos dedicados
        ↓
Retirar variables legacy
        ↓
Reiniciar servicio
        ↓
Ejecutar smoke test personal
```

---

# 7. Technical Considerations

## 7.1 Modelo de datos

Tabla propuesta:

```text
user_ai_oauth_connections
```

Campos conceptuales:

```text
id
user_id
provider
encrypted_session
session_version
status
created_at
updated_at
last_validated_at
reauth_required_at
```

Restricción única:

```text
unique (user_id, provider)
```

Restricciones de dominio:

```text
provider in ('claude', 'codex')
status in ('connected', 'reauth_required')
session_version > 0
```

La ausencia de fila representa `not_connected`.

## 7.2 Blob cifrado

`encrypted_session` contiene únicamente:

### Claude

```text
.credentials.json
```

### Codex

```text
auth.json
```

Se recomienda un envelope versionado:

```ts
interface EncryptedOAuthSessionEnvelope {
  version: number;
  provider: "claude" | "codex";
  ciphertext: string;
  iv: string;
  authTag: string;
}
```

No almacenar secretos duplicados fuera del envelope.

## 7.3 Compare-and-swap

Toda actualización debe condicionar por:

```text
id + session_version
```

Ejemplo conceptual:

```sql
update user_ai_oauth_connections
set
  encrypted_session = $new_blob,
  session_version = session_version + 1,
  updated_at = now()
where
  id = $id
  and session_version = $expected_version;
```

Una fila afectada igual a cero representa conflicto.

## 7.4 Single-flight

En la VPS única actual puede implementarse inicialmente mediante coordinación in-memory por:

```text
user_id + provider
```

Esto es válido mientras exista una única instancia del backend.

Si el backend se replica:

* mover el lock a PostgreSQL;
* o utilizar un mecanismo distribuido equivalente.

El diseño no debe bloquear una futura migración.

## 7.5 Registry de login

En una única instancia puede mantenerse un registry transitorio con:

```text
user_id
provider
attempt_id
process/login_id
expires_at
temporary_directory
status
```

No contiene secretos persistentes.

Debe limpiarse:

* al completar;
* al cancelar;
* al vencer;
* al reiniciar, mediante limpieza de temporales huérfanos.

## 7.6 Claude login adapter

Responsabilidades:

* crear `CLAUDE_CONFIG_DIR`;
* iniciar proceso;
* capturar URL;
* aceptar código;
* escribir en stdin una sola vez;
* terminar/cancelar;
* validar `auth status`;
* recoger `.credentials.json`.

Interfaces conceptuales:

```ts
startLogin(userId): Promise<LoginChallenge>
submitLoginCode(attemptId, code): Promise<LoginCompletion>
cancelLogin(attemptId): Promise<void>
```

## 7.7 Codex login adapter

Responsabilidades:

* crear `CODEX_HOME`;
* configurar store en archivo;
* iniciar app-server;
* ejecutar `account/login/start`;
* emitir challenge;
* observar `account/login/completed`;
* cancelar mediante `account/login/cancel`;
* validar mediante `account/read`;
* recoger `auth.json`.

## 7.8 OAuth session runtime

Responsabilidades conceptuales:

```ts
resolveConnection(userId, provider)
materializeSession(connection)
collectUpdatedSession(materialized)
promoteSession(connectionId, expectedVersion, updatedBlob)
markReauthRequired(connectionId)
cleanupMaterializedSession(materialized)
```

No crear un framework genérico más amplio que Claude y Codex.

## 7.9 Executors

### ClaudeCodeExecutor

Debe:

* recibir o resolver el directorio materializado;
* utilizarlo en el holder;
* mantener restricciones de flags;
* permitir escritura al directorio;
* no leer el caché global.

### CodexExecutor

Debe corregirse para:

* no iniciar login durante un run;
* usar `account/read`;
* operar con sesión ya materializada;
* mantener el app-server como canal de ejecución;
* no leer el caché global.

## 7.10 Directorios temporales

Requisitos:

* nombre impredecible;
* propietario del proceso del Orquestador;
* modo `0700`;
* archivo `0600`;
* no reutilización;
* no exposición en logs;
* eliminación recursiva en `finally`;
* cleanup de huérfanos tras reinicio.

## 7.11 Capa holder/worker

Debe revisarse:

* montaje del directorio OAuth;
* acceso exclusivo del holder;
* variables permitidas;
* variables prohibidas del worker;
* lifecycle del mount;
* cleanup posterior;
* que MCP/dynamic tools sigan funcionando.

**Hallazgo concreto de la revisión técnica (2026-08-02)**: la capa de aislamiento de tools ya
implementa este patrón de bloqueo por nombre de variable, pero solo para las credenciales de
`api_key` — verificado contra el código real:

```text
src/executor/isolated-tools/qaWorkerServer.ts
src/executor/isolated-tools/roleWorkerServer.ts
src/executor/isolated-tools/searchProxyServer.ts
src/executor/isolated-tools/worker.ts
```

Cada uno de estos archivos rechaza el arranque del worker (`SECRET_IN_WORKER_ENV:<nombre>`) si
detecta `ANTHROPIC_API_KEY` o `CODEX_API_KEY` en su propio `process.env`. `CLAUDE_CONFIG_DIR` y
`CODEX_HOME` (las variables que esta Feature usa para apuntar el holder al directorio OAuth
materializado, sección 5.9.7) **no están en esa lista todavía**. Deben agregarse a los cuatro
archivos, mismo patrón, mismo criterio -- el worker no debe poder ni siquiera detectar que existe
un directorio OAuth materializado, no solo no poder leerlo.

## 7.12 Pin de versiones

### Claude

Actualmente debe incorporarse:

* versión fija;
* idealmente digest de imagen;
* contract tests.

### Codex

Debe conservarse:

* versión fija;
* schema hash;
* contract tests.

## 7.13 Contract tests

Como mínimo:

### Claude

* comando de login;
* salida esperada de URL;
* `auth status`;
* artefacto mínimo;
* flags prohibidos;
* holder con MCP;
* refresh;
* logout.

### Codex

* app-server schema;
* `chatgptDeviceCode`;
* `account/login/completed`;
* `account/read`;
* artefacto mínimo;
* holder con dynamic tool;
* refresh;
* logout.

Un cambio incompatible debe bloquear el upgrade.

## 7.14 API backend

Endpoints conceptuales:

```text
GET    /api/ai-connections
POST   /api/ai-connections/:provider/login
POST   /api/ai-connections/:provider/login/code
DELETE /api/ai-connections/:provider/login
DELETE /api/ai-connections/:provider
```

Las rutas definitivas deben seguir las convenciones del backend existente.

Nunca exponen:

* tokens;
* blobs;
* emails;
* account IDs;
* rutas internas.

## 7.15 UI

La pantalla de configuración debe mostrar por proveedor:

```text
No conectado
Conectado
Requiere reautenticación
```

Acciones:

```text
Autenticar
Cancelar autenticación
Reautenticar
Desconectar
```

Para Codex device code:

* URL;
* código;
* vencimiento.

Para Claude:

* URL;
* campo para código;
* confirmación.

La conexión se configura una vez por usuario, no por proyecto.

## 7.16 Errores funcionales

Como mínimo:

```text
not_connected
reauth_required
connection_in_progress
login_cancelled
login_expired
login_failed
session_corrupted
session_promotion_conflict
provider_unavailable
cli_contract_incompatible
active_runs_using_connection
```

Los mensajes de CLI deben mapearse a estos errores sin exponer secretos.

## 7.17 Observabilidad

Se pueden registrar:

* provider;
* user ID interno;
* connection ID;
* attempt ID;
* session version;
* resultado del refresh;
* CAS ganado o perdido;
* estado funcional;
* duración.

No se registran:

* access token;
* refresh token;
* código completo;
* blob;
* email;
* account ID externo;
* contenido del archivo de sesión.

## 7.18 Cutover y cleanup legacy

El procedimiento debe identificar con precisión:

* variables configuradas;
* rutas reales;
* volúmenes;
* temporales;
* copias manuales;
* procesos activos.

Debe utilizar logout oficial cuando sea posible antes de borrar.

No debe depender de que logout remoto tenga éxito para completar la eliminación local.

Debe documentarse evidencia de:

* rutas eliminadas;
* variables retiradas;
* servicio reiniciado;
* nueva conexión validada;
* ausencia de fallback.

## 7.19 Dependencias

* FEATURE-015 — holder/worker y aislamiento.
* FEATURE-016 — `authMode` y wiring inicial.
* FEATURE-025 Parte 1 — configuración, UI base y clave de cifrado.
* FEATURE-025 Parte 3 — consumirá Parte 2 para OAuth del rol `intake`.

Parte 3 depende de Parte 2.

Parte 2 no depende de Parte 3.

---

# 8. Validation Criteria

## Scenario 1 — Conexión Claude

**Input**

Usuario autenticado pulsa **Autenticar Claude**.

**Expected output**

* Se inicia un único intento.
* Se muestra URL.
* El código se acepta por endpoint autenticado.
* `auth status` confirma conexión.
* Se persiste blob cifrado.
* El temporal se elimina.
* La UI muestra `Conectado`.

## Scenario 2 — Conexión Codex

**Input**

Usuario pulsa **Autenticar Codex**.

**Expected output**

* Se inicia device flow.
* Se muestra URL, código y vencimiento.
* `account/login/completed` confirma éxito.
* `account/read` confirma cuenta.
* `auth.json` se cifra.
* La UI muestra `Conectado`.

## Scenario 3 — Segundo intento simultáneo

**Input**

Usuario intenta conectar nuevamente el mismo proveedor.

**Expected output**

Se devuelve `connection_in_progress`.

## Scenario 4 — Cancelación de login

**Expected output**

* El proceso se cancela.
* El temporal se elimina.
* No se crea fila.
* El estado vuelve a `not_connected`.

## Scenario 5 — Login vencido

**Expected output**

* El intento se elimina al vencer el TTL.
* No se crea conexión.
* Puede iniciarse otro intento.

## Scenario 6 — Claude OAuth en run

**Input**

Rol configurado con Claude + `cli_session`.

**Expected output**

* Se resuelve conexión del owner.
* Se reconstruye `.credentials.json`.
* El holder ejecuta con MCP.
* El worker no recibe OAuth.
* Se elimina el temporal.

## Scenario 7 — Codex OAuth en run

**Input**

Rol configurado con Codex + `cli_session`.

**Expected output**

* Se reconstruye `auth.json`.
* El run usa `account/read`.
* No ejecuta `account/login/start`.
* La dynamic tool funciona.
* Se elimina el temporal.

## Scenario 8 — Sin conexión

**Expected output**

* Falla como `not_connected`.
* No usa caché global.
* No usa API key.

## Scenario 9 — Reautenticación requerida

**Expected output**

* Falla como `reauth_required`.
* La UI habilita **Reautenticar**.
* No se ejecuta al agente.

## Scenario 10 — Refresh Claude

**Input**

Sesión próxima a vencer.

**Expected output**

* Se ejecuta un único refresh.
* Rotan los datos correspondientes.
* Se promueve nueva versión.
* El run termina correctamente.

## Scenario 11 — Refresh Codex

**Expected output**

* Se ejecuta refresh oficial.
* Se recoge `auth.json`.
* Se promueve mediante CAS.

## Scenario 12 — Dos refresh Claude simultáneos

**Expected output**

* Solo uno ejecuta el refresh remoto.
* El otro reutiliza el estado promovido.
* No se corrompe la sesión.

## Scenario 13 — Dos refresh Codex simultáneos

**Expected output**

* La coordinación evita promoción divergente.
* Existe una única versión canónica.

## Scenario 14 — Dos usuarios Claude

**Expected output**

* Directorios diferentes.
* Identidades diferentes.
* Ejecución paralela.
* Cero contaminación.

## Scenario 15 — Dos usuarios Codex

Mismo resultado esperado que el escenario anterior.

## Scenario 16 — Dos runs del mismo usuario

**Expected output**

* Temporales independientes.
* Runs normales paralelos.
* Promoción protegida.

## Scenario 17 — Pérdida de CAS

**Expected output**

* La rama local se descarta.
* Se conserva la versión canónica.
* No se sobrescribe estado nuevo con estado antiguo.

## Scenario 18 — Conexión corrupta

**Expected output**

* No se materializa.
* Se marca `reauth_required`.
* Se genera alerta operativa.
* No se expone el contenido.

## Scenario 19 — Desconexión sin runs activos

**Expected output**

* Se ejecuta logout best-effort.
* Se elimina blob.
* Se eliminan temporales.
* Estado `not_connected`.

## Scenario 20 — Desconexión con runs activos

**Expected output**

* Se bloquean nuevos runs.
* La UI informa consumidores activos.
* El usuario puede esperar o cancelar.
* No se ejecuta logout hasta drenar.

## Scenario 21 — Logout remoto fallido

**Expected output**

* La fila local igualmente se elimina.
* Se informa la limitación.
* No vuelven a ejecutarse runs OAuth.

## Scenario 22 — Retry tras refresh

**Expected output**

El retry conserva provider/model/auth mode y utiliza la conexión canónica renovada.

## Scenario 23 — Retry tras desconexión

**Expected output**

Falla como `not_connected`.

## Scenario 24 — Caché global presente

**Input**

La VPS aún contiene un caché legacy.

**Expected output**

El runtime no lo consulta.

## Scenario 25 — Cutover Claude

**Expected output**

* Nueva conexión personal validada.
* Logout legacy best-effort.
* Archivo legacy eliminado.
* Variable retirada.
* Servicio reiniciado.
* Smoke test exitoso.

## Scenario 26 — Cutover Codex

Mismo resultado cuando exista caché legacy de Codex.

## Scenario 27 — Ausencia de secretos

En login, ejecución, refresh, error, logout y cleanup:

* no aparecen tokens;
* no aparece blob;
* no aparece código completo;
* no aparece identidad externa.

## Scenario 28 — Contract incompatible

**Input**

Upgrade de CLI con contrato diferente.

**Expected output**

* Contract test falla.
* La versión no se despliega.
* No se reinterpretan artefactos automáticamente.

## Validation Evidence

Debe aportarse:

* conexión UI Claude;
* conexión UI Codex;
* blobs cifrados;
* directorios y permisos;
* holder Claude con MCP;
* holder Codex con dynamic tool;
* worker sin OAuth;
* refresh real de ambos;
* CAS y single-flight;
* dos usuarios simultáneos;
* mismo usuario con dos runs;
* desconexión;
* reautenticación requerida;
* ausencia de fallback;
* cutover legacy;
* cleanup de VPS;
* contract tests;
* ausencia de secretos en logs.

---

# 9. Risks

## Riesgo 1 — Exposición del bearer OAuth

El blob permite actuar como el usuario.

**Mitigación**

* cifrado;
* acceso mínimo;
* temporales efímeros;
* holder/worker;
* logs sanitizados;
* permisos restrictivos;
* backups protegidos.

## Riesgo 2 — Refresh concurrente Claude

Dos refresh del mismo token pueden invalidar una rama.

**Mitigación**

Single-flight obligatorio.

## Riesgo 3 — Ramas divergentes Codex

Dos refresh pueden producir estados distintos.

**Mitigación**

Single-flight y CAS.

## Riesgo 4 — Pérdida de actualización

Una ejecución antigua puede intentar sobrescribir una nueva.

**Mitigación**

`session_version` y compare-and-swap.

## Riesgo 5 — Directorios compartidos

Producirían carreras y cleanup cruzado.

**Mitigación**

Temporal exclusivo por invocación.

## Riesgo 6 — CLI no pineado

Claude podría cambiar contratos tras un rebuild.

**Mitigación**

Pin de versión, imagen y contract tests.

## Riesgo 7 — App-server experimental

Codex puede cambiar schemas.

**Mitigación**

Pin, schema hash y tests previos a upgrade.

## Riesgo 8 — Logout afecta copias activas

Puede revocar la familia de refresh tokens.

**Mitigación**

Drenar o cancelar runs antes de logout.

## Riesgo 9 — Logout remoto incompleto

No todos los proveedores garantizan invalidación total.

**Mitigación**

Borrado local garantizado y comunicación clara.

## Riesgo 10 — Device code deshabilitado

Algunas cuentas o workspaces pueden bloquearlo.

**Mitigación**

Error accionable. Browser callback queda como ampliación futura.

## Riesgo 11 — Riesgo contractual de Claude

Anthropic puede limitar integraciones de terceros que utilicen credenciales de planes personales.

**Tratamiento**

* permitido técnicamente;
* uso interno sujeto a aceptación del owner;
* lanzamiento público sujeto a revisión legal o confirmación del proveedor.

## Riesgo 12 — Estado legacy residual

Archivos globales podrían permanecer en la VPS después del cutover.

**Mitigación**

Procedimiento y evidencia obligatorios de cleanup.

## Riesgo 13 — Borrado excesivo

Eliminar `~/.claude` o `~/.codex` podría afectar usos personales no relacionados.

**Mitigación**

Eliminar únicamente rutas dedicadas confirmadas.

## Riesgo 14 — Reinicio durante login

Puede dejar procesos o temporales huérfanos.

**Mitigación**

TTL, cleanup de arranque y registry transitorio.

## Riesgo 15 — Reautenticación inesperada

El proveedor puede revocar o expirar refresh tokens.

**Mitigación**

Estado `reauth_required` y flujo sencillo de reautenticación.

## Riesgo 16 — Scope excesivo

La Feature combina UI, runtime, cifrado, concurrencia y cutover.

**Evaluación**

El alcance es amplio, pero corresponde a un único capability indivisible:

> convertir `cli_session` global en una conexión personal segura y operable.

Separar arbitrariamente login, refresh y persistencia dejaría estados intermedios inseguros o no utilizables.

La implementación puede organizarse en etapas internas, pero el Approval Gate y la validación deben evaluar el capability completo.

---

# 10. Approval Gate

La implementación permanece prohibida hasta aprobación humana explícita.

Antes de aprobar deben cerrarse estas decisiones:

1. **Riesgo contractual Claude**

   * Autorizar uso interno/privado.
   * Definir requisito de revisión antes de lanzamiento público.

2. **Codex**

   * Confirmar device code como único flujo inicial.
   * Dejar browser callback fuera de esta versión.

3. **Desconexión**

   * Confirmar UX:

     * esperar runs;
     * o cancelarlos;
     * nunca revocar mientras sigan activos.

4. **Modelo de datos**

   * Nombre definitivo de tabla.
   * Campos finales.
   * Restricciones.
   * Migración asignada.

5. **Estados**

   * Confirmar solo:

     * `connected`;
     * `reauth_required`;
     * ausencia de fila como `not_connected`.

6. **Single-flight**

   * Confirmar implementación in-memory para la VPS única.
   * Documentar evolución al replicar backend.

7. **CAS**

   * Confirmar contrato y tratamiento de conflicto.

8. **Cifrado**

   * Confirmar envelope y AAD.
   * Confirmar reutilización de `AI_CREDENTIAL_ENCRYPTION_KEY`.

9. **Claude**

   * Confirmar pin de versión.
   * Confirmar flags permitidos y prohibidos.

10. **Codex**

    * Confirmar corrección de `account/login/start`.
    * Confirmar `account/read` en ejecución.

11. **UI**

    * Confirmar experiencia de login de ambos proveedores.
    * Confirmar mensajes de estados y errores.

12. **Cutover legacy**

    * Confirmar que forma parte del cierre de Parte 2.
    * Identificar rutas reales antes de borrar.
    * Confirmar que no se migrará la sesión global.
    * Confirmar logout y eliminación controlada.

13. **Criterios de validación**

    * Confirmar evidencia real en VPS.
    * Confirmar pruebas con dos identidades.
    * Confirmar refresh real.
    * Confirmar cleanup legacy.

14. **Parte 3**

    * Confirmar que el rol `intake` consumirá esta infraestructura en FEATURE-025 Parte 3 y no amplía el alcance de Parte 2.

**Estado del gate:** cerrado — diseño completo, revisado técnicamente y aprobado explícitamente.

## 10.1 Resultado de la validación E2E en vivo (2026-08-03)

Validada punta a punta en el VPS por el owner, con cuentas reales de Claude y Codex conectadas por
OAuth. Circuito completo ejercitado: Architect (roadmap de dos releases) → Functional → Planning →
loop Developer↔QA → aprobación de merge (Modo Manual) → cierre de release r1 → continuación al
release r2 (Activo) → mismo circuito completo de nuevo → resuelto. Confirmado en la práctica:

* Conexión/desconexión OAuth por usuario y proveedor desde `/settings/agents`, incluyendo el aviso
  de runs activos al desconectar.
* Materialización/promoción de la sesión funcionando de punta a punta (sin pérdida ni corrupción del
  archivo de sesión a través de múltiples fases e invocaciones).
* Bloqueo del worker verificado indirectamente: ninguna fase filtró `CLAUDE_CONFIG_DIR`/`CODEX_HOME`.

La validación en vivo encontró y corrigió, en el camino, varios bugs reales — algunos específicos de
OAuth, otros preexistentes pero nunca antes ejercitados con el circuito completo + credenciales
reales por usuario. Detalle completo de cada uno en la entrada de `docs/ROADMAP.md`
(`### ✅ FEATURE-025-Parte-2`). Resumen:

1. `git push` de la aprobación de merge (Modo Manual) fallaba con "Invalid username or token" —
   `mergeFeatureBranchIntoBase` nunca recibía `gitAuth`, a diferencia de `pushRunBranch`/
   `cloneRunRepository`. Corregido (parámetro `gitAuth` opcional threaded desde
   `respondMergeApproval`).
2. El handler de errores genérico de Express (`app.ts`) no logueaba nada — un 500 real era invisible
   en `journalctl`. Corregido.
3. `isNotApplicableOutput` solo reconocía la forma objeto (`{notApplicable: true}`), que
   `PHASE_RESULT_SCHEMA` de `CodexExecutor` no puede producir (`outputArtifact` restringido a
   `string|null`) — la señal de "esta escalación no me corresponde" se perdía, causando que Architect
   re-propusiera un roadmap ya cerrado desde cero. Corregido reconociendo también la forma string
   embebida ("NO_APLICA: true").
4. La base de worktrees se anidaba en cadena (`ai-orchestrator-worktrees` repetido hasta 4 veces) en
   runs con varios reingresos — el default dependía de `repoRoot`, que en el flujo real
   "standalone-clone" es el worktree del run padre. Corregido con una base estable independiente de
   `repoRoot` (`defaultWorktreesBaseDir`, mismo criterio que `cloneRunRepository`).
5. Sesión OAuth de Claude fallaba con "API Error: 400 Invalid effort level" en cuentas donde el
   nivel de esfuerzo por default del CLI no está habilitado. Corregido fijando `--effort medium`
   para `cli_session`.
6. El modelo real ejecutado podía diferir silenciosamente del configurado, por remapeo del propio
   Claude Code cuando la cuenta conectada no tiene el modelo pedido disponible (comportamiento
   documentado oficialmente; el aviso se suprime bajo `--output-format json`). Mitigado traduciendo
   el modelo configurado a su alias genérico (`opus`/`sonnet`/`haiku`) solo para `cli_session` —
   sigue siendo una limitación de la cuenta/organización conectada cuando esta restringe modelos, no
   del código (confirmado: con una cuenta personal sin esa restricción, el modelo real coincide con
   el configurado).
7. Catálogo de modelos de Codex desactualizado (faltaba `gpt-5.6-terra`) — corregido contra la
   documentación oficial vigente.

**No ejecutado en esta sesión, explícitamente pendiente de confirmación separada del owner:** el
cutover legacy (borrado del caché OAuth global anterior en el VPS, sección 5.18/6.6) — es
destructivo y el propio diseño lo exige como paso separado y validado.
