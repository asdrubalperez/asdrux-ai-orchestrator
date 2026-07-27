# FEATURE-021 — Build determinístico garantizado por el Orquestador entre Developer y QA

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: Surge de un hallazgo real durante la validación E2E de FEATURE-020 (ver
> `docs/features/FEATURE-020-*.md`, Lecciones Aprendidas). Este número reemplaza al ítem viejo
> "Adaptación de FEATURE-018 al mecanismo de FEATURE-019", que quedó absorbido sin trabajo propio
> por la implementación real de FEATURE-019/020 (verificado contra `main`, sin resto del modelo
> viejo). No confundir ambos significados históricos del número 021.

---

## 1. Feature Identity

- **Name**: Build determinístico garantizado por el Orquestador entre Developer y QA
- **Type**: Backend (motor de pipeline, `runDeveloperQaLoop`, nuevo componente `BuildExecutor`,
  `parseTestCommand`)
- **Owner**: asdru
- **Status**: 🟡 En Diseño
- **Priority**: Alta — bloqueó la validación end-to-end de FEATURE-020

---

## 2. Problem Statement

Durante la prueba real de FEATURE-020, el `COMANDO_TEST` declarado por Planning incluía un paso de
compilación (`"npm run build && node --test dist/....test.js"`). Esto falló repetidamente, en dos
Features distintas de la misma sesión, con el error `TS5042` (`tsc`: *"Option 'project' cannot be
mixed with source files on a command line"*).

Se confirmaron dos causas reales, independientes entre sí:

1. **QA es intencionalmente de solo lectura.** `qaPolicy.ts` (`filesystem: "read-only"`) y
   `qaRuntime.ts` (`--read-only` en Docker) — decisión deliberada, no un descuido (Regla 10,
   Ownership de Artefactos: QA valida, no produce). QA y Developer comparten el mismo
   `worktree.worktreePath` (`runStart.ts:838,843`, no un clon separado) — el build que Developer
   hace en su propio turno queda físicamente en el worktree, pero cualquier intento de
   **recompilar** en el turno de QA falla con `EROFS`, sin importar que el build de Developer ya
   esté ahí.
2. **Bug confirmado en `parseTestCommand`** (`src/testing/testExecutor.ts:104`): divide
   `COMANDO_TEST` únicamente por espacios en blanco — el propio comentario del código ya lo
   documenta como *"simplificación conocida, no un parser de shell completo"*. Para un comando con
   `&&`, produce tokens sueltos (`["run","build","&&","node","--test","dist/x.test.js"]`),
   ejecutados con `spawn(..., { shell: false })` (línea 62, sin shell real) — npm recibe todo como
   argumentos crudos y reenvía los sobrantes al script `build` (`tsc`), causando `TS5042` siempre
   que `COMANDO_TEST` tenga `&&`, sin importar el contenido del proyecto.

**Restricción de diseño no negociable**: `shell: false` es una decisión de seguridad deliberada de
FEATURE-006 ("secure-execution-isolation", resuelve H14) — *"el `TestExecutor` nunca acepta ni
construye un comando como string — siempre `executable` + `args` estructurados, invocado con
`shell: false`"* (`docs/features/FEATURE-006-secure-execution-isolation.md:36,52,72`). Ninguna
solución de esta Feature puede introducir un shell real que interprete un string arbitrario —
reabriría el riesgo de inyección que esa Feature cerró a propósito.

Se evaluaron 3 opciones (Discovery conjunto owner + Architect + validación técnica de Claude Code):

- **QA puede escribir/compilar**: descartada. No aporta nada que la opción elegida no dé gratis —
  QA repitiendo un build que Developer ya hizo no gana determinismo (dependería igual de que el
  LLM de QA decida correrlo bien), y amplía la superficie de un rol cuyo valor específico
  (FEATURE-006) es ser el extremo minimal/read-only del pipeline.
- **QA nunca recompila, confía en lo que Developer dejó**: viable a corto plazo (Developer ya
  tiene `command_exec` + `workspace-write` en su propio turno, confirmado en
  `contracts.ts:91`/`roleWiring.test.ts:39`), pero sin garantía estructural — `developer.txt` no
  tiene ninguna instrucción de compilar como último paso (confirmado, cero menciones a
  "build"/"compilar"). Un `dist/` desactualizado generaría un **falso positivo de aprobación** (QA
  valida código viejo y lo deja pasar), no un escalamiento visible — consecuencia más grave que
  otras convenciones H12 ya toleradas en este código (`ROADMAP`, `FEATURES`).
- **El Orquestador garantiza el build, como infraestructura, entre el turno de Developer y el de
  QA** (elegida): mismo patrón de diseño que el propio código ya validó para el problema gemelo
  (`TestExecutor`: *"no confiar en que un agente lo haga bien, hacerlo en código estructurado"*).

---

## 3. Functional Goal

1. Entre el turno de Developer y el de QA, el Orquestador garantiza un build fresco y
   determinístico del proyecto gestionado, sin depender de que ningún agente (Developer o QA)
   decida correrlo o recuerde hacerlo bien.
2. `COMANDO_TEST`, tal como lo declara Planning, deja de necesitar nunca un paso de compilación —
   pasa a ser siempre un único comando de ejecución de tests ya compilados.
3. Si el build falla, se trata como responsabilidad de Developer (Regla 10, Ownership de
   Artefactos) — se alimenta como contexto al siguiente intento de Developer, dentro del mismo
   contador de intentos ya existente (`maxAttempts`), sin invocar a QA ese intento.
4. Proyectos sin paso de compilación (JS plano, sin `scripts.build` en `package.json`) no ven
   ningún cambio de comportamiento — el paso nuevo es un no-op limpio, sin costo.
5. `parseTestCommand` deja de fallar de forma confusa ante un `COMANDO_TEST` compuesto (con `&&`,
   `;`, `|`) — rechaza explícitamente con un error claro, en vez de producir tokens sueltos que
   terminan en un fallo de aspecto distinto (como el `TS5042` de esta prueba).

---

## 4. Scope

**Incluido:**
- Nuevo componente `BuildExecutor` (análogo a `TestExecutor`, mismo perfil de seguridad Docker
  salvo el montaje de filesystem): detecta por convención si el proyecto tiene paso de build
  (`scripts.build` en el `package.json` del worktree), y si existe, corre `npm run build` de forma
  estructurada — nunca interpreta el contenido del script, es `npm` quien lo resuelve
  internamente.
- Integración en `runDeveloperQaLoop` (`runStart.ts:802-930`): el paso nuevo se ejecuta
  inmediatamente después de que Developer complete (`developerResult.status === "completed"`) y
  antes de invocar a `TestExecutor`/QA.
- Manejo de fallo de build como responsabilidad de Developer — mismo contador `maxAttempts`, sin
  invocar a QA ese intento, sin inventar un mecanismo de reintento nuevo.
- Ítem chico de deuda técnica, incluido en el alcance: `parseTestCommand` rechaza explícitamente
  (`throw`) si detecta `&&`, `;` o `|` en el string recibido, en vez de dividirlo tal cual.
- Nuevo evento (`build_executed`, análogo a `test_executed`) para trazabilidad — se registra
  siempre que el paso corra (no cuando es no-op).

**Excluido:**
- Cualquier cambio a la política de QA (`qaPolicy.ts`/`qaRuntime.ts`) — QA sigue siendo de solo
  lectura, sin cambios.
- Un campo `COMANDO_BUILD` declarado por Planning — se descarta deliberadamente, reintroduciría el
  mismo riesgo (depender de que un LLM lo declare bien) que esta Feature busca eliminar.
- Soporte para gestores de paquetes distintos de `npm` (yarn, pnpm) — fuera de alcance por ahora,
  el proyecto de prueba usa `npm`; queda como ítem futuro si hace falta generalizar.
- Un parser de shell real para `parseTestCommand` — explícitamente descartado por la restricción
  de seguridad de FEATURE-006 (sección 2). El rechazo explícito (`throw`) es la única forma
  aceptable de tratar un `COMANDO_TEST` compuesto.

---

## 5. Functional Rules

1. El paso de build corre siempre en un contenedor efímero nuevo, separado tanto del de Developer
   como del de QA — nunca reutiliza `TestExecutor` (que es `:ro`).
2. La detección de si corresponde correr el paso es por convención (`scripts.build` presente y no
   vacío en el `package.json` del worktree) — nunca por un campo declarado por ningún rol.
3. Si no hay paso de build que correr, el pipeline continúa exactamente igual que hoy — cero
   invocaciones, cero eventos nuevos, cero costo.
4. Un build fallido nunca invoca a QA en ese intento — se atribuye a Developer, consumiendo uno de
   los `maxAttempts` ya existentes, con el error de build como contexto para el intento siguiente
   de Developer, en un campo propio (`buildFailureReason`, ver 6.2 y 6.4) — nunca reusando ni
   falseando `qaRejectionReason`/`previousAttemptSummary`, que corresponden a resultados reales de
   QA/Developer. `buildFailureReason` y `qaRejectionReason` son mutuamente excluyentes (ronda 2 de
   validación técnica): si el motivo inmediato del reintento es un build roto, ese es el único
   motivo que ve Developer — un `qaRejectionReason` de un intento anterior no se cuela junto a un
   fallo de build más reciente. Si el build sigue fallando al llegar al último intento (`attempt
   === maxAttempts`), se escala a humano explícitamente (mismo patrón que `loop_exhausted` cuando
   QA agota sus intentos) — nunca se deja que el loop termine sin haber invocado a QA ni una vez y
   sin un resultado final válido.
5. El comando que corre el paso de build es siempre, literalmente, `npm run build` — nunca el
   contenido textual del script tal como aparece en `package.json` (evita reintroducir cualquier
   forma de interpretación de string).
6. `COMANDO_TEST`, a partir de esta Feature, nunca debería necesitar `&&` — si Planning lo declara
   igual con un operador de shell, `parseTestCommand` lo rechaza explícito antes de ejecutar nada.
7. El nuevo contenedor de build mantiene el mismo perfil de seguridad que `TestExecutor`
   (`--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--user node`, límites
   de `--pids-limit`/`--memory`/`--cpus`) — la única diferencia deliberada es el montaje de
   filesystem (`:rw` en vez de `:ro`, sin `--read-only`).
8. Un `package.json` que existe pero no es JSON parseable **no** se trata igual que uno ausente
   (ronda 2 de validación técnica) — un `package.json` ausente (específicamente `ENOENT` — el
   archivo genuinamente no existe, ronda 3) es no-op limpio (Regla 3); uno presente pero corrupto
   se trata como un build fallido más (Regla 4), atribuible a Developer, nunca como una categoría
   de escalamiento de infraestructura aparte. Cualquier otro error al intentar leer
   `package.json` (permisos, I/O, path inaccesible — no `ENOENT`) **tampoco** es "ausente": es un
   error real de infraestructura y se propaga como excepción, igual que ya hace
   `TestExecutor.run()` hoy — sin agregar un mecanismo de manejo nuevo para ese caso.

---

## 6. Technical Considerations

### 6.1 Nuevo componente `BuildExecutor`

Análogo estructural a `TestExecutor` (`src/testing/testExecutor.ts`), mismo perfil Docker con un
solo cambio deliberado. **`BuildExecutionResult` se mantiene como interfaz plana** (no una unión
discriminada) — consistente con el estilo de `TestExecutionResult`, el análogo ya existente:

```ts
export interface BuildExecutionResult {
  ran: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const BUILD_RUNNER_IMAGE = "node:22-alpine"; // misma familia que docker/developer.Dockerfile

export class BuildExecutor {
  async runIfNeeded(workingDirectory: string, timeoutMs: number): Promise<BuildExecutionResult> {
    const buildScriptCheck = await this.checkBuildScript(workingDirectory);

    // "missing" (no hay package.json) y "no-script" (hay package.json, pero sin scripts.build)
    // son AMBOS no-op limpio — ninguno es responsabilidad de Developer, el proyecto simplemente
    // no tiene paso de build (Regla 3/8, ver 6.2 corregido en la ronda 2 de validación).
    if (buildScriptCheck === "missing" || buildScriptCheck === "no-script") {
      return { ran: false, exitCode: null, stdout: "", stderr: "", timedOut: false };
    }

    // "invalid" (package.json existe pero no es JSON parseable) NO es lo mismo que "missing" —
    // tratarlo como no-op dejaría a QA validando un dist/ viejo si Developer rompió el archivo
    // por accidente (tiene escritura sobre todo el worktree). Se modela como un build fallido más
    // (mismo camino que un exitCode !== 0, ver 6.2), no como una categoría de escalamiento nueva —
    // sigue siendo responsabilidad de Developer (Regla 10, dueño del estado del repo).
    if (buildScriptCheck === "invalid") {
      return {
        ran: true,
        exitCode: null,
        stdout: "",
        stderr: `package.json en ${workingDirectory} no es JSON válido — no se pudo determinar si hay un paso de build.`,
        timedOut: false,
      };
    }

    const dockerArgs = [
      "run", "--rm",
      "--network", "none",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--user", "node",
      "--pids-limit", "128",
      "--memory", "256m",
      "--cpus", "1",
      "-v", `${workingDirectory}:/workspace:rw`, // única diferencia real vs TestExecutor
      "--workdir", "/workspace",
      BUILD_RUNNER_IMAGE, "npm", "run", "build", // siempre literal, nunca el string del script
    ];
    // spawn(..., { shell: false }) — mismo criterio que TestExecutor, sin excepción. Un error de
    // spawn (docker no disponible, etc.) rechaza la promesa igual que hoy hace TestExecutor.run()
    // (child.on("error", ...) → reject) — no se agrega ningún manejo nuevo acá: se propaga hasta
    // el mismo catch genérico de executePipelineRun que ya maneja cualquier otro fallo de
    // infraestructura del pipeline (run_error → finishRun status "failed"). Ver 6.2, nota de
    // la ronda 2.
    // ... ejecutar, capturar stdout/stderr/exitCode/timedOut, return { ran: true, ... }
  }

  /**
   * Distingue 3 casos, no 2 (ronda 2 de validación técnica — el diseño original solo
   * distinguía "hay build script" sí/no, tratando un `package.json` corrupto igual que uno
   * ausente):
   * - "missing": no existe `package.json` — específicamente `ENOENT`, ver más abajo (ronda 3,
   *   corrige una inconsistencia real con la Regla 8). No-op limpio.
   * - "invalid": existe pero `JSON.parse` falla — NO es "missing", ver arriba.
   * - "no-script": es JSON válido pero sin `scripts.build` (o vacío) — no-op limpio.
   * - "present": `scripts.build` es un string no vacío.
   *
   * **Corregido en la ronda 3 de validación técnica**: el `catch` de `readFile` original
   * capturaba *cualquier* error (permisos, I/O, path inaccesible, etc.) y lo trataba igual que
   * "no existe el archivo" — inconsistente con la propia Regla 8 de este documento, que ya
   * establece que un error real de infraestructura debe propagarse como excepción, no leerse
   * como "no hay build". Un error de lectura que no sea `ENOENT` (el archivo genuinamente no
   * existe) ahora se re-lanza — llega al mismo manejo genérico de infraestructura que ya
   * describe 6.1 para errores de `spawn`/Docker (`executePipelineRun`, `run_error` → `finishRun`
   * status `"failed"`), sin agregar ningún mecanismo de manejo nuevo.
   */
  private async checkBuildScript(workingDirectory: string): Promise<"missing" | "invalid" | "no-script" | "present"> {
    let raw: string;
    try {
      raw = await readFile(path.join(workingDirectory, "package.json"), "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return "missing";
      }
      throw error; // permisos, I/O, etc. — error real, no "no hay build" (Regla 8)
    }
    let pkg: unknown;
    try {
      pkg = JSON.parse(raw);
    } catch {
      return "invalid";
    }
    const buildScript = (pkg as { scripts?: { build?: unknown } } | null)?.scripts?.build;
    return typeof buildScript === "string" && buildScript.trim().length > 0 ? "present" : "no-script";
  }
}
```

Nota deliberada: **no** se usa `--read-only` (a diferencia de `TestExecutor`) — es la única
diferencia real de perfil de seguridad, exactamente la que hace falta para poder escribir `dist/`.

### 6.2 Integración en `runDeveloperQaLoop`

**Corregido en la ronda 1 de validación técnica** — el snippet original de esta sección tenía 2
defectos reales, encontrados al resolver el pedido explícito de esa ronda ("proponer el mecanismo
concreto para devolverle a Developer un build roto", que el documento original dejaba sin resolver
a nivel de código):

1. Mutar `lastDeveloperResult`/`lastQaResult` con un `escalationReason` sintético no funciona:
   `developerContext` (`runStart.ts:827-834`, sin cambios de esta Feature) nunca lee
   `.escalationReason` — solo `.summary` de cada uno. Developer nunca hubiera visto el error de
   build real.
2. El `continue` no tenía ninguna ruta de agotamiento: si el build falla en los `maxAttempts`
   intentos, el `for` termina sin haber invocado a QA ni una vez, y el `return lastQaResult as
   PhaseResult` final del loop (`runStart.ts:937`) devolvería `null` — rompiendo el resto del
   pipeline (`finishRun`/`finalizeRun` esperan un `PhaseResult` real).

**Corregido en la ronda 2 de validación técnica (Architect, vía revisión externa)** — un 3er
defecto en el snippet de la ronda 1: `developerContext` incluía `qaRejectionReason` y
`buildFailureReason` **a la vez**, sin exclusión mutua. Escenario que lo rompe: intento 1, QA
rechaza (real); intento 2, Developer corrige pero rompe el build (nunca llega a invocar a QA,
`lastQaResult` queda sin tocar); intento 3 recibiría el `buildFailureReason` real del intento 2
**junto con** el `qaRejectionReason` viejo del intento 1 — contexto stale que puede ya no tener
nada que ver con lo que rompió el build en el medio. Corregido haciendo que ambos campos sean
mutuamente excluyentes: si hay un fallo de build pendiente, ese es el único motivo que se muestra;
`qaRejectionReason` solo aparece cuando el motivo inmediato del reintento fue un rechazo de QA real.

Mecanismo corregido: una variable dedicada (`lastBuildFailureSummary`), nunca se falsea el
resultado real de Developer/QA, un bloque de agotamiento explícito que espeja el que ya existe
para el rechazo de QA (`runStart.ts:922-932`), y los dos motivos de reintento (build vs. QA) se
excluyen mutuamente en el contexto.

Nueva variable, declarada junto a `lastDeveloperResult`/`lastQaResult` (`runStart.ts:820-821`):
```ts
let lastBuildFailureSummary: string | null = null;
```

`developerContext` (`runStart.ts:827-834`) gana un campo nuevo, opcional, sin tocar
`previousAttemptSummary` — pero `qaRejectionReason` y `buildFailureReason` pasan a ser mutuamente
excluyentes (ronda 2):
```ts
const developerContext =
  attempt === 1
    ? { plan: planningResult.outputArtifact }
    : {
        plan: planningResult.outputArtifact,
        previousAttemptSummary: lastDeveloperResult?.summary,
        ...(lastBuildFailureSummary
          ? { buildFailureReason: lastBuildFailureSummary }
          : lastQaResult
            ? { qaRejectionReason: lastQaResult.summary }
            : {}),
      };
```

Punto de integración — entre `if (developerResult.status !== "completed") { ...; return
developerResult; }` (`runStart.ts:863-866`) y `await updateRunCurrentPhase(runId, "qa")` (línea
869; las líneas citadas en la versión original de esta sección, `857-860`/`862`, quedaron corridas
por cambios de FEATURE-020 — actualizadas acá):

```ts
const buildExecutor = new BuildExecutor();
const buildResult = await buildExecutor.runIfNeeded(executor.options.workingDirectory, 120_000);
if (buildResult.ran) {
  await recordRunEvent(runId, "build_executed", { attempt, buildResult });
}
if (buildResult.ran && buildResult.exitCode !== 0) {
  // ronda 2: el mensaje distingue timeout de un exitCode real — evita que un timeout se lea como
  // si fuera un error de compilación del código (el mecanismo de agotamiento de abajo ya cubre
  // el caso de que persista en los 3 intentos, sin necesitar una categoría de escalamiento nueva).
  lastBuildFailureSummary = buildResult.timedOut
    ? `Build superó el timeout (${120_000}ms) sin terminar.`
    : `Build falló (exitCode ${buildResult.exitCode}): ${buildResult.stderr.slice(0, 2000)}`;
  console.log(`[run:start] Build (intento ${attempt}) falló — Developer recibe el error en el próximo intento.`);

  if (attempt === maxAttempts) {
    const exhausted: PhaseResult = {
      status: "escalated",
      outputArtifact: null,
      summary: `Se agotaron los ${maxAttempts} intentos sin lograr un build exitoso. Último error: ${lastBuildFailureSummary}`,
      escalationReason: `Límite de reintentos (${maxAttempts}) alcanzado — build roto en todos los intentos, QA nunca llegó a validar.`,
    };
    await recordRunEvent(runId, "loop_exhausted", { maxAttempts, reason: "build", lastBuildResult: buildResult });
    console.log(`[run:start] Límite de ${maxAttempts} intentos alcanzado sin build exitoso — run escalado.`);
    return exhausted;
  }

  // No se invoca a QA este intento — continúa al siguiente attempt del mismo for, consumiendo
  // el mismo contador maxAttempts que ya existe (sin inventar uno nuevo).
  continue;
}
lastBuildFailureSummary = null; // se limpia apenas un build corre bien (o es no-op) en este intento
```

**Auditoría**: el artifact que ya se persiste para el turno de Developer (`runStart.ts:854-859`,
`kind: "code"`) sigue registrándose *antes* de este paso, con el status real que Developer
reportó (`"completed"`) — un build roto después no lo invalida retroactivamente. Quien audite un
run necesita cruzar ese artifact con el evento `build_executed` (`exitCode`) para entender por qué
hubo un intento siguiente aunque Developer haya declarado éxito — es intencional (Developer sí
completó su turno; fue el paso de infraestructura posterior el que falló), no un hueco de
integridad de datos, pero vale la pena dejarlo explícito acá para que no se lea como inconsistencia
al revisar logs.

### 6.3 `parseTestCommand` — rechazo explícito de comandos compuestos

```ts
export function parseTestCommand(comandoTest: string): { executable: string; args: string[] } {
  if (/&&|;|\|/.test(comandoTest)) {
    throw new Error(
      `COMANDO_TEST no puede contener operadores de shell (&&, ;, |): "${comandoTest}". ` +
      `El paso de build ya lo garantiza el Orquestador (FEATURE-021) — declará solo el comando ` +
      `de ejecución de tests.`
    );
  }
  const parts = comandoTest.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`COMANDO_TEST vacío o no parseable: "${comandoTest}"`);
  }
  return { executable: parts[0], args: parts.slice(1) };
}
```

### 6.4 Ajuste de texto en `planning.txt` y `developer.txt`

**`planning.txt`**: agregar instrucción explícita — `COMANDO_TEST` nunca debe incluir un paso de
build, el Orquestador ya lo garantiza. Ejemplo correcto: `"node --test dist/x.test.js"`. Ejemplo
incorrecto (ya no aceptado): `"npm run build && node --test dist/x.test.js"`.

**`developer.txt` (agregado en la ronda 1 de validación técnica — el documento original no lo
contemplaba, y es necesario para que el mecanismo corregido de 6.2 tenga efecto real)**: nueva
regla, mismo patrón que la Regla 3 ya existente sobre `qaRejectionReason` ("Si el contexto incluye
'qaRejectionReason'... leé esa razón con atención y corregí específicamente lo que causó el
rechazo"):
> Si el contexto incluye `buildFailureReason` (un intento anterior compiló con errores antes de
> llegar a QA), leé esa razón con atención y corregí específicamente lo que rompió la compilación
> — no asumas que el problema es el mismo que un `qaRejectionReason` de un intento distinto.

### 6.5 Riesgos técnicos

- Proyectos con paso de build que requiera variables de entorno específicas (ej. flags de
  compilación condicionales) no están cubiertos — `BuildExecutor` corre `npm run build` sin
  environment adicional, mismo criterio restrictivo que ya aplica hoy a `TestExecutor`
  (`environment` allowlist explícita, nunca hereda el entorno del Orquestador). Si esto resulta un
  problema real, es una extensión futura, no bloqueante para el caso general.
- El límite de `--memory 256m`/`--cpus 1` (heredado de `TestExecutor`) no está validado para
  proyectos con builds pesados (ej. bundlers grandes) — vale la pena instrumentar el `timeoutMs`
  real usado en la prueba y ajustar si hace falta, sin sobre-dimensionar de entrada.
- Compatibilidad de `node_modules`: se asume que el `node_modules` que Developer instaló en su
  propio turno es compatible con la imagen `node:22-alpine` de este nuevo contenedor — confirmado
  que `docker/developer.Dockerfile` y `docker/codex-developer.Dockerfile` ya usan la misma imagen
  base, así que no debería haber discrepancia de ABI en módulos nativos.
- **Existencia de `node_modules` (confirmado en la ronda 1 de validación técnica)**: no hay, en
  ningún punto del pipeline, un paso explícito de `npm install`/`npm ci` para el proyecto
  gestionado (verificado en `worktree.ts`, `developer.txt`, `planning.txt` — ninguno lo menciona).
  Su existencia depende hoy de que Developer lo haya instalado por su cuenta vía `command_exec` en
  su propio turno (tiene Bash real en su contenedor, `docker/developer.Dockerfile`, a diferencia de
  QA). No es un riesgo nuevo de esta Feature — es el mismo supuesto implícito del que ya depende
  `TestExecutor` hoy para que `node --test ...` funcione — pero `BuildExecutor` pasa a depender de
  él tan directamente como `TestExecutor`, así que queda documentado explícito acá en vez de
  implícito.

---

## 7. Validation Criteria

| Escenario | Input | Esperado |
|---|---|---|
| Proyecto con build exitoso | `scripts.build` presente, compila sin errores | `BuildExecutor` corre, `exitCode 0`, continúa a QA con `dist/` fresco |
| Proyecto con build roto | `scripts.build` presente, `tsc` falla | No se invoca a QA este intento; Developer recibe el error en el intento siguiente; se consume un `attempt` |
| Proyecto sin paso de build | Sin `scripts.build` en `package.json` | No-op limpio — cero eventos `build_executed`, comportamiento idéntico a hoy |
| `COMANDO_TEST` con `&&` (regresión) | Planning declara `"npm run build && node --test x"` | `parseTestCommand` rechaza con error explícito, antes de intentar ejecutar nada |
| Reproducción del bug original | Mismo caso real de la prueba (`teamOptimizationMenu`) | El build corre una sola vez entre Developer y QA; QA nunca ve `EROFS` |
| Regresión de FEATURE-006 | Cualquier `COMANDO_TEST` normal, sin build | Sigue ejecutándose con `shell: false`, sin cambios de seguridad |
| Build roto en todos los intentos (agregado en la ronda 1, Hallazgo 2) | `scripts.build` presente, `tsc` falla en los `maxAttempts` intentos | Se escala a humano explícitamente en el último intento (`loop_exhausted`, `reason: "build"`) — el loop nunca termina sin haber invocado a QA y sin devolver un `PhaseResult` válido |
| `buildFailureReason` llega a Developer (agregado en la ronda 1, Hallazgo 1) | Build falla en el intento 1 | El contexto del intento 2 incluye `buildFailureReason` con el error real (no el `summary` original de Developer ni un `qaRejectionReason` ajeno) |
| Mutua exclusión de motivos (agregado en la ronda 2) | Intento 1: QA rechaza. Intento 2: Developer corrige pero rompe el build | El contexto del intento 3 incluye `buildFailureReason` del intento 2 — nunca junto con el `qaRejectionReason` viejo del intento 1 |
| `package.json` corrupto (agregado en la ronda 2) | `package.json` presente pero no es JSON válido | Se trata como build fallido (Regla 8) — Developer recibe el error en el intento siguiente, consume un `attempt`, nunca se lee como "sin build" |
| Timeout de build distinguido (agregado en la ronda 2) | Build supera el `timeoutMs` sin terminar | `buildFailureReason` menciona explícitamente el timeout, distinto de un `exitCode` de compilación real — mismo mecanismo de agotamiento si persiste en los 3 intentos |
| `package.json` ausente (agregado en la ronda 3) | No existe `package.json` en el worktree (`ENOENT` al leerlo) | No-op limpio — mismo resultado que "sin `scripts.build`", cero eventos `build_executed` |
| Error de lectura distinto de `ENOENT` (agregado en la ronda 3, corrige inconsistencia con la Regla 8) | `readFile` de `package.json` falla por permisos/I/O (no `ENOENT`) | `checkBuildScript` relanza el error — llega al manejo genérico de infraestructura de `executePipelineRun` (`run_error`), nunca se lee como "no hay build" |

### Validation Evidence

- Prueba real end-to-end en la VPS, reproduciendo el caso exacto que falló (Feature con paso de
  compilación) — confirmar que el ciclo Developer→build→QA corre limpio.
- Prueba con un proyecto sin paso de build, para confirmar el no-op.
- Prueba forzando un build roto, para confirmar que Developer recibe el contexto correcto sin que
  QA sea invocado.

---

## 8. Risks

- Es la primera vez que el Orquestador ejecuta código del proyecto gestionado con permiso de
  escritura fuera del propio turno de Developer — aunque el perfil de seguridad es el mismo que
  `TestExecutor` salvo el montaje, vale la pena una revisión de seguridad explícita antes de dar
  el Go, dado que es una superficie nueva de escritura no controlada por ningún agente.
- Sin caso de negocio real todavía probado con un build roto de verdad (solo el caso real que ya
  falló, que era un problema de invocación, no de código roto) — la validación real del camino
  "build falla, Developer corrige" queda pendiente de una prueba explícita.

---

## 9. Approval Gate

Implementación prohibida hasta aprobación humana explícita de este documento.

---

## Estado de la implementación

Pendiente — 3 rondas de validación técnica realizadas (Go condicionado en las 2 primeras). Confirmado
contra `main` que no hubo cambios posteriores a FEATURE-020 que afecten
`runDeveloperQaLoop`/`TestExecutor`/`qaPolicy.ts`/`qaRuntime.ts`, y que no existe ningún otro punto
del pipeline con un build implícito.

Ronda 1: 2 hallazgos bloqueantes en el snippet de integración original (6.2) — el mecanismo de
`buildFailureReason` no llegaba realmente a Developer, y no había ruta de agotamiento si el build
fallaba en todos los intentos (podía devolver `null` en vez de un `PhaseResult`) — corregidos con
la propuesta concreta de código y el ajuste correspondiente a `developer.txt`.

Ronda 2 (revisión del Architect, vía ChatGPT, sobre la corrección de la ronda 1): 3 hallazgos
adicionales, todos incorporados — (a) `qaRejectionReason` y `buildFailureReason` no eran
mutuamente excluyentes, contexto viejo podía colarse junto a un fallo de build más reciente; (b)
un `package.json` corrupto se trataba igual que uno ausente, arriesgando que QA valide un `dist/`
viejo en silencio — ahora se modela como build fallido (Regla 8), nunca como no-op; (c) el mensaje
de fallo ahora distingue timeout de un `exitCode` de compilación real. Se evaluó y se decidió NO
incorporar 2 propuestas de esa ronda: una unión discriminada para `BuildExecutionResult` (se
mantiene la interfaz plana, consistente con `TestExecutionResult`) y un camino de escalamiento
nuevo para errores de `spawn`/Docker (se deja que se propague igual que ya hace `TestExecutor.run()`
hoy, sin mecanismo adicional) — con la justificación de cada decisión documentada en 6.1/6.2 y
Functional Rules.

Ronda 3 (mismo origen que la ronda 2): `checkBuildScript` trataba **cualquier** error de
`readFile` (no solo "el archivo no existe") como `"missing"` — permisos, I/O, path inaccesible,
etc. quedaban leídos como no-op, contradiciendo la Regla 8 (un error real de infraestructura debe
propagarse, no leerse como "no hay build"). Corregido: solo `ENOENT` devuelve `"missing"`;
cualquier otro error se relanza y llega al manejo genérico de infraestructura existente
(`executePipelineRun`, `run_error`), sin agregar ningún mecanismo nuevo. No es una decisión nueva —
es la Regla 8 ya acordada, aplicada correctamente al código que no la seguía del todo.

**Go técnico** de mi parte tras esta ronda — no encontré más inconsistencias entre las Reglas
Funcionales y los snippets de 6.1/6.2.

Nota de proceso: Discovery y el Architect no tienen acceso directo al repo en este momento — las
rondas 1 y 3 las hizo Claude Code cumpliendo ese rol temporalmente, y la ronda 2 la revisó el
Architect por fuera del repo (vía ChatGPT), validada por Claude Code contra el código real de
`main` antes de incorporarla acá. Pendiente de que Discovery/Architect (o el owner) revisen esta
versión directamente cuando puedan volver a acceder, antes del Approval Gate.