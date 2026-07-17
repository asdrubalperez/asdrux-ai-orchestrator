# FEATURE-006 — Aislamiento Real de Ejecución (Resuelve H14)

Versión: v1.0
Basado en: 07-FEATURE-TEMPLATE.md (Standard Mode)

---

# 1. Feature Identity

- **Name**: Aislamiento Real de Ejecución — Contenedor + QA sin Bash
- **Type**: Feature de seguridad/infraestructura — resuelve riesgo bloqueante
- **Owner**: Asdru
- **Status**: Draft — pendiente de Go humano
- **Priority**: Crítica — desbloquea el riesgo H14 registrado en 01-PROJECT-CHARTER.md

---

# 2. Problem Statement

H14 (FEATURE-005) y la investigación posterior (`docs/research/H14-command-confinement.md`,
contrastada con un dictamen independiente) confirmaron: `--allowedTools "Bash(<patrón>)"` no impone
ninguna restricción real sobre qué comandos ejecuta un rol. Además, se confirmó por inspección
directa del código que `claudeCodeExecutor.ts` hereda hoy el `process.env` completo del Orquestador
hacia cada invocación — exponiendo `DATABASE_URL_DEV` y cualquier otro secreto a cualquier rol con
Bash. Esta Feature implementa la solución consensuada, no una exploración adicional — la
investigación ya está cerrada.

---

# 3. Functional Goal

1. Ningún proceso hijo del Orquestador hereda `process.env` completo — cada invocación recibe una
   allowlist explícita de variables.
2. El rol `qa` **no recibe la herramienta Bash en absoluto**. El comando de test que `Planning`
   definió se ejecuta mediante un **Test Executor** propio del Orquestador (no el agente QA),
   invocado como `executable` + `args` estructurados (nunca un string de shell), dentro de un
   contenedor efímero con `--network none`.
3. El rol `developer` (que sí necesita Bash) corre dentro de un contenedor endurecido: sin red
   libre (solo egress al proveedor de IA), filesystem read-only salvo el worktree montado, usuario
   sin privilegios, sin Docker socket ni sockets del host, con límites de recursos (`pids-limit`,
   memoria, CPU, timeout).
4. Los roles `read-only` (`architect`, `functional`, `planning`) mantienen su mecanismo actual (H1,
   ya validado) — no requieren contenedor por este motivo, aunque pueden beneficiarse del mismo por
   consistencia de infraestructura si el costo es marginal.

---

# 4. Scope

**Included**
- Fix de variables de entorno en `claudeCodeExecutor.ts`: allowlist explícita, nunca `{ ...process.env }`.
- `TestExecutor`: componente nuevo del Orquestador que recibe `{ executable, args, workingDirectory, timeoutMs, environment, network: "none" }` (nunca un comando como string) y lo ejecuta con `spawn(executable, args, { shell: false })` dentro de un contenedor Docker efímero.
- Rol `qa` reescrito para NO tener Bash en su toolset — solo `Read`/`Grep`/`Glob` sobre el resultado estructurado (stdout, stderr, exitCode) que le entrega el `TestExecutor`, y produce su veredicto a partir de eso.
- Contenedor Docker para `developer`: imagen base con lo mínimo necesario (Node, git), `--cap-drop ALL`, `--security-opt no-new-privileges`, usuario no root, `--pids-limit`, límite de memoria/CPU, timeout externo, sin montar `docker.sock` ni sockets del host.
- Verificación explícita (con intento de escape real, mismo patrón que FEATURE-001/002/005) de que: (a) QA ya no puede ejecutar ningún comando de Bash, (b) Developer dentro del contenedor no puede acceder a variables fuera de su allowlist explícita, (c) ningún contenedor puede alcanzar la red salvo el egress permitido.

**Excluded**
- `PreToolUse` hooks — quedan descartados como solución principal (dependencia de una API específica de Claude Code, no portable a un futuro adaptador de Codex). Si en el futuro se verifica que funcionan sin `--bare` y se decide agregarlos como capa adicional, es una Feature separada, no parte de esta.
- Egress controlado por proxy/allowlist de dominios para Developer (mencionado como opción en la investigación) — para este incremento, alcanza con "acceso de red solo al proveedor de IA" de forma simple; el diseño fino del proxy queda para más adelante si hace falta.
- Roles read-only dentro de contenedor — no es necesario para resolver H14, se evalúa aparte si el costo resulta marginal.

**Future ideas**
- Evaluar `PreToolUse` hooks como capa adicional para QA, una vez verificado que sobreviven sin `--bare`.
- Proxy de egress con allowlist de dominios explícita para Developer.

---

# 5. Functional Rules

1. Ningún Executor pasa `process.env` completo a ningún proceso hijo ni contenedor — siempre una allowlist explícita y mínima.
2. El rol `qa` nunca recibe la herramienta Bash bajo ninguna circunstancia — el `TestExecutor` es la única vía de ejecutar comandos en su fase.
3. El `TestExecutor` nunca acepta ni construye un comando como string — siempre `executable` + `args` como arreglo, invocado con `shell: false`.
4. El contenedor de `developer` nunca tiene acceso a `DATABASE_URL_DEV`, ni a ningún secreto que no sea estrictamente necesario para su tarea (la `ANTHROPIC_API_KEY` de esa fase, nada más).
5. Ningún contenedor (QA o Developer) monta el socket de Docker del host, ni sockets de SSH, ni el home del usuario del host.

---

# 6. Estrategia Algorítmica (Opcional)

No aplica.

---

# 7. Technical Considerations

- **Arquitectura afectada**: `ClaudeCodeExecutor` (fix de entorno + invocación vía contenedor), nuevo componente `TestExecutor`, `pipeline_definitions`/rol `qa` (pierde Bash).
- **Riesgo de latencia**: crear/destruir contenedores por invocación — evaluar con evidencia real si el overhead es marginal frente al tiempo de las invocaciones LLM (la investigación estima que sí, pero verificarlo empíricamente en esta Feature).
- **Dependencias**: Docker Engine ya operativo en la VPS (Milestone 0) — no se instala nada nuevo, se usa por primera vez para este propósito.
- **Riesgo de mantenimiento**: la imagen Docker base necesita mantenerse (dependencias, versión de Node) — no es gratis a largo plazo, documentarlo como costo operativo real, no ocultarlo.

---

# 8. Validation Criteria

| Escenario | Input | Expected Output |
|---|---|---|
| Fix de entorno | Invocar cualquier rol, inspeccionar variables recibidas por el proceso hijo | Solo la allowlist explícita, nunca `DATABASE_URL_DEV` ni el `process.env` completo del Orquestador |
| QA sin Bash | Intentar instruir al rol QA a ejecutar cualquier comando de Bash | La herramienta no existe en su toolset — imposible de invocar, no solo bloqueado |
| TestExecutor aislado | Correr el caso de negocio de FEATURE-005 con el TestExecutor real | Mismo resultado que el camino dorado ya validado, pero sin que QA tenga Bash |
| Developer contenido | Intento de escape desde dentro del contenedor de Developer (leer secretos fuera de su allowlist, alcanzar la red fuera del proveedor) | Bloqueado por el contenedor, no por convención de prompt |

### Validation Evidence
- Inspección real del entorno recibido por el proceso hijo en cada rol (no solo el código, la ejecución real).
- Reintento del caso de negocio completo de FEATURE-005 con la nueva arquitectura, mismo resultado exitoso.
- Intento de escape real contra el contenedor de Developer y contra el TestExecutor, documentado igual que H1/H5/H14.

---

# 9. Risks

- Latencia de contenedores no verificada empíricamente todavía en este proyecto — validar, no asumir.
- Mantenimiento de imagen Docker es costo recurrente nuevo, no puntual.
- Reescribir el rol QA sin Bash puede requerir ajustar cómo Planning comunica el `testCommand` de forma estructurada (no como texto libre) — puede generar un hallazgo de formato, similar a H2/H12.

---

# 10. Approval Gate

**Pendiente.** Requiere Go humano explícito de Asdru antes de implementar.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.
