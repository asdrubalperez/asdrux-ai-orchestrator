# FEATURE-013 — Capa de UI "Run en curso" — Parte 013B: Implementation Results

## Scope implementado

- Migración `0007_web_sessions.sql`:
  - tabla `sessions`
  - `user_id`, `token_hash`, `expires_at`, `revoked_at`
  - índices por `user_id` y `expires_at`
- Backend Express:
  - `POST /auth/login`
  - `POST /auth/logout`
  - `GET /auth/me`
  - middleware de sesión real para `GET /runs/:id` y `GET /runs/:id/stream`
  - reemplazo completo del shim `ORCHESTRATOR_WEB_USER_ID`
- Seguridad web:
  - cookie `httpOnly`, `SameSite=None`, `Secure` por default
  - cookie con formato `sessionId.rawToken`
  - `token_hash` SHA-256 en DB, sin token plano
  - TTL web de 48 horas
  - revocación real vía `revoked_at`
  - CORS con `Access-Control-Allow-Credentials: true` y origin exacto
  - validación de `Origin`/`Referer` en requests que cambian estado
  - rate limit in-memory sobre `/auth/login`
  - `app.set("trust proxy", 1)` para operar detrás de Caddy
- Frontend:
  - UI mínima de login/logout
  - `fetch` con `credentials: "include"`
  - `EventSource` con `{ withCredentials: true }`
  - soporte `VITE_API_BASE_URL` para frontend desplegado fuera del backend

## Decisiones de implementación

- El selector de sesión (`sessions.id`) no es secreto. La autenticación requiere además el
  `rawToken` correcto, hasheado y comparado contra `sessions.token_hash`.
- `ORCHESTRATOR_COOKIE_SECURE=false` existe solo como escape local de desarrollo. El default es
  cookie `Secure`.
- `ORCHESTRATOR_WEB_ORIGIN` es obligatorio al arrancar el servidor. Sin ese origin exacto no se
  habilitan credenciales cross-origin.
- No se agregó una dependencia externa de CORS/cookies/rate-limit; el comportamiento queda
  implementado explícitamente para mantener el cambio mínimo.

## Validación local

- `npm test`: 16/16 tests pasan.
- `npm run build`: pasa `tsc --noEmit`, typecheck de `web/`, y `vite build`.
- Smoke de servidor:
  - `ORCHESTRATOR_WEB_ORIGIN=https://ui.example.com`
  - `ORCHESTRATOR_COOKIE_SECURE=false`
  - `PORT=3999`
  - Resultado: servidor inicia y escucha en `http://127.0.0.1:3999`; timeout esperado por proceso
    persistente.

## Validación real en VPS/Postgres dev

- Ambiente: `srv1834767` / contenedor `postgres-dev-orquestador`.
- Migración aplicada con `psql -f /tmp/0007_web_sessions.sql`.
- Tabla verificada con `to_regclass('public.sessions')`: resultado `sessions`.
- Migración marcada como aplicada en `schema_migrations` con filename `0007_web_sessions.sql`.

## Validación real pendiente

- Confirmar login/logout end-to-end contra backend real con TLS.
- Confirmar cookie `SameSite=None; Secure` desde frontend real en Vercel contra backend real.
- Confirmar SSE autenticado con `withCredentials` desde navegador real.
