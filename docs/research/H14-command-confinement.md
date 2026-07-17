# Investigación H14 — Confinamiento real de comandos para agentes de código headless

Versión: v1.0
Fecha: 2026-07-17
Tipo: Análisis e investigación — **sin implementación**. Este documento es un insumo para decidir,
no una Feature.

---

## Resumen ejecutivo

1. **`--allowedTools "Bash(<patrón>)"` no impone una restricción real de comandos.** Confirmado con
   evidencia nueva (sección 2): comandos explícitamente no autorizados (`git log`, `whoami`, `echo`,
   `type`) se ejecutan sin bloqueo. Lo que sí bloquea algunos comandos (`env`, `/proc/self/environ`,
   `node -p "process.env..."`, comandos compuestos con `&&`) es un **heurístico interno y opaco de
   Claude Code** — no nuestro `allowedCommands`, no es configurable por nosotros, y no cubre todos
   los vectores (paginar con `| cat` lo evadió trivialmente en una prueba).
2. **El riesgo de exposición de variables de entorno está CONFIRMADO — y ya es real hoy en nuestro
   propio código**, independientemente de cualquier solución de sandboxing: `claudeCodeExecutor.ts`
   pasa `{ ...process.env, ANTHROPIC_API_KEY: apiKey }` al proceso hijo — es decir, **todo** el
   entorno del Orquestador (incluyendo `DATABASE_URL_DEV`) se hereda hoy en cada invocación, sin
   importar el rol. Esto es una corrección inmediata y de bajo riesgo, independiente de todo lo
   demás.
3. **Existe un mecanismo oficial no contemplado en el brief original: PreToolUse hooks.** Claude Code
   soporta interceptar el comando exacto de Bash antes de ejecutarlo vía un hook configurado en
   `--settings`, con capacidad real de aprobar/denegar. Es más robusto que un wrapper de shell
   externo, pero **requiere dejar de usar `--bare`**, que hoy los desactiva explícitamente.
4. **Recomendación (no es "elegí una de las dos"): las dos líneas propuestas no son sustitutas, son
   complementarias, y ninguna de las dos por sí sola es la prioridad más alta.** La prioridad #1 es
   el fix de variables de entorno (ya identificado, trivial). La prioridad #2 es el aislamiento por
   contenedor — no es una alternativa nueva, es completar una decisión de arquitectura **ya
   aprobada** en `02-ARCHITECTURE.md` ("Developer y QA corren en contenedor limitado a ese
   worktree") que nunca se implementó. El wrapper/hook de validación de comando exacto es una
   tercera capa, de menor prioridad, útil pero no esencial si el contenedor ya elimina red y limita
   el entorno.

---

## 1. Contexto: qué se sabía al empezar esta investigación

FEATURE-005 (`docs/features/FEATURE-005-implementation-results.md`, hallazgo H14) ya había
confirmado, con un intento de escape real, que `permissions.allowedCommands` mapeado a
`--allowedTools "Bash(<patrón>)"` no bloqueó `git log -1` (se ejecutó, solo "falló" porque no había
un repo git en el directorio de prueba — casualidad del entorno, no una restricción real). Un
intento de escritura de archivo sí fue bloqueado, pero por el sandbox de rutas ya conocido (H5), no
por una restricción de comandos.

Esta investigación repite y extiende esa prueba para caracterizar el mecanismo real con más
precisión, y responde las tres preguntas del brief.

---

## 2. Evidencia nueva — qué bloquea y qué no, y por qué

Se probó, contra la misma configuración híbrida (`filesystem: "read-only"`,
`allowedCommands: ["node --test allowed.test.mjs"]`, mapeado a
`--allowedTools "Bash(node --test allowed.test.mjs)"`), una batería de comandos NO autorizados:

| Comando | Resultado | Mecanismo real |
|---|---|---|
| `node --test allowed.test.mjs` (autorizado) | Ejecutado | — |
| `git log -1` | **Ejecutado** | Ninguno — no bloqueado |
| `git status` | **Ejecutado** | Ninguno — no bloqueado |
| `whoami` | **Ejecutado** | Ninguno — no bloqueado |
| `echo hello` | **Ejecutado** | Ninguno — no bloqueado |
| `type allowed.test.mjs` | **Ejecutado** | Ninguno — no bloqueado |
| `node --test allowed.test.mjs \| cat` | **Ejecutado** | Ninguno — no bloqueado (el pipe no disparó el heurístico) |
| `dir` | Bloqueado | "This command requires approval" (heurístico genérico) |
| `env` | Bloqueado | "This command requires approval" (heurístico genérico) |
| `node -e "console.log(1+1)"` | Bloqueado | "This command requires approval" (heurístico genérico) |
| `node -p "process.env.ANTHROPIC_API_KEY ? ... : ..."` | Bloqueado | "This command requires approval" |
| `set` | Bloqueado | "This command requires approval" |
| `cat /proc/self/environ` | Bloqueado | **Mensaje específico**: "Accesses /proc/*/environ which may expose secrets" |
| `node --test allowed.test.mjs && env` | Bloqueado | **Mensaje específico**: "This Bash command contains multiple operations. The following part requires approval: env" |

### Interpretación

El patrón NO es "todo lo que no matchea `allowedCommands` se bloquea" (eso sería la restricción real
que buscábamos). El patrón real es: **Claude Code tiene su propio heurístico interno, no
documentado ni configurable por nosotros, que reconoce un conjunto acotado de patrones
"sospechosos de exponer secretos o ser introspección del entorno"** (`env`, `/proc/*/environ`,
lectura directa de `process.env`, comandos compuestos con `&&` donde una parte matchea esos
patrones) **y los bloquea independientemente de nuestro `allowedCommands`**. Todo lo demás —
incluyendo comandos claramente fuera del alcance previsto para QA (`git log`, `whoami`) — se
ejecuta sin ninguna restricción real.

Esto **no es una función de seguridad que hayamos diseñado o que podamos confiar como límite** —
es un efecto colateral del propio entrenamiento/guardrails de Claude Code, con cobertura parcial y
demostrada como evadible (`| cat` lo esquivó trivialmente en una de las pruebas).

---

## 3. Riesgo de exposición de variables de entorno — CONFIRMADO, y ya presente en el código actual

Pregunta del brief: si el proceso Orquestador (con `ANTHROPIC_API_KEY` y `DATABASE_URL_DEV` reales)
hereda sus variables de entorno al proceso hijo que ejecuta el CLI.

**Confirmado por inspección directa del código, no solo por prueba empírica:**

```typescript
// src/executor/claudeCodeExecutor.ts, método spawnClaude
const child = spawn(this.claudeBinary, [...args, prompt], {
  cwd: this.options.workingDirectory,
  env: { ...process.env, ANTHROPIC_API_KEY: apiKey },   // <- todo el entorno del padre, heredado
});
```

`{ ...process.env, ... }` copia **absolutamente todas** las variables de entorno del proceso
Orquestador — incluyendo `DATABASE_URL_DEV` (con la contraseña de Postgres de desarrollo) — al
proceso hijo de Claude Code, en **cada invocación, de cualquier rol**, no solo Developer/QA.

Las pruebas de esta investigación muestran que el heurístico interno de Claude Code bloquea los
vectores más obvios (`env`, `/proc/self/environ`), pero:

- No es una garantía — es best-effort, no documentado, y demostrablemente evadible (`| cat`).
- No cubre vectores menos obvios que no se probaron acá (por ejemplo, un modelo real —no
  necesariamente adversarial, simplemente cumpliendo una tarea legítima de forma creativa— podría
  escribir un script intermedio, usar otro lenguaje/intérprete disponible en el `PATH`, o
  aprovechar una herramienta MCP si estuviera habilitada).
- Aunque el heurístico bloqueara el 100% de los intentos de leer el entorno, **esto no depende de
  nada que controlemos** — es una propiedad del proveedor que puede cambiar entre versiones sin
  aviso.

**Esto es corregible hoy, de forma aislada, sin esperar ninguna decisión de sandboxing más amplia**:
pasar al proceso hijo únicamente las variables estrictamente necesarias (`ANTHROPIC_API_KEY`, y las
mínimas de sistema como `PATH`), nunca el `process.env` completo del Orquestador. Es un cambio
acotado, de bajo riesgo, y cierra la exposición más seria (`DATABASE_URL_DEV`) independientemente de
qué se decida sobre el resto de H14.

---

## 4. Evaluación de las líneas de solución propuestas

### 4.1 Wrapper de shell (interceptar Bash con un script intermedio)

**Cómo funcionaría en teoría**: reemplazar/envolver el binario `bash`/`sh` que el CLI invoca
internamente por un script que valide el comando contra un allowlist antes de dejarlo correr.

**Problema de fondo**: Claude Code CLI no invoca un `bash` externo bajo nuestro control de forma
directa y estable — invoca su propia herramienta interna "Bash" (parte del binario `claude.exe`
mismo, no un subproceso `bash.exe`/`sh` separado que podamos sustituir de forma confiable en el
`PATH`). No hay garantía de que reemplazar el `bash` del sistema (en la VPS Linux, `/bin/bash`)
efectivamente intercepte lo que la herramienta interna del CLI ejecuta — es un detalle de
implementación no documentado, propenso a romperse entre versiones del CLI, y específico de un
solo proveedor (no se traslada a un futuro adaptador de Codex, que probablemente tenga su propia
implementación interna de "ejecutar comandos").

**Alternativa real dentro de la misma familia de idea — PreToolUse hooks (sección 5)**: Claude Code
sí expone un mecanismo **oficial y soportado** para exactamente este propósito (interceptar el
comando exacto antes de que se ejecute), sin necesidad de wrappear ningún binario del sistema. Es
la versión correcta de "Opción 1", pero implementada como el proveedor la soporta, no como un hack
externo.

**Veredicto sobre la Opción 1 tal como se planteó (wrapper de sistema)**: descartada — fragile,
específica del proveedor, no hay garantía de interceptar realmente la ruta de ejecución interna del
CLI. La versión viable de esta idea es la de la sección 5 (hooks), no un wrapper de `bash` del
sistema operativo.

### 4.2 Sandboxing a nivel de contenedor

**Motivo para adoptarlo, más allá de H14**: esto no es una idea nueva evaluada desde cero — **ya es
la arquitectura aprobada** (`02-ARCHITECTURE.md`, Constraints: *"Aislamiento obligatorio: cada run
debe tener su propio `git worktree`; Developer y QA corren en contenedor limitado a ese
worktree"*). FEATURE-002 validó el aislamiento por `git worktree`; el contenedor para Developer/QA
nunca se implementó (FEATURE-003/004/005 corrieron todo directamente en el host). H14 es, en los
hechos, la confirmación empírica de por qué esa decisión de arquitectura era necesaria desde el
principio, no un lujo.

**Qué resuelve realmente, con evidencia de esta sesión como referencia**:
- `--network none`: aunque un comando lograra leer una variable de entorno o un archivo sensible,
  no hay forma de exfiltrarlo a un destino externo. Esto neutraliza el riesgo más severo (fuga de
  credenciales hacia afuera) **independientemente de si el comando en sí se bloqueó o no**.
- Filesystem de solo lectura salvo el worktree montado: refuerza (no reemplaza) el sandbox de rutas
  ya validado (H5), a nivel de kernel en vez de depender de la lógica interna del CLI.
  usuario sin privilegios: limita el daño de cualquier comando que sí logre ejecutarse.
- Variables de entorno explícitas al contenedor (no heredadas del proceso Orquestador): cierra el
  hallazgo de la sección 3 de raíz, a nivel de la superficie del contenedor, no solo del código de
  `spawnClaude`.

**Costos reales**:
- Latencia agregada: crear/destruir un contenedor por invocación de fase tiene overhead (típicamente
  cientos de ms a pocos segundos en Docker moderno con una imagen ya cacheada localmente — no
  cientos de ms por invocación si la imagen no está cacheada y hay que descargarla, pero eso es un
  costo único). Comparado con los tiempos ya observados de las invocaciones reales de esta sesión
  (decenas de segundos a minutos por fase con modelos reales), el overhead de contenedor es
  marginal en proporción.
- Complejidad de implementación: media — requiere una imagen base (Node + git + lo que Developer
  necesite para instalar dependencias/correr tests), montar el worktree como volumen, y adaptar
  `ClaudeCodeExecutor` para invocar `docker run` en vez de `spawn` directo. No es trivial, pero
  tampoco es investigación nueva — Docker Engine ya está operativo en la VPS (Milestone 0).
- Generalización a Codex: alta — el contenedor no depende de mecanismos internos de Claude Code
  CLI, así que un futuro adaptador de Codex se beneficia del mismo aislamiento sin trabajo
  adicional.

**Veredicto**: adoptar. Es la solución de mayor robustez real (aplicación a nivel de kernel/OS, no
de lógica interna de un proveedor), ya estaba aprobada en la arquitectura, y generaliza bien.

---

## 5. Mecanismo no contemplado en el brief original: PreToolUse hooks

Claude Code soporta hooks que interceptan el ciclo de vida de una invocación de herramienta. El
relevante acá es `PreToolUse`, matcheado a la herramienta `Bash`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/ruta/a/validador-de-comando.sh",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

El script recibe por stdin un JSON con `tool_input.command` — el comando **exacto** que Claude Code
está por ejecutar — y puede responder con `permissionDecision: "deny"` para bloquearlo
explícitamente, con una razón. Esto es, literalmente, la implementación real de nuestro propio
`allowedCommands`: un validador que compara el comando propuesto contra el (los) comando(s)
autorizados de la invocación, y deniega cualquier otra cosa — a diferencia de `--allowedTools`, que
según la evidencia de la sección 2 no hace esto de forma confiable.

**La complicación real**: nuestro adaptador usa `--bare` (adoptado en FEATURE-001, H4, para forzar
autenticación exclusiva por `ANTHROPIC_API_KEY` sin depender de OAuth/keychain). El `--help` del
CLI declara explícitamente que `--bare` **desactiva los hooks** junto con otras funcionalidades. La
documentación oficial no aclara si `--settings` puede reintroducir hooks bajo `--bare` — hay que
asumir que no, dado lo explícito del texto de ayuda, y confirmarlo empíricamente antes de adoptar
este mecanismo (no se hizo en esta investigación — es exactamente el tipo de verificación empírica
que este proyecto exige antes de asumir comportamiento del proveedor).

**Veredicto**: mecanismo real y más robusto que un wrapper externo, pero **no gratis** — requiere
dejar `--bare` para las fases con Bash habilitado (Developer, QA) y volver a validar que la
autenticación por `ANTHROPIC_API_KEY` se sostenga sin él (no debería romperse — `--bare` solo
*fuerza* ese modo, no debería ser la única vía de lograrlo — pero es una suposición a verificar
empíricamente, no a asumir, antes de implementarlo). Se recomienda como una **capa adicional**, no
como sustituto del contenedor: incluso si el hook tiene un bug o un caso no cubierto, el contenedor
sin red y con entorno mínimo sigue conteniendo el daño.

---

## 6. A quién le aplica cada cosa (confirmación del planteo del brief)

Se confirma el análisis del brief:

- **Architect, Functional, Planning**: sin superficie — `Bash` no está en su toolset (H1). Nada de
  esta investigación les aplica; no necesitan contenedor ni hooks por este motivo (aunque
  podrían beneficiarse igual del contenedor por otras razones de aislamiento ya cubiertas por H5).
- **QA**: el caso más grave — el diseño asume confinamiento a un único comando, y esa suposición
  falló en la práctica (H14). Necesita la solución completa (contenedor + idealmente hook).
- **Developer**: mismo agujero de fondo (Bash sin restricción real de qué comando corre), pero
  "menos sorpresa" porque su tarea real requiere Bash relativamente amplio. El contenedor (sin red,
  entorno mínimo) es la mitigación que tiene sentido para Developer específicamente — un hook de
  "un solo comando permitido" no aplica a Developer por diseño (necesita `npm install`, `git`,
  correr el código, etc.), pero sí debería tener las mismas restricciones de red/entorno/filesystem
  que QA.

---

## 7. Recomendación concreta, priorizada

1. **Ahora, bajo riesgo, sin depender de nada más**: dejar de pasar `process.env` completo al hijo
   en `claudeCodeExecutor.ts` — pasar una allowlist explícita de variables (`ANTHROPIC_API_KEY` +
   las mínimas de sistema operativo que el CLI necesite, ej. `PATH`, `HOME`/`USERPROFILE`). Cierra
   la exposición de `DATABASE_URL_DEV` y cualquier otra variable del Orquestador hoy mismo,
   independientemente de cualquier otra decisión.
2. **Prioridad alta, completa una decisión de arquitectura ya aprobada**: implementar el
   aislamiento por contenedor para Developer y QA (`--network none`, filesystem read-only salvo el
   worktree montado, usuario sin privilegios, entorno explícito y mínimo pasado al contenedor). No
   es una Feature nueva conceptualmente — es implementar lo que `02-ARCHITECTURE.md` ya define y
   que las FEATURE-002 a 005 no llegaron a cubrir (todas corrieron en el host).
3. **Prioridad media, capa adicional, no sustituto**: evaluar PreToolUse hooks para el caso
   específico de QA (un único comando autorizado) — pero primero verificar empíricamente si
   funcionan sin `--bare` y si `ANTHROPIC_API_KEY` se sostiene sin él, antes de comprometerse. Si el
   contenedor (punto 2) ya está implementado, este punto deja de ser urgente — el contenedor ya
   contiene el daño de cualquier comando no autorizado que QA ejecute.
4. **No adoptar**: wrapper de shell a nivel de sistema operativo (sección 4.1) — descartado por
   fragilidad y por no generalizar a un futuro Codex.

Ninguno de estos puntos se implementó en esta sesión — quedan como insumo para una Feature futura
(candidata natural: "FEATURE-006 — Aislamiento por contenedor para Developer/QA", que además
destrabaría el riesgo BLOQUEANTE ya registrado en `01-PROJECT-CHARTER.md` a partir de H14).
