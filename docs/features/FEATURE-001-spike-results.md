# FEATURE-001 — Resultados del Spike (Walking Skeleton del Executor)

Versión: v1.0
Fecha de ejecución: 2026-07-16
Ejecutado por: Claude Code (asistente IA de desarrollo), invocación headless real — sin mocks.

Este documento es la evidencia de cierre exigida por `FEATURE-001-executor-walking-skeleton.md`
(sección 8, Validation Criteria / Validation Evidence). Todo lo acá reportado corresponde a
invocaciones reales a Claude Code CLI en modo headless, no simuladas.

---

## 0. Decisión previa escalada y resuelta

Durante la implementación surgieron dos ambigüedades explícitas que, según `FEATURE-001` (sección
"Antes de implementar") y `03-AI-CONSTITUTION.md` (regla 8), correspondía escalar en vez de resolver
por asunción:

1. **Mecanismo de invocación headless (Agent SDK vs CLI).** Resuelto por el humano: se usa
   **Claude Code CLI headless** (`claude -p`), no el Agent SDK.
2. **El binario `claude` no estaba instalado en el entorno de ejecución.** Se instaló vía
   `npm install -g @anthropic-ai/claude-code` (v2.1.211) con autorización explícita del humano.
3. **Autenticación del CLI.** El CLI requirió login; se resolvió con `claude auth login`
   (OAuth por navegador, cuenta `claude.ai`, tier `team`). Ver hallazgo H4 más abajo — esto
   **no** es el mecanismo de autenticación que va a poder usarse en producción sobre la VPS.

---

## 1. Invocación 1 — Caso básico + intento de escritura bloqueado

### PhaseInvocation utilizado (contrato de `02-ARCHITECTURE.md` sección 6)

```json
{
  "agentRole": "architect",
  "roleInstructions": "<ver docs/features/evidence/FEATURE-001/role_instructions_architect.txt>",
  "context": {
    "caso_negocio": "Reservas de salas de reunión",
    "descripcion": "El equipo de facilities necesita que los empleados puedan reservar salas de reunión desde un portal interno existente, viendo disponibilidad en tiempo real y evitando dobles reservas.",
    "restricciones_conocidas": [
      "Debe integrarse con el calendario corporativo existente (Google Calendar)",
      "Máximo 2 horas de reserva continua por usuario por día"
    ]
  },
  "permissions": {
    "filesystem": "read-only",
    "writableRoots": [],
    "allowedCommands": []
  }
}
```

### Mapeo a la invocación real de CLI

`permissions.filesystem: "read-only"` se tradujo como:

```
claude -p \
  --system-prompt "$(cat role_instructions_architect.txt)" \
  --tools "Read,Grep,Glob" \
  --output-format json \
  --no-session-persistence \
  --strict-mcp-config \
  "$(cat invocation1_prompt.txt)"
```

Es decir: **ningún flag de "read-only" existe como tal en el CLI**. La única forma real de
imponerlo es no incluir `Write`, `Edit`, `NotebookEdit` ni `Bash` en `--tools`. Ver hallazgo H1.

El prompt de tarea instruyó explícitamente intentar crear `output.txt` (ver
`docs/features/evidence/FEATURE-001/invocation1_prompt.txt`), para forzar el intento de escritura
requerido por la regla funcional 3 de la Feature.

### Evidencia — intento de escritura bloqueado

- **Transcript crudo completo:** `docs/features/evidence/FEATURE-001/invocation1_raw.json`
- **`output.txt` NO fue creado** en el directorio de trabajo (verificado con `ls` inmediatamente
  después de la invocación — ver evidencia de comando en el historial de ejecución de esta sesión).
- **`permission_denials: []`** en la respuesta cruda — el intento no generó ni siquiera un evento
  de "denegado"; la operación fue estructuralmente imposible porque el modelo no tenía ninguna
  herramienta capaz de escribir. El propio modelo lo reportó así en su respuesta (campo
  `INTENTO_ESCRITURA` del texto de resultado):

  > "... no dispongo de ninguna herramienta de escritura de archivos (Write/Edit) ni de ejecución
  > de comandos de shell (Bash) en este entorno/fase, por lo que resulta técnicamente imposible
  > ejecutar la operación de escritura solicitada. El resultado del intento es: rechazado/no
  > ejecutable por ausencia de herramienta habilitada para esa acción — no por un error de
  > permisos del filesystem en sí ..."

Esto confirma la regla de diseño de `01-PROJECT-CHARTER.md` ("solo lectura no puede depender solo
del prompt") — acá se sostuvo por restricción real del toolset, no por instrucción de prompt
ignorable. Pero el mecanismo concreto es distinto al que la arquitectura daba por sentado. Ver H1.

### PhaseResult completado (sin campos forzados)

```json
{
  "status": "completed",
  "outputArtifact": {
    "componentes_principales": [
      "Portal interno (frontend existente) — se extiende con módulo 'Reservar sala'",
      "API de Reservas (Booking Service) — nuevo backend/módulo que orquesta disponibilidad, creación/cancelación y validación de reglas",
      "Motor de Reglas de Negocio — valida el límite de 2h continuas/usuario/día",
      "Integración con Google Calendar API como fuente de verdad de disponibilidad",
      "Base de datos propia para metadatos de reserva, auditoría y validación de la regla de negocio",
      "Autenticación/SSO reutilizando el mecanismo corporativo existente",
      "Capa de notificaciones (opcional)"
    ],
    "flujo_interaccion": "Login SSO → consulta disponibilidad vía Google Calendar Free/Busy API → validación de regla 2h contra historial propio → creación atómica del evento en Calendar con manejo de conflictos → persistencia local para auditoría → sincronización en tiempo real vía webhooks/push notifications",
    "mecanismo_anti_doble_reserva": "Google Calendar como lock natural sobre el recurso sala + verificación previa de conflicto en el Booking Service antes de escribir, con reintento si Calendar reporta conflicto",
    "supuestos_a_confirmar": [
      "Cantidad de salas y si están modeladas como Calendar Resources en Google Workspace",
      "Mecanismo de autenticación actual del portal",
      "Posibilidad de cancelar/modificar reservas y antelación requerida",
      "Alcance exacto de la regla de 2h (por sala, por usuario global, o ambas)",
      "Requisitos de auditoría/reporting a mediano plazo"
    ]
  },
  "summary": "Se diseñó una arquitectura de alto nivel para el sistema de reservas de salas de reunión, basada en sincronización con Google Calendar como fuente de verdad de disponibilidad, una capa de validación de reglas de negocio (máx. 2h continuas/usuario/día) y una API intermedia que expone el flujo de reserva al portal interno existente. No se identificaron ambigüedades bloqueantes. Se intentó crear 'output.txt' según lo solicitado; el intento fue bloqueado porque la invocación no dispone de herramientas de escritura (solo Read, Glob y Grep), consistente con la restricción de esta fase de no modificar el filesystem real.",
  "escalationReason": null
}
```

**Mapeo:** limpio, sin inventar campos. `outputArtifact` se construyó estructurando el bloque
`ARTEFACTO` de la respuesta cruda (texto en bullets) — la respuesta original no vino en JSON
estructurado nativo, ver hallazgo H2.

---

## 2. Invocación 2 — Escalamiento simulado

### PhaseInvocation utilizado

Mismo `roleInstructions` y `permissions` que la Invocación 1. Cambia el `context`:

```json
{
  "caso_negocio": "Modernizar el sistema de pagos internos",
  "descripcion": "Queremos mejorar el sistema de pagos.",
  "restricciones_conocidas": []
}
```

Comando real: idéntico al de la Invocación 1, cambiando el archivo de prompt
(`docs/features/evidence/FEATURE-001/invocation2_prompt.txt`), que instruye explícitamente no
inventar datos faltantes y escalar si la información es insuficiente.

### Evidencia

Transcript crudo completo: `docs/features/evidence/FEATURE-001/invocation2_raw.json`

### PhaseResult completado

```json
{
  "status": "escalated",
  "outputArtifact": null,
  "summary": "El caso de negocio 'Modernizar el sistema de pagos internos' fue recibido con una descripción genérica ('Queremos mejorar el sistema de pagos') y sin restricciones conocidas. No es posible proponer una arquitectura de alto nivel con confianza razonable porque faltan datos críticos de diseño (tipo de pagos, volumen, integraciones existentes, marco regulatorio, requisitos no funcionales, alcance de la modernización). Corresponde escalar a un humano para relevar esta información antes de continuar con la fase de Architect.",
  "escalationReason": "Información crítica insuficiente para diseñar con confianza: (1) tipo y naturaleza de los pagos internos a modernizar, (2) volumen/frecuencia de transacciones esperado, (3) sistemas e integraciones existentes que deben mantenerse o migrarse, (4) marco regulatorio y de compliance aplicable (PCI-DSS, AML/KYC, normativa local), (5) requisitos no funcionales (disponibilidad, latencia, consistencia, auditoría, seguridad), (6) alcance esperado de la modernización (reemplazo total vs. incremental vs. coexistencia con legado). Se requiere que un humano complete este relevamiento antes de proceder con el diseño."
}
```

**Mapeo:** limpio. `status: "escalated"` y `escalationReason` no nulo se completaron
directamente desde la respuesta real, sin forzar ningún valor.

---

## 3. Qué partes del contrato de Executor se sostuvieron tal como estaban diseñadas

- La forma de `PhaseInvocation` (agentRole, roleInstructions, context, permissions) se pudo usar
  completa y sin recortes para invocar el CLI real.
- `permissions.filesystem: "read-only"` se sostiene como restricción *real*, no solo de prompt —
  confirmado con evidencia funcional observable (intento de escritura, `output.txt` inexistente,
  `permission_denials: []`).
- Los cuatro estados de `PhaseResult.status` usados en la Feature (`completed`, `escalated`) se
  completaron sin forzar campos. El agente distingue correctamente cuándo debe escalar en lugar de
  inventar una resolución — comportamiento consistente con `03-AI-CONSTITUTION.md` regla 8.
- El timeout de fase (`timeoutMs`) no se ejerció en este spike — no estaba en el alcance incluido.

## 4. Hallazgos — qué no mapeó limpiamente o difiere de lo asumido en el diseño

**H1 — "Sandbox de filesystem" no es lo que impone el read-only; es tool-allowlisting.**
`02-ARCHITECTURE.md` (sección 6, Integration Principles) asume que "solo lectura" se impone
"combinando prompt de rol + herramientas habilitadas + sandbox de filesystem + política de
comandos". En la práctica, con el CLI, el único mecanismo real disponible y verificado hoy es la
restricción del **toolset** (`--tools "Read,Grep,Glob"`, excluyendo `Write`/`Edit`/`NotebookEdit`/`Bash`).
No hay un sandbox de filesystem a nivel OS que se haya probado o que el CLI exponga como flag
nativo — esa capa, si se necesita como defensa adicional (especialmente relevante para las fases
Developer/QA que sí necesitan escritura, donde `Bash` seguirá habilitado), depende de lo que ya
está planeado en la arquitectura: aislamiento por `git worktree` + contenedor. **Para fases
read-only como Architect/Functional/Planning, el tool-allowlisting alcanza; para fases de
escritura, el aislamiento por contenedor sigue siendo necesario y no fue validado en este spike**
(estaba explícitamente fuera de alcance).

**H2 — La respuesta no viene en el shape de `PhaseResult` de forma nativa.**
`--output-format json` devuelve un objeto con metadata de ejecución (costo, tokens, duración, etc.)
y un campo `result` que es **texto libre** — no un JSON estructurado con `status`/`outputArtifact`/
`summary`/`escalationReason`. En este spike, ese mapeo se logró porque el `roleInstructions` le pidió
al modelo seguir un formato de texto por convención (`ESTADO:`, `RESUMEN:`, `ARTEFACTO:`, etc.), y
el mapeo a `PhaseResult` se hizo manualmente parseando ese texto. Esto es frágil para un Executor de
producción. El CLI expone `--json-schema` (structured output validation) que **no se usó en este
spike** pero sería el mecanismo correcto para que el Executor obtenga directamente un JSON con la
forma exacta de `PhaseResult`, sin depender de parsing de texto por convención. Recomendación para
la implementación real del Executor: usar `--json-schema` con el schema de `PhaseResult`.

**H3 — Routing interno de modelos no es visible en el contrato.**
La respuesta cruda muestra que la invocación usó dos modelos (`claude-haiku-4-5` para una tarea
interna corta y `claude-sonnet-5` para el trabajo real). El contrato de `PhaseResult` no tiene lugar
para registrar qué modelo ejecutó la fase. Si la auditabilidad de qué modelo tomó cada decisión
importa (razonable dado el principio de auditabilidad completa del Charter), esto es un campo a
considerar agregar a `PhaseResult` o a `run_events`, o fijar explícitamente el modelo con `--model`
en cada invocación del Executor real.

**H4 — Autenticación headless real para producción sigue sin validar (hallazgo pre-existía, confirmado empíricamente).**
Este spike se autenticó con `claude auth login` (OAuth por navegador, cuenta `claude.ai`). Esto
funciona para un spike ejecutado por una persona con acceso interactivo, pero **no** es viable tal
cual para el Executor corriendo headless en la VPS de producción, donde no habrá una persona
disponible para loguearse por navegador cada vez que expire la sesión. Esto **no invalida** la
evidencia de permisos/sandbox obtenida hoy (es ortogonal), pero queda como **pendiente aparte,
bloqueante antes de construir el Orquestador real**: validar un camino de autenticación headless
sin intervención humana (candidatos a evaluar: `apiKeyHelper` / `ANTHROPIC_API_KEY` con `--bare`,
o autenticación vía proveedor empresarial como Bedrock/Vertex/Foundry, mencionados en el propio
`--bare` help text del CLI). No se investigó cuál de estos aplica al plan de Santex/Swiss Medical —
queda para una Feature o spike futuro específico.

**Actualización 2026-07-16 — H4 resuelto: autenticación headless no interactiva confirmada con `ANTHROPIC_API_KEY`.**
Se repitió la invocación básica de la Invocación 1 (mismo rol `architect`, mismo
`permissions.filesystem: "read-only"` mapeado a `--tools "Read,Grep,Glob"`), autenticando
**exclusivamente** con `ANTHROPIC_API_KEY` como variable de entorno, usando además `--bare` (que
según el propio `--help` del CLI fuerza que la autenticación sea estrictamente vía
`ANTHROPIC_API_KEY`/`apiKeyHelper`, ignorando OAuth y keychain). **Sin ningún paso interactivo ni
`claude auth login`.**

- Transcript crudo completo: `docs/features/evidence/FEATURE-001/invocation1_apikey_raw.json`.
- La key se leyó desde `.env.local` (no versionado — protegido por `.gitignore` vía el patrón
  `*.local`) y se inyectó únicamente en el entorno del proceso puntual de esa invocación; nunca se
  imprimió, registró en logs, ni se escribió en ningún archivo del repositorio. Verificado
  explícitamente: el archivo de evidencia no contiene el valor de la key (`grep` sobre el prefijo
  `sk-ant-` no matchea nada en el JSON guardado).
- **Primer intento falló con `401 Invalid API key`** — causa raíz identificada sin exponer el
  secreto: el valor en `.env.local` estaba entre comillas dobles (`"sk-ant-...gAA"`) y la extracción
  inicial no las removía, por lo que las comillas viajaban como parte del valor de la variable de
  entorno. Corregido el parseo (se despojan comillas envolventes además de espacios), la invocación
  se reintentó y funcionó.
- **Resultado del segundo intento (ya con la key bien parseada): éxito.** `is_error: false`,
  `exit_code: 0`. El modelo respondió `ESTADO: completed` con una propuesta de arquitectura, y
  reportó el intento de escritura de `output.txt` como imposible por no tener ninguna herramienta
  de escritura disponible (`Read` únicamente) — mismo comportamiento de bloqueo ya evidenciado en la
  Invocación 1 autenticada por OAuth. `output.txt` **no** se creó (confirmado por `ls` posterior).
- **Conclusión de H4**: el comportamiento de permisos (bloqueo de escritura en fase read-only) es
  **idéntico** entre autenticación OAuth y autenticación por `ANTHROPIC_API_KEY` — la imposición de
  read-only es independiente del mecanismo de autenticación, como cabía esperar dado que ambos pasan
  por la misma restricción de toolset (H1). Y, a diferencia del OAuth por navegador, **este
  mecanismo sí es viable para un Executor headless en la VPS de producción sin persona disponible**:
  no requiere ningún paso interactivo, solo que la variable `ANTHROPIC_API_KEY` esté disponible en
  el entorno del proceso que invoca al Executor. El riesgo bloqueante queda **resuelto** — ver
  actualización correspondiente en `01-PROJECT-CHARTER.md`. Queda como nota operativa (no
  bloqueante): definir cómo se provisiona esa variable de forma segura en la VPS (variable de
  entorno del servicio, secret manager, etc. — no se decidió en este spike, es un detalle de
  despliegue).

**Seguimiento 2026-07-21 — FEATURE-015.** H4 no validó si una sesión OAuth ya autenticada puede
reusarse sin intervención humana a través de múltiples invocaciones headless separadas en el
tiempo, ni qué implica montar esa sesión dentro del contenedor de Developer. FEATURE-015 retoma
esa pregunta como investigación empírica antes de diseñar cualquier `authMode` real para los
Executors.

---

## 5. Evidencia adjunta

- `docs/features/evidence/FEATURE-001/role_instructions_architect.txt` — `roleInstructions` usado.
- `docs/features/evidence/FEATURE-001/invocation1_prompt.txt` — prompt de tarea, invocación 1.
- `docs/features/evidence/FEATURE-001/invocation2_prompt.txt` — prompt de tarea, invocación 2.
- `docs/features/evidence/FEATURE-001/invocation1_raw.json` — transcript crudo completo, invocación 1.
- `docs/features/evidence/FEATURE-001/invocation2_raw.json` — transcript crudo completo, invocación 2.

---

## 6. Conclusión

El contrato de Executor (`Executor.runPhase`, `PhaseInvocation`, `PhaseResult`) es viable y se
sostiene con evidencia funcional real vía Claude Code CLI headless. El riesgo de mayor prioridad
identificado por la Feature — que `permissions.filesystem: "read-only"` no fuera imponible más allá
del prompt — **no se materializó**: la restricción se sostiene, pero por un mecanismo distinto
(tool-allowlisting) al descripto literalmente en la arquitectura (sandbox de filesystem). Se
recomienda actualizar `02-ARCHITECTURE.md` sección 6 para reflejar este mecanismo concreto antes de
diseñar el Executor real, y resolver H4 (autenticación headless de producción) como pre-requisito
del Orquestador — no bloquea este spike, pero sí bloquea el siguiente milestone.
