# FEATURE-008 - CodexExecutor de produccion (paridad con Claude Code)

## 1. Feature Identity

- Name: CodexExecutor de produccion - paridad con Claude Code
- Type: Infraestructura de Executor (multi-proveedor)
- Owner: Asdru
- Status: Approved - Approval Gate confirmado por el owner
- Priority: Alta (`docs/ROADMAP.md`, Confirmado)

---

## 2. Problem Statement

FEATURE-007 probo que el contrato `Executor` es agnostico de proveedor, pero solo para una
invocacion unica, rol `architect`, `read-only`. Hoy Codex no puede usarse en ningun run real del
Orquestador: falta lo que FEATURE-002, FEATURE-004/005 y FEATURE-006 ya resolvieron para Claude
Code: escritura aislada, orquestacion multi-fase con loop Developer-QA, y confinamiento real de QA.

---

## 3. Functional Goal

Un run completo del Orquestador puede ejecutar sus 5 fases usando `CodexExecutor`, con el mismo
nivel de aislamiento y confinamiento ya validado para Claude Code, sin asumir que los mecanismos de
sandbox de Codex se comportan igual: cada parte se verifica con evidencia real.

---

## 4. Scope

Incluye, en este orden:

1. Adaptador `CodexExecutor implements Executor` de produccion para rol `architect`, `read-only`,
   validado dentro de la maquinaria real del Orquestador.
2. Aislamiento de escritura para Codex en rol `developer`, usando Docker como limite real de
   escritura y ejecutando Codex dentro del contenedor con `--sandbox danger-full-access`.
3. Secuencia de 2 fases con Codex (`architect -> functional`) y transicion automatica.
4. Orquestacion multi-fase completa con Codex: 5 fases, loop Developer-QA con limite 3, push real al
   aprobar.
5. Confinamiento de QA con Codex: QA no tiene via de ejecutar comandos arbitrarios; el
   `TestExecutor` sigue siendo quien corre tests.
6. Seleccion explicita de modelo economico mediante `--model`/`-m` en cada invocacion usada para
   scaffolding y validacion de esta Feature.

Excluye:

- Seleccion de proveedor, modelo o credenciales por rol via UI.
- Optimizaciones de latencia entre proveedores.
- Decision de modelo para roles de produccion real fuera de esta Feature.

---

## 5. Functional Rules

No introduce reglas funcionales nuevas. Reutiliza las reglas aprobadas en FEATURE-003/004/005/006 y
solo cambia el proveedor de ejecucion.

Nota de diseño (confirmada con el owner): el commit dd7fd2e agregó la regla 3 a
`src/executor/roles/architect.txt` y `src/executor/roles/functional.txt` — archivos compartidos
entre `ClaudeCodeExecutor` y `CodexExecutor`. Es una mejora deliberada del pipeline completo (menos
escalamientos por edge cases fuera de alcance), no un ajuste exclusivo para hacer pasar a Codex.
Afecta el comportamiento de ambos proveedores de acá en adelante.

---

## 6. Estrategia Algoritmica

No aplica logica de decision nueva.

---

## 7. Technical Considerations

- Afecta `src/executor/` con un nuevo `CodexExecutor`, sin cambiar
  `Executor`/`PhaseInvocation`/`PhaseResult`.
- Autenticacion: `CODEX_API_KEY`, validado en FEATURE-007. No usar `OPENAI_API_KEY`.
- Invocacion: `codex exec` con `--output-schema`, entorno allowlisted y sandbox nativo para
  `read-only`. Para `workspace-write`, Codex corre dentro de Docker con `--sandbox
  danger-full-access`; el contenedor impone el limite real porque el sandbox nativo de Codex en la
  VPS dispara bubblewrap y falla con `RTM_NEWADDR`.
- Confinamiento QA: como reaccion a la validacion positiva del pipeline completo, QA mantiene
  `read-only` y ademas invoca Codex con `--config features.shell_tool=false`, equivalente a quitar
  `Bash` del rol QA en FEATURE-006. El `TestExecutor` sigue siendo la unica via de ejecucion de
  tests.
- Modelo: se inyecta por opciones de clase y se pasa de forma explicita con `--model`; no se
  hardcodea ni se depende de `~/.codex/config.toml`.
- Riesgo H17: no confiar en que el modelo reporte su propio aislamiento; validar con evidencia
  externa del sistema.
- Ambiente de ejecucion autorizado: la evidencia que dependa del sandbox Linux de Codex se genera en
  la VPS `/home/asdru/ai-orchestrator`. El checkout local puede preparar cambios, pero el cierre de
  partes que requieren evidencia real debe contrastarse contra la VPS.

---

## 8. Validation Criteria

1. Smoke test de modelo: salida real de `codex exec` que confirme si el flag `--model` es aceptado y
   que modelo reporta el header/metadata.
2. Una fase real persistida con `CodexExecutor` dentro del Orquestador.
3. Evidencia de archivo antes/despues para intento de escritura bloqueado fuera del alcance
   permitido.
4. Pipeline de 2 fases con transicion automatica sin segundo comando manual.
5. Run end-to-end con Codex y push real de la rama, verificado contra remoto.
6. Confirmacion estructural de que QA no tiene herramienta de ejecucion de comandos bajo Codex.

### Validation Evidence

La evidencia se versiona bajo `docs/features/evidence/FEATURE-008/` y el cierre consolidado en
`docs/features/FEATURE-008-implementation-results.md`.

---

## 9. Risks

- El sandbox de Codex puede comportarse distinto a Docker y distinto al sandbox de Claude Code.
- El nombre/disponibilidad del modelo economico indicado por investigacion externa puede no coincidir
  con el sistema real.
- No hay matriz oficial localmente verificada de compatibilidad `--output-schema` por modelo; salida
  invalida debe tratarse como error del Executor.
- El pipeline completo con un modelo economico puede fallar por calidad de respuesta, aunque el
  contrato y la orquestacion funcionen.

---

## 10. Approval Gate

Aprobado por Asdru. Implementacion secuenciada por partes, replicando el orden historico validado
con Claude Code:

1. Una fase real persistida.
2. Escritura aislada.
3. Secuencia de 2 fases.
4. Pipeline completo.
5. Confinamiento QA como reaccion a lo observado en el pipeline completo.

Commit intermedio al cerrar cada parte y push de la rama cuando el proceso lo amerite por etapa.

---

## Design Principle

Problem -> Rules -> Architecture -> Validation -> Implementation.

Never invert this order.
