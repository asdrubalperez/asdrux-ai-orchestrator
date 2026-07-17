# FEATURE-006 — Resultados de Implementación (Aislamiento Real de Ejecución)

Versión: v1.0
Fecha: 2026-07-17
Ejecutado por: Claude Code (asistente IA de desarrollo), contra Docker Engine real y Postgres real
de la VPS (por SSH directo, no simulado) — resuelve el riesgo bloqueante H14.

Este documento es la evidencia de cierre exigida por `FEATURE-006-secure-execution-isolation.md`
(sección 8).

---

## 0. Nota de entorno

Esta Feature se desarrolló y validó **directamente por SSH en la VPS**, no en la notebook local
(sin Docker Desktop, decisión ya tomada en sesiones anteriores). Requirió instalar Node.js 22 LTS
en la VPS (documentado en `02-ARCHITECTURE.md` sección 7) — primera vez que el propio código del
Orquestador corre ahí, no solo su infraestructura de soporte.

---

## 1. Qué se implementó, por partes (commits intermedios)

1. **Fix de `process.env`** (`48331d6`): `buildChildEnv()` reemplaza `{ ...process.env }` por una
   allowlist explícita. Verificado con variable canario.
2. **TestExecutor + QA sin Bash** (`66e8f21`): el comando de test ya no lo ejecuta QA vía Bash —
   lo ejecuta `src/testing/testExecutor.ts`, dentro de un contenedor Docker efímero
   (`--network none`, filesystem read-only salvo `/tmp`), como executable + args estructurados.
   QA pasa a recibir el resultado (`exitCode`/`stdout`/`stderr`/`timedOut`) por contexto.
3. **Contenedor Docker para Developer** (`39c2bf5`): la invocación COMPLETA de Claude Code para
   el rol `developer` (incluida su herramienta Bash interna) corre dentro de
   `docker/developer.Dockerfile` (node:22-alpine + git + Claude Code CLI, usuario no root),
   endurecido (`--cap-drop ALL`, `--security-opt no-new-privileges`, límites de recursos, solo el
   worktree montado, solo `ANTHROPIC_API_KEY` pasado al contenedor).

---

## 2. Validación cruzada contra la sección 8 de la Feature

| Escenario | Resultado |
|---|---|
| Fix de entorno | ✅ Variable canario ausente en el hijo tras el fix; `ANTHROPIC_API_KEY` sigue funcionando |
| QA sin Bash | ✅ Confirmado estructural: "no existe herramienta para ejecutar comandos" — no hay vía, no solo bloqueo |
| TestExecutor aislado | ✅ Pipeline completo de FEATURE-005 corrió con el mismo resultado exitoso, sin que QA tuviera Bash |
| Developer contenido | ✅ Intento de escape (docker.sock, /etc/passwd, escritura fuera de /workspace) bloqueado; variable de entorno del host confirmada ausente vía `docker run` directo |

---

## 3. Hallazgos

**Ninguno bloqueante nuevo.** Dos observaciones documentadas, no bloqueantes:

- **Egress de Developer no está restringido a un allowlist fino** — usa la red bridge default de
  Docker (acceso general a internet), no solo al proveedor de IA. Explícitamente fuera de alcance
  de este incremento (ver Scope/Excluded de la Feature). Riesgo residual: un comando dentro del
  contenedor de Developer podría, en teoría, alcanzar destinos de red arbitrarios — mitigado
  parcialmente por el hecho de que ya no hay secretos del Orquestador disponibles para exfiltrar
  (punto 1 de esta Feature), pero no es una garantía de red completa.
- **Los propios heurísticos de Claude Code interfirieron con algunas pruebas de verificación**
  (bloquearon `node -e` y hasta la ejecución de un archivo legítimamente creado por Developer
  dentro de su propio workspace, con "requires approval") — no es un problema de esta Feature,
  pero obligó a verificar el aislamiento de entorno con `docker run` directo (sin pasar por Claude
  Code) para tener evidencia concluyente, en vez de depender de que el agente reportara
  fielmente. Documentado como una limitación práctica de usar el agente mismo como testigo de su
  propio aislamiento — la evidencia más confiable es la que no depende de su cooperación.

---

## 4. Lecciones Aprendidas (06-DELIVERY-WORKFLOW.md, Stage 6)

**Específico de esta implementación:**
- El entorno de desarrollo (VPS por SSH en vez de notebook local) fue una decisión operativa
  puntual de esta Feature, no un patrón a repetir automáticamente — Features futuras que no
  necesiten Docker real pueden seguir desarrollándose localmente como antes.
- La interferencia de los heurísticos de Claude Code con las pruebas de verificación es específica
  de usar el propio agente como sujeto de prueba — no aplica a otras Features.

**Decisiones de arquitectura del proyecto:**
- `02-ARCHITECTURE.md` ya se actualizó (commit `979b5d0`) documentando Node.js en la VPS como
  infraestructura nueva. No se requieren ADRs adicionales — el aislamiento por contenedor para
  Developer/QA ya estaba aprobado desde el diseño original; esta Feature lo implementa, no lo
  redecide.
- El riesgo BLOQUEANTE H14 registrado en `01-PROJECT-CHARTER.md` queda resuelto por esta Feature —
  actualizar esa entrada al cerrar.

**Candidato a conocimiento reusable del AI-Playbook Base:**
- Ninguno identificado. Es una solución de infraestructura específica de este proyecto (Docker +
  Claude Code CLI), no una lección de metodología generalizable a otros proyectos.

---

## 5. Conclusión

H14 queda resuelto: ningún secreto del Orquestador se filtra a procesos hijos o contenedores;
QA ya no tiene ninguna vía de ejecutar comandos arbitrarios (confinamiento estructural, no de
convención de prompt); Developer corre confinado dentro de un contenedor endurecido, con
aislamiento de entorno confirmado tanto por evidencia real (agente) como por verificación directa
(`docker run` sin intermediarios). Queda una limitación conocida y documentada (egress de red no
restringido a un allowlist fino para Developer) que no bloquea el cierre de esta Feature pero sí
queda como candidato de una Feature futura si se decide necesario.
