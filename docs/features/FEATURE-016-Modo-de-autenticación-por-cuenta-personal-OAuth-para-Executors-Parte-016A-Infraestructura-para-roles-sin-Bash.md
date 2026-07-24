# FEATURE-016A — Modo de autenticación por cuenta personal (OAuth) para Executors — Parte 016A: Infraestructura para roles sin Bash

Versión: v1.0 (borrador para revisión — no aprobado)
Basado en template: `docs/playbook/07-FEATURE-TEMPLATE.md` v2.1
Parte de: FEATURE-016 (desdoblada en 016A/016B, mismo patrón que FEATURE-013 — ver `docs/ROADMAP.md`)
Insumos: `docs/research/investigacion-auth-cuenta-personal-executors.md` v1.1

---

# 1. Feature Identity

- **Name**: Modo de autenticación por cuenta personal (OAuth) para Executors — Parte 016A:
  Infraestructura para roles sin Bash
- **Type**: Autenticación / Infraestructura de Executors
- **Owner**: Asdrubal Perez
- **Status**: Draft — pendiente de Approval Gate
- **Priority**: Media-Alta — no bloqueada por ninguna otra Feature; puede implementarse ya

---

# 2. Problem Statement

Hoy los Executors (`ClaudeCodeExecutor`/`CodexExecutor`) solo soportan autenticación por API key.
La investigación empírica v1.1 confirmó, con evidencia real en la VPS (sección 8), que una sesión
OAuth de cuenta personal ya autenticada (`claude auth login`) se reutiliza sin intervención humana
entre invocaciones headless y procesos separados, y que el archivo de credenciales es portable
entre `HOME`s — alcanza con copiarlo al home efectivo de un contenedor para reusar la sesión.

Motivación de negocio: permitir que los roles del pipeline usen la suscripción personal del owner
en vez de facturación por API key, cuando eso sea preferible operacionalmente.

Esta parte (016A) cubre específicamente los roles **sin herramienta de Bash habilitada**
(Architect, Functional, Planning, QA) — ver Regla 7 del análisis original: estos roles no tienen
el mismo perfil de riesgo de exfiltración que Developer, porque no pueden ejecutar comandos
arbitrarios que combinen lectura del secreto con egress de red libre. Por eso esta parte **no
depende de FEATURE-015** (egress con protección de exfiltración, prerequisito exclusivo de
FEATURE-016B / Developer) y puede implementarse de forma independiente y ya.

---

# 3. Functional Goal

Después de esta Feature, los roles Architect, Functional, Planning y QA pueden configurarse con
`authMode="cli_session"`, reutilizando una sesión OAuth de cuenta personal ya autenticada
(`claude auth login` o equivalente), sin requerir una API key, con el caché de credenciales
aislado en un directorio dedicado del Orquestador (nunca el `HOME` personal completo del
operador).

Comportamiento observable esperado:

- `authMode` no especificado (u `"api_key"`) → comportamiento idéntico al actual, sin cambios.
- `authMode="cli_session"` en un rol sin Bash → invocación headless exitosa sin intervención
  humana, siempre que exista una sesión válida en el caché dedicado.
- Sesión vencida o caché ausente → falla explícita con error claro, nunca fallback silencioso a
  otro comportamiento.
- Un intento de configurar `authMode="cli_session"` para el rol **Developer** → rechazado
  explícitamente por esta misma Feature (ver Regla 8), independientemente del estado de
  FEATURE-015/016B.

---

# 4. Scope

## Incluido

1. Parámetro `authMode?: "api_key" | "cli_session"` en `ClaudeCodeExecutorOptions` y
   `CodexExecutorOptions`, default `"api_key"` — comportamiento actual sin cambios si no se
   especifica. El contrato `Executor` (`src/contracts/executor.ts`) no cambia.
2. Rama condicional en `buildChildEnv` (`claudeCodeExecutor.ts`, y equivalente en
   `codexExecutor.ts`): `"api_key"` inyecta la key como hoy; `"cli_session"` no inyecta ninguna
   key y no hereda `process.env` completo (mínimo necesario: `PATH` + la ruta al caché OAuth
   dedicado — mismo criterio que el fix de H14, no pasar el entorno completo al hijo).
3. Caché OAuth dedicado al Orquestador — un directorio propio (no el `HOME` personal del
   operador) que contiene únicamente el archivo de credenciales necesario, montado de solo
   lectura por invocación, tanto en host como en contenedor.
4. Falla explícita si el caché no existe, está vacío o la sesión está vencida sin posibilidad de
   refresh — error claro y accionable (`authMode=cli_session requiere sesión OAuth válida; no
   encontrada o vencida`), sin fallback silencioso a otro comportamiento (ni a `api_key` si
   hubiera una configurada, ni a continuar sin autenticación).
5. Política de refresh: el proceso puede escribir de vuelta únicamente en ese caché dedicado
   (nunca en ninguna otra ruta del contenedor/host). Semántica de refresh (reconciliada con
   FEATURE-015 Regla 5, para que ambas partes de FEATURE-016 compartan el mismo criterio):
   refresh nativo/reactivo dentro del ciclo normal de la invocación está permitido y esperado; si
   ese refresh nativo falla (sesión vencida sin poder refrescar), la fase falla explícitamente.
   Refresh proactivo externo al ciclo (renovar antes de vencer) queda excluido — ver Future ideas.
6. Aplica únicamente a los roles Architect, Functional, Planning y QA (Regla 7 del análisis
   original: sin Bash habilitado, sin el mismo perfil de riesgo de exfiltración que Developer) —
   sin gate adicional más allá del Approval Gate de esta misma Feature.
7. Documentar en `docs/playbook/02-ARCHITECTURE.md` la sub-sección de modo de autenticación, con
   referencia al análisis v1.1 y a esta Feature.
8. **Rechazo explícito y definitivo para Developer dentro de esta misma implementación** (no un
   placeholder temporal): la rama condicional debe rechazar `authMode="cli_session"` cuando el rol
   sea Developer, con un error explícito equivalente al que usará la Regla 6 de FEATURE-016B una
   vez implementada. Esto evita que 016A, shippeada sola, habilite por accidente el modo de riesgo
   que FEATURE-015/016B todavía no resuelven.

## Excluido

1. Todo lo relativo al rol Developer más allá del rechazo explícito del punto 8 — la habilitación
   real de `cli_session` para Developer es FEATURE-016B, bloqueada por FEATURE-015. Esta Feature
   no adelanta ni prepara esa habilitación.
2. UI para que el usuario final elija `authMode` por rol — se apoya en el ítem Tentativo
   "Selección de proveedor/modelo/credenciales por rol" cuando exista esa UI; por ahora se
   configura igual que `executorProvider`/`model` hoy (config de proyecto/`.env`).
3. Refresh proactivo, externo al ciclo normal de invocación (renovar antes de vencer) — ver
   Future ideas.
4. Validación de concurrencia de múltiples invocaciones simultáneas reutilizando la misma sesión
   OAuth — relacionado con el ítem Tentativo "Concurrencia de runs simultáneos"; fuera de alcance
   inicial (no hay concurrencia real hoy en el Orquestador).
5. Límites de uso de un plan personal bajo el patrón de invocación repetida (run tras run) — no
   se valida en esta Feature, es un riesgo operativo (ver Risks), no de diseño.

## Future ideas (opcional)

- Refresh proactivo (renovar antes de que venza, no solo reaccionar al vencimiento).
- Selección de `authMode` desde la UI, por rol, cuando exista la Capa de UI de Disparo.

---

# 5. Functional Rules

1. `authMode` es opcional en las opciones de `ClaudeCodeExecutor`/`CodexExecutor`; su ausencia
   equivale a `"api_key"` y no cambia ningún comportamiento existente.
2. `authMode="cli_session"` nunca inyecta `ANTHROPIC_API_KEY` (ni la variable equivalente de
   Codex) y nunca hereda el `process.env` completo del Orquestador hacia el proceso hijo — mismo
   criterio que el fix de H14, aplicado específicamente a este modo.
3. El Orquestador gestiona su propio caché OAuth dedicado (separado del `HOME` real del
   operador), conteniendo solo el/los archivo(s) de credenciales necesarios. Se monta de solo
   lectura en cada invocación; el proceso nunca tiene acceso al resto del `HOME` personal.
4. Falla explícita, sin fallback silencioso: si el caché no existe, está vacío, o la sesión está
   vencida sin posibilidad de refresh, el Executor falla la invocación con el error claro
   definido en Scope → Incluido punto 4.
5. Refresh acotado al caché dedicado: si el CLI necesita escribir un token refrescado, solo puede
   hacerlo dentro de ese caché dedicado — ninguna otra ruta del contenedor/host queda escribible
   por este motivo. Semántica compartida con FEATURE-015 Regla 5 (ver Scope → Incluido punto 5).
6. Esta Feature aplica únicamente a Architect, Functional, Planning y QA. No requiere ningún gate
   adicional para estos roles (Regla 7 del análisis original) — su propio Approval Gate es
   suficiente.
7. **Rechazo definitivo de Developer**: la misma rama condicional debe rechazar explícitamente
   `authMode="cli_session"` cuando el rol invocado sea Developer, incluso si técnicamente el
   parámetro se configuró para ese rol — con un error claro y explícito, nunca un fallback
   silencioso a `api_key`. Esto es la implementación real y definitiva de ese rechazo, no un
   parche temporal — se mantiene vigente hasta que FEATURE-015 + FEATURE-016B lo reemplacen por
   la verificación real del gate (Regla 6).
8. Documentar la sub-sección de modo de autenticación en `docs/playbook/02-ARCHITECTURE.md`, con
   referencia explícita al análisis v1.1 y a esta Feature.

---

# 6. Estrategia Algorítmica (Opcional)

No aplica. Esta Feature no introduce lógica de decisión/optimización.

---

# 7. Technical Considerations

- El contrato `Executor.runPhase()` (`src/contracts/executor.ts`) no cambia — confirmado en el
  análisis original y no revisado por la validación empírica.
- **Sin dependencia de FEATURE-015**: a diferencia de FEATURE-016B, esta parte no requiere el
  patrón holder/worker ni ningún control de egress adicional — los roles cubiertos no tienen Bash
  habilitado, por lo que el perfil de riesgo de exfiltración de red no aplica de la misma forma
  que a Developer (ver Problem Statement).
- **Guardia de rechazo para Developer (Regla 7) es parte central de esta Feature, no un detalle
  menor**: debe implementarse y validarse con la misma seriedad que el resto del mecanismo, porque
  es lo que permite que 016A y 016B se entreguen en cualquier orden relativo sin riesgo de
  exposición accidental (ver Scope → Secuencia entre Features en `docs/ROADMAP.md`).
- Mecanismo de montaje del caché dedicado depende de si el Executor corre en host o contenedor —
  la investigación v1.1 (sección 8.3) confirmó portabilidad del archivo entre `HOME`s, pero el
  mecanismo concreto de mount en contenedor para estos 4 roles no fue validado todavía con
  evidencia real — queda como parte del Approval Gate.
- Reutiliza el patrón de aislamiento de entorno ya usado en el proyecto (H14) para no heredar
  variables sensibles del Orquestador hacia procesos hijos.

---

# 8. Validation Criteria

| Escenario | Input | Expected Output |
|---|---|---|
| `api_key` (default) sin cambios | Config sin `authMode` | Comportamiento idéntico al actual |
| `cli_session` en host, sesión válida (rol sin Bash) | Caché dedicado con credenciales válidas | Invocación headless exitosa, sin intervención humana |
| `cli_session` en host, sesión vencida | Caché con credenciales vencidas, sin refresh posible | Falla explícita con el mensaje de error definido, sin fallback |
| `cli_session` en contenedor, sesión válida (rol sin Bash) | Mismo caché montado de solo lectura dentro del contenedor | Invocación headless exitosa — **pendiente de validar con evidencia real, no cubierto todavía** |
| `cli_session` con refresh real | Token que vence a mitad de la ejecución, refresh nativo disparado por el CLI | Refresh exitoso, escritura solo en el caché dedicado, ninguna otra ruta modificada, la fase continúa |
| `cli_session` + Developer | Config intenta habilitar esta combinación, sin importar el estado de FEATURE-015 | Rechazado explícitamente por esta Feature (Regla 7), con error claro |
| Variables de entorno no filtradas | Invocación en `cli_session` para cualquiera de los 4 roles | El proceso hijo no hereda variables sensibles del Orquestador (mismo criterio que el fix de H14) |

### Validation Evidence

- Ejecución headless real, en host y en contenedor, para al menos uno de los 4 roles cubiertos,
  con sesión OAuth real y documentada.
- Al menos un ciclo de refresh real (no simulado) durante una invocación de uno de estos roles,
  con evidencia de que la escritura ocurrió únicamente en el caché dedicado.
- Prueba explícita del rechazo de Developer (Escenario correspondiente en la tabla), ejecutada
  independientemente del estado de FEATURE-015/016B.
- Verificación de que el proceso hijo no hereda variables de entorno sensibles del Orquestador.

Esta evidencia complementa las pruebas automatizadas y sigue el mismo patrón de validación real
documentada usado en `FEATURE-012-implementation-results.md` y
`FEATURE-014-implementation-results.md`.

---

# 9. Risks

- Límites de uso de un plan personal no caracterizados bajo el patrón de invocación repetida de
  un Orquestador (run tras run) — no se valida en esta Feature; riesgo operativo, no de diseño.
- Tensión con el ítem Tentativo "Concurrencia de runs simultáneos" — una sesión de cuenta
  personal puede no soportar paralelismo de la misma forma que API keys independientes; no
  bloquea esta Feature (hoy no hay concurrencia real), pero debe reevaluarse si esa Feature
  avanza.
- Revocar/cerrar una sesión de cuenta personal comprometida afecta al usuario en otros contextos
  (fuera del Orquestador) — no es tan limpio como rotar una API key.
- **Riesgo de percepción, no técnico**: esta Feature podría malinterpretarse como "ya resuelve
  OAuth para todos los roles". Debe quedar claro en cualquier comunicación o documentación
  derivada que Developer sigue explícitamente excluido y depende de FEATURE-015 + FEATURE-016B.
- Mecanismo exacto de mount del caché dedicado en contenedor no validado todavía con evidencia
  real (ver Technical Considerations) — es parte del Approval Gate, no una asunción resuelta.

---

# 10. Approval Gate

Implementación prohibida hasta aprobación explícita del owner. Antes de aprobar, validar con
evidencia real:

1. ☐ Mecanismo concreto de mount del caché OAuth dedicado en contenedor, para al menos uno de los
   4 roles cubiertos.
2. ☐ Al menos un ciclo de refresh real (no simulado) documentado.
3. ☐ La guardia de rechazo explícito de Developer (Regla 7) implementada y probada, independiente
   del estado de FEATURE-015/016B.
4. ☐ Confirmación de que ningún proceso hijo hereda variables de entorno sensibles del
   Orquestador bajo `cli_session`.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.