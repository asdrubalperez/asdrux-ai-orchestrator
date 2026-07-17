# FEATURE-005 — Orquestador Real: Pipeline Completo con Loop Developer↔QA

Versión: v1.0
Basado en: 07-FEATURE-TEMPLATE.md (Standard Mode)

---

# 1. Feature Identity

- **Name**: Orquestador Real — Milestone 1, Incremento 3 (pipeline completo)
- **Type**: Feature de producto
- **Owner**: Asdru
- **Status**: **Closed** — Go confirmado y feature implementada/validada el 2026-07-17. Ver `FEATURE-005-implementation-results.md`. Incluye un hallazgo abierto y no resuelto (H14) sobre el confinamiento real de comandos de QA — ver sección 4/5 del documento de resultados.
- **Priority**: Alta — cierra Milestone 1

---

# 2. Problem Statement

FEATURE-004 confirmó la transición automática entre 2 fases lineales, sin loops. El diseño completo (`resumen-diseno-orquestador.md`, secciones 3 y 6) requiere las 5 fases (`Architect → Functional → Planning → Developer ↔ QA`) con un loop real de reintentos (límite 3) entre Developer y QA, y la etapa de Finalización (push de la rama). Ninguna de estas dos cosas —el loop con límite, y un push real hecho por el propio Orquestador— se probó todavía.

---

# 3. Caso de Negocio de Prueba

Caso concreto, elegido por ser simple pero con una regla límite fácil de omitir en un primer intento:

> "Agregar una función que calcule el total de una compra aplicando descuento: si el monto supera $100, 10% de descuento; si no, sin descuento. No debe permitir montos negativos."

---

# 4. Functional Goal

Dado un run con el pipeline completo de 5 fases sobre el caso de negocio de la sección 3:

1. `Architect` y `Functional` corren igual que en FEATURE-004 (read-only, transición automática).
2. `Planning` produce un plan de trabajo **y** un set acotado de casos de prueba concretos (3-5, representativos, no exhaustivos) — nunca cientos.
3. `Developer` implementa contra el plan, con `workspace-write` dentro del worktree del run.
4. `QA` valida **exclusivamente** contra los casos de prueba que definió `Planning` — permisos híbridos: `read-only` + `allowedCommands` acotado al comando de test específico. QA no decide qué probar ni amplía el alcance.
5. Si QA rechaza: `Developer` recibe la razón del rechazo como `context` y reintenta. Máximo 3 intentos totales — al tercer rechazo, el run escala automáticamente, sin cuarto intento.
6. Si QA aprueba (en cualquier intento dentro del límite): el run hace push de su rama a `origin` y limpia su worktree.
7. Si el run escala (por rechazo agotado, o por cualquier fase anterior): el worktree permanece vivo, según la política de retención ya definida (21 días) — no se limpia mientras espera resolución humana.

---

# 5. Scope

**Included**
- Pipeline de 5 fases completo en `pipeline_definitions`, incluyendo la representación del loop Developer↔QA con límite de intentos (no solo transición lineal como en FEATURE-004).
- Rol `planning`: produce plan de trabajo + casos de prueba concretos y acotados.
- Rol `developer` con `workspace-write` dentro de una secuencia automática (primera vez que se combina con lo de FEATURE-004).
- Rol `qa`: permisos híbridos (`read-only` + `allowedCommands` limitado al comando de test que definió Planning).
- Loop real: reintento de Developer con el feedback de QA como contexto, hasta 3 intentos.
- Escalamiento automático al tercer rechazo — sin reintento adicional.
- Etapa de Finalización real: push de la rama del run a `origin` cuando QA aprueba.
- Limpieza de worktree solo en el caso de éxito; en escalamiento, el worktree permanece vivo (política ya definida).
- Persistencia de cada intento del loop como eventos/artifacts distinguibles y auditables (no un solo evento por el loop completo).

**Excluded**
- Creación real de Pull Request vía API de GitHub — Finalización en este incremento es solo el push de la rama, no la apertura de PR.
- Merge automático de la rama del run hacia `main` — eso es un paso posterior, fuera de este incremento.
- Concurrencia de múltiples runs simultáneos (H9 — sigue sin validar).
- Loop Architect↔Functional (roadmap, ver `01-PROJECT-CHARTER.md`).
- UI, Codex.

**Future ideas (no implementar en esta Feature)**
- Creación real de PR vía API de GitHub, como parte de Finalización.
- Definir si el merge de la rama del run a `main` es automático (al aprobar QA) o requiere otro gate — nota de roadmap ya registrada en `01-PROJECT-CHARTER.md`, se resuelve en un incremento futuro, no acá.
- Validar concurrencia real de runs simultáneos.

---

# 6. Functional Rules

1. El loop Developer↔QA tiene un límite estricto de 3 intentos totales. El primer y segundo rechazo dan a Developer una oportunidad real de corregir con el feedback de QA; al tercer rechazo, el sistema escala automáticamente — no hay cuarto intento bajo ninguna circunstancia.
2. QA valida exclusivamente contra los casos de prueba definidos por `Planning` — no puede ejecutar pruebas adicionales ni ampliar el alcance de validación por su cuenta.
3. Cada intento de Developer y cada veredicto de QA se persisten como eventos y artifacts distinguibles, numerados por intento — el historial completo del loop debe ser auditable, no colapsado en un solo evento.
4. Al rechazar, QA debe producir una razón de rechazo concreta y accionable, que se pasa como `context` explícito al siguiente intento de Developer — nunca un reintento "a ciegas".
5. El push de la rama a `origin` solo ocurre si QA aprueba dentro del límite de intentos. Si el run escala (por cualquier causa, en cualquier fase), no hay push — el worktree permanece vivo según la política de retención de 21 días ya definida.

---

# 7. Estrategia Algorítmica (Opcional)

Loop acotado simple: contador de intentos por run, incrementado en cada rechazo de QA; corte estricto al alcanzar 3, sin lógica adaptativa ni heurística de "casi convergencia" — el corte es un número fijo, no una decisión inteligente del sistema (ver discusión previa sobre por qué no existe una heurística confiable para distinguir "converge lento" de "nunca va a converger").

---

# 8. Technical Considerations

- **Arquitectura afectada**: `pipeline_definitions.definition` necesita representar un loop con límite de intentos, no solo una secuencia lineal (novedad real respecto a FEATURE-004) — mantenerlo simple, sin generalizar a loops arbitrarios entre cualquier par de fases (eso no existe en este diseño, ver roadmap de Architect↔Functional).
- **Primera vez que el Orquestador hace un push real de git** (Finalización) — reutiliza la deploy key ya configurada en Milestone 0, no se introduce credencial nueva.
- **Riesgo de reproducibilidad del caso de escalamiento**: forzar de forma determinística que Developer falle 3 veces seguidas puede ser difícil si el modelo corrige bien antes — si hace falta un artificio para ejercer ese camino (ej. un caso de prueba deliberadamente engañoso), documentarlo explícitamente como parte de la evidencia, no ocultarlo ni presentarlo como comportamiento espontáneo.
- **Dependencias**: mismo mecanismo CLI, Postgres de desarrollo, aislamiento por worktree y modelo económico (`--model haiku`, salvo que una fase puntual justifique más potencia) ya establecidos.

---

# 9. Validation Criteria

| Escenario | Input | Expected Output |
|---|---|---|
| Pipeline completo, aprobado al primer intento | Caso de negocio de la sección 3, Developer implementa correctamente | Las 5 fases completan, QA aprueba en intento 1, push real de la rama, worktree limpio |
| Loop con 1-2 rechazos y aprobación posterior | Developer omite la regla de montos negativos en el primer intento | QA rechaza con razón concreta, Developer corrige con ese contexto, QA aprueba en el reintento — evidencia de ambos intentos persistida por separado |
| Escalamiento por 3 rechazos agotados | Developer no logra corregir en 3 intentos | Run escala automáticamente al tercer rechazo, sin cuarto intento; worktree permanece vivo |
| Casos de prueba acotados de Planning | Cualquiera de los casos anteriores | Planning define 3-5 casos concretos, no una cantidad arbitraria ni exhaustiva |

### Validation Evidence

- Queries reales a Postgres mostrando cada intento del loop como evento/artifact distinguible.
- Evidencia real del push (verificable contra el remoto: la rama del run debe existir en GitHub tras la aprobación).
- Transcript real de al menos un rechazo de QA con razón concreta, y el reintento de Developer usándola como contexto.
- Confirmación explícita de que, en el caso de escalamiento, no hubo cuarto intento de Developer.

---

# 10. Risks

- **Riesgo de schema**: representar el loop con límite de intentos en `pipeline_definitions.definition` puede requerir ajustes no anticipados — documentar como hallazgo, no forzar el diseño original a la fuerza.
- **Riesgo de reproducibilidad**: ver Technical Considerations — el caso de 3 rechazos reales puede no ser trivial de provocar de forma determinística.
- **Riesgo del primer push real**: confirmar que la deploy key configurada en Milestone 0 sigue vigente y con permisos de escritura antes de asumir que el push va a funcionar sin fricción.
- **Supuesto a validar**: que QA con permisos híbridos (`read-only` + un comando de test puntual) se comporta con el mismo nivel de confinamiento ya validado en FEATURE-002, y no requiere un mecanismo distinto por combinar ambos tipos de permiso a la vez.

---

# 11. Approval Gate

**Aprobado.** Go humano confirmado el 2026-07-17 por Asdru (owner del proyecto), condicionado a verificar primero la deploy key de la VPS (hecho, ver `FEATURE-005-implementation-results.md` sección 0). Implementación completada el mismo día.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Never invert this order.
