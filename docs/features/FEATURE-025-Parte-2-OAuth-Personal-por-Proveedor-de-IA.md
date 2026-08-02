# FEATURE-025-Parte-2 — OAuth personal por proveedor de IA

# 1. Feature Identity

* **Name:** OAuth personal por proveedor de IA (Claude / Codex)
* **Type:** Autenticación / integración de credenciales
* **Owner:** Asdrubal Pérez
* **Status:** Diseño preliminar — punto de partida para ARIA, no cerrado
* **Priority:** Media (después de Parte 1 — ver handoff de priorización)

---

# 2. Problem Statement

El modo de autenticación `cli_session` (alternativa a `api_key`, ya persistido por usuario y por
rol desde FEATURE-016) hoy **no es realmente por usuario**. El código confirma que, detrás de
`cli_session`, hay una única sesión OAuth compartida en el host:

```
src/executor/claudeCodeExecutor.ts:135: const oauthCacheDir = process.env.CLAUDE_OAUTH_CACHE_DIR;
src/executor/codexExecutor.ts:148:      const oauthCacheDir = process.env.CODEX_OAUTH_CACHE_DIR;
```

Son variables de entorno globales del proceso, montadas de solo lectura en el contenedor aislado
sin importar qué usuario del Orquestador pidió `cli_session`. Es decir: el selector
(`user_agent_config.auth_mode = 'cli_session'`) aparenta ser una elección personal, pero el secreto
real detrás es tan compartido como la API key global que FEATURE-025-Parte-1 resuelve. Esta Feature
es la que efectivamente cierra ese hueco para el modo OAuth, tal como Parte 1 lo cierra para el modo
API key.

Esto es, en esencia, el mismo problema que resolvió FEATURE-026 para GitHub (`user_git_connections`,
flujo OAuth completo, token cifrado por usuario) — pero aplicado a los proveedores de IA
(Anthropic/Claude, OpenAI/Codex) en vez de a GitHub.

---

# 3. Functional Goal

Después de implementar esta parte:

* cada usuario puede conectar su propia cuenta de Claude (Claude.ai / Claude Max/Pro) y/o su propia
  cuenta de Codex (ChatGPT Plus/Pro), de forma análoga a como F026 conecta GitHub;
* un run que use `cli_session` para un rol usa la sesión OAuth **del usuario dueño del run**, no una
  compartida del host;
* un usuario sin conexión OAuth propia sigue pudiendo usar `cli_session` contra el mecanismo
  compartido actual (comportamiento legacy intacto) o cae a `api_key` si así lo prefiere.

---

# 4. Scope

## Included

* Investigación técnica previa (spike, ver Riesgo 1): cómo autentica realmente cada CLI
  (`claude`/Claude Code, `codex`) contra su proveedor — formato del caché de sesión que hoy vive en
  `CLAUDE_OAUTH_CACHE_DIR`/`CODEX_OAUTH_CACHE_DIR`, si el flujo de login es un OAuth App estándar
  (como GitHub) o un mecanismo propio del CLI (login interactivo, device code, token de sesión
  opaco) — esto determina si el patrón de FEATURE-026 es directamente reusable o si hace falta un
  mecanismo distinto por proveedor.
* Flujo de conexión por usuario (UI + backend) para cada proveedor que el spike confirme viable.
* Almacenamiento cifrado de las credenciales de sesión resultantes, por usuario y por proveedor.
* Aislamiento del caché OAuth por usuario en el contenedor de ejecución (hoy se monta un único
  directorio compartido de solo lectura — pasa a resolverse por usuario, mismo espíritu que
  `GIT_ASKPASS` efímero de FEATURE-026 para las operaciones Git).
* Desconexión/revocación por usuario.

## Excluded

* Cualquier cambio al modo `api_key` — ya resuelto por Parte 1.
* Forzar que todos los usuarios migren a OAuth personal — `api_key` (propia o compartida) sigue
  siendo una opción válida indefinidamente.
* Facturación o límites de uso por cuenta OAuth conectada.

---

# 5. Functional Rules (borrador, a validar con ARIA — y con el spike técnico)

1. La conexión OAuth es siempre por (usuario, proveedor) — nunca compartida entre usuarios.
2. Un usuario sin conexión OAuth propia para un proveedor no puede seleccionar `cli_session` para
   un rol que use ese proveedor **a menos que** el sistema decida conservar el fallback a la sesión
   compartida del host como comportamiento legacy explícito (a decidir con ARIA — mismo criterio de
   "no romper nada para quien no adopta la Feature" que Parte 1).
3. Las credenciales de sesión nunca se exponen en texto plano fuera del proceso hijo aislado que las
   consume (mismo criterio que FEATURE-026, Regla de `GIT_ASKPASS` efímero).
4. Desconectar revoca/borra la credencial local del Orquestador; el resultado remoto (si el
   proveedor soporta revocación real, a confirmar por el spike) es best-effort, mismo criterio que
   `disconnectGitHub` de FEATURE-026 (Regla 24: la seguridad local nunca depende de que el proveedor
   responda correctamente).

---

# 6. Estrategia Algorítmica

No aplica todavía — depende enteramente de lo que el spike técnico (7.1) confirme sobre el
mecanismo real de autenticación de cada CLI. No tiene sentido diseñar el flujo de token/refresh
antes de saber si existe uno.

---

# 7. Technical Considerations (abiertas para ARIA — más abiertas que Parte 1)

## 7.1 Spike previo obligatorio

A diferencia de FEATURE-026 (GitHub expone OAuth Apps estándar, bien documentado, ya validado en
producción), no está confirmado que Claude Code CLI o Codex CLI expongan un mecanismo de OAuth
equivalente, delegable y re-emitible por un backend propio. Puede ser:

* un OAuth App real (mejor caso, patrón F026 aplica directo);
* un login interactivo del CLI que genera un token/sesión local sin API pública de emisión
  delegada (peor caso — requeriría investigar si el CLI soporta headless login, device code flow,
  o si hay que mantener el modelo actual de "sesión pre-autenticada en el host" pero aislada por
  usuario en vez de compartida).

Este punto es la razón principal por la que esta parte se separó de Parte 1: el riesgo técnico y el
tamaño real del trabajo dependen de una respuesta que hoy no tenemos, y no bloquea nada de lo que
Parte 1 sí puede resolver con certeza.

## 7.2 Aislamiento por usuario en el contenedor

Hoy `oauthCacheDir` es un único path montado read-only. Si el mecanismo real permite credenciales
por usuario, el equivalente sería un directorio de caché generado/resuelto por usuario en el
momento de la invocación (análogo a `createGitProcessAuth` de FEATURE-026, que arma un directorio
efímero por invocación), no una ruta fija de configuración del servidor.

## 7.3 Arquitectura afectada (lista preliminar, altamente dependiente del spike)

* `src/executor/claudeCodeExecutor.ts`, `src/executor/codexExecutor.ts` — resolución de
  `oauthCacheDir` pasa de variable de entorno fija a valor resuelto por usuario.
* Migración nueva para la tabla de conexiones OAuth de IA (estructura similar a
  `user_git_connections` de FEATURE-026, pero por proveedor de IA en vez de GitHub).
* Endpoints nuevos en `src/server/app.ts`.
* UI nueva o extensión de la de Parte 1.

## 7.4 Dependencias

* FEATURE-025-Parte-1 — comparte la tabla/UI de configuración de agente donde se elige `api_key`
  vs `cli_session` por rol; esta parte le da un backend real a la segunda opción.
* FEATURE-026 — precedente directo de patrón (cifrado, aislamiento efímero de credenciales,
  revocación best-effort), aplicable en la medida que el spike confirme un mecanismo compatible.

---

# 8. Validation Criteria (borrador, a completar tras el spike)

* Dos usuarios distintos, cada uno con su propia cuenta de Claude conectada, corren runs con
  `cli_session` en paralelo sin que la sesión de uno interfiera con la del otro.
* Desconectar la cuenta de un usuario no afecta a otros usuarios con `cli_session` activo.

---

# 9. Risks

* **Riesgo 1 — Viabilidad técnica no confirmada** (el más importante, ver 7.1): esta Feature puede
  resultar mucho más chica o mucho más grande de lo estimado según lo que el spike encuentre. No
  comprometerse a un alcance de implementación fijo hasta tener esa respuesta.
* **Riesgo 2 — Términos de servicio del proveedor**: automatizar o delegar sesiones de cuentas
  consumer (Claude Max/Pro, ChatGPT Plus/Pro) puede tener restricciones distintas a las de una API
  de desarrollador — a verificar explícitamente antes de implementar, no solo antes de lanzar.
* **Riesgo 3 — Alcance abierto termina bloqueando Parte 1**: mitigado por el propio split — Parte 1
  no depende de esta parte y puede shippearse sola.

---

# 10. Approval Gate

La implementación permanece prohibida. Además del cierre de diseño y aprobación del owner (igual
que cualquier Feature), esta parte específicamente **no debería iniciar implementación sin haber
completado primero el spike técnico de la sección 7.1** — el diseño funcional completo depende de su
resultado.

**Estado del gate:** abierto — diseño preliminar, pendiente de spike técnico y de ARIA.
