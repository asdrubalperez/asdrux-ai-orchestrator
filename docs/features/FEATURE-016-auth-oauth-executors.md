# FEATURE-016 — Modo de autenticación por cuenta personal (OAuth) para Executors

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: Basada en el análisis de arquitectura
> `docs/research/investigacion-auth-cuenta-personal-executors.md` (v1.1, con validación empírica
> real de Codex). No reabre la forma arquitectónica ya resuelta ahí (parámetro `authMode`, sin
> Executors nuevos) — la retoma como Feature formal ahora que la validación empírica es positiva.

---

## 1. Feature Identity

- **Name**: Modo de autenticación por cuenta personal (OAuth) para Executors
- **Type**: Backend (Executor / autenticación de proveedor)
- **Owner**: asdru
- **Status**: En diseño — borrador v1
- **Priority**: Media — no bloquea nada existente (comportamiento default sin cambios), pero
  incluye una dependencia dura con un ítem hoy ⚪ Tentativo (ver Risks y Scope).

---

## 2. Problem Statement

Hoy los Executors (`ClaudeCodeExecutor`, `CodexExecutor`) se autentican contra el proveedor
exclusivamente vía API key (`ANTHROPIC_API_KEY`/`CODEX_API_KEY`). Esto tiene costo por token y no
aprovecha suscripciones ya pagadas por el usuario (Claude Pro/Max, ChatGPT Plus, etc.).

La validación empírica (Codex, sesión de investigación) confirmó que una sesión OAuth ya
autenticada (`claude auth login`) se reusa sin intervención humana en invocaciones headless
repetidas, incluso desde un `HOME` distinto — pero también confirmó, de forma no teórica, que el
archivo de credenciales (`~/.claude/.credentials.json`) es directamente portable: copiarlo a otro
`HOME` alcanza para reusar la sesión completa. Esto es un riesgo real, no hipotético, para el rol
Developer (Bash real, red hoy sin allowlist fino).

## 3. Functional Goal

Cada Executor debe poder autenticarse por API key (default, sin cambios) o por sesión OAuth de
cuenta personal (`cli_session`), configurable por rol. El modo `cli_session` debe exponer al
subproceso solo lo estrictamente necesario (un caché de credenciales dedicado, nunca el `HOME`
personal completo), fallar explícitamente si la sesión falta o venció (sin fallback silencioso), y
soportar refresh real sin ampliar el mount escribible más allá de ese caché dedicado.

Para el rol Developer específicamente, `cli_session` solo puede habilitarse cuando FEATURE-015
(egress con protección de exfiltración de credenciales, sin bloquear investigación) esté resuelta
— no antes.

## 4. Scope

### Incluido
1. Parámetro `authMode?: "api_key" | "cli_session"` en `ClaudeCodeExecutorOptions` y
   `CodexExecutorOptions`, default `"api_key"` — comportamiento actual sin cambios si no se
   especifica.
2. Rama condicional en `buildChildEnv` (`claudeCodeExecutor.ts`, y equivalente en
   `codexExecutor.ts`): `"api_key"` inyecta la key como hoy; `"cli_session"` no inyecta ninguna
   key y no hereda `process.env` completo (mínimo necesario: `PATH` + la ruta al caché OAuth
   dedicado).
3. Caché OAuth dedicado al Orquestador — un directorio propio (no el `HOME` personal del
   operador) que contiene únicamente el archivo de credenciales necesario, montado de solo
   lectura por invocación.
4. Falla explícita si el caché no existe o la sesión está vencida — error claro, sin intento de
   fallback silencioso a otro comportamiento.
5. Política de refresh: el proceso puede escribir de vuelta únicamente en ese caché dedicado
   (nunca en ninguna otra ruta del contenedor/host).
6. **Gate de configuración para Developer**: si se configura `authMode=cli_session` para el rol
   Developer, el sistema debe verificar que FEATURE-015 (egress con protección de exfiltración de
   credenciales, ver Risks) esté resuelta e implementada — si no lo está, rechazar la
   configuración con un error explícito al iniciar el run, no permitirlo con una advertencia.
7. Documentar en `docs/playbook/02-ARCHITECTURE.md` la sub-sección de modo de autenticación, con
   referencia al análisis v1.1 y a esta Feature.

### Excluido
1. Implementar la protección de egress en sí — es FEATURE-015, una Feature separada y ya
   promovida a 🟡 Confirmado en el Roadmap; esta Feature solo depende de que exista, no la
   implementa.
2. UI para que el usuario final elija `authMode` por rol — se apoya en el ítem Tentativo
   "Selección de proveedor/modelo/credenciales por rol" cuando exista esa UI; por ahora se
   configura igual que `executorProvider`/`model` hoy (config de proyecto/`.env`).
3. Refresh automático fuera del ciclo normal de invocación — si el token vence a mitad de una
   fase, se falla esa fase con el error explícito (Regla 4); reintento automático de refresh
   proactivo queda como idea futura si resulta necesario en la práctica.

### Future ideas
- Refresh proactivo (renovar antes de que venza, no solo fallar al vencimiento).
- Selección de `authMode` desde la UI, por rol, cuando exista la Capa de UI de Disparo.

---

## 5. Functional Rules

1. **Default sin cambios**: `authMode` ausente o `"api_key"` se comporta exactamente igual que
   hoy — regresión cero para todo lo que ya funciona.
2. **`cli_session` nunca inyecta API keys**, y nunca hereda `process.env` completo del proceso
   Orquestador — mínimo necesario (`PATH` + ruta al caché dedicado). Esto es además coherente con
   el fix ya recomendado en H14 (no pasar el entorno completo al hijo), aplicado acá
   específicamente al modo OAuth.
3. **Caché dedicado, nunca el `HOME` personal completo**: el Orquestador gestiona su propio
   directorio de caché OAuth (separado del `HOME` real del operador), conteniendo solo el/los
   archivo(s) de credenciales necesarios. Se monta de solo lectura en cada invocación; el proceso
   nunca tiene acceso al resto del `HOME` personal.
4. **Falla explícita, sin fallback silencioso**: si el caché no existe, está vacío, o la sesión
   está vencida sin posibilidad de refresh, el Executor falla la invocación con un error claro
   (`authMode=cli_session requiere sesión OAuth válida; no encontrada o vencida`) — nunca cae
   silenciosamente a otro comportamiento (ni a `api_key` si hubiera una configurada, ni a
   continuar sin autenticación).
5. **Refresh acotado al caché dedicado**: si el CLI necesita escribir un token refrescado, solo
   puede hacerlo dentro de ese caché dedicado — ninguna otra ruta del contenedor/host queda
   escribible por este motivo.
6. **Gate duro para Developer**: `authMode=cli_session` + rol Developer requiere que FEATURE-015
   (egress con protección de exfiltración de credenciales) esté implementada y activa. Si no lo
   está, el sistema rechaza la configuración al iniciar el run con un error explícito — no se
   permite con una advertencia ignorable. Esta regla es la mitigación real al hallazgo de
   exfiltración confirmado en la validación empírica.
7. **Sin gate especial para Architect/Functional/Planning/QA**: estos roles no tienen Bash
   habilitado (QA tiene un único comando confinado, H1) — el riesgo de exfiltración por red no
   aplica igual que a Developer; pueden usar `cli_session` sin la dependencia de la Regla 6.

---

## 6. Estrategia Algorítmica

No aplica.

---

## 7. Technical Considerations

- El contrato `Executor.runPhase()` (`src/contracts/executor.ts`) no cambia — confirmado en el
  análisis v1.0 y no revisado por la validación empírica.
- Dependencia dura y explícita con FEATURE-015 ("Egress con protección de exfiltración de
  credenciales, sin bloquear investigación (Developer)") — el owner ya decidió promoverla a 🟡
  Confirmado como prerequisito explícito de la Regla 6 de esta Feature para Developer. Esta
  Feature puede entregarse primero solo para Architect/Functional/Planning/QA (Regla 7), dejando
  Developer explícitamente bloqueado hasta que FEATURE-015 esté resuelta e implementada.
- Esta Feature invalida parcialmente una premisa de cierre de FEATURE-006 (ver Risks) — se dejó
  una nota de seguimiento en `FEATURE-006-implementation-results.md` señalando esto explícitamente,
  sin reabrir esa Feature (que sigue Closed).
- Mecanismo de montaje del caché dedicado depende de si el Executor corre en host o contenedor
  (FEATURE-006) — el diseño de implementación debe cubrir ambos casos, la validación de Codex ya
  cubrió el caso host; falta el caso contenedor (ver Validation Criteria).
---

## 8. Validation Criteria

| Escenario | Input | Salida esperada |
|---|---|---|
| `api_key` (default) sin cambios | Config sin `authMode` | Comportamiento idéntico al actual |
| `cli_session` en host, sesión válida | Caché dedicado con credenciales válidas | Invocación headless exitosa, sin intervención humana |
| `cli_session` en host, sesión vencida | Caché con credenciales vencidas, sin refresh posible | Falla explícita con el mensaje de error definido, sin fallback |
| `cli_session` en contenedor, sesión válida | Mismo caché montado de solo lectura dentro del contenedor | Invocación headless exitosa — **pendiente de validar, no cubierto en la investigación previa** |
| `cli_session` con refresh real | Token que vence a mitad de la ejecución, refresh disparado por el CLI | Refresh exitoso, escritura solo en el caché dedicado, ninguna otra ruta modificada |
| `cli_session` + Developer, sin allowlist activo | Config intenta habilitar esta combinación | Rechazado al iniciar el run, error explícito (Regla 6) |
| `cli_session` + Developer, con allowlist activo | Misma combinación, allowlist ya implementado | Permitido; tráfico saliente del contenedor limitado a los hosts del allowlist durante toda la invocación |
| Variables de entorno no filtradas | Invocación en `cli_session` | El proceso hijo no hereda `DATABASE_URL_DEV` ni otras variables del Orquestador (mismo criterio que el fix de H14) |

### Validation Evidence

Evidencia real esperada: ejecución headless exitosa con `cli_session` **dentro del contenedor**
(no solo host, que ya está validado por Codex), atravesando al menos un ciclo de refresh real, y
confirmación mediante inspección de tráfico de red (o logs del allowlist) de que, con Developer +
allowlist activo, no hay intentos de conexión fuera de los hosts permitidos durante una invocación
que use `cli_session`.

---

## 9. Risks

- **Confirmado empíricamente, no teórico, y agravado por un cambio de premisa respecto a
  FEATURE-006**: el archivo de credenciales OAuth es portable — copiarlo a otro `HOME` alcanza
  para reusar la sesión. `FEATURE-006-implementation-results.md` (sección 3) ya documentó el
  egress sin restricción de Developer como riesgo residual no bloqueante, pero razonó esa
  tolerancia explícitamente así: *"mitigado parcialmente por el hecho de que ya no hay secretos
  del Orquestador disponibles para exfiltrar"*. Esa razón asumía un mundo con un único secreto por
  invocación (`ANTHROPIC_API_KEY`, rotable centralmente sin consecuencia). Con `authMode=cli_session`,
  esa premisa deja de sostenerse: aparece un secreto de naturaleza distinta (portable, no
  trivialmente rotable, con implicancia sobre la cuenta personal del usuario) dentro del mismo
  contenedor cuyo egress sigue sin allowlist fino. La Regla 6 (gate duro con el allowlist) es la
  consecuencia directa de que esa mitigación de FEATURE-006 ya no aplica una vez que esta Feature
  se aprueba para Developer — no es prudencia adicional, es restaurar la garantía que FEATURE-006
  daba por sentada.
- Límites de uso de un plan personal no caracterizados bajo el patrón de invocación repetida de un
  Orquestador (run tras run) — no se validó en esta investigación, es un riesgo operativo, no de
  seguridad.
- Tensión con el ítem Tentativo "Concurrencia de runs simultáneos" — una sesión de cuenta personal
  puede no soportar paralelismo de la misma forma que API keys independientes; no bloquea esta
  Feature (hoy no hay concurrencia real), pero debe reevaluarse si esa Feature avanza.
- Revocar/cerrar una sesión de cuenta personal comprometida afecta al usuario en otros contextos
  (fuera del Orquestador) — no es tan limpio como rotar una API key.

---

## 10. Approval Gate

Implementación prohibida hasta aprobación explícita del owner. Enviar a validación de Codex antes
de implementar — en particular, confirmar la viabilidad técnica exacta del gate de configuración
(Regla 6) y el mecanismo de montaje del caché dedicado en contenedor.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.
