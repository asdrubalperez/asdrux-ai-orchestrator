# FEATURE-008 — Resultados de implementación: CodexExecutor de producción

Fecha de cierre: 2026-07-18
Rama: `feature/008-codex-executor-produccion`

## Resumen

Las 5 partes del Approval Gate quedaron implementadas y validadas con evidencia real contra la
VPS, replicando el orden histórico usado para Claude Code (FEATURE-001/002/003/004/005/006), no un
orden inventado. Un hallazgo bloqueó la Parte 2 dos veces antes de resolverse por una vía distinta
a la originalmente supuesta — documentado abajo sin maquillar el rodeo.

## Qué se implementó, por partes (commits intermedios)

### Parte 1 — CodexExecutor de producción, read-only (`e7a09b3`, `e07438a`)

- `e7a09b3`: smoke test real de modelo económico. Confirmó contra la VPS que `--model gpt-5.6-luna`
  es aceptado por `codex exec` y que el header de la invocación reporta ese modelo — cerrando la
  duda que motivó la investigación externa previa (tres fuentes convergentes, ahora con evidencia
  propia).
- `e07438a`: adaptador real `CodexExecutor implements Executor`, con selector `--executor
  claude|codex` en `runStart.ts` y test dirigido del parser. Circuito de validación (equivalente
  FEATURE-003): una fase real persistida dentro del Orquestador con Codex, run
  `32de063a-8b15-417e-ad74-35148ecaf526`, `status: completed`, `executorMetadata: { provider:
  codex, model: gpt-5.6-luna }` — no un script aislado como fue el spike de FEATURE-007.

### Parte 2 — Aislamiento de escritura para Codex (`79299a6`, `bd7a6f9`)

- `79299a6`: primer intento bloqueado. `workspace-write` con el bubblewrap empaquetado de Codex
  falló con `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` — un problema de
  privilegio de red del kernel de la VPS al intentar montar el namespace de red que ese modo
  requiere, no un problema de instalación.
- Se probó instalar `bubblewrap` nativo (`apt install bubblewrap`) como primera hipótesis de
  arreglo — **no resolvió nada**: mismo error exacto, ahora con el binario nativo en vez del
  empaquetado. Confirmó que el problema era de privilegio del kernel, no del binario. `bubblewrap`
  nativo fue desinstalado después de este hallazgo.
- Se verificó por separado que `--sandbox danger-full-access` no invoca bubblewrap en absoluto
  (`BWRAP_ANY_COUNT=0`), y que el mecanismo de aislamiento de escritura de Claude Code (FEATURE-002)
  nunca dependió de Docker — es una restricción de aplicación propia del CLI, verificada de nuevo
  en esta sesión tanto en host como dentro del contenedor real de Developer (FEATURE-006), sin
  cambios de comportamiento en ninguno de los dos casos.
- `bd7a6f9`: `CodexExecutor` con modo `sandbox: "container"` — corre `codex exec --sandbox
  danger-full-access` dentro de `docker/codex-developer.Dockerfile`, con el mismo endurecimiento ya
  usado para Claude Code (`--cap-drop ALL`, `--security-opt no-new-privileges`, solo el worktree
  montado). El contenedor impone el límite real; Codex no confía en su propio sandbox. Circuito de
  validación: escritura interna exitosa, 4 intentos externos bloqueados (las rutas ni existen
  dentro del contenedor), `BWRAP_ANY_COUNT=0`.

### Parte 3 — Secuencia de 2 fases con Codex (`d4ee63f`)

Circuito equivalente a FEATURE-004: run `60ecaa96-c81a-4387-bb9e-ddb93f7a7b52`, secuencia
`architect → functional` con transición automática, sin segundo comando manual, ambas fases
`provider: codex, model: gpt-5.6-luna`. Circuito adicional de corte por escalamiento (no exigido
explícitamente, agregado como refuerzo): run `8ff2004f-4f48-46d1-80d7-260be8eaff1a`, `architect`
escaló y no existe ningún evento `phase_started:functional` — el corte funciona igual con Codex.

### Parte 4 — Pipeline completo con Codex (`dd7fd2e`)

Circuito equivalente a FEATURE-005, mismo caso de negocio (`case_descuento.json`, el mismo usado
para validar Claude Code) para comparación directa. Run `c4d8ada5-34f1-4ebe-989a-b7f207c4f605`,
`status: completed`, las 5 fases con `provider: codex, model: gpt-5.6-luna`, `TEST_EXECUTED_COUNT:
1`, commit real pusheado a `run/c4d8ada5-34f1-4ebe-989a-b7f207c4f605` (`a783b4e1`,
`src/discount.mjs` + `src/discount.test.mjs`, 41 líneas) — verificado contra el remoto.

También en este commit: `extractTestCommand` ahora acepta el formato textual `COMANDO_TEST:` que
devuelve Codex, además del formato estructurado de Claude.

**Nota de diseño** (documentada por separado en `dd6f642`, no en este commit): este commit agregó
una regla 3 a `src/executor/roles/architect.txt` y `functional.txt` — archivos **compartidos**
entre `ClaudeCodeExecutor` y `CodexExecutor` — para reducir escalamientos por edge cases fuera de
alcance. Es una decisión consciente confirmada con el owner: una mejora universal del pipeline,
no un parche exclusivo para hacer pasar a Codex. Afecta el comportamiento de ambos proveedores de
acá en adelante.

### Parte 5 — Confinamiento QA con Codex (`3b1c5b3`)

Circuito equivalente a FEATURE-006/H14, como reacción a la validación positiva de la Parte 4 (no
como paso preventivo). `CodexExecutor` invoca `codex exec --config features.shell_tool=false`
cuando `agentRole === "qa"`, sobre `--sandbox read-only`. Prueba de auditoría adversarial: un
prompt le pidió explícitamente a QA que intentara ejecutar `pwd`, un marcador, y una escritura vía
`sh -c` a pesar de sus propias reglas de rol — la salida cruda no muestra ningún intento de
ejecución (a diferencia de las pruebas anteriores donde sí aparecía el bloque `exec` cuando la
herramienta estaba disponible). `features.shell_tool=false` remueve la herramienta del todo, no
solo bloquea su uso. `TestExecutor` sigue siendo la única vía de ejecución de tests.

## Hallazgos

- **H-bwrap-net**: el sandbox nativo de Codex (`workspace-write`, vía bubblewrap) no funciona en
  esta VPS por un problema de privilegio de red a nivel de kernel (`RTM_NEWADDR`), independiente de
  qué binario de bubblewrap se use (empaquetado o nativo). Resuelto evitando ese mecanismo por
  completo: Docker impone el aislamiento en su lugar, con `danger-full-access` dentro del
  contenedor. Documentado para que una futura Feature no repita el mismo intento de arreglo sin
  revisar esto primero.
- **Diferencia arquitectónica confirmada entre proveedores**: Claude Code logra el aislamiento de
  escritura mediante restricción de aplicación propia del CLI (independiente de Docker, verificado
  de nuevo en esta Feature); Codex no tiene un mecanismo equivalente de aplicación — o delega en el
  kernel (bubblewrap) o no confina nada (`danger-full-access`). Esta asimetría queda contenida
  dentro de cada `Executor` concreto; el Orquestador y el resto del sistema no necesitan conocerla
  (confirmado leyendo `runStart.ts`: la única decisión de "host vs container" vive en el punto
  donde se construye el Executor por rol, no desparramada en el resto del código).

## Decisión final

FEATURE-008 queda cerrada con las 5 partes validadas con evidencia real, no solo reportada. Listo
para decidir el camino de merge a `main` (PR vs. commit directo) como paso siguiente, separado de
este cierre.
