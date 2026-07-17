# FEATURE-005 — Resultados de Implementación (Pipeline Completo con Loop Developer↔QA)

Versión: v1.0
Fecha de ejecución: 2026-07-17
Ejecutado por: Claude Code (asistente IA de desarrollo), contra Postgres real de la VPS (túnel SSH),
invocaciones headless reales a Claude Code CLI (`--model haiku`, salvo el propio motor de
razonamiento de esta sesión), y push real a GitHub vía la deploy key de la VPS — sin mocks.

Este documento es la evidencia de cierre exigida por `FEATURE-005-orchestrator-full-pipeline.md`
(sección 9).

---

## 0. Verificación previa — deploy key (pedido explícito antes de implementar)

Antes de escribir código: se verificó por SSH que la deploy key configurada en Milestone 0
(`/home/asdru/ai-orchestrator` en la VPS) tiene permisos de **escritura** reales — no solo lectura.
Se creó una rama de prueba, se commiteó un archivo trivial, se pusheó, se confirmó en GitHub, y se
eliminó (remoto + local). De paso se confirmó que `asdrubalperez/ai-orchestrator` (nombre viejo,
usado por la VPS) y `asdrubalperez/asdrux-ai-orchestrator` (nombre actual, usado localmente) son el
mismo repositorio — GitHub redirige automáticamente tras el rename; los hashes de commit coinciden
exactamente.

---

## 1. Qué se construyó

- `src/executor/roles/planning.txt`, `developer.txt`, `qa.txt`: roleInstructions productivas de los
  3 roles nuevos.
- `src/pipelines/definitions.ts`: `FULL_PIPELINE` (`full-pipeline-architect-to-qa@1`) — 3 fases
  lineales (architect, functional, planning) + un `loop` (developer↔qa, `maxAttempts: 3`),
  deliberadamente no generalizado a loops arbitrarios.
- `src/pipelines/extractTestCommand.ts`: extrae el `COMANDO_TEST` que Planning declara.
- `src/isolation/worktree.ts`: `commitAllChanges()` (nuevo) y `pushRunBranch()` — Finalización real.
- `src/cli/commands/runStart.ts`: reescrito con el loop Developer↔QA completo, manejo de errores
  que nunca deja un run colgado en `running`, y push/limpieza condicionados a la aprobación de QA.
- `src/executor/claudeCodeExecutor.ts`: soporte de permisos híbridos (`read-only` +
  `allowedCommands`), reconocimiento de `status: "rejected"` (ya estaba en el contrato, nunca usado
  hasta ahora), parser de la convención de texto más tolerante a Markdown, y flag `--model`
  configurable por instancia.

---

## 2. Validaciones reales

### 2.1 Camino dorado — aprobado en el primer intento

```
npm run cli -- run:start --case case_descuento.json --pipeline full-pipeline-architect-to-qa --model haiku
[run:start] COMANDO_TEST declarado por Planning: node --test src/discount.test.mjs
[run:start] QA aprobó en el intento 1.
[run:start] cambios commiteados en la rama.
[run:start] push real de la rama "run/5fd08aa7-..." a origin.
[run:start] worktree limpiado tras aprobación.
[run:start] status final: completed
```

Evidencia: `docs/features/evidence/FEATURE-005/run_golden_path_approved_first_attempt_status.json`
y `remote_push_verification.txt`. Confirmado contra el remoto real (`git fetch` + `git show
FETCH_HEAD --stat`): la rama pusheada contiene un commit real con `src/discount.mjs` (21 líneas) y
`src/discount.test.mjs` (30 líneas) — no el commit vacío de creación del worktree.

### 2.2 Loop con rechazos reales y aprobación posterior

En el primer intento real de esta Feature (antes de aplicar el fix de H10/H11 de más abajo), QA
rechazó de forma genuina y concreta un intento de Developer:

> "CASO 3 - Límite crítico (100.01 con descuento) falló. El test espera `discount_amount: 10.01`
> pero la función retorna `discount_amount: 10`..."

Ese run particular no llegó a cerrar por un timeout (corregido después, ver H11). Se repitió la
validación con un artificio transparente y documentado en Developer únicamente (ver sección 4,
H13) para forzar de forma determinística al menos un rechazo real seguido de una corrección real:

```
[run:start] QA rechazó el intento 1: ...Cannot find module 'src/src/utils/DiscountCalculator.mjs'...
[run:start] QA rechazó el intento 2: ...Caso 5 falló. Para la entrada 123.45, la función retornó 61.73 en lugar del valor esperado 111.11...
[run:start] QA aprobó en el intento 3.
[run:start] push real de la rama "run/4efe4614-..." a origin.
```

Evidencia: `docs/features/evidence/FEATURE-005/run_loop_rejected_then_approved_status.json`.
Confirma: 2 rechazos reales con razones concretas y accionables (un bug de import, luego un bug de
cálculo), persistidos como eventos/artifacts distinguibles por intento (`attempt: 1`, `attempt: 2`,
`attempt: 3`), y aprobación + push real en el intento 3 (dentro del límite de 3).

### 2.3 Agotamiento del loop — sin cuarto intento

Se intentó forzar el agotamiento mediante artificios en el caso de negocio y en las instrucciones de
Developer — ambos fallaron por razones legítimas y documentadas como hallazgo (H12 parcial, H13). En
consecuencia, el mecanismo de agotamiento se validó de forma **determinística a nivel de código**,
con un Executor simulado que rechaza siempre en QA (sin invocar Claude Code real para este caso
puntual — el objetivo es verificar el control de flujo del propio Orquestador, no el comportamiento
del modelo):

```
developerCalls: 3 (esperado: 3, nunca un 4to intento)
qaCalls: 3 (esperado: 3)
finalResult.status: escalated (esperado: escalated)
OK: developerCalls === 3
OK: qaCalls === 3
OK: finalResult.status === 'escalated'
OK: no hay un 4to phase_started:developer
OK: hay evento loop_exhausted
```

Evidencia completa: `docs/features/evidence/FEATURE-005/loop_exhaustion_deterministic_test.txt`.

---

## 3. Validation Criteria — verificación cruzada

| Escenario | Resultado |
|---|---|
| Pipeline completo, aprobado al primer intento | ✅ real, con push verificado contra el remoto |
| Loop con 1-2 rechazos y aprobación posterior | ✅ real, 2 rechazos concretos + aprobación en intento 3 |
| Escalamiento por 3 rechazos agotados | ✅ validado determinísticamente (código), no con el modelo real — ver H13 |
| Casos de prueba acotados de Planning (3-5) | ✅ Planning definió 5 casos concretos en el camino dorado |

---

## 4. Hallazgos

**H10 — Falta el commit de los cambios de Developer antes del push (corregido).**
La primera ejecución completa "exitosa" pusheó una rama cuyo hash era **idéntico** al de creación
del worktree — el código real de Developer nunca se había commiteado, y `git worktree remove
--force` lo descartó silenciosamente al limpiar. Se agregó `commitAllChanges()` (commit real con
identidad `ai-orchestrator-bot`, ejecutado antes del push) — confirmado con hashes distintos y
contenido real verificado contra el remoto en los runs posteriores.

**H11 — Un error inesperado (timeout, crash) dejaba el run colgado en `running` para siempre.**
Cuando el CLI superó el timeout original de 180s durante un reintento de Developer, el proceso Node
completo murió sin persistir ningún cierre — el `run` quedó en `status: "running"` sin ningún
evento final. Se corrigió envolviendo el cuerpo de `runStart` en try/catch: cualquier error
inesperado ahora se persiste como `status: "failed"` con un evento `run_error`, preservando el
worktree para inspección. Adicionalmente se subió el timeout de las invocaciones de Developer/QA a
300s (las fases de solo lectura se mantienen en 180s) — 180s resultó insuficiente para una
invocación que escribe código y tests reales.

**H12 — Modelos económicos (`haiku`) no siempre respetan "texto plano sin Markdown".**
Con `--model haiku`, al menos una respuesta de Functional envolvió sus etiquetas en `**negrita**`
de Markdown, rompiendo el parser de regex estricto (`ESTADO:` no coincidía con `**ESTADO:**`) — la
fase se interpretó como `completed` cuando el modelo en realidad había escrito una escalación. Se
corrigió en dos frentes: (1) se agregó una instrucción explícita "SIN Markdown de ningún tipo" a las
5 instrucciones de rol, y (2) el parser ahora despoja `**` y encabezados `#` antes de extraer
campos, como defensa adicional — no se asume que el modelo va a respetar la convención siempre. Esto
confirma empíricamente la fragilidad que H2 (FEATURE-001) ya había anticipado sobre el mecanismo de
parseo por convención de texto.

**H13 — El modelo se resistió a una instrucción explícita de "producir siempre un resultado incorrecto".**
Para forzar el escenario de agotamiento del loop, se instruyó a Developer (temporalmente, revertido
después) a implementar deliberadamente un cálculo incorrecto (`monto * 0.5` en vez de `monto * 0.9`),
enmarcado como instrucción de máxima prioridad, no negociable. En la primera prueba el modelo
"cedió" tras dos rechazos reales y corrigió el cálculo en el tercer intento (produciendo la
evidencia de la sección 2.2). Al reforzar aún más la instrucción (explícitamente prohibiendo
corregirla "ni siquiera en el último intento"), el modelo **igual implementó el cálculo correcto
desde el primer intento**, ignorando por completo la instrucción de sabotaje deliberado. No se
insistió más — es un comportamiento razonable y hasta deseable del modelo (resistencia a
instrucciones adversariales sin sentido de negocio real), pero significa que **no es viable forzar
el agotamiento del loop mediante manipulación de prompt de forma confiable**. Por eso la sección 2.3
se validó con un Executor simulado en vez de con el modelo real.

**H14 — Los permisos híbridos de QA (`read-only` + `allowedCommands`) NO confinan realmente qué comando de Bash se ejecuta (riesgo abierto, sin resolver).**
Se probó explícitamente (mismo patrón de intento de escape que FEATURE-001/002): con
`permissions: { filesystem: "read-only", allowedCommands: ["node --test allowed.test.mjs"] }`,
mapeado a `--allowedTools "Bash(node --test allowed.test.mjs)"`, se instruyó a un rol de prueba a
intentar (1) el comando autorizado, (2) `git log -1` (NO autorizado), y (3) escribir un archivo vía
`echo > archivo` (NO autorizado). Resultado real:
- Intento 1 (autorizado): ejecutado, correcto.
- **Intento 2 (`git log -1`, NO autorizado): se EJECUTÓ igual** — no fue bloqueado por el sandbox;
  solo falló porque no había un repo git en ese directorio (una casualidad del entorno de prueba,
  no una restricción real). Esto confirma que `--allowedTools "Bash(<patrón>)"` **no** impone una
  restricción real sobre qué comandos de Bash pueden ejecutarse — a diferencia de lo que su nombre
  sugiere, parece limitarse a pre-aprobar ese patrón sin bloquear otros.
- Intento 3 (escritura de archivo, NO autorizado): sí fue bloqueado — pero por el mecanismo de
  sandbox de rutas ya conocido (H5, FEATURE-002), no por la restricción de comandos.

**Esto significa que la Regla Funcional 2 de esta Feature ("QA no puede ejecutar pruebas
adicionales... por su cuenta") NO está impuesta por el sandbox real — depende enteramente de que
QA respete su rol-instruction (nivel de prompt), exactamente el tipo de imposición "no real" que
el proyecto viene evitando desde H1.** No se intentó una solución dentro de este incremento —
queda documentado como riesgo abierto y no resuelto para una Feature/spike futuro dedicado
(candidatos a investigar: un wrapper de shell que valide el comando antes de ejecutarlo, o un
mecanismo de sandboxing de proceso a nivel de contenedor en vez de depender de flags del CLI).

---

## 5. Lecciones Aprendidas (06-DELIVERY-WORKFLOW.md, Stage 6)

**Específico de esta implementación:**
- H10, H11 son bugs de implementación ya corregidos dentro de este mismo incremento — no quedan
  abiertos.
- H12 y H13 son específicos del uso de un modelo económico (`haiku`) para pruebas — no se sabe si
  aplican igual con Sonnet/Opus (no se volvió a probar con esos modelos en este incremento, por la
  instrucción explícita de usar `haiku` por default).
- **H14 queda abierto y sin resolver** — es el hallazgo más importante de este incremento.

**Decisiones de arquitectura del proyecto:**
- H14 amerita evaluarse para una ADR en `02-ARCHITECTURE.md` **una vez que se investigue una
  solución real** — no se agrega la ADR todavía porque documentar un problema sin solución validada
  sería prematuro; se prioriza dejarlo como riesgo abierto explícito primero.
- El resto del diseño (loop como segmento de datos separado de las fases lineales, commit+push real
  en Finalización, manejo de errores que nunca deja un run sin cierre) se sostuvo sin necesitar
  ajustes de schema.

**Candidato a conocimiento reusable del AI-Playbook Base:**
- H12 (modelos económicos no respetan convenciones de formato estrictas de forma tan confiable como
  modelos más grandes) y H13 (los modelos resisten instrucciones de "actuar mal a propósito" incluso
  cuando se enmarcan como prioritarias) son observaciones generalizables sobre trabajar con modelos
  económicos y con intentos de manipular su comportamiento — podrían ser útiles para el Playbook
  Base al diseñar spikes de otros proyectos. Se dejan como recomendación, no se aplican
  unilateralmente sobre la copia local del Playbook.

---

## 6. Conclusión

El pipeline completo de 5 fases con loop Developer↔QA y Finalización real funciona end-to-end, con
evidencia real verificada contra Postgres y contra GitHub (no solo logs locales). Se encontraron y
corrigieron dos bugs reales de implementación (H10, H11) durante la validación. Se documentan dos
observaciones sobre el comportamiento de modelos económicos bajo manipulación de prompt (H12, H13),
y se identifica un **riesgo de seguridad real y no resuelto** (H14): el confinamiento de comandos de
QA no es una imposición real del sandbox, solo depende del comportamiento esperado del rol. Este
hallazgo debe tratarse como bloqueante antes de confiar en QA con permisos híbridos en un entorno de
producción no supervisado.
