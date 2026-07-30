# FEATURE-032 — Instalación determinística de dependencias antes del build

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: diseño original de ARIA (AI Product Architect), revisado y validado
> técnicamente contra el código real antes de aprobar la implementación. Se amplió el alcance
> aprobado para incluir timeouts configurables en los tres componentes del loop (ver sección 7).

---

## 1. Feature Identity

- **Name**: Instalación determinística de dependencias antes del build
- **Type**: Pipeline Reliability / Testing Infrastructure
- **Owner**: asdru
- **Status**: ✅ Ejecutada — validada con suite automatizada y prueba E2E real en VPS (2026-07-30)
- **Priority**: P2
- **Related Features**: FEATURE-021 (build determinístico), FEATURE-029 (contrato COMANDO_TEST)

---

## 2. Problem Statement

El pipeline garantiza build y tests deterministas (FEATURE-021, FEATURE-029), pero no existía
ningún paso estructural que garantizara que las dependencias npm del proyecto estuvieran
instaladas antes de `BuildExecutor`. `BuildExecutor` corre `npm run build` en un contenedor
`--network none`, asumiendo que `node_modules/.bin` ya existe.

Este supuesto produjo un fallo real durante la validación E2E de FEATURE-029: `tsc: not found`,
porque nadie había instalado la dependencia `typescript` declarada en `devDependencies`. Developer
puede instalar dependencias en su propio turno, pero esa acción no está garantizada — depende de
que el agente lo recuerde, puede verse afectada por una caché npm o `$HOME` no escribibles
(confirmado: el contenedor de Developer es `--read-only` con solo `/tmp` como `tmpfs`, sin
`NPM_CONFIG_CACHE` configurado), y mezcla infraestructura con implementación funcional.

---

## 3. Functional Goal

Flujo resultante:

```text
Developer → DependencyInstaller → BuildExecutor → TestCommandContract → TestExecutor → QA
```

La instalación corre después de cada turno normal de Developer (incluido el primero) y antes de
cada build. Si falla, no se ejecutan build, contrato de test, tests, ni QA; Developer recibe el
motivo en el siguiente intento; se consume el mismo contador de intentos; el run escala mediante el
mecanismo existente al agotarlos.

---

## 4. Scope

### Included

- Componente `DependencyInstaller` (`src/testing/dependencyInstaller.ts`), análogo estructural a
  `BuildExecutor`.
- Regla de selección: sin `package.json` → no-op; `package.json` inválido → fallo; sin
  dependencias instalables (`dependencies`/`devDependencies`/`optionalDependencies`) → no-op; con
  `package-lock.json` → `npm ci`; sin lockfile → `npm install`.
- Instalación en cada turno normal de Developer (incluido el primero), nunca durante el turno
  post-QA de readiness.
- Mismo worktree que build y tests; contenedor propio con red (a diferencia de
  `BuildExecutor`/`TestExecutor`) y caché npm escribible explícita (`NPM_CONFIG_CACHE`).
- `dependencyInstallationFailureReason`, mutuamente excluyente con `buildFailureReason`,
  `testCommandFailureReason`, `qaRejectionReason`.
- Reutilización íntegra del contador de intentos, agotamiento y escalamiento existentes.
- **Ampliación aprobada**: timeouts configurables vía variable de entorno para los tres pasos del
  loop — `BUILD_TIMEOUT_MS`, `TEST_TIMEOUT_MS` (existían hardcodeados) y
  `DEPENDENCY_INSTALL_TIMEOUT_MS` (nuevo), mismo patrón que los timeouts de fase
  (`ARCHITECT_TIMEOUT_MS`, etc.), sin cambiar los valores por defecto.

### Excluded

pnpm, Yarn, Bun, detección general de package managers, monorepos/workspaces complejos, caché
distribuida o compartida entre runs, hashing de manifest/lockfile para invalidación, modo offline,
registries privados, secrets, instalación global, `npm audit`, actualización automática de
dependencias o lockfiles, `--ignore-scripts`, sistema genérico de jobs/executors.

---

## 5. Functional Rules

Ver diseño completo (28 reglas) en el historial de la sesión de diseño — resumen de las
determinantes:

1. La instalación es responsabilidad del Orquestador, nunca de una acción discrecional de
   Developer.
2. Corre entre Developer y `BuildExecutor`, en cada turno normal (incluido el primero), nunca
   durante `readinessRequest: true`.
3. `package.json` ausente → no-op; inválido → fallo atribuible al proyecto (nunca "sin
   dependencias"); sin dependencias instalables → no-op.
4. Con lockfile → `npm ci` literal; sin lockfile → `npm install` literal. Nunca se sustituye
   automáticamente uno por otro ante una inconsistencia.
5. `npm install` puede generar/modificar `package-lock.json` — el Orquestador no oculta ni
   revierte esa modificación.
6. Mismo worktree que build/tests; nunca se asume que `node_modules` de un run anterior está
   disponible (cada run/run hijo crea worktree nuevo).
7. Red solo durante la instalación; `BuildExecutor`/`TestExecutor` conservan su política actual.
8. Caché npm escribible explícita (`NPM_CONFIG_CACHE`), independiente de `$HOME`.
9. Comando fijo (`npm ci`/`npm install`), nunca proveniente de Planning/Developer/caso de
   negocio/`COMANDO_TEST`. `shell: false` siempre.
10. Fallo de instalación consume un intento del loop; Developer recibe el motivo; nunca se le
    sugiere tocar `COMANDO_TEST`. QA nunca se invoca ante este fallo.
11. Exclusión mutua estricta entre los cuatro motivos del loop — orden cronológico:
    `dependencyInstallationFailureReason` → `buildFailureReason` → `testCommandFailureReason` →
    `qaRejectionReason`.

---

## 6. Estrategia Algorítmica

**Decisión** (en este orden): `package.json` no existe → `no-op`. No es JSON válido →
`invalid-package-json`. No declara `dependencies`/`devDependencies`/`optionalDependencies` no
vacías → `no-op`. Existe `package-lock.json` → `npm-ci`. Si no → `npm-install`.

**Salida estructurada**:
```ts
interface DependencyInstallResult {
  ran: boolean;
  command: "npm ci" | "npm install" | null;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
```

Sin reglas de desempate ni optimización basada en hashes — mismo criterio de simplicidad ya
aplicado en FEATURE-029/FEATURE-021.

---

## 7. Technical Considerations

`src/testing/dependencyInstaller.ts`, clase `DependencyInstaller` con
`installIfNeeded(workingDirectory, timeoutMs)`, análoga a `BuildExecutor.runIfNeeded`. Perfil
Docker: `--rm --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs
/tmp:rw,nosuid,size=512m --user node --pids-limit 256 --memory 512m --cpus 2`, más
`-e NPM_CONFIG_CACHE=/tmp/npm-cache` y `-v <worktree>:/workspace:rw` — sin `--network none` (única
diferencia real de aislamiento respecto de `BuildExecutor`/`TestExecutor`, necesaria para acceder
al registry).

Integrado en `runDeveloperQaLoop` entre `haltIfCancelledExternally` y `buildExecutor.runIfNeeded`.
Nueva variable `lastDependencyInstallFailureSummary`, mismo patrón que
`lastBuildFailureSummary`/`lastTestCommandFailureSummary`. Servicio inyectable
`dependencyInstaller` agregado al DI de `runDeveloperQaLoop` para tests.

### Ampliación de alcance acordada antes de implementar

Se extendieron los timeouts hardcodeados de `BuildExecutor` (`120_000`) y `TestExecutor`
(`60_000`) a variables de entorno configurables (`BUILD_TIMEOUT_MS`, `TEST_TIMEOUT_MS`), mismo
patrón que `ARCHITECT_TIMEOUT_MS`/`DEVELOPER_TIMEOUT_MS`/etc. vía `parsePositiveIntEnv`, sin
cambiar los valores por defecto (regresión cero). `DEPENDENCY_INSTALL_TIMEOUT_MS` nuevo, default
`180_000` (mayor que build/test porque depende de red real). El mensaje de log de timeout de build
se corrigió para reflejar el valor configurado en vez de un literal.

`developer.txt` — nueva Regla 7: el Orquestador garantiza la instalación, Developer no debe
correr `npm install`/`npm ci` como paso rutinario; ante `dependencyInstallationFailureReason`,
corrige el estado del proyecto (dependencias, versiones, `package.json`/lockfile), nunca
`COMANDO_TEST`.

---

## 8. Validation Criteria

20 escenarios según el diseño original (no-op sin `package.json`/sin dependencias, `npm ci` con
lockfile, `npm install` sin lockfile, `package.json` inválido, lockfile inconsistente, dependencia
de build ausente inicialmente — el caso real de FEATURE-029 —, fallo de instalación, timeout,
caché escribible, primer intento, reintento con/sin cambio de dependencias, exclusión mutua,
agotamiento, regresiones de FEATURE-021/FEATURE-029, `shell: false`, aislamiento de red).

### Validation Evidence

- 5 tests unitarios de `dependencyInstaller.ts` contra filesystem real (no-op sin `package.json`,
  no-op sin dependencias instalables, no-op con solo `peerDependencies`, fallo con `package.json`
  inválido, propagación de errores distintos de `ENOENT`).
- 1 test de integración en `runStart.test.ts`: agota 3 intentos cuando la instalación falla, sin
  invocar `BuildExecutor` ni QA.
- Suite completa: 196 tests, 186 pass, 10 skip (específicos de plataforma en Windows), 0 fail.

**Validación E2E real en VPS (2026-07-30, proyecto `pruebas-ia`, rama
`pruebas-ai-orchestratror-feature-029`, mismo caso de negocio reutilizado de FEATURE-029)**:

1. Primer intento: Developer escribió un `package.json` con BOM inválido (patrón ya observado
   antes en la validación de FEATURE-029). El evento `dependency_install_executed` registró el
   fallo de instalación (JSON inválido, Regla 7 del diseño) y el loop lo atribuyó correctamente
   como `dependencyInstallationFailureReason` — ni `BuildExecutor` ni QA se invocaron.
2. Segundo intento: Developer corrigió el `package.json`. La instalación real de `typescript` vía
   `npm ci` corrió con éxito con red real (`node_modules/.bin/tsc` quedó disponible), pero el build
   con `tsc` real falló por un error de tipos genuino y distinto (`TS2307`, módulo no encontrado) —
   atribuido correctamente como `buildFailureReason`, no como fallo de instalación, confirmando en
   un run real la exclusión mutua estricta entre ambos motivos (Regla 11 del diseño).
3. Tercer intento: Developer corrigió el problema de tipos; instalación, build, contrato de
   `COMANDO_TEST` (FEATURE-029) y tests corrieron limpios, QA aprobó, y el run llegó al
   escalamiento de merge.

Evidencia real y específica — con Docker y red reales, no simulados — de los tres componentes de
la Feature (no-op/instalación real, atribución de fallo, exclusión mutua con `buildFailureReason`)
actuando correctamente en secuencia sobre un run genuino.

---

## 9. Risks

Ver diseño original (12 riesgos) — los más relevantes: tiempo de ejecución adicional en cada
intento (aceptado por simplicidad sobre optimización prematura), acceso de red durante instalación
(mitigado con perfil de contenedor reducido, sin red después), generación de `package-lock.json`
por `npm install` (documentado, no oculto), dependencias nativas que requieran toolchains ausentes
en `node:22-alpine` (fuera de alcance, falla visible), diferencia entre mocks y runtime real (la
aprobación técnica requiere evidencia real en VPS, no solo tests unitarios).

---

## 10. Approval Gate

Aprobado por el owner, incluyendo la ampliación de timeouts configurables. Validado real en VPS
(Docker con red real) — ver sección 8. Mergeada a `main`.

---

## Estado de la implementación

**✅ Ejecutada.** Implementada en rama `feature/032-dependency-installer`, validada con suite
automatizada (`tsc --noEmit` limpio, 196 tests) y con una prueba E2E real en VPS que ejercitó tanto
el camino de fallo de instalación como el camino exitoso con un fallo de build genuino y distinto,
confirmando la exclusión mutua entre motivos en un run real. Mergeada a `main`.
