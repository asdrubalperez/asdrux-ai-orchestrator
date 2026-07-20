# FEATURE-012 — Investigación: persistencia de contexto/hallazgos en escalamiento

Fecha: 2026-07-20
Rama: `feature/012-escalation-context-persistence-research`
Tipo: investigación para decisión de Architect, sin implementación

## Objetivo

Evaluar cómo persistir el contexto y los hallazgos cuando un agente detecta algo que excede su
autoridad y escala hacia Architect, reiniciando el circuito descrito en
`docs/runbook/06-DELIVERY-WORKFLOW.md`, Stage 3.

Este documento no decide el diseño final ni autoriza implementación. La decisión final pertenece a
Architect.

## Contexto relevado

Stage 3 del Runbook ya define la regla funcional: todo escalamiento entra por Architect y avanza en
el orden normal hasta el dueño real, llevando los hallazgos del agente de origen. También declara
pendiente el mecanismo técnico de persistencia entre reinicios.

Mecanismos de persistencia existentes que podrían importar:

| Mecanismo | Estado actual | Relevancia para FEATURE-012 |
|---|---|---|
| `runs` | Corrida concreta, con `status`, `current_phase`, `owner_id`, `project_id`, branch/worktree. | Sirve para saber que un run terminó `escalated`, pero no modela un hallazgo ni sus intentos de resolución. |
| `run_events` | Log append-only por run, `event_type`, `payload jsonb`, `created_at`; usado por `recordRunEvent`. | Muy relevante para auditoría y reconstrucción cronológica. Ya registra `phase_finished`, `run_error`, `loop_exhausted`, etc. |
| `artifacts` | Outputs por fase: `run_id`, `phase`, `kind`, `content jsonb`, `commit_ref`. Hoy guarda `kind = "escalation"` cuando una fase escala. | Relevante para conservar el artefacto de escalamiento, pero no tiene identidad de circuito/hallazgo ni estado de resolución. |
| `pipeline_definitions` | Definición versionada del pipeline como datos. | Útil para reproducir qué flujo corría, no para transportar hallazgos. |
| `project_config_versions` | Configuración vigente versionada por proyecto. | No es buen store para hallazgos: representa configuración operativa, no eventos/casos de escalamiento. |
| `run_config_versions` | Snapshot de configs vigentes al iniciar un run. | Útil para reconstruir contexto de configuración de un run escalado, no para gestionar el circuito. |
| Git/worktree | Código y cambios reales viven en git/worktrees. | Puede complementar evidencia técnica, pero no reemplaza una traza consultable en DB. |

## Opciones evaluadas

### Opción A — Usar solo `run_events` con eventos estructurados nuevos

Consiste en mantener el log append-only como fuente principal, agregando convenciones de eventos
como `escalation_opened`, `escalation_routed`, `escalation_resolved`, `escalation_human_required`,
con payloads JSON que incluyan `finding_id`, agente origen, fase destino, razón, contador de
pasadas y hash/firma del hallazgo repetido.

Ventajas:

- Encaja con la arquitectura actual: auditabilidad primero y `run_events` como log append-only.
- Costo bajo: no requiere tabla nueva necesariamente.
- Preserva historia completa sin sobrescribir estado.
- Se integra naturalmente con `getRunDetail` y futura UI/SSE.

Riesgos:

- Consultar "estado vigente" del circuito exige reconstruirlo desde eventos, con lógica de replay.
- Las garantías son convenciones de aplicación: no hay constraints para impedir dos escalations
  abiertas para el mismo hallazgo.
- La detección de hallazgo repetido o tope de 3 pasadas puede quedar frágil si depende solo de
  payload JSON sin índices/constraints específicos.

Encaje actual: alto para auditoría y MVP, medio para operación robusta.

### Opción B — Reutilizar `artifacts` con `kind = "escalation_context"`

Consiste en guardar cada hallazgo escalado como artifact adicional del run, usando `phase`, `kind`
y `content` para conservar contexto, destino esperado, evidencia y estado.

Ventajas:

- Ya existe tabla y función `recordArtifact`.
- Se alinea parcialmente con el uso actual: cuando una fase escala, ya se guarda un artifact
  `kind = "escalation"`.
- Costo bajo y lectura simple desde `getRunDetail`.

Riesgos:

- `artifacts` modela outputs de fases, no workflow operativo ni estado de resolución.
- No hay campos naturales para `finding_id`, intento/pasada, estado abierto/resuelto, dueño real,
  ni relación entre reinicios.
- Mezcla semántica similar al problema evitado en FEATURE-011 con `artifacts`: output producido
  por agente vs estado operativo del sistema.
- Difícil imponer reglas de "3 pasadas" o "hallazgo repetido" con constraints.

Encaje actual: medio para conservar evidencia, bajo como store canónico del circuito.

### Opción C — Tabla dedicada de escalamiento + eventos para auditoría

Consiste en crear una entidad específica, por ejemplo `escalation_threads` o
`run_escalation_findings`, para representar el hallazgo operativo y su estado vigente. Campos
posibles: `id`, `origin_run_id`, `project_id`, `finding_key` o `finding_hash`, `origin_agent_role`,
`current_owner_role`, `status`, `pass_count`, `payload jsonb`, `opened_at`, `resolved_at`,
`human_required_at`. `run_events` seguiría registrando cada transición como auditoría.

Ventajas:

- Separa claramente estado operativo vigente de auditoría append-only.
- Permite consultas directas: hallazgos abiertos, repetidos, resueltos, escalados a humano.
- Permite índices/constraints útiles, por ejemplo por `origin_run_id`, `status`, `finding_hash`.
- Modela explícitamente las reglas de Stage 3: camino único, contador de pasadas y repetición.

Riesgos:

- Mayor costo: migración, funciones repository, integración en `runStart.ts`/orquestación futura y
  pruebas reales.
- Si se diseña demasiado grande ahora, puede sobredimensionar una parte del pipeline que todavía
  no está implementada end-to-end.
- Requiere decidir forma mínima del `finding_key/hash` y cuándo se considera "mismo hallazgo".

Encaje actual: alto como solución robusta, con costo medio.

### Opción D — Modelo híbrido mínimo: `run_events` canónico para historia + tabla fina de índice/estado

Consiste en usar `run_events` como registro canónico de todo lo ocurrido, pero agregar una tabla
pequeña para el estado consultable del circuito, por ejemplo `escalation_findings`, con solo lo
necesario para operación: identidad, run/proyecto, estado, dueño actual, contador de pasadas,
firma del hallazgo y referencia al último `run_events.id` relevante.

Ventajas:

- Mantiene el principio de auditabilidad en `run_events`.
- Evita reconstruir estado operativo haciendo replay completo.
- Tabla más chica que la opción C; reduce riesgo de sobrediseño.
- Permite evolucionar: empezar con campos mínimos y mantener payload rico en eventos.

Riesgos:

- Hay doble escritura: evento append-only + actualización/insert de estado. Debe ser transaccional.
- La consistencia entre tabla de estado y eventos debe diseñarse explícitamente.
- Igual requiere migración y APIs nuevas.

Encaje actual: alto si Architect quiere una primera implementación sólida sin cargar toda la
semántica futura en una tabla grande.

## Tabla de tradeoffs

| Opción | Costo | Solidez operativa | Auditoría | Simplicidad de lectura vigente | Riesgo principal |
|---|---:|---:|---:|---:|---|
| A. Solo `run_events` | Bajo | Media | Alta | Baja-media | Estado derivado por replay y convenciones JSON. |
| B. Solo `artifacts` | Bajo | Baja | Media | Media | Mezcla output de agente con estado operativo. |
| C. Tabla dedicada completa + eventos | Medio-alto | Alta | Alta | Alta | Sobrediseño prematuro y más superficie a implementar. |
| D. Híbrido mínimo: eventos + tabla fina | Medio | Alta | Alta | Alta | Consistencia transaccional entre evento y estado. |

## Recomendación razonada

Recomiendo que Architect considere la opción D como diseño base: `run_events` debe seguir siendo el
log append-only canónico para auditoría, pero conviene agregar una tabla mínima de estado para no
obligar al Orquestador a reconstruir el circuito de escalamiento por replay de eventos cada vez que
necesite decidir si el hallazgo se repitió, si llegó al tope de 3 pasadas, o quién debe resolverlo
ahora.

La opción A es atractiva como MVP porque aprovecha infraestructura existente, pero deja las reglas
centrales de Stage 3 apoyadas en payloads JSON y lógica de reconstrucción. Eso puede ser suficiente
para observar escalamientos, no necesariamente para gobernarlos.

La opción B no la recomiendo como store canónico. `artifacts` puede seguir guardando el output
producido por una fase que escaló, pero el circuito de escalamiento necesita identidad, estado y
transiciones; eso no es lo mismo que un artifact.

La opción C es conceptualmente sólida, pero probablemente convenga llegar a ella de forma
incremental desde la opción D, cuando haya evidencia de qué consultas y reglas operativas necesita
realmente el Orquestador.

Decisión final pendiente: Architect debe definir si FEATURE-012 prioriza un MVP apoyado solo en
eventos, o si incorpora desde el inicio una tabla mínima de estado. Codex no toma esa decisión.

## Preguntas de diseño para Architect

- ¿El circuito de escalamiento se modela dentro del mismo `run` o crea runs nuevos vinculados al
  hallazgo original?
- ¿Qué forma mínima debe tener la identidad de "mismo hallazgo" para detectar repetición:
  `finding_hash`, clave semántica explícita, o combinación de agente/fase/razón?
- ¿Qué debe considerarse resolución: una fase posterior completada, una decisión humana, o un
  evento explícito `escalation_resolved`?
- ¿La UI futura necesita listar hallazgos abiertos por proyecto, o solo verlos dentro de un run?
