# FEATURE-007 — Walking Skeleton del Executor (Codex)

Versión: v1.1
Basado en: 07-FEATURE-TEMPLATE.md (Standard Mode)

---

# 1. Feature Identity

- **Name**: Executor Walking Skeleton — Codex, invocación única, rol Architect
- **Type**: Spike técnico / prueba de contrato (no feature de negocio)
- **Owner**: Asdru
- **Status**: **Pending Approval** (Discovery cerrado, revisado por Codex, falta Go explícito)
- **Priority**: Alta — valida si el contrato de Executor es genuinamente agnóstico de proveedor, o si quedó modelado a medida de Claude Code por ser el primero probado

---

# 2. Problem Statement

El contrato de Executor (Executor.runPhase, PhaseInvocation, PhaseResult) se diseñó antes de
que existiera ninguna implementación real, y hasta ahora solo se validó contra un proveedor
(Claude Code CLI, FEATURE-001/002/006). Quedó anotado como "future idea" desde FEATURE-001:
repetir el mismo spike contra Codex, para confirmar que el contrato no tiene supuestos ocultos
específicos de Claude Code (formato de streaming, mecanismo de permisos, forma de la respuesta).

Motivación de negocio: de-riesgar la portabilidad del contrato de Executor antes de comprometer
esfuerzo en construir un CodexExecutor de producción o en decisiones de selección de proveedor
por rol.

---

# 3. Functional Goal

Confirmar, con una invocación real y no simulada contra Codex, que:

1. Existe un mecanismo de invocación headless de Codex (resolver empíricamente: App Server vs
   codex exec — pregunta abierta desde el diseño original, nunca cerrada).
2. Existe una forma de autenticar ese mecanismo **sin login interactivo**, con criterio
   observable: comando ejecutado desde proceso hijo (Node/script), sin navegador, sin prompt
   manual. Si Codex termina usando una sesión ya cacheada en vez de autenticación real por API
   key, **eso se documenta como hallazgo, no se cuenta como éxito de autenticación headless**
   (equivalente a H4 de FEATURE-001, pero con el criterio de "headless real" precisado a pedido
   de Codex).
3. El permiso filesystem: "read-only" puede sostenerse con el mecanismo real de Codex — sea o
   no el mismo mecanismo que usa Claude Code (exclusión de toolset). No asumir el patrón de
   Claude Code; investigar primero cómo Codex confina de verdad.
4. La respuesta real de Codex puede mapearse, sin pérdida de información relevante ni campos
   forzados, a la forma PhaseResult ya definida. executorMetadata.model se registra **solo si
   la salida nativa o metadata real de Codex lo expone**; si no lo expone, se documenta
   explícitamente "no disponible" — nunca se inventa un valor.
5. El proceso hijo que invoca Codex no hereda process.env completo del Orquestador —
   verificado con una variable canario (ver Sección 8), no solo con inspección visual del
   entorno heredado.

---

# 4. Scope

**Included**
- Una única invocación headless a Codex, rol architect.
- Investigación y prueba empírica del mecanismo real de invocación headless (no asumir cuál es
  antes de probarlo).
- Verificación efectiva de permissions.filesystem: "read-only" — incluyendo intento explícito de
  escritura contra un archivo objetivo nombrado, mismo patrón que FEATURE-001.
- Mapeo de la respuesta real al contrato PhaseResult, incluyendo executorMetadata.provider y
  executorMetadata.model cuando esté disponible.
- Verificación de variables de entorno heredadas al proceso hijo, con variable canario.
- Registro simple del resultado (archivo/log local, igual que FEATURE-001 — no persistencia).

**Excluded**
- workspace-write / aislamiento de escritura para Codex (equivalente a FEATURE-002 — se hace
  después, si este spike confirma que vale la pena seguir).
- Rol qa y su mecanismo de confinamiento de comandos (equivalente a FEATURE-006 — H14 se resolvió
  para Claude Code sacándole Bash a QA; no asumir que Codex necesita el mismo patrón sin investigar
  primero cómo maneja Codex la ejecución de comandos).
- CodexExecutor implements Executor como implementación de producción — esto es spike
  descartable primero, no compromiso de construir el adaptador completo.
- Base de datos, Orquestador (máquina de estados), UI — igual que FEATURE-001.
- Selección de modelo/proveedor por rol — depende de que este spike exista primero.
- Exploración en entornos distintos al ambiente autorizado de esta Feature (ver Sección 7) — no
  mezclar evidencia de este spike con pruebas exploratorias en otro ambiente.

**Future ideas (optional)**
- Si el spike confirma portabilidad del contrato: repetir FEATURE-002 (aislamiento de escritura)
  y FEATURE-006 (confinamiento QA) contra Codex, para tener paridad completa antes de considerar
  selección de proveedor por rol.

---

# 5. Functional Rules

1. La invocación debe usar exactamente la forma de PhaseInvocation ya definida en
   02-ARCHITECTURE.md — no una versión simplificada ad-hoc, porque lo que se está probando es
   la portabilidad de ese contrato tal cual está escrito.
2. El resultado se considera **válido** solo si se puede completar PhaseResult sin campos
   forzados o inventados. Si el shape nativo de Codex no mapea limpio, eso es un hallazgo a
   documentar, no un detalle a ocultar (mismo criterio que H2 en FEATURE-001). Esto aplica en
   particular a executorMetadata.model: si no está expuesto, se documenta "no disponible", no
   se completa con un valor supuesto.
3. La verificación de read-only debe hacerse contra un archivo objetivo nombrado
   (docs/features/evidence/FEATURE-007/codex_write_probe.txt), con verificación de
   existencia/hash **antes y después** del intento. Si el archivo llega a crearse, no se borra sin
   documentar primero el resultado — la evidencia de la falla del confinamiento (si ocurre) vale
   más que dejar el workspace limpio.
4. No asumir que el mecanismo de permisos de Codex es análogo al de Claude Code. Investigar primero
   cómo Codex confina filesystem/comandos en la práctica, documentarlo como hallazgo independiente,
   y solo después decidir si el mismo patrón aplica.
5. La verificación de variables de entorno heredadas se hace inyectando una variable canario en el
   proceso padre (ej. ORCHESTRATOR_SECRET_CANARY=should_not_leak_to_codex — nunca un secreto
   real) y confirmando que el proceso hijo invocado por Codex no la recibe. No alcanza con una
   allowlist declarada sin verificación empírica de que se respeta.
6. Toda la evidencia de esta Feature (autenticación, permisos, canary, escritura) es válida
   únicamente si se produjo en el ambiente autorizado (ver Sección 7). Evidencia recolectada en
   otro ambiente no cuenta para cerrar esta Feature.

---

# 6. Estrategia Algorítmica (Opcional)

No aplica — esta Feature no introduce ni modifica lógica de decisión del Orquestador.

---

# 7. Technical Considerations

- **Arquitectura afectada**: ninguna en producción — spike aislado, fuera del Orquestador, mismo
  patrón que FEATURE-001.
- **Ambiente de ejecución autorizado**: **VPS Linux** (el mismo entorno ya configurado con
  Node.js 22 LTS y Docker desde FEATURE-006, y el entorno de producción real del proyecto). No se
  usa exploración en Windows local ni otro ambiente como fuente de evidencia válida para esta
  Feature — el comportamiento de sandbox de filesystem, autenticación headless y herencia de
  variables de entorno puede diferir entre ambientes, como ya ocurrió con la resolución de
  localhost vs 127.0.0.1 documentada en H6/FEATURE-006. Exploración informal en otro ambiente
  puede servir para orientarse, pero no reemplaza la evidencia formal, que debe producirse en la
  VPS.
- **Integraciones**: Codex en modo headless — mecanismo exacto de invocación (App Server vs
  codex exec) es una pregunta abierta que esta misma Feature debe resolver empíricamente.
- **Dependencias**: cuenta personal de OpenAI/Codex ya paga, sin fricción de pago (según handoff
  general). Acceso funcional a Codex headless desde la VPS.
- **Riesgos técnicos**:
  - Que no exista un modo headless real equivalente a claude -p ... --bare, obligando a
    replantear el alcance del spike.
  - Que el mecanismo de confinamiento de filesystem de Codex sea estructuralmente distinto
    (ej. dependa de contenedor en vez de exclusión de toolset), lo cual no invalida el contrato de
    Executor pero sí condiciona cómo se implementa permissions puertas adentro del adaptador.
  - **Riesgo principal señalado por Codex**: que el spike termine validando accidentalmente el
    entorno interactivo actual de Codex Desktop en vez de un mecanismo headless reproducible por
    el Orquestador. Este riesgo es precisamente lo que la Regla 5.2 (criterio observable de
    "headless sin login interactivo") busca blindar.

---

# 8. Validation Criteria

| Escenario | Input | Expected Output |
|---|---|---|
| Mecanismo de invocación headless identificado | Investigación empírica (no solo documentación) | Se documenta cuál mecanismo real de Codex se usó y por qué, con evidencia de que funciona sin persona interactiva |
| Autenticación sin login interactivo | API key como variable de entorno, ejecutado como proceso hijo sin navegador/prompt manual | Invocación headless se autentica exitosamente sin intervención manual; si se detecta uso de sesión cacheada en vez de API key, se documenta como hallazgo, no como éxito |
| Invocación básica exitosa | PhaseInvocation con rol architect, roleInstructions de ejemplo, permissions.filesystem: "read-only", en VPS | Se obtiene una respuesta de Codex headless sin error de transporte/autenticación |
| Mapeo a contrato | Respuesta cruda de Codex | Se completa PhaseResult con status: "completed", outputArtifact y summary no vacíos, executorMetadata.provider seteado, executorMetadata.model presente si Codex lo expone o "no disponible" documentado si no |
| Intento de escritura bloqueado | Rol instruido a crear/modificar docs/features/evidence/FEATURE-007/codex_write_probe.txt | Verificación de existencia/hash del archivo antes y después del intento; se documenta el resultado real (bloqueado o no), sin borrar el archivo si llegó a crearse antes de registrar el resultado |
| Verificación de entorno heredado | Proceso padre con ORCHESTRATOR_SECRET_CANARY=should_not_leak_to_codex (valor señuelo, no secreto real), proceso hijo invocado por Codex | Se confirma empíricamente que el proceso hijo no recibe la variable canario |

### Validation Evidence

- Log/transcript crudo de la invocación real (input y output), guardado en
  docs/features/evidence/FEATURE-007/, producido en la VPS.
- Documentación explícita del mecanismo de invocación headless elegido y por qué.
- Confirmación explícita del resultado del intento de escritura contra el archivo objetivo
  nombrado, con verificación de existencia/hash antes y después.
- Confirmación explícita del resultado de la verificación del canario de entorno.
- El objeto PhaseResult final, completado a partir de la respuesta real — no un mock — con
  model marcado "no disponible" si corresponde, nunca inventado.

---

# 9. Risks

- **Riesgo de contrato**: si el shape nativo de la respuesta de Codex no mapea limpio a
  PhaseResult, o si permissions.filesystem no puede imponerse de ninguna forma equivalente, hay
  que documentar el gap y decidir si el contrato necesita ajuste o si Codex queda descartado como
  segundo proveedor viable por ahora.
- **Riesgo de alcance**: que la investigación del mecanismo de invocación headless (pregunta 1)
  consuma más esfuerzo del esperado y haga necesario partir este spike en dos si no se resuelve
  rápido.
- **Riesgo de ambiente** (agregado a pedido de Codex): que se produzca evidencia informal en un
  ambiente no autorizado (ej. exploración en Windows local) y se confunda con evidencia formal de
  cierre de la Feature. Mitigado por la Sección 7 y la Regla 5.6.
- **Supuesto a validar**: que el patrón de confinamiento usado para Claude Code (exclusión de
  toolset, luego contenedor para QA) tiene *algún* equivalente en Codex — si no lo tiene, es un
  hallazgo relevante para la arquitectura, no un bloqueante de este spike puntual (que es solo rol
  architect, read-only).

---

# 10. Approval Gate

**Pending.** Discovery cerrado (alcance: invocación única; rol: architect, read-only; ambiente:
VPS Linux). Revisado por Codex, 5 ajustes de precisión de evidencia incorporados (v1.1). Falta Go
explícito del owner antes de que el asistente IA de desarrollo asignado a este spike — **Codex**,
no Claude Code — inicialice esta Feature y empiece la investigación/implementación.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.