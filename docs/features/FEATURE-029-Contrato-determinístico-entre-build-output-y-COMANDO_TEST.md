# FEATURE-029 — Contrato determinístico entre build output y `COMANDO_TEST`

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: diseño original de ARIA (AI Product Architect), revisado y validado
> técnicamente contra el código real antes de aprobar la implementación. Una corrección se aplicó
> al diseño original antes de implementar — ver sección 7, "Corrección aplicada".

---

## 1. Feature Identity

- **Name**: Contrato determinístico entre build output y `COMANDO_TEST`
- **Type**: Backend — validación previa a la ejecución de tests
- **Owner**: asdru
- **Status**: ✅ Implementada e integrada en `main`
- **Priority**: P1

---

## 2. Problem Statement

FEATURE-021 garantiza que, entre Developer y QA, el Orquestador ejecute de forma obligatoria el
build definido por el proyecto, y que `COMANDO_TEST` contenga únicamente el comando de ejecución
de tests, sin pasos de build ni operadores de shell.

Sin embargo, no existía una garantía de que las rutas declaradas en `COMANDO_TEST` correspondan al
resultado realmente disponible después del build. Por ejemplo, Planning podría declarar
`node --test src/example.test.ts` aunque el proyecto compile TypeScript hacia
`dist/example.test.js`. En ese caso el build puede terminar correctamente, el código compilado
puede existir, pero `COMANDO_TEST` sigue apuntando a una ruta fuente no ejecutable en el runtime
disponible — el fallo aparece recién durante la ejecución de tests, indistinguible de un rechazo
real de QA.

El Orquestador necesita detectar esta inconsistencia antes de ejecutar `TestExecutor`, sin intentar
deducir automáticamente cómo compila cualquier proyecto ni introducir soporte genérico para todos
los runtimes.

---

## 3. Functional Goal

1. Un `COMANDO_TEST` directo que declare rutas concretas solo puede ejecutarse si esas rutas
   existen después del build.
2. Un comando que apunte a una ruta inexistente se rechaza antes de invocar `TestExecutor` y QA.
3. El error se atribuye a una inconsistencia del plan o de la implementación y se devuelve a
   Developer dentro del loop existente.
4. Los comandos basados en scripts de `package.json` (`npm test`/`npm run <script>`) siguen siendo
   válidos sin que el Orquestador intente interpretar su contenido.
5. FEATURE-021 sigue siendo responsable del build y de sus fallos; FEATURE-029 no modifica ese
   comportamiento.

---

## 4. Scope

### Included

1. Dos formas soportadas de `COMANDO_TEST`: script de `package.json`, y `node --test` con rutas
   explícitas.
2. Validar, después de un build exitoso (o no-op) y antes de ejecutar tests, las rutas explícitas
   de un comando `node --test`.
3. Rechazar una ruta explícita cuando no existe dentro del worktree, apunta fuera de él, o apunta a
   un directorio en vez de a un archivo.
4. Tratar el fallo de prevalidación mediante el loop Developer↔QA existente: QA no se invoca ese
   intento, Developer recibe el motivo, se consume el mismo contador de intentos.
5. Actualizar `planning.txt`/`developer.txt` con la instrucción correspondiente.
6. Pruebas de regresión para ambas formas soportadas.

### Excluded

- Descubrir automáticamente el directorio de salida de TypeScript.
- Interpretar `tsconfig.json`, bundlers o herramientas equivalentes.
- Transformar automáticamente rutas `src/*.ts` en rutas `dist/*.js`.
- Globbing propio del shell, o un parser completo de comandos.
- Ejecutar comandos mediante un shell real.
- Validar el contenido interno de scripts de `package.json`.
- Soporte para otros ecosistemas (Python, Java, .NET) o runtimes TypeScript explícitos (`tsx`,
  `ts-node`).
- Cambiar cómo se instala `node_modules` (FEATURE-032) ni el comportamiento básico de
  `BuildExecutor`.

---

## 5. Functional Rules

1. **Valores permitidos para la forma del comando**: script de `package.json` (`npm test`,
   `npm run <script>`), o `node --test` con rutas explícitas. Cualquier otra forma conserva el
   comportamiento previo a esta Feature (no se bloquea).
2. **Validación posterior al build**: corre después de que Developer complete su turno y
   `BuildExecutor` termine (exitoso o no-op), y antes de invocar `TestExecutor`/QA. Observa el
   mismo worktree que usará `TestExecutor`.
3. **Rutas explícitas**: deben ser relativas al worktree, resolver dentro de él, existir después
   del build, y representar un archivo (no un directorio). Una ruta terminada en `.ts` no se
   rechaza solo por su extensión — la regla determinante es si el archivo existe y es ejecutable
   por la forma declarada; la ejecución real sigue siendo la validación final de compatibilidad de
   runtime.
4. **Ruta inexistente**: `TestExecutor` no se ejecuta, QA no se invoca, Developer recibe el
   `COMANDO_TEST`, la ruta inexistente, y la indicación de alinear el *output* generado por el
   proyecto — nunca se le sugiere tocar `COMANDO_TEST`.
5. **Scripts de `package.json`**: el script solicitado debe existir en `package.json`; el
   Orquestador no analiza su contenido, ni globbing ni flags internos — npm resuelve el script.
6. **Seguridad de rutas**: una ruta explícita no puede resolver fuera del worktree (rutas
   relativas con `..`, ni rutas absolutas).
7. **Operadores de shell**: sigue vigente la regla de FEATURE-021 — `COMANDO_TEST` no puede
   contener `&&`, `;`, `|`.
8. **Responsabilidad del fallo**: un fallo de contrato detectado antes de QA es corregible por
   Developer — no se crea una categoría nueva de escalamiento. Al agotar intentos, se usa el
   mecanismo de agotamiento ya existente.
9. **Prioridad de validación**: parsear/validar la forma básica → ejecutar/no-op de build →
   verificar script o rutas explícitas → ejecutar `TestExecutor` → entregar a QA.

---

## 6. Estrategia Algorítmica

**Objetivo**: detectar, antes de ejecutar tests, inconsistencias simples y verificables entre
`COMANDO_TEST` y el contenido disponible en el worktree después del build.

**Entradas**: `COMANDO_TEST` parseado (`executable`/`args`), ruta del worktree.

**Salida**: `{ valid: true } | { valid: false; reason: string }`.

**Restricciones obligatorias**: no ejecutar un shell; no interpretar contenido de scripts npm; no
inferir ni transformar rutas; no acceder fuera del worktree; no invocar QA cuando la prevalidación
falla; reutilizar el contador y el contexto de retry existentes.

**Comportamiento**: para `npm test`/`npm run <script>`, verificar que el script exista en
`package.json`. Para `node --test <rutas>`, tomar los argumentos que no empiecen con `-` como
candidatos de ruta (los que empiezan con `-` son flags de Node, no rutas) y verificar existencia +
confinamiento de cada uno. Formas no reconocidas no se bloquean en esta primera versión.

**Sin reglas de desempate**: no se elige la ruta "más parecida"; un mismatch siempre falla.

---

## 7. Technical Considerations

Nuevo módulo dedicado `src/testing/testCommandContract.ts` (no se amplía `TestExecutor` ni
`BuildExecutor` — misma responsabilidad única por componente que ya sigue el resto del pipeline),
con `validateTestCommandContract(parsed, workingDirectory)` como entrada única.

Integrado en `runDeveloperQaLoop` (`src/cli/commands/runStart.ts`), entre el chequeo de build y la
invocación de QA. Nuevo campo de contexto `testCommandFailureReason`, mutuamente excluyente con
`buildFailureReason` y `qaRejectionReason` (mismo patrón de exclusión ya usado entre esos dos).

### Corrección aplicada antes de implementar

El diseño original de ARIA redactaba el mensaje de error como *"Alinea el comando de test o el
output generado por el proyecto"* — ambiguo, porque sugiere que Developer podría tocar
`COMANDO_TEST`. La Regla 4 de `developer.txt` ya prohíbe explícitamente que Developer modifique
`COMANDO_TEST` o la ruta del archivo de test (es propiedad exclusiva de Planning, Regla 10 de
`03-AI-CONSTITUTION.md`). Se corrigió el mensaje y la instrucción de `developer.txt` para que
apunten exclusivamente a alinear el *output* que Developer genera, nunca el comando.

### Decisiones de implementación (no especificadas en el diseño original)

- Campo `testCommandFailureReason` como propio, separado (no reusa `buildFailureReason`).
- Módulo nuevo `src/testing/testCommandContract.ts`, en vez de ampliar `testExecutor.ts`.
- Heurística de flags: cualquier argumento de `node --test` que empiece con `-` se trata como
  flag, no como ruta candidata.

---

## 8. Validation Criteria

Igual a la matriz de escenarios propuesta por ARIA: ruta compilada válida/inexistente, comando
apuntando a fuente incorrecta, script npm válido/nombrado válido/inexistente, ruta fuera del
worktree, ruta absoluta externa, proyecto sin build, build fallido, operador de shell, comando no
reconocido, agotamiento tras 3 intentos.

### Validation Evidence

- 12 tests unitarios de `testCommandContract.ts` contra filesystem real (sin mocks), cubriendo
  las dos formas soportadas y sus rechazos.
- 1 test de integración en `runStart.test.ts` verificando que el loop agota 3 intentos sin invocar
  QA cuando `validateTestCommandContract` rechaza, y que el artifact de escalamiento queda
  atribuido a `phase: "developer"`.
- Suite completa del repo: 190 tests, 181 pass, 9 skip (específicos de plataforma en Windows), 0
  fail — corrida antes y después del merge a `main`.

---

## 9. Risks

- **Falsa sensación de validación completa**: comprobar que un archivo existe no garantiza que sea
  ejecutable ni el archivo correcto — la ejecución real y QA siguen validando el comportamiento.
- **Parsing incompleto de `node --test`**: Node admite múltiples flags; se soportan solo los casos
  concretos usados hoy, casos complejos deben encapsularse en un script npm.
- **Duplicación del manejo de retries**: mitigado reusando el mismo flujo de retry/agotamiento sin
  contador nuevo.

**Riesgo confirmado durante la validación E2E (no anticipado en el diseño original)**: forzar este
escenario específico en un E2E real depende de que un agente con permisos de escritura totales
(Developer) tome una decisión imperfecta muy puntual. En dos intentos reales (2026-07-30, proyecto
`pruebas-ia`), Developer tomó decisiones razonables que evitaron el escenario en ambos casos — ver
"Estado de la implementación" abajo. La Feature queda validada por los tests automatizados
(deterministas), no por evidencia E2E real.

---

## 10. Approval Gate

Aprobada por el owner, con la corrección de la sección 7 aplicada antes de implementar.

---

## Estado de la implementación

**Implementada** (rama `feature/029-test-command-contract`, mergeada a `main` en `67ec9cd`;
commits principales `c762c37` implementación, `bcee447` cierre de Roadmap, `67ec9cd` merge).
`tsc --noEmit` y la suite completa (190 tests) verificados antes y después del merge.

**Intentos de validación E2E real (2026-07-30, proyecto `pruebas-ia`) — no reproducidos**:

1. Proyecto con `scripts.build` no-op (`mkdir -p dist`) y caso de negocio describiendo un proyecto
   TypeScript. Sin evidencia real de TypeScript en el repo (sin `tsconfig.json` ni dependencia
   `typescript`), Developer escribió el archivo de test directamente en `.mjs` ejecutable —
   decisión razonable que evitó por completo el circuito `dist/`.
2. Se agregó `tsconfig.json` y la dependencia `typescript` real. Planning y Developer sí siguieron
   la ruta `dist/`, pero Developer reemplazó el `scripts.build` no-op por un `tsc` real — y como el
   contenedor de build corre con `--network none` sin que nadie instale `node_modules` (gap de
   FEATURE-032), el build falló con `tsc: not found` antes de llegar a la prevalidación de esta
   Feature. El loop se agotó por el mecanismo de fallo de build ya existente (FEATURE-021), sin
   invocar nunca a QA.

Ver `docs/ROADMAP.md` (entrada FEATURE-029) para el detalle equivalente y su relación con
FEATURE-032.
