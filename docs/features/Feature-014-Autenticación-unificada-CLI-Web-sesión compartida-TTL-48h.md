# FEATURE-014 — Autenticación unificada CLI + Web (sesión compartida, TTL 48h)

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)
Versión de este documento: v3 — incorpora la segunda ronda de precisiones de Codex (límite exacto
del `try/catch`, fallo de borrado post-revocación, orden y escritura atómica del re-login).

> **Nota de proceso**: v1 → validación de Codex (5 puntos) → v2 → segunda validación de Codex
> (3 precisiones adicionales, sin rediseño) → v3. Pendiente de Approval Gate conjunto entre el
> owner y Codex.

---

## 1. Feature Identity

- **Name**: Autenticación unificada CLI + Web (sesión compartida, TTL 48h)
- **Type**: Backend (autenticación / seguridad) — sin UI nueva
- **Owner**: asdru
- **Status**: En diseño — borrador v3, precisado por dos rondas de validación de Codex
- **Priority**: Alta relativa — cierra una brecha de seguridad real (sesión CLI no revocable,
  sin validación server-side) detectada al auditar el estado post-013B.

---

## 2. Problem Statement

(sin cambios respecto a v2)

FEATURE-013B introdujo un mecanismo de sesión real para la web: tabla `sessions`
(`migrations/0007_web_sessions.sql`), validación server-side en `src/auth/webSession.ts`
(`authenticateWebRequest`), y revocación real vía `logout`.

El CLI (`src/auth/session.ts`, de Feature 10) nunca se migró a ese mecanismo. Sigue guardando
`{userId, token, createdAt, expiresAt}` en `~/.orquestador/session.json`, con TTL de 30 días.
`readValidSession()` solo valida el archivo por fecha — no consulta la base, no hay lookup contra
`sessions`, y `logout.ts` solo borra el archivo local: no revoca nada del lado del servidor.

Hoy son dos mecanismos de autenticación paralelos con garantías de seguridad muy distintas para
el mismo concepto (una sesión de usuario).

## 3. Functional Goal

(sin cambios respecto a v2)

El CLI debe autenticarse contra el mismo mecanismo server-side que ya usa la web: la misma tabla
`sessions`, el mismo contrato de hash y el mismo TTL (48 horas). El transporte del secreto sigue
siendo un archivo local, pero ese secreto debe representar una fila real y revocable, y la
identidad del usuario debe determinarse siempre desde la base, nunca desde el archivo local.

## 4. Scope

### Incluido
1. Renombrar `createWebSession`/`getWebSessionById`/`revokeWebSession` a
   `createSessionRow`/`getSessionById`/`revokeSession` — confirmado seguro en el mismo PR por
   Codex (dos rondas).
2. Módulo compartido `src/auth/sessionCore.ts` con `SESSION_TTL_MS`, generación de `rawToken` y
   hash SHA-256 — confirmado como ubicación adecuada por Codex, ninguna abstracción existente
   mejor.
3. `login.ts` (CLI): usa `sessionCore` + `createSessionRow`, sigue el **orden preciso de la Regla
   4** (ver abajo) para no dejar sesiones huérfanas ni tocar el archivo si falla el login.
4. `session.ts` (CLI) — `readValidSession()` reescrito: valida el archivo con el límite exacto de
   la Regla 2, hace lookup por `sessionId`, valida `revoked_at`/`expires_at`, compara hash, y
   devuelve **`session.user_id` directo de la fila** (Regla 1 — sin `findUserById`, innecesario
   para el CLI).
5. `logout.ts` (CLI): revoca primero en DB, borra el archivo después, con manejo explícito de los
   4 casos de la Regla 3 (incluido el borrado fallido post-revocación).
6. TTL unificado a 48 horas para ambos canales, vía `sessionCore.ts`.
7. Suite de tests de CLI: token alterado, fila revocada, fila inexistente (tratada igual que
   revocada), identidad local manipulada, formato viejo/corrupto (incluyendo `null`/array/
   primitivos/string vacío/fecha inválida), error de DB durante logout, borrado local fallido tras
   revocación exitosa, re-login con sesión previa activa, login fallido preservando la sesión
   existente, doble logout consecutivo.
8. Sin cambios de firma en los comandos consumidores (`runStart.ts`, `runStatus.ts`,
   `runRespond.ts`).

### Excluido
1. Refresh tokens.
2. UI de administración de sesiones.
3. Rate limiting de login CLI.
4. Cambios al mecanismo de `password_hash` (bcrypt).
5. TTL diferenciado por canal.
6. Compatibilidad transparente con el formato de archivo anterior.
7. **Exclusión mutua entre comandos `login`/`logout` concurrentes del mismo usuario** (sin
   locking) — confirmado por Codex como fuera de alcance dado el criterio de cambio mínimo; el
   riesgo residual es un crash entre escribir el archivo nuevo y revocar la sesión anterior
   (Regla 4), aceptado como best-effort.
8. `findUserById()` en el flujo CLI — el web lo necesita para construir un `UserRow` completo; el
   CLI solo necesita el identificador para autorizar consultas, no se impone la misma necesidad.

### Future ideas
- Listado real de sesiones activas por usuario (web + CLI) con revocación remota.
- Refresh token si el TTL de 48h genera fricción real de uso en el CLI.
- Locking entre comandos de sesión concurrentes, si el riesgo residual de la Regla 4 resulta
  problemático en la práctica (hoy no se espera que lo sea).

---

## 5. Functional Rules

1. **Identidad siempre desde la DB, nunca desde el archivo.** `readValidSession()` devuelve
   `userId = session.user_id` directo de la fila validada. No se llama a `findUserById()` — el CLI
   no necesita un `UserRow` completo, solo el identificador para autorizar consultas; no existe hoy
   un estado de usuario deshabilitado que deba comprobarse por ese camino. (Distinto del flujo web,
   que sí construye `UserRow` completo — no se le impone esa necesidad al CLI.)

2. **Límite exacto de validación del archivo local, sin filtrar hacia la DB.** El bloque que valida
   el archivo debe cubrir, y terminar ahí:
   - `readFile` (archivo inexistente/ilegible).
   - `JSON.parse` (JSON corrupto).
   - Comprobación de que el resultado parseado es un objeto (rechazar `null`, arrays, valores
     primitivos, strings vacíos).
   - Validación explícita de tipos y presencia de `sessionId`/`rawToken`/`userId`/`createdAt`/
     `expiresAt`.
   - Fecha inválida: rechazar si `Number.isNaN(Date.parse(session.expiresAt))`.

   Este bloque **no debe envolver el lookup a la DB**. Una caída de Postgres durante la
   validación server-side no debe convertirse en el mismo mensaje de "sesión inexistente" — debe
   propagarse como error operativo distinto (ver Regla 3 para el caso análogo en logout;
   `readValidSession()` debe seguir el mismo criterio: fallo de archivo → mensaje de sesión
   inexistente; fallo de DB → error operativo explícito, no silenciado).

3. **Logout: revocar primero, borrar después — los 4 casos.**
   - Archivo ilegible/inválido → "No había sesión local para cerrar." (sin tocar DB).
   - DB no disponible al intentar revocar → error operativo explícito ("No se pudo revocar la
     sesión en el servidor: `<error>`. El archivo local no fue eliminado.") — archivo **no se
     borra**.
   - Fila ya revocada, expirada, **o inexistente** → tratado como éxito idempotente por igual (una
     fila inexistente no es un error distinto de una ya revocada) → continuar a borrar el archivo.
   - Revoca con éxito, pero `rm(session.json)` falla (permisos/I/O) → informar explícitamente:
     "La sesión fue revocada en el servidor, pero no se pudo eliminar el archivo local: `<error>`."
     — no imprimir simplemente "Sesión cerrada" en este caso, aunque la sesión ya esté segura.
   - Revoca con éxito y el borrado del archivo también tiene éxito → "Sesión cerrada."
   - **Doble logout consecutivo**: la segunda ejecución, sin archivo local (ya borrado por la
     primera), da como resultado "No había sesión local para cerrar." — no un error, no intenta
     "borrar el archivo" de nuevo (corrección respecto a la v2, que tenía esto ambiguo en
     Validation Criteria).

4. **Re-login: orden preciso y escritura atómica, sin garantía transaccional absoluta.**

   Orden obligatorio:
   1. Validar credenciales (`verifyPassword`) — nada de lo siguiente ocurre si esto falla
      (ver Regla 5).
   2. Leer y conservar referencia a la sesión anterior, si existe un archivo local válido.
   3. Crear la fila nueva en `sessions`.
   4. Escribir el archivo nuevo de forma **atómica**: archivo temporal con permisos `0600` +
      `rename()` — nunca truncar el archivo anterior antes de tener el contenido nuevo listo.
   5. Revocar **best-effort** la sesión anterior (la de paso 2).

   Con este orden: si crear la fila (paso 3) o escribir el archivo (paso 4) falla, la sesión
   anterior sigue siendo utilizable (no se tocó todavía), y si se llegó a crear la fila nueva sin
   poder escribir el archivo, esa fila se revoca como compensación. Si la revocación compensatoria
   (paso 5, o la compensación por fallo de escritura) también falla, se reporta explícitamente sin
   ocultar el error original — nunca se silencia una revocación fallida detrás de otro mensaje.

   **Garantía explícitamente best-effort, no transaccional**: el riesgo residual es un crash entre
   los pasos 4 y 5 (archivo nuevo ya escrito, sesión anterior todavía no revocada) — se acepta como
   riesgo residual conocido, no se resuelve con locking ni transacciones distribuidas (fuera de
   alcance, Excluido #7).

5. **Login fallido no toca la sesión existente.** Confirmado sin ajustes: el flujo valida usuario
   y contraseña completamente (`verifyPassword`) antes de que cualquier revocación, creación de
   fila, o escritura de archivo pueda comenzar (Regla 4, paso 1 es una condición de entrada, no un
   paso intercambiable). Con credenciales inválidas, no hay camino que toque el archivo local
   existente.

---

## 6. Estrategia Algorítmica

No aplica.

---

## 7. Technical Considerations

- Rename de `createWebSession`/`getWebSessionById`/`revokeWebSession` — confirmado seguro en el
  mismo PR por Codex en dos rondas de validación, sin objeciones nuevas.
- `sessionCore.ts` — confirmado como ubicación y nombre adecuados, sin abstracción existente
  mejor.
- Único impacto operacional real: los archivos `session.json` emitidos antes de esta Feature
  quedan inválidos y exigen re-login.
- Consumidores reales confirmados de `readValidSession()`: `runStart.ts`, `runStatus.ts`,
  `runRespond.ts`. `login.ts` usa `createSessionRow` directamente; `logout.ts` usa `revokeSession`
  directamente.
- Los permisos `0600` del archivo ya se usan desde Feature 10. El reemplazo atómico mediante
  temporal + `rename` es una extensión acotada de ese mecanismo.

---

## 8. Validation Criteria

| Escenario | Input | Salida esperada |
|---|---|---|
| Login CLI correcto | `handle`+password válidos, sin sesión previa | Fila creada, archivo con `{sessionId, rawToken, userId, createdAt, expiresAt}`, TTL +48h |
| Login CLI incorrecto, sin sesión previa | Password inválida | Sin fila, sin archivo |
| Login CLI incorrecto, con sesión previa válida | Password inválida, ya existía un archivo local válido | Sin fila nueva; archivo existente intacto |
| Re-login con sesión previa válida | Login correcto, ya existía sesión activa | Fila anterior revocada best-effort; fila nueva creada mediante el orden de la Regla 4; archivo reemplazado atómicamente |
| Comando CLI con sesión válida | `run:status` | Ejecuta normalmente |
| Comando CLI con sesión expirada | Archivo con `expiresAt` vencido | Rechazo, mensaje estándar |
| Comando CLI con sesión revocada | `logout` ejecutado, se reintenta un comando con copia del archivo ya borrado | Rechazo |
| Identidad manipulada en archivo local | `userId` editado a mano, `sessionId`/`rawToken` válidos | Se usa `session.user_id` real de la fila, ignora el campo editado |
| Formato antiguo / JSON corrupto / `null` / array / string vacío / fecha inválida | Cualquiera de estos en el archivo | Rechazo, mismo mensaje que "sesión inexistente" — **sin** involucrar la DB |
| Logout con DB no disponible | `logout` sin conexión a la base | Error operativo explícito; archivo local no se borra |
| Logout con sesión ya revocada, expirada, o **fila inexistente** | `logout` con cualquiera de estos tres estados | Tratado por igual como éxito idempotente; borra el archivo |
| **Logout con revocación exitosa pero `rm()` fallido** | Revoca OK, borrado de archivo falla por permisos/I/O | Mensaje explícito: sesión revocada en servidor, archivo no eliminado, `<error>` — **no** "Sesión cerrada" sin más |
| **Doble logout consecutivo** | Segundo `logout` sin archivo local (ya borrado) | "No había sesión local para cerrar." — no error, no intenta borrar de nuevo |
| `sessionId` correcto, `rawToken` incorrecto | Archivo con `rawToken` alterado | Rechazo |
| Regresión sesión web | Flujo completo de 013B sin tocar nada de web | Comportamiento observable idéntico al actual |
| Fallo de DB durante `readValidSession()` (no durante logout) | Postgres caído al validar sesión en `run:status` | Error operativo distinto del mensaje de "sesión inexistente" — no debe confundirse con archivo inválido |

### Validation Evidence

Evidencia real esperada: (1) login CLI real, (2) comando exitoso, (3) `logout` real, (4) reintento
del comando con copia del archivo previamente válido — confirmar rechazo. Adicionalmente: forzar
un fallo de `rm()` (permisos) tras un logout exitoso y confirmar el mensaje distinto; ejecutar
`logout` dos veces seguidas y confirmar que la segunda da "No había sesión local para cerrar" sin
error.

---

## 9. Risks

- Rename/generalización de funciones ya usadas en producción por el flujo web — mitigar cubriendo
  ambos flujos en la misma validación, mismo PR.
- Bajar el TTL del CLI a 48h introduce fricción real de re-login — asumido conscientemente.
- Dependencia de conexión a DB para validar sesión CLI — coherente con el resto del CLI hoy, pero
  bloquea cualquier uso futuro offline del CLI.
- **Riesgo residual explícitamente aceptado**: crash entre escribir el archivo nuevo (Regla 4,
  paso 4) y revocar la sesión anterior (paso 5) puede dejar ambas sesiones (nueva y anterior)
  activas simultáneamente hasta que la anterior expire por TTL. Aceptado como best-effort, no
  transaccional — no se resuelve con locking (Excluido #7).

---

## 10. Approval Gate

Implementación prohibida hasta aprobación explícita y conjunta del owner con Codex.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.
