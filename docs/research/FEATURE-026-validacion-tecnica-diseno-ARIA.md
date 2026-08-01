# Validación técnica del diseño de ARIA — FEATURE-026

Contraste del diseño "Autenticación GitHub por usuario para operaciones Git del Orquestador"
(traído por el owner tras revisión con ARIA) contra el código real de `asdrux-ai-orchestrator`. No
se implementó nada, no se tocó `docs/ROADMAP.md`.

## Veredicto general

El diseño es sólido y las 22 reglas funcionales son consistentes entre sí. La validación técnica
confirma la mayoría de las premisas, corrige el encuadre de una (el riesgo real no es "acoplamiento
a Postgres" sino "ceguera a identidad de usuario" en las firmas actuales), y encuentra **una pieza
de trabajo que el diseño puede reutilizar en vez de construir desde cero** (allowlist de entorno,
Regla 13) que reduce el esfuerzo estimado en ese punto específico.

## Confirmado sin matices

- `migrations/` va de `0001` a `0014` sin huecos — `0015` es el siguiente número libre.
- Las rutas `/auth/login` (`app.ts:56`), `/auth/logout` (`app.ts:96`), `/auth/me` (`app.ts:110`)
  siguen un patrón plano (montadas directo en `app`, sin router de módulo, protegidas
  selectivamente con `requireSession`) — `/auth/github/start`, `/auth/github/callback` encajan sin
  fricción ni colisión de convención.
- No existe ningún mecanismo `state`/CSRF/nonce en el código (grep negativo sobre `src/auth/` y el
  resto de `src/`) — confirmado como trabajo net-new, tal como el diseño lo trata. Lo único
  adyacente que existe es `requireAllowedOrigin` (`app.ts:58,98`, chequeo de header `Origin`), que
  no reemplaza la necesidad de un `state` real por callback.
- No hay módulo de configuración centralizado — cada archivo lee `process.env.X` inline en el
  punto de uso (`ANTHROPIC_API_KEY` en `claudeCodeExecutor.ts:145`, `CODEX_API_KEY` en
  `codexExecutor.ts:158`, mismo patrón para el resto). `GITHUB_OAUTH_CLIENT_ID`/`_SECRET`/etc.
  deberían seguir esa misma convención dispersa para ser consistentes con el resto del código, no
  introducir un `config.ts` nuevo.

## Corrección de encuadre — Regla 6/7.7, "worktree.ts no consulta Postgres"

Confirmado que `worktree.ts` efectivamente no importa nada de Postgres/`repository.ts` (solo
módulos `node:*`), pero el riesgo real no es de acoplamiento a datos — es que **las firmas
actuales de `cloneRunRepository` y `pushRunBranch` no tienen ningún parámetro de identidad**:

```ts
cloneRunRepository(params: { runId: string; repoUrl: string; baseRef: string })
pushRunBranch(worktree: RunWorktree)  // solo { branchName, worktreePath }
```

Ninguna de las dos recibe `userId` ni contexto de owner hoy. El diseño (7.6/7.7) ya propone
resolver la credencial en una capa de aplicación antes de invocar estas funciones (`GitCredentialContext`/`GitCredentialProvider`), lo cual es coherente — pero conviene que quede
explícito en el documento final **en qué capa exacta** ocurre esa resolución y qué firma nueva
reciben estas dos funciones (¿un objeto de credenciales como parámetro adicional, o un entorno ya
armado?), porque hoy no existe ningún punto de entrada natural para eso — es una decisión de
contrato, no solo de flujo.

## Hallazgo que reduce esfuerzo — Regla 13 ya tiene precedente reutilizable

El diseño trata el entorno mínimo (allowlist en vez de heredar todo `process.env`) como
construcción nueva. **Ya existe exactamente ese patrón en el codebase**:
`runtimeEnvironment()` (`src/executor/isolated-tools/roleRuntime.ts:176-184`) arma un entorno por
allowlist explícita (`PATH, HOME, USERPROFILE, TEMP, TMP, TMPDIR, SystemRoot, windir, LANG,
LC_ALL`) y ya se usa para los `spawn()` de `docker run` en el mismo archivo. Portar/adaptar ese
patrón a `worktree.ts` es reutilización directa, no diseño desde cero — vale la pena que la sección
7.7/13 lo referencie explícitamente en la implementación.

Detalle lateral encontrado, no pedido pero relevante para el mismo punto: `gitNoPromptEnv()`
(`worktree.ts:23-25`) es la función "hereda-todo-y-agrega-2-claves" que el diseño quiere
reemplazar, pero **`cloneRunRepository` ni siquiera usa esa función** — duplica el mismo patrón
inline en su propia llamada (línea 432). Si se toca esto, son dos lugares a corregir, no uno.

## Confirmado — sin precedente de cifrado reversible (Regla 9)

Todo uso de `node:crypto` en `src/` es `randomUUID`, `randomBytes`, `createHash` (unidireccional,
para checksums/IDs) o `timingSafeEqual` (comparación de tokens). `password_hash` usa `bcryptjs`
—hash unidireccional, no reversible—, que es un precedente de naturaleza distinta a lo que necesita
un token OAuth (debe recuperarse en texto plano para usarse). **Cifrar-y-persistir en Postgres es
trabajo enteramente net-new**, confirma que la decisión pendiente #7 (algoritmo) no tiene atajo de
reutilización disponible — el diseño ya recomienda evitar criptografía casera y usar primitivas
estándar de `node:crypto` (AES-GCM), lo cual sigue siendo la recomendación correcta sin precedente
que la contradiga.

## Confirmado — sin cliente de GitHub API (relevante para decisión #5)

`package.json` no tiene `@octokit/*` ni cliente HTTP dedicado (dependencias reales:
`@radix-ui/*`, `@tanstack/react-query`, `bcryptjs`, `express`, `pg`, `react`, etc., sin `axios` ni
`node-fetch` — se asume `fetch` nativo). `listAccessibleRepositories` (7.5) requiere agregar
`@octokit/rest` (u otra librería) o implementar llamadas REST crudas con `fetch` nativo. Ninguna
opción es compleja, pero es una decisión explícita a tomar, no algo que ya esté resuelto.

## Confirmado — identidad de autor de commit hoy es fija, no por usuario (decisión #3)

Dos puntos exactos con identidad hardcodeada:
- `commitAllChanges` (`worktree.ts:85-88`): `-c user.name=ai-orchestrator-bot -c
  user.email=ai-orchestrator-bot@localhost`.
- `mergeFeatureBranchIntoBase` (`worktree.ts:248-251`): mismo patrón.

Confirma que la decisión pendiente #3 (author/committer) es trabajo real, no una formalidad — hoy
ningún commit refleja identidad de usuario. Nota para cuando se cierre esa decisión: no verifiqué
si `users` tiene columna de email; si la opción elegida es "usar email del usuario", puede hacer
falta agregar esa columna (no confirmado en esta pasada, señalar para la próxima).

## Resumen para el Approval Gate

Nada de lo encontrado invalida el diseño. Los ajustes recomendados antes de aprobar:
1. Especificar en qué capa/firma exacta se inyecta la credencial hacia `cloneRunRepository`/
   `pushRunBranch` (hoy ninguna acepta identidad).
2. Referenciar `runtimeEnvironment()` (`roleRuntime.ts:176-184`) como base reutilizable para la
   Regla 13, en vez de tratarlo como diseño nuevo.
3. Corregir `cloneRunRepository` para usar el mismo mecanismo de entorno que el resto (hoy duplica
   `gitNoPromptEnv()` inline).
4. Confirmar si `users` necesita columna de email antes de cerrar la decisión #3.

## Addendum — validación de la v3 (documento final en `docs/features/`)

La v3 (`docs/features/FEATURE-026-Autenticación-Github-por-Usuario-para-Operaciones-Git.md`)
incorpora las tres decisiones que quedaban abiertas en la v2 (ciclo de vida del token, mensajes de
UX, cambio de cuenta) y queda con "Status: Diseño completo — pendiente de aprobación". Contra el
código, esta versión ya resuelve correctamente los cuatro ajustes de la sección anterior — el
contrato de inyección de credenciales (7.9-7.10), la reutilización de `runtimeEnvironment()`
(7.11), la corrección de `cloneRunRepository`, y la identidad de commits fija sin depender de
email de usuario (Regla 31). También agrega FKs explícitas en `oauth_states`
(`references users(id)`, `references sessions(id)`) que faltaban en la v2.

Lo único que esta versión no puede validarse contra este repositorio — depende del comportamiento
real de GitHub, no del código local — son las Reglas 21-22 (ciclo de vida y verificación del
token). Se verificó contra documentación oficial de GitHub:

- **Confirmado**: las OAuth Apps tradicionales no emiten refresh token ni access tokens de 8 horas
  (eso es específico de GitHub Apps con expiración habilitada) — el token persiste hasta
  revocación explícita o automática. Consistente con la Regla 21.
- **Confirmado con el número exacto**: GitHub revoca automáticamente el token más antiguo cuando
  una misma combinación usuario/aplicación/scopes acumula **más de 10 tokens simultáneos**. El
  diseño menciona "exceso de tokens" en la Regla 21/Riesgo 6 sin dar el número — vale la pena
  agregarlo explícitamente (10), porque es información accionable: reconexiones repetidas del
  mismo usuario sin limpiar tokens viejos podrían acercarse a ese límite.
- **Confirmado**: GitHub revoca automáticamente tokens (OAuth App y PAT) sin uso durante un año.
  Consistente con el Riesgo 6.
- **Confirmado, con una corrección técnica que falta en el documento**: los endpoints existen tal
  como los describe la Regla 22 — `POST /applications/{client_id}/token` (verificar) y `DELETE
  /applications/{client_id}/token` (revocar). Lo que el diseño **no menciona** y es necesario para
  implementar: ambos endpoints se autentican con **Basic Auth usando `client_id:client_secret` de
  la OAuth App** — no con el token del usuario ni con ningún mecanismo de sesión del Orquestador.
  Es coherente con el resto del diseño (esos secretos ya están contemplados en
  `GITHUB_OAUTH_CLIENT_ID`/`_SECRET`, sección 7.3), pero conviene dejarlo explícito en la sección
  7.6 (Cliente HTTP) antes de implementar: cambia qué credencial usa cada llamada — las
  operaciones normales usan el token del usuario, pero check/revoke usan las credenciales de la
  App.

No se verificaron independientemente en esta pasada las Reglas 25 (restricciones
organizacionales) y 26 (SAML) contra documentación oficial — son coherentes con el comportamiento
conocido de GitHub, pero no se hizo una consulta dedicada para confirmarlas con la misma precisión
que el resto.

### Veredicto sobre el Approval Gate

No encontré nada que invalide el diseño. El único ajuste recomendado antes de aprobar es agregar
el detalle de autenticación (Basic Auth client_id:client_secret) a la sección 7.6, y opcionalmente
el número exacto (10) en la Regla 21. El resto del documento está consistente tanto con el código
real del repositorio como con el comportamiento documentado de GitHub.

Fuentes consultadas:
- [Authorizing OAuth Apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [REST API endpoints for OAuth authorizations](https://docs.github.com/en/rest/apps/oauth-applications)
- [Token expiration and revocation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation)
