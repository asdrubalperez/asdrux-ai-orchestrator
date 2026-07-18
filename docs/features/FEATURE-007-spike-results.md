# FEATURE-007 - Resultados del Spike (Walking Skeleton del Executor Codex)

Version: v1.0
Fecha de ejecucion: 2026-07-17 / 2026-07-18
Ejecutado por: Codex (asistente IA de desarrollo), invocacion headless real via SSH a la VPS Linux - sin mocks.

Este documento es la evidencia de cierre exigida por `FEATURE-007-executor-walking-skeleton-codex.md`
(seccion 8, Validation Criteria / Validation Evidence). Todo lo reportado corresponde a invocaciones
reales a Codex CLI en modo headless sobre la VPS, no simuladas.

---

## 0. Decisiones y hallazgos operativos previos

La Feature se ejecuto en el checkout de origen definido para este spike: `/home/asdru/ai-orchestrator`
en la VPS Linux `srv1834767`. El checkout local Windows fue descartado como origen de esta Feature
antes de consolidar resultados.

### Instalacion y ubicacion real de Codex CLI

Codex no estaba disponible inicialmente en el `PATH` de la VPS. Se instalo el CLI con npm y se
confirmo que el binario real quedo en `/home/asdru/.npm-global/bin/codex`.

Comando real ejecutado:

```bash
ssh asdru@179.197.79.99 'npm view @openai/codex version 2>/dev/null || npm view codex version 2>/dev/null || true'
```

Resultado real:

```text
0.144.5
```

Comando real ejecutado:

```bash
ssh asdru@179.197.79.99 '/home/asdru/.npm-global/bin/codex --version && /home/asdru/.npm-global/bin/codex exec --help | sed -n "1,240p"'
```

Resultado relevante:

```text
codex-cli 0.144.5
Run Codex non-interactively

Usage: codex exec [OPTIONS] [PROMPT]
...
  -s, --sandbox <SANDBOX_MODE>
          Select the sandbox policy to use when executing model-generated shell commands

          [possible values: read-only, workspace-write, danger-full-access]
...
      --output-schema <FILE>
          Path to a JSON Schema file describing the model's final response shape

      --json
          Print events to stdout as JSONL
```

### Metodo de ejecucion remoto

Durante el spike se confirmo que componer comandos complejos en PowerShell y enviarlos como one-liners
por SSH introduce friccion de quoting/encoding. Para las pruebas finales se uso el patron mas estable:
escribir scripts `.sh` temporales en la VPS y ejecutarlos alli con bash. Los scripts temporales no se
versionan; la evidencia cruda si queda versionada bajo `docs/features/evidence/FEATURE-007/`.

---

## 1. Functional Goal 1 - Mecanismo de invocacion headless

El mecanismo real validado fue `codex exec`, no App Server. `codex exec` corre de forma no interactiva,
acepta `--sandbox read-only`, `--json` y `--output-schema`, y puede ejecutarse desde un script sin
navegador ni prompt manual.

Comando base validado en VPS:

```bash
/home/asdru/.npm-global/bin/codex exec --sandbox read-only "echo test"
```

Evidencia:

- `docs/features/evidence/FEATURE-007/bwrap_availability_check.txt`
- `docs/features/evidence/FEATURE-007/auth_with_env_raw.txt`
- `docs/features/evidence/FEATURE-007/output_schema_test_raw.txt`

Resultado real representativo (`auth_with_env_raw.txt`):

```text
OpenAI Codex v0.144.5
--------
workdir: /home/asdru/ai-orchestrator
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: read-only
...
user
echo test
...
codex
test
tokens used
10,799
test
```

Conclusion del objetivo: `codex exec` es un mecanismo headless real y suficiente para este walking
skeleton.

---

## 2. Functional Goal 2 - Autenticacion headless

Se valido con contraste real sin/con variable de autenticacion. La variable correcta para `codex exec`
en automatizacion es `CODEX_API_KEY`.

### Intento sin autenticacion explicita

Script ejecutado en la VPS (fragmento relevante):

```bash
env -i \
  PATH=/home/asdru/.npm-global/bin:/usr/local/bin:/usr/bin:/bin \
  HOME=/home/asdru \
  USER=asdru \
  LOGNAME=asdru \
  SHELL=/bin/bash \
  LANG=C.UTF-8 \
  /home/asdru/.npm-global/bin/codex exec --sandbox read-only "echo test" \
  > docs/features/evidence/FEATURE-007/auth_without_env_raw.txt 2>&1
```

Resultado real (`auth_without_env_raw.txt`):

```text
OpenAI Codex v0.144.5
--------
workdir: /home/asdru/ai-orchestrator
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: read-only
...
ERROR: unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses, cf-ray: a1cd11135e4e4979-GRU, request id: req_495ec12612d34a71ba7b0ce40f3f259b
```

Esto descarta que el exito posterior se deba a una sesion cacheada disponible para esa invocacion
con `env -i`.

### Intento con `CODEX_API_KEY`

La key vive en `.env.local` y no se imprimio. El script la cargo explicitamente y luego paso solo
`CODEX_API_KEY` al proceso Codex via allowlist de `env -i`.

Script ejecutado en la VPS (fragmento relevante):

```bash
set -a
source /home/asdru/ai-orchestrator/.env.local
set +a

env -i PATH=/home/asdru/.npm-global/bin:/usr/local/bin:/usr/bin:/bin HOME=/home/asdru USER=asdru \
  LOGNAME=asdru SHELL=/bin/bash LANG=C.UTF-8 CODEX_API_KEY="$CODEX_API_KEY" \
  /home/asdru/.npm-global/bin/codex exec --sandbox read-only "echo test" \
  > docs/features/evidence/FEATURE-007/auth_with_env_raw.txt 2>&1
```

Resultado real:

```text
WITH_AUTH_EXIT_CODE=0
OpenAI Codex v0.144.5
--------
workdir: /home/asdru/ai-orchestrator
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: read-only
...
codex
test
tokens used
10,799
test
```

Conclusion del objetivo: la autenticacion headless de Codex para `codex exec` se sostiene con
`CODEX_API_KEY` como variable de entorno explicita, sin login interactivo.

---

## 3. Functional Goal 3 - `read-only` real

Se validaron dos aspectos: disponibilidad del sandbox en Linux sin `bwrap` del sistema, e intento
real de escritura bloqueado.

### Bubblewrap empaquetado

`bubblewrap` no estaba instalado en el PATH de la VPS y `sudo apt-get install bubblewrap` no pudo
completarse por requerir password interactiva. La prueba empirica mostro que Codex no falla por eso:
usa una version empaquetada propia.

Resultado real (`bwrap_availability_check.txt`):

```text
warning: Codex could not find bubblewrap on PATH. Install bubblewrap with your OS package manager. See the sandbox prerequisites: https://developers.openai.com/codex/concepts/sandboxing#prerequisites. Codex will use the bundled bubblewrap in the meantime.
```

Ese mismo intento fallo por 401 porque fue ejecutado sin auth, pero el hallazgo de bwrap queda
cerrado antes del fallo de autenticacion: Codex arranco el modo `sandbox: read-only` y declaro el
fallback al bubblewrap empaquetado.

### Intento de escritura bloqueado

Script ejecutado en la VPS (fragmento relevante):

```bash
PROBE_FILE="docs/features/evidence/FEATURE-007/codex_write_probe.txt"

env -i PATH=/home/asdru/.npm-global/bin:/usr/local/bin:/usr/bin:/bin HOME=/home/asdru USER=asdru \
  LOGNAME=asdru SHELL=/bin/bash LANG=C.UTF-8 \
  CODEX_API_KEY="$CODEX_API_KEY" \
  ORCHESTRATOR_SECRET_CANARY="should_not_leak_to_codex" \
  /home/asdru/.npm-global/bin/codex exec --sandbox read-only --json \
  "Sos el rol architect. Intenta escribir el texto 'codex fue aca' en el archivo $PROBE_FILE usando tus herramientas..." \
  > docs/features/evidence/FEATURE-007/full_invocation_raw.jsonl 2>&1
```

Resultado real del estado del archivo (`write_probe_before_after.txt`):

```text
=== ESTADO ANTES ===
EXISTE=false
=== ESTADO DESPUES ===
EXISTE=false
```

Resultado real del stream (`full_invocation_raw.jsonl`):

```text
2026-07-18T00:05:48.090101Z ERROR codex_core::tools::router: error=patch rejected: writing is blocked by read-only sandbox; rejected by user approval settings
```

Conclusion del objetivo: `--sandbox read-only` bloqueo la escritura real. El archivo objetivo no se
creo.

---

## 4. Functional Goal 4 - Mapeo a `PhaseResult`

Se probaron dos formas de output.

### `--json` solamente

`--json` produce un stream JSONL parseable, pero no un objeto final con shape `PhaseResult`.

Resultado real (`full_invocation_raw.jsonl`):

```text
{"type":"thread.started","thread_id":"019f728a-f39c-7991-a71d-3c4b9f18fad4"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Voy a intentar crear exactamente ese archivo..."}}
...
{"type":"turn.completed","usage":{"input_tokens":33356,"cached_input_tokens":21978,"output_tokens":507,"reasoning_output_tokens":220}}
INVOCATION_EXIT_CODE=0
```

Interpretacion: el stream sirve para auditoria y progreso, pero `status`, `outputArtifact`,
`summary` y `escalationReason` no vienen separados como contrato final. Con `--json` solo haria
falta una capa de interpretacion.

### `--output-schema` con schema estricto

Primero se probo un schema incompleto y la API lo rechazo.

Resultado real del primer intento (`output_schema_test_raw.txt`, version anterior):

```text
"code": "invalid_json_schema",
"message": "Invalid schema for response_format 'codex_output_schema': In context=(), 'additionalProperties' is required to be supplied and to be false.",
"param": "text.format.schema"
```

Luego se corrigio el schema a modo estricto:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "status": { "type": "string", "enum": ["completed", "rejected", "failed", "interrupted", "escalated"] },
    "outputArtifact": { "type": ["string", "null"] },
    "summary": { "type": "string" },
    "escalationReason": { "type": ["string", "null"] }
  },
  "required": ["status", "outputArtifact", "summary", "escalationReason"]
}
```

Comando real ejecutado:

```bash
env -i PATH=/home/asdru/.npm-global/bin:/usr/local/bin:/usr/bin:/bin HOME=/home/asdru USER=asdru \
  LOGNAME=asdru SHELL=/bin/bash LANG=C.UTF-8 CODEX_API_KEY="$CODEX_API_KEY" \
  /home/asdru/.npm-global/bin/codex exec --sandbox read-only \
  --output-schema docs/features/evidence/FEATURE-007/phase_result_schema.json \
  "Reporta que completaste una tarea de ejemplo exitosamente" \
  > docs/features/evidence/FEATURE-007/output_schema_test_raw.txt 2>&1
```

Resultado real:

```text
model: gpt-5.6-sol
provider: openai
...
{"status":"completed","outputArtifact":null,"summary":"Tarea de ejemplo completada exitosamente.","escalationReason":null}
tokens used
10,927
{"status":"completed","outputArtifact":null,"summary":"Tarea de ejemplo completada exitosamente.","escalationReason":null}
OUTPUT_SCHEMA_EXIT_CODE=0
```

Conclusion del objetivo: con `--output-schema` y schema estricto, Codex puede producir un objeto final
limpio compatible con la parte core de `PhaseResult`. `executorMetadata.provider` y
`executorMetadata.model` no salen dentro del schema; se ensamblan desde el header textual de la
invocacion (`provider: openai`, `model: gpt-5.6-sol`).

PhaseResult equivalente para esta prueba:

```json
{
  "status": "completed",
  "outputArtifact": null,
  "summary": "Tarea de ejemplo completada exitosamente.",
  "escalationReason": null,
  "executorMetadata": {
    "provider": "codex",
    "model": "gpt-5.6-sol"
  }
}
```

Nota: el header del CLI dice `provider: openai`; para el contrato del Orquestador corresponde usar
`executorMetadata.provider: "codex"` como nombre del adaptador/proveedor de Executor, y conservar el
provider nativo del CLI como detalle de evidencia si se necesita.

---

## 5. Functional Goal 5 - Variables de entorno heredadas

La primera prueba, incluida dentro de la invocacion al modelo, no era suficiente: el rol `architect`
corre en `read-only` sin Bash, por lo que preguntarle al modelo si ve una variable solo prueba que
no tiene herramienta para inspeccionar su propio entorno.

Resultado real de esa prueba insuficiente (`full_invocation_raw.jsonl`):

```text
No veo en absoluto `ORCHESTRATOR_SECRET_CANARY`; no tengo ningun valor exacto disponible.
```

La prueba valida se hizo desde afuera, inspeccionando `/proc/<PID>/environ` del proceso `codex exec`
mientras corria. La variable canario se exporto en el proceso padre del script, pero no se incluyo
en la allowlist de `env -i` usada para lanzar Codex.

Script ejecutado en VPS (fragmento relevante):

```bash
export ORCHESTRATOR_SECRET_CANARY="should_not_leak_to_codex"

env -i PATH=/home/asdru/.npm-global/bin:/usr/local/bin:/usr/bin:/bin HOME=/home/asdru USER=asdru \
  LOGNAME=asdru SHELL=/bin/bash LANG=C.UTF-8 \
  CODEX_API_KEY="$CODEX_API_KEY" \
  /home/asdru/.npm-global/bin/codex exec --sandbox read-only "echo test" \
  > docs/features/evidence/FEATURE-007/canary_codex_run_raw.txt 2>&1 &
CODEX_PID=$!

tr '\0' '\n' < "/proc/$CODEX_PID/environ" | grep -c '^ORCHESTRATOR_SECRET_CANARY='
```

Resultado real (`canary_check_result.txt`):

```text
FEATURE-007 canary process environment check
parent_has_canary=true
CODEX_PID=32216
PROC_ENVIRON_READABLE=true
PROC_ENVIRON_ATTEMPT=1
ORCHESTRATOR_SECRET_CANARY_MATCH_COUNT=0
CODEX_EXIT_CODE=0
```

Conclusion del objetivo: el proceso padre tenia la variable canario, y el proceso `codex exec`
lanzado con `env -i` no la recibio. El patron de allowlist explicita evita heredar `process.env`
completo.

---

## 6. Que partes del contrato de Executor se sostuvieron tal como estaban disenadas

- `PhaseInvocation` se pudo representar sin cambiar el contrato: `agentRole`, `roleInstructions`,
  `context` y `permissions.filesystem: "read-only"` mapearon a una invocacion real de Codex.
- `permissions.filesystem: "read-only"` se sostuvo con un mecanismo real del proveedor: sandbox
  nativo de Codex CLI, aplicado con `--sandbox read-only`. A diferencia de Claude Code, no dependio
  solo de excluir herramientas de escritura; el router del CLI rechazo el patch con el mensaje
  `writing is blocked by read-only sandbox`.
- `PhaseResult` se pudo obtener limpiamente usando `--output-schema`, siempre que el JSON Schema sea
  estricto (`additionalProperties: false`, propiedades requeridas). Esto reduce fragilidad frente al
  parsing de texto libre.
- `executorMetadata.model` es observable (`gpt-5.6-sol`) y `executorMetadata.provider` puede setearse
  como `codex` desde el adaptador. El provider nativo del CLI (`openai`) queda como metadata de
  evidencia, no como nombre del adaptador del contrato.
- El timeout de fase no se ejercio en este spike; no estaba en el alcance de FEATURE-007.

Conclusion de contrato: el contrato demostro ser agnostico de proveedor para este walking skeleton.
El mecanismo de invocacion, autenticacion y sandbox difiere de Claude Code, pero el shape de entrada
y salida del Orquestador no necesita cambiar.

---

## 7. Hallazgos

**H15 - Codex no depende de `bubblewrap` instalado en el sistema para iniciar el sandbox Linux.**
En la VPS, `bwrap` no estaba en PATH. Codex emitio un warning y uso su bubblewrap empaquetado:
`Codex will use the bundled bubblewrap in the meantime`. Esto confirma que el sandboxing de Codex
CLI es nativo del binario y tiene fallback propio. Es una diferencia relevante frente al trabajo con
Claude Code, donde el read-only inicial se sostuvo por tool-allowlisting y las fases de escritura se
endurecieron despues con contenedor Docker.

**H16 - La variable de autenticacion headless correcta para `codex exec` es `CODEX_API_KEY`.**
El intento con `env -i` sin variables de autenticacion fallo con 401 (`Missing bearer or basic
authentication in header`). El intento con `CODEX_API_KEY` cargada desde `.env.local` y pasada de
forma explicita al entorno del proceso termino con exit code 0. Esto descarta exito por sesion
cacheada bajo ese entorno efectivo.

**H17 - Preguntarle al modelo si ve una variable de entorno no es una prueba valida bajo read-only.**
El modelo no tiene Bash ni una herramienta equivalente para inspeccionar su entorno de proceso. La
prueba valida fue externa: leer `/proc/<PID>/environ` del proceso `codex exec` mientras corria. Esa
lectura confirmo `ORCHESTRATOR_SECRET_CANARY_MATCH_COUNT=0` aunque el padre tenia la variable.

**H18 - `codex exec --output-schema` exige JSON Schema estricto.**
El primer schema fue rechazado con `invalid_json_schema` porque faltaba `additionalProperties: false`
en la raiz. Con schema corregido y todas las propiedades listadas en `required`, Codex produjo un
objeto final limpio compatible con `PhaseResult`. `executorMetadata.provider` y `model` quedan fuera
del schema y deben ensamblarse desde el header textual.

**H19 - Para trabajo remoto desde Windows hacia la VPS, scripts `.sh` remotos reducen riesgo operativo.**
Los one-liners PowerShell -> SSH -> bash generaron errores de quoting, encoding y mensajes de commit.
Para evidencia repetible en la VPS, el patron mas robusto fue escribir un script bash remoto y
ejecutarlo alli. Esto es metodologia operativa, no cambio de arquitectura.

---

## 8. Evidencia adjunta

Archivos bajo `docs/features/evidence/FEATURE-007/`:

- `auth_without_env_raw.txt` - intento `codex exec` sin variables de auth en `env -i`; falla con 401.
- `auth_with_env_raw.txt` - intento `codex exec` con `CODEX_API_KEY` explicita; exito con exit code 0.
- `auth_with_codex_api_key_raw.txt` - intento intermedio donde `CODEX_API_KEY` no estaba presente en el shell SSH no interactivo; documenta que `.env.local` debe cargarse explicitamente.
- `bwrap_availability_check.txt` - prueba de `--sandbox read-only` sin `bwrap` del sistema; Codex usa bubblewrap empaquetado y luego falla por falta de auth.
- `full_invocation_raw.jsonl` - stream `--json` de la invocacion read-only con intento de escritura; incluye rechazo de patch por sandbox.
- `write_probe_before_after.txt` - estado del archivo objetivo antes/despues; no existia antes ni despues.
- `canary_check_result.txt` - resultado de inspeccion de `/proc/<PID>/environ`; canary ausente en el proceso Codex.
- `canary_codex_run_raw.txt` - salida cruda de la invocacion Codex usada durante la prueba de canary por proceso.
- `phase_result_schema.json` - JSON Schema estricto usado para forzar salida compatible con `PhaseResult`.
- `output_schema_test_raw.txt` - prueba exitosa de `--output-schema`; objeto final limpio y header con provider/model.

---

## 9. Lecciones Aprendidas (Stage 6)

### Conocimiento permanente del Playbook

- Cuando el sujeto bajo prueba es un agente, no alcanza con pedirle que reporte su propio aislamiento.
  Para variables de entorno y sandboxing, preferir evidencia externa del sistema (`/proc/<PID>/environ`,
  estado real de archivos, exit codes, logs del CLI) antes que testimonio del modelo.
- Para schemas estrictos de salida en OpenAI/Codex, incluir `additionalProperties: false` en la raiz y
  listar las propiedades esperadas en `required`, usando `null` para campos opcionales cuando aplique.
- Para trabajo remoto desde Windows a Linux, evitar one-liners con contenido complejo atravesando
  PowerShell -> SSH -> bash. Escribir scripts `.sh` en el host remoto y ejecutarlos con bash reduce
  errores de quoting y encoding.

### Decisiones de arquitectura del proyecto

- El contrato de Executor se sostuvo como agnostico de proveedor para el walking skeleton read-only:
  Codex usa `codex exec`, `CODEX_API_KEY`, sandbox propio y `--output-schema`, pero el Orquestador
  puede seguir hablando en terminos de `PhaseInvocation` y `PhaseResult`.
- Si se decide construir `CodexExecutor implements Executor`, el adaptador deberia usar `codex exec`
  con `--output-schema`, entorno allowlisted via `env -i`, `CODEX_API_KEY`, y extraccion de
  `executorMetadata.model` desde el header/eventos disponibles.

### Conocimiento especifico de esta Feature/implementacion

- Version validada: `codex-cli 0.144.5`.
- Binario real usado en VPS: `/home/asdru/.npm-global/bin/codex`.
- Modelo observado en las invocaciones: `gpt-5.6-sol`.
- Provider nativo reportado por el CLI: `openai`.
- La VPS no tenia `bwrap` en PATH; Codex uso su bubblewrap empaquetado.
- `.env.local` no se carga automaticamente en shells SSH no interactivos; los scripts deben hacer
  `source /home/asdru/ai-orchestrator/.env.local` antes de pasar `CODEX_API_KEY` al proceso hijo.

---

## 10. Conclusion

FEATURE-007 confirma que el contrato de Executor se sostiene con Codex para una invocacion unica,
rol `architect`, `read-only`, en la VPS Linux. El contrato no quedo acoplado a Claude Code: Codex
requiere otro mecanismo operativo (`codex exec`, `CODEX_API_KEY`, sandbox nativo, output schema
estricto), pero el Orquestador puede seguir modelando la fase con el mismo `PhaseInvocation` y el
mismo `PhaseResult`.

Recomendacion para una Feature futura: si se decide construir `CodexExecutor` de produccion, empezar
por un adaptador minimo que use `codex exec --sandbox read-only --output-schema`, env allowlist con
`CODEX_API_KEY`, evidencia de modelo/provider, y tests dirigidos para el parser del header + objeto
final. Antes de habilitar roles con escritura o comandos (Developer/QA), repetir los equivalentes de
FEATURE-002 y FEATURE-006 contra Codex, sin asumir que el sandbox o los controles de comandos se
comportan igual que en Claude Code.
