# Análisis de arquitectura — Modo de autenticación por cuenta personal (CLI) para Executors

Versión: v1.0
Fecha: 2026-07-22
Tipo: Análisis e investigación — **sin implementación**. Este documento es un insumo para
decidir, no una Feature. Sigue la misma convención que `docs/research/H14-command-confinement.md`.

---

## Resumen ejecutivo

1. **La premisa de partida del handoff necesita un ajuste real**: el sistema **ya usa CLIs
   oficiales** para invocar los modelos — `ClaudeCodeExecutor` invoca `claude` (Claude Code CLI)
   y `CodexExecutor` invoca `codex` (Codex CLI), ambos como subprocesos (`spawn`/`execFileSync`),
   no llamadas HTTP directas a una API REST. Lo que hoy varía **no es la herramienta invocada**
   (ya es la CLI oficial en los dos casos), sino **el mecanismo de autenticación de esa CLI**:
   hoy, en ambos Executors, es exclusivamente vía variable de entorno (`ANTHROPIC_API_KEY` /
   `CODEX_API_KEY`). El pedido real, entonces, no es "agregar modo CLI" — ya existe — es "agregar
   un segundo modo de autenticación (OAuth de cuenta personal) a los Executors que ya invocan la
   CLI".
2. **Esto ya se investigó parcialmente y hay una decisión previa documentada que hay que
   respetar o revisar explícitamente, no ignorar**: `docs/features/FEATURE-001-spike-results.md`,
   hallazgo H4, ya probó autenticación OAuth (`claude auth login`, cuenta personal) contra la
   misma API key, y confirmó que el comportamiento de permisos (bloqueo de escritura en
   read-only) es **idéntico** entre ambos modos. La razón por la que se eligió API key no fue
   capacidad — fue que el spike necesitaba **cero pasos interactivos** para uso headless de
   producción, y en ese momento no se validó si un login OAuth ya hecho persiste de forma
   reusable, sin reintervención humana, a través de **múltiples invocaciones headless
   posteriores** — esa es la pregunta empírica real que este nuevo enfoque necesita responder
   antes de aprobarse, no una pregunta de diseño abstracto.
3. **Recomendación de forma, no de fondo**: no crear un Executor nuevo por proveedor
   (`ClaudeApiExecutor` / `ClaudeCliExecutor`) — ya no aplica, porque no existe hoy ningún
   "Executor de API pura" del cual separarse. La forma que respeta más el Principio de Cambio
   Mínimo (`03-AI-CONSTITUTION.md`, Regla 3) es un **parámetro de modo de autenticación** en las
   opciones ya existentes de cada Executor (`ClaudeCodeExecutorOptions`, `CodexExecutorOptions`),
   no una jerarquía de clases nueva.
4. **Riesgo nuevo, no cubierto por el spike original, y más serio en `Developer`**: una cuenta
   personal (OAuth) tiene un radio de exposición mayor que una API key si se filtra desde dentro
   de un contenedor que ejecuta código generado (`Developer`, con Bash real) — una API key se
   rota/revoca centralmente sin tocar la cuenta del usuario; una sesión OAuth de cuenta personal
   comprometida puede exponer facturación, otros permisos de esa cuenta, y no es trivialmente
   revocable sin afectar al usuario en otros contextos. Esto no bloquea la propuesta, pero cambia
   el cálculo de riesgo específicamente para la fase que corre en contenedor con acceso a shell.

---

## 1. Impacto arquitectónico

**¿Nuevo tipo de Executor, u otra implementación del mismo?** — Ninguna de las dos tal como las
plantea el handoff. La unidad de variación correcta no es "Executor" (ya está bien separado por
proveedor: `ClaudeCodeExecutor` vs `CodexExecutor`), es **cómo ese Executor obtiene credenciales
para invocar su CLI**. Verificado en código: `ClaudeCodeExecutorOptions` y
`CodexExecutorOptions` ya reciben `workingDirectory`, `model`, `sandbox` como parámetros de
construcción — el lugar natural para esto es sumar ahí un campo más, no bifurcar la jerarquía de
clases:

```ts
export interface ClaudeCodeExecutorOptions {
  workingDirectory: string;
  model?: string;
  sandbox?: "host" | "container";
  authMode?: "api_key" | "cli_session"; // nuevo — default "api_key", sin cambiar nada existente
}
```

**Responsabilidades que cambian**: la función interna que hoy arma el entorno del proceso hijo
(`buildChildEnv` en `claudeCodeExecutor.ts`, y su equivalente en `codexExecutor.ts`) necesita una
rama condicional: si `authMode === "api_key"` (default, comportamiento actual sin cambios), sigue
igual; si `authMode === "cli_session"`, **no** inyecta `ANTHROPIC_API_KEY`/`CODEX_API_KEY`, y en
cambio confía en que el CLI encuentre su propia sesión cacheada (típicamente en un archivo bajo
`HOME`, ya presente en `ALLOWED_ENV_PASSTHROUGH_KEYS`).

**Responsabilidades que NO cambian**: el contrato `Executor.runPhase(invocation, options)`
(`src/contracts/executor.ts`) no necesita ningún cambio — sigue devolviendo el mismo
`PhaseResult`. El Workflow Engine (el bucle en `executePipelineRun`, `runStart.ts`) no se entera
de qué modo de autenticación usa el Executor que invoca — coherente con el objetivo del handoff de
mantenerlo desacoplado. La imposición de permisos (`read-only` vs `workspace-write`, H1/H5 de
FEATURE-001) tampoco cambia — ya se confirmó empíricamente en H4 que es independiente del modo de
autenticación.

## 2. Compatibilidad con la arquitectura de 3 capas

Workflow Engine → Executor → Herramienta externa **sigue siendo válida sin refinar**. La
autenticación es un detalle de implementación *dentro* de la capa Executor (cómo arma el
subproceso), no una capa nueva ni una responsabilidad que se filtre hacia el Workflow Engine. No
hace falta introducir una cuarta capa ni dividir "Executor" en sub-capas — el `authMode` propuesto
en la sección 1 es información de configuración, no de arquitectura.

## 3. Estrategia de autenticación — abstracción

No hace falta una interfaz `IExecutor` nueva ni diferenciada por modo de auth (el contrato
`Executor` ya es único y suficiente). La abstracción correcta vive un nivel más abajo, dentro de
cada Executor concreto, en la construcción del entorno del subproceso:

```
Executor.runPhase()
  └─ buildChildEnv(authMode)
       ├─ "api_key"     → inyecta ANTHROPIC_API_KEY / CODEX_API_KEY explícitamente
       └─ "cli_session" → NO inyecta ninguna key; el CLI resuelve su propia sesión cacheada
                          (requiere que HOME/USERPROFILE apunten a donde vive esa sesión)
```

El Workflow permanece desacoplado porque nunca decide esto por fase — se decide una sola vez, al
configurar qué Executor usar para todo el run (o para todo el proyecto), igual que hoy se decide
`executorProvider` (`claude` | `codex`) y `model`.

## 4. Ventajas y desventajas

**Modo API key (actual, sin cambios)**
- Ventajas: cero pasos interactivos garantizado (ya confirmado por H4); rotable/revocable
  centralmente sin tocar cuentas personales; facturación server-to-server clara y auditable;
  compatible sin fricción con ejecución concurrente (ítem Tentativo del Roadmap) y con contenedores
  (Developer/QA) sin exponer nada más sensible que ya no esté ya expuesto hoy.
- Desventajas: costo por uso (pay-per-token), sin aprovechar suscripciones ya pagadas por el
  usuario.

**Modo cuenta personal / OAuth (propuesto)**
- Ventajas: aprovecha suscripciones existentes (Claude Pro/Max, ChatGPT Plus, etc.) — puede
  reducir costo marginal para uso individual; acceso a funcionalidades del plan del usuario que
  la API pura no necesariamente expone igual.
- Desventajas / riesgos reales, no solo teóricos:
  - **No validado para reuso headless repetido** (ver Resumen ejecutivo, punto 2) — requiere una
    validación empírica nueva, no asumible por analogía con H4.
  - **Radio de exposición mayor si se filtra desde un contenedor** (Developer, con Bash real) —
    ver Resumen ejecutivo, punto 4.
  - **Límites de uso menos predecibles**: un plan personal tiene cuotas/límites de uso pensados
    para una persona interactuando, no para un Orquestador disparando invocaciones automáticas
    por fase, run tras run — el comportamiento ante ese patrón de uso no está caracterizado.
  - **Tensión con concurrencia**: el ítem Tentativo "Concurrencia de runs simultáneos" del Roadmap
    asume múltiples invocaciones en paralelo — una sesión de cuenta personal puede no soportar
    eso de la misma forma que credenciales de API independientes por invocación.
  - **Revocación/rotación menos limpia**: revocar una API key comprometida es una operación
    aislada; revocar/cerrar sesión de una cuenta personal puede afectar el uso normal de esa
    cuenta por parte del usuario en otros contextos (fuera del Orquestador).

## 5. Roadmap

Se recomienda incorporar como nuevo ítem `⚪ Tentativo` (no `🟡 Confirmado` — depende de una
validación empírica pendiente, ver punto 2 del resumen ejecutivo):

> Modo de autenticación por cuenta personal (OAuth/sesión de CLI) para Executors, alternativo a
> API Key — condicionado a: (a) validar empíricamente que una sesión ya autenticada se reusa sin
> intervención humana a través de múltiples invocaciones headless separadas en el tiempo (extensión
> de H4, `FEATURE-001-spike-results.md`), y (b) definir política de aislamiento de esa sesión
> cuando el Executor corre en contenedor (Developer/QA, FEATURE-006).

No reemplaza el ítem de "Selección de proveedor/modelo/credenciales por rol" ya existente en el
Roadmap — son complementarios: ese ítem es sobre *qué* proveedor/modelo por rol, este es sobre
*cómo* se autentica el proveedor elegido.

## 6. Documentación de arquitectura a actualizar (cuando se apruebe, no antes)

- `docs/playbook/02-ARCHITECTURE.md`, sección del Executor: agregar una sub-sección
  "Modo de autenticación" documentando los dos valores de `authMode` y su tradeoff, con
  referencia a este análisis y a H4.
- `src/contracts/executor.ts`: el contrato en sí **no cambia** (ver sección 1) — no requiere
  edición si se aprueba esta forma. Si en la validación empírica se descubre que sí hace falta
  exponer algo del modo de auth a través del contrato, ese sería el único punto de esta
  recomendación que quedaría abierto a revisar.
- `docs/features/FEATURE-001-spike-results.md`: agregar una nota de seguimiento sobre H4,
  señalando que este análisis lo retoma para el caso de reuso headless repetido — sin reabrir ni
  modificar el hallazgo original, que sigue siendo válido para el caso que investigó.

## 7. Consideraciones (ya respetadas por diseño de este análisis)

No se investigó ni se propone ningún mecanismo de automatización de interfaces web ni elusión de
autenticación — todo lo descrito arriba usa exclusivamente el mecanismo de login oficial de cada
CLI (`claude auth login` o equivalente), tal como ya se probó en H4.

---

## Recomendación final

Aprobar el concepto como línea de trabajo futura (ítem Tentativo del Roadmap, sección 5), pero
**no** como Feature lista para diseñar todavía — falta cerrar la validación empírica de reuso
headless (punto 2 del resumen ejecutivo) antes de que esto pueda promoverse a `🟡 Confirmado`. La
forma arquitectónica recomendada (parámetro `authMode` sobre los Executors existentes, sin
Executors nuevos ni cambios al contrato) sí puede darse por resuelta desde ya, para cuando se
retome.