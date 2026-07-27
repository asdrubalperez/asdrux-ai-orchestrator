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
   de Developer (mismo lugar que hoy ocupa `qaRejectionReason`).
5. El comando que corre el paso de build es siempre, literalmente, `npm run build` — nunca el
   contenido textual del script tal como aparece en `package.json` (evita reintroducir cualquier
   forma de interpretación de string).
6. `COMANDO_TEST`, a partir de esta Feature, nunca debería necesitar `&&` — si Planning lo declara
   igual con un operador de shell, `parseTestCommand` lo rechaza explícito antes de ejecutar nada.
7. El nuevo contenedor de build mantiene el mismo perfil de seguridad que `TestExecutor`
   (`--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--user node`, límites
   de `--pids-limit`/`--memory`/`--cpus`) — la única diferencia deliberada es el montaje de
   filesystem (`:rw` en vez de `:ro`, sin `--read-only`).

---

## 6. Technical Considerations

### 6.1 Nuevo componente `BuildExecutor`

Análogo estructural a `TestExecutor` (`src/testing/testExecutor.ts`), mismo perfil Docker con un
solo cambio deliberado:

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
    const hasBuildScript = await this.hasBuildScript(workingDirectory);
    if (!hasBuildScript) {
      return { ran: false, exitCode: null, stdout: "", stderr: "", timedOut: false };
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
    // spawn(..., { shell: false }) — mismo criterio que TestExecutor, sin excepción.
    // ... ejecutar, capturar stdout/stderr/exitCode/timedOut, return { ran: true, ... }
  }

  private async hasBuildScript(workingDirectory: string): Promise<boolean> {
    // leer ${workingDirectory}/package.json, parsear JSON, chequear
    // typeof pkg.scripts?.build === "string" && pkg.scripts.build.trim().length > 0
  }
}
```

Nota deliberada: **no** se usa `--read-only` (a diferencia de `TestExecutor`) — es la única
diferencia real de perfil de seguridad, exactamente la que hace falta para poder escribir `dist/`.

### 6.2 Integración en `runDeveloperQaLoop`

Entre `if (developerResult.status !== "completed") { ...; return developerResult; }`
(`runStart.ts:857-860`) y `await updateRunCurrentPhase(runId, "qa")` (línea 862):

```ts
const buildExecutor = new BuildExecutor();
const buildResult = await buildExecutor.runIfNeeded(executor.options.workingDirectory, 120_000);
if (buildResult.ran) {
  await recordRunEvent(runId, "build_executed", { attempt, buildResult });
}
if (buildResult.ran && buildResult.exitCode !== 0) {
  lastDeveloperResult = {
    status: "rejected",
    outputArtifact: developerResult.outputArtifact,
    summary: developerResult.summary,
    // se reusa el mismo canal que hoy ocupa qaRejectionReason en el intento siguiente
    escalationReason: `Build falló (exitCode ${buildResult.exitCode}): ${buildResult.stderr}`,
  };
  // no se invoca a QA este intento — continúa al siguiente attempt del mismo for,
  // igual que hoy hace un rechazo de QA (sin consumir un attempt extra fuera del loop existente)
  continue;
}
```

El `attempt` de este ciclo se consume igual (mismo `for` de `runStart.ts:822`, `maxAttempts` sin
cambios) — no se inventa un contador nuevo.

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

### 6.4 Ajuste de texto en `planning.txt`

Agregar instrucción explícita: `COMANDO_TEST` nunca debe incluir un paso de build — el Orquestador
ya lo garantiza. Ejemplo correcto: `"node --test dist/x.test.js"`. Ejemplo incorrecto (ya no
aceptado): `"npm run build && node --test dist/x.test.js"`.

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

Pendiente — documento recién redactado, aún no enviado a validación técnica (Codex/Claude Code).