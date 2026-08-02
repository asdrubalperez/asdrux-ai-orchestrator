# Handoff — FEATURE-025-Parte-1: revisión técnica contra el código real

## 1. Destinatario

ARIA (AI Product Architect). Revisión técnica del diseño propuesto en
`docs/features/FEATURE-025-Parte-1-Asistente-Modelo-y-Credenciales-API-por-Agente.md`, hecha
verificando cada afirmación contra el código real (no contra lo que el propio documento asume) —
mismo criterio aplicado a las rondas de validación de FEATURE-026/042/043. El diseño general es
sólido y la mayoría de sus afirmaciones se confirman; hay un hallazgo estructural que debe
resolverse antes del Approval Gate, más gaps de completitud y una decisión de arquitectura que el
owner ya definió.

**Estado del gate:** sigue cerrado. Este handoff no es una aprobación — es la corrección técnica
previa a que el owner apruebe.

## 2. Hallazgo crítico — el mecanismo de reintento existente no está contemplado

`src/cli/respondService.ts:104-113` (FEATURE-016) hace algo que el diseño no menciona en ningún
lado: cuando un escalamiento se reintenta, el código **deliberadamente no vuelve a resolver contra
`user_agent_config`** — reconstruye `provider`/`authMode`/`model` leyéndolos directamente del
payload ya persistido del evento `run_started` del run original. Comentario textual en el código:
*"un reintento de escalación reusa exactamente lo que se usó en el run original — no re-resuelve
contra user_agent_config, que pudo haber cambiado desde entonces"*.

La Regla Funcional 5.8.6 del diseño lo roza de forma genérica ("salvo que otra Feature defina
snapshots de configuración") pero no lo resuelve. El problema real: `provider`/`authMode`/`model`
son strings, se pueden persistir tal cual en el payload de un evento sin conflicto. Una
**credencial** no — es un secreto cifrado, y la propia Regla 5.6.10 del diseño prohíbe que un
secreto aparezca en eventos persistidos. Entonces, ante un reintento:

* ¿se vuelve a resolver la credencial *actual* del usuario? (rompe la simetría "exactamente lo
  mismo que el run original" que sí se preserva hoy para provider/modelo — si el usuario rotó su
  API key entre el run original y el reintento, el reintento usaría una credencial distinta a la
  que efectivamente falló);
* ¿o hace falta persistir qué *credencial* (el ID, nunca el secreto) se usó, para poder recuperarla
  y descifrarla de nuevo en el reintento, preservando la simetría?

Es una decisión de diseño funcional, no un detalle de implementación — necesita quedar resuelta
explícitamente en el documento antes de aprobar. Recomendación del owner/Claude: la opción del ID
de credencial parece más consistente con el espíritu de la Regla 5.8.6 y con Riesgo 1 (nunca
persistir secretos), pero la decisión final queda para ARIA + owner.

## 3. Gaps de completitud en la sección 7.9 ("Runtime afectado")

Mismo patrón de gap que tuvo el primer borrador de FEATURE-043 (una lista de "archivos afectados"
que no cubre todos los call sites reales):

1. **`createPlanningToQaChildRun` (`runStart.ts:1327`) y `createArchitectReentryChildRun`
   (`runStart.ts:1395`)** — ambas llaman a `resolveAgentConfig` para reingresos automáticos sin
   intervención humana (Circuitos 2/3). No están en la lista de 7.9.
2. **`mapBusinessCase.ts`** está correctamente excluido del *alcance* (sección 4, confirmado: lee
   `ANTHROPIC_API_KEY` de forma completamente independiente vía `fetch` directo, sin tocar el
   camino de los Executors) pero no aparece ni siquiera mencionado en 7.9 como "confirmado fuera de
   alcance". Sin esa nota, alguien que audite 7.9 para confirmar "cero lectores de API key global
   remanentes" puede asumir erróneamente que no queda ninguno, cuando en realidad queda uno
   explícitamente fuera de esta Feature.
3. **La capa de aislamiento de tools** (`qaWorkerServer.ts:10`, `roleWorkerServer.ts:17`,
   `searchProxyServer.ts:8`, `worker.ts:25`) trata `ANTHROPIC_API_KEY`/`CODEX_API_KEY` como
   secretos prohibidos dentro del entorno del worker aislado — no son "lectores" pero están
   acoplados a esos mismos nombres de variable. Si el mecanismo de inyección de credencial cambia,
   esta capa debería revisarse para confirmar que sigue bloqueando el secreto correcto (o el nuevo
   mecanismo, si aplica). No mencionada en 7.9.
4. **No existe hoy ningún test** que ejercite `resolveAgentConfig`, `AgentConfig` o
   `user_agent_config` directamente (confirmado por búsqueda completa de `.test.ts`). El punto
   "tests de configuración" de 7.9 no es una extensión de cobertura existente — es cobertura nueva
   desde cero. Vale la pena que el diseño lo diga explícitamente, para dimensionar el esfuerzo real.

## 4. Riesgo 2 del diseño está sobredimensionado — ya mitigado por la arquitectura actual

Riesgo 2 ("Contaminación entre ejecuciones... modificar `process.env` global podría mezclar
credenciales entre usuarios") está redactado como si fuera un peligro nuevo que la Feature debe
introducir mitigación para evitar. En los hechos, **ya está resuelto hoy**: `claudeCodeExecutor.ts`
(`buildChildEnv`, líneas 268-278) y `codexExecutor.ts` (líneas 415-425) ya construyen un objeto de
entorno nuevo por invocación, pasado vía `spawn(cmd, args, { env })` — en ningún lugar de ninguno de
los dos executors se muta `process.env` global. Recomendación de redacción: cambiar "mitigación" por
"preservar el patrón existente" — Parte 1 solo necesita cambiar qué valor entra a ese objeto de
entorno ya aislado, no construir el aislamiento en sí.

## 5. Decisión ya tomada por el owner: clave de cifrado separada, no compartida

El diseño (sección 7.2, punto abierto) proponía "extraer la primitiva genérica de cifrado hacia un
módulo neutral" sin resolver si la nueva credencial de IA reutiliza `GIT_CREDENTIAL_ENCRYPTION_KEY`
o usa una clave propia. Verificado contra `src/auth/gitCredentialEncryption.ts`: **la función ya
acepta la key como parámetro** (`encryptGitToken(plaintext, key: Buffer = encryptionKeyFromEnv())`)
— lo único acoplado a Git es el nombre de la variable de entorno *default*, no la lógica de cifrado
en sí. Esto cambia el costo real de la decisión: no hace falta ningún refactor ni extracción de
módulo, solo una segunda variable de entorno.

**Decisión del owner: clave separada** (`AI_CREDENTIAL_ENCRYPTION_KEY`, nueva, distinta de
`GIT_CREDENTIAL_ENCRYPTION_KEY`), no una clave compartida entre GitHub y proveedores de IA. Motivos:

* Costo de implementación prácticamente nulo dado que la key ya es un parámetro — no justifica
  elegir "compartida" por simplicidad, porque no hay diferencia real de simplicidad.
* Separación de dominios de secreto es la práctica estándar de la industria (NIST SP 800-57; mismo
  criterio detrás de "un CMK por clasificación de dato" en cualquier KMS de cloud) — no es
  sobre-ingeniería, es lo mínimo esperable en cualquier auditoría de seguridad una vez que el
  sistema cifra más de un tipo de secreto, que es exactamente la situación actual.
* Blast radius real y distinto por tipo de secreto: un token de GitHub compromete escritura sobre
  repos; una API key de Anthropic/OpenAI compromete gasto de terceros. Con claves separadas, una
  sospecha de filtración de una permite rotarla sin invalidar la otra (y sin forzar a todos los
  usuarios a reconectar GitHub vía FEATURE-026 solo porque se sospechó de la credencial de IA).
* Mirando adelante: FEATURE-025-Parte-2 va a agregar credenciales OAuth de IA también. Empezar
  compartiendo "porque es más simple" garantiza terminar migrando de todas formas cuando haya 3-4
  tipos de secreto bajo la misma clave — y ese momento, con datos reales ya cifrados en producción,
  es mucho más caro que separar ahora, con cero migración pendiente.

**Alcance explícitamente acotado de esta decisión** (para no sobre-diseñar): no hace falta renombrar
`gitCredentialEncryption.ts` ni mover funciones a un "módulo neutral" nuevo, como sugería el
borrador. Alcanza con agregar una segunda función de resolución de key (en el mismo archivo o en uno
chico nuevo) que lea `AI_CREDENTIAL_ENCRYPTION_KEY` y la pase como parámetro a las mismas
`encryptGitToken`/`decryptGitToken` ya existentes, sin tocar su interfaz pública actual ni sus
nombres.

## 6. Confirmaciones (para que ARIA no tenga que re-verificar)

* La exclusión de `mapBusinessCase.ts` del alcance es legítima (ver punto 3.2).
* Agregar la columna `model` a `user_agent_config` es un cambio aditivo limpio — sin conflicto con
  los índices únicos parciales existentes (`migrations/0008_user_agent_config.sql`).
* La resolución por-invocación (Regla 5.8.1) ya es el comportamiento real hoy — `resolveSelection`
  se llama dentro del loop de fases (`runStart.ts:385`), no una sola vez por run.
* `--model` no tiene ningún consumidor en CI/automatización que se rompa con un cambio de
  precedencia (no existen workflows ni scripts que lo invoquen).
* Próximo número de migración disponible: `0021` (la última es `0020_rama_base_trabajo_sin_default_main.sql`, de FEATURE-043).

## 7. Documentos relevantes

1. `docs/features/FEATURE-025-Parte-1-Asistente-Modelo-y-Credenciales-API-por-Agente.md` — diseño
   propuesto por ARIA, objeto de esta revisión.
2. `docs/features/FEATURE-025-Parte-2-OAuth-Personal-por-Proveedor-de-IA.md` — sin cambios, sigue
   dependiendo de que Parte 1 cierre su diseño primero.
3. `docs/research/HANDOFF-FEATURE-025-priorizacion-y-division-en-dos-partes.md` — contexto de
   priorización y de la división original en dos partes.
