# FEATURE-013 — Capa de UI "Run en curso" — Parte 013B: Sesiones web

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: Parte 013B de FEATURE-013 (misma Feature de Roadmap, división organizativa
> pedida por Codex). Depende de 013A (endpoints a proteger) pero es diseñable/implementable en
> paralelo. Habilita el despliegue público real de 013A — sin esta parte, 013A solo debe correr
> por túnel SSH (ver 013A, Regla 7 y Risks).

---

## 1. Feature Identity

- **Name**: Capa de UI "Run en curso" — Parte 013B: Sesiones web
- **Type**: Backend (autenticación / seguridad) + UI mínima de login/logout
- **Owner**: asdru
- **Status**: En diseño — borrador v2
- **Priority**: Alta relativa dentro de FEATURE-013 — bloquea cualquier despliegue público de
  013A y 013C.

---

## 2. Problem Statement

La sesión actual (`src/auth/session.ts`) vive en un archivo local del disco (`~/.orquestador/
session.json`) sin tabla `sessions` ni validación server-side del token — funciona para CLI en la
propia máquina, pero no sirve para un cliente web servido desde otro origen (Vercel). Este es,
además, el "otro mecanismo de autenticación" que ya estaba anotado como condición en
`docs/ROADMAP.md` para poder bajar el TTL de la sesión CLI de 30 días a 48hs en producción.

## 3. Functional Goal

Login por `handle` + password (reusando `users.password_hash`, ya existente) que emite una
sesión validada server-side, vía cookie, consumible desde el frontend de 013A en otro origen
(Vercel).

## 4. Scope

### Incluido
1. Migración: tabla `sessions` (Postgres).
2. `POST /auth/login` — valida contra `users.password_hash` (bcrypt), crea fila en `sessions`.
3. Middleware Express que valida la cookie de sesión en cada request y adjunta `userId` —
   reemplaza el mecanismo temporal de 013A (Regla 7 de 013A).
4. `POST /auth/logout` — revoca la sesión (borra o marca inválida la fila).
5. CORS restringido al dominio real de Vercel (no `*`).
6. TLS/reverse proxy en la VPS (dominio + certificado).
7. Rate limiting básico sobre `/auth/login`.
8. **UI mínima de login/logout** en el frontend de 013A (`web/src`) — un formulario simple
   (`handle` + password, botón de logout), agregado tras la validación de Codex: sin esto, la
   evidencia real exigida (login end-to-end desde el frontend desplegado en Vercel) no es
   implementable — 013A hoy no tiene ninguna pantalla de autenticación (`web/src` solo tiene
   `main.tsx` y `styles.css`). No es una pantalla nueva de producto, es el mínimo indispensable
   para poder probar 013B de punta a punta.

### Excluido
1. Reseteo de contraseña, 2FA, listado/administración de sesiones activas por el usuario — ideas
   futuras, no bloquean esta parte.
2. Reducir el TTL de la sesión **CLI** — no es esta tabla; queda igual, es un mecanismo aparte.

---

## 5. Functional Rules

1. **Token de sesión guardado hasheado** en `sessions` — con **SHA-256** (`node:crypto`, sin
   dependencias nuevas), no con `bcrypt`. Distinción importante: `password_hash` sí usa `bcrypt`
   (correcto ahí, porque una contraseña humana es de baja entropía y hay que encarecer
   artificialmente el brute-force). El `rawToken` de sesión es distinto — lo genera el servidor,
   aleatorio y de alta entropía (ej. 32 bytes), ya inadivinable por fuerza bruta sin importar la
   velocidad de comparación. Usar `bcrypt` ahí no suma seguridad real, pero sí un costo real: se
   ejecutaría en cada request autenticado (cada carga de la UI, cada reconexión de SSE). SHA-256
   sigue protegiendo contra un volcado de la base (no queda el token en texto plano) sin ese costo.

   **Contrato de lookup** (precisado tras la validación de Codex — un token puramente hasheado no
   es buscable en la base sin este esquema): la cookie contiene `sessionId.rawToken` (dos partes
   separadas por un punto). La tabla `sessions` guarda `id` (= `sessionId`, no secreto — es solo
   selector), `user_id`, `token_hash` (SHA-256 de `rawToken`), `expires_at`, `revoked_at`. El
   middleware de validación busca la fila por `id` (lookup directo, eficiente, no escanea toda la
   tabla) y **luego** compara el SHA-256 de `rawToken` contra `token_hash` — recién ahí la sesión
   se da por válida. `sessionId` solo, sin el `rawToken` correcto, no alcanza para autenticar nada.

2. **Cookie**: `httpOnly`, `Secure`, `SameSite=None` (obligatorio por ser origen cruzado
   Vercel↔VPS). `SameSite=None` sin `Secure` no funciona en navegadores modernos — refuerza la
   necesidad de TLS (Regla 6 de scope).

   **Contrato de credenciales cross-origin** (precisado tras la validación de Codex — la cookie
   sola no alcanza, el navegador no la manda por defecto entre orígenes distintos): son
   obligatorias las cuatro piezas juntas, o el login funciona en el servidor y falla en un
   navegador real:
   - Todo `fetch` del frontend hacia el backend debe incluir `{ credentials: "include" }` — esto
     incluye actualizar el `fetch` ya existente de 013A (`web/src/main.tsx`, línea 129), que hoy
     no lo tiene.
   - El `EventSource` del SSE debe crearse con `{ withCredentials: true }` — mismo caso, actualizar
     el `EventSource` ya existente de 013A (`web/src/main.tsx`, línea 150).
   - El servidor debe responder `Access-Control-Allow-Credentials: true`.
   - `Access-Control-Allow-Origin` debe ser el dominio exacto de Vercel — nunca `*` (`*` es
     incompatible con credenciales, el navegador lo rechaza igual aunque el servidor lo mande).

3. **TTL de la sesión web**: **48 horas** (no 30 días como el CLI). Es una superficie nueva,
   pública, de mayor exposición — amerita un TTL más corto desde el día uno, sin esperar a un
   endurecimiento posterior. No hay refresh automático en esta parte (al vencer, se re-loguea);
   refresh token queda como idea futura si la fricción de re-login cada 48hs resulta molesta en la
   práctica.

4. **Rate limiting de login**: límite simple en memoria (ej. 5 intentos por IP cada 15 minutos)
   — suficiente para un solo proceso Express en la VPS. No sobrevive a un reinicio del proceso ni
   escala a múltiples instancias; aceptable al estado actual del proyecto (un solo ambiente, ver
   `02-ARCHITECTURE.md`).

5. **CSRF**: dado que la cookie viaja cross-site (`SameSite=None`), toda request que cambie estado
   (`login`, y más adelante la respuesta a escalamiento de 013C) debe validar que el origen del
   request coincide con el dominio de Vercel permitido (chequeo de header `Origin`/`Referer` del
   lado del servidor, además del whitelist de CORS) — doble capa, no confiar solo en CORS del
   navegador.

6. **Revocación real**: `POST /auth/logout` borra (o marca `revoked_at`) la fila en `sessions`.
   El middleware de validación (Regla 3 de scope) rechaza cualquier token no encontrado o
   revocado — a diferencia del mecanismo CLI actual, esto sí permite cerrar sesión de verdad.

7. **TLS/proxy**: recomendado **Caddy** sobre nginx para esta VPS — HTTPS automático vía Let's
   Encrypt con configuración mínima, coherente con el criterio de "cambio mínimo" del proyecto
   (Regla 3 de `03-AI-CONSTITUTION.md`). Alternativa válida: nginx + certbot, si se prefiere mayor
   control manual. Decisión final de herramienta puede confirmarse en implementación si Codex
   encuentra una razón de peso para nginx.

---

## 6. Estrategia Algorítmica

No aplica.

---

## 7. Technical Considerations

- Primera superficie de autenticación real contra la red pública del proyecto — más sensible que
  el CLI local.
- Primer despliegue público del backend de la VPS — cambio de postura de seguridad (firewall,
  puerto abierto) que merece revisión explícita al implementar.
- Migración nueva (`sessions`), análoga en espíritu a la de `users`/`projects` de FEATURE-010.
- **`trust proxy` en Express**: corriendo detrás de Caddy, Express ve todas las conexiones como
  viniendo de `127.0.0.1` (la IP del proxy, no la del cliente real) salvo que se configure
  explícitamente `app.set("trust proxy", ...)` para leer `X-Forwarded-For`. Sin esto, el rate
  limiting de login (Regla 4) terminaría limitando a todos los usuarios como si fueran uno solo.

---

## 8. Validation Criteria

| Escenario | Input | Salida esperada |
|---|---|---|
| Login correcto | `handle`+password válidos | Cookie de sesión emitida, fila en `sessions` creada, token hasheado en DB |
| Login incorrecto | Password inválida | 401, sin cookie, sin fila en `sessions` |
| Rate limit | 6º intento fallido en 15 min desde la misma IP | 429, bloqueado temporalmente |
| Sesión expirada | Cookie con token de una sesión de hace >48hs | 401 en cualquier endpoint protegido |
| Logout | `POST /auth/logout` con sesión válida | Fila marcada revocada; requests posteriores con esa cookie devuelven 401 |
| CORS/CSRF | Request desde un origen distinto al de Vercel configurado | Rechazado, tanto por CORS del navegador como por validación de `Origin` del servidor |
| Cross-origin real | Frontend en Vercel real, backend en VPS real, `fetch`/`EventSource` con credenciales incluidas | La cookie viaja y se valida correctamente end-to-end |
| `sessionId` correcto, `rawToken` incorrecto | Cookie con `id` válido de `sessions` pero `rawToken` que no matchea `token_hash` | 401 — el `sessionId` solo no alcanza para autenticar |
| Sin credenciales en el request | `fetch`/`EventSource` sin `credentials`/`withCredentials` contra un endpoint protegido | 401 (el navegador ni siquiera manda la cookie) — confirma que la falta de este contrato rompe todo, no es opcional |

### Validation Evidence
Evidencia real esperada: login end-to-end desde el frontend desplegado en Vercel (no solo
`localhost`) contra el backend real en la VPS con TLS activo — confirma que la cookie
`SameSite=None; Secure` efectivamente funciona cross-origin en un navegador real, no solo en tests
de servidor.

---

## 9. Risks

- Primer certificado TLS del proyecto — dependencia de renovación automática (Let's Encrypt vía
  Caddy) sin intervención manual periódica.
- Rate limiting en memoria se resetea si el proceso Express reinicia — riesgo aceptado, bajo, dado
  el volumen de uso actual (owner + equipo chico).

---

## 10. Approval Gate

Implementación prohibida hasta aprobación explícita del owner. Enviar a validación de Codex antes
de implementar.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.