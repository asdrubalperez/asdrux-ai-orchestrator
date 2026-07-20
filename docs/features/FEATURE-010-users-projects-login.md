# FEATURE-010 — Users, Projects y login del CLI

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: este documento se redacta retroactivamente. La Feature ya fue implementada,
> validada y cerrada en `docs/ROADMAP.md` antes de que existiera este archivo — la falta de este
> documento en `docs/features/` fue detectada como un error real durante el cierre de Feature 09 y
> se corrige acá. El Design Principle (Problem → Rules → Architecture → Validation →
> Implementation) se aplica aquí de forma **descriptiva** (para dejar registro completo y
> consistente con el resto de `docs/features/`), no como aprobación previa a un trabajo que ya
> ocurrió y ya fue aprobado por el owner en su momento.
>
> **Corrección post-revisión**: al revisar este documento antes de commitearlo, Codex detectó dos
> imprecisiones factuales (el alcance real del `not null` sobre `project_id`, y el mensaje real de
> error de `login.ts`), verificadas independientemente. La primera pasada de corrección dejó una
> tercera mención de la misma imprecisión sin corregir (en Validation Evidence) — Codex la detectó
> en una segunda revisión y ya está corregida en las tres ubicaciones. Se deja constancia completa
> porque es evidencia de que el proceso de verificación funcionó, incluyendo que hizo falta más de
> una pasada — no es una nota menor de estilo.

---

## 1. Feature Identity

- **Name**: Users, Projects y autenticación local del CLI
- **Type**: Modelo de datos / infraestructura de autenticación
- **Owner**: asdru
- **Status**: Cerrada (mergeada en `main`, verificada contra el repo real)
- **Priority**: Alta — bloqueaba el cierre formal de Feature 09 (marcador `[PENDIENTE-DB-PROJECTS]`)

---

## 2. Problem Statement

Antes de esta Feature, `runs.owner_id` era un campo de texto libre sin validar contra ninguna
tabla de usuarios, y no existía ningún concepto de `project` en el schema — cada run vivía
aislado, sin agrupación por proyecto ni por dueño real. Tampoco existía ningún mecanismo de
autenticación: cualquier invocación del CLI podía declarar cualquier `owner_id` vía flag.

Esto dejaba bloqueado el cierre de Feature 09 (Runbook), que había dejado un marcador explícito
`[PENDIENTE-DB-PROJECTS]` en 9 ubicaciones de `docs/runbook/`, a la espera de que existiera un
modelo real de proyectos y usuarios antes de poder describir ese mecanismo sin ambigüedad.

## 3. Functional Goal

Permitir login real con usuario/contraseña, y que cada `run` quede asociado a un usuario real
(`owner_id` como FK, no texto libre) y a un proyecto real (`project_id` como FK nueva), reemplazando
por completo el esquema anterior de texto libre sin migrar datos históricos en silencio.

## 4. Scope

**Included**
- Tabla `users` (`id`, `handle` único, `password_hash` vía `bcryptjs`, `created_at`).
- Tabla `projects` (`id`, `name`, `repo_path`, `owner_id` FK a `users`, `created_at`).
- Migración de `runs.owner_id` de texto libre a FK real hacia `users`, y `runs.project_id` nuevo,
  FK a `projects`.
- Backfill de los runs históricos existentes (19/19), con validación explícita que aborta la
  migración si aparece algún `owner_id` histórico no contemplado — no completar en silencio.
- Comandos CLI: `login`, `logout`, `seed:user`.
- Sesión local persistida en `~/.orquestador/session.json`, expiración de 30 días.

**Excluded**
- Validación server-side de la sesión (no existe tabla `sessions`) — la sesión local es confianza
  local **a propósito**, decisión explícita del owner, no una omisión.
- UI de gestión de usuarios o proyectos.
- Expiración de sesión reducida a 48 horas para producción — queda registrada como ítem Tentativo
  en el Roadmap, condicionada a que no exista otro mecanismo de autenticación implementado antes.

**Future ideas**
- Tabla `sessions` con validación server-side, si en algún momento se decide que la confianza
  local deja de ser suficiente.

## 5. Functional Rules

1. Un login solo es válido si el `handle` existe en `users` **y** tiene `password_hash` poblado
   (`seed:user` es prerrequisito de `login`, no un paso opcional).
2. La migración de backfill debe fallar explícitamente (`raise exception`) si encuentra cualquier
   `owner_id` histórico fuera de la lista contemplada — nunca completar con valores nulos o
   default silenciosos.
3. Al finalizar el backfill, ninguna fila de `runs` puede quedar con `owner_id` o `project_id`
   nulos — verificado con una segunda validación explícita antes de aplicar `not null`. **Nota de
   precisión** (detectada al verificar el código real): el `not null` a nivel de constraint de
   schema solo se aplicó a `owner_id` (`alter table runs alter column owner_id set not null`);
   `project_id` queda protegido únicamente por la validación de la migración en el momento del
   backfill, no por un constraint `not null` en la columna. Si en el futuro se inserta un run sin
   `project_id` fuera del camino de esta migración, la base de datos no lo va a rechazar por sí
   sola.
4. La sesión local no requiere ida y vuelta al servidor para considerarse válida — es una decisión
   de diseño explícita (modo desarrollo/comodidad), no deuda técnica oculta.

## 6. Estrategia Algorítmica

No aplica — esta Feature no introduce lógica de decisión, es modelo de datos y autenticación.

## 7. Technical Considerations

- Migración en dos fases (`0002_users_projects_phase_a.sql` agrega columnas nuevas nullable;
  `0003_users_projects_phase_b.sql` backfillea, valida, y recién ahí aplica `not null` sobre
  `owner_id` y elimina la columna `owner_id` vieja) — evita downtime y permite verificar el estado
  intermedio antes de comprometerse al esquema final. `project_id` no recibe constraint `not null`
  en esta migración (ver riesgo correspondiente más abajo).
- `bcryptjs` para el hash de contraseña — sin dependencias nativas, consistente con el resto del
  proyecto en Node/TypeScript puro.
- El diseño de `projects` (columnas, relación con `runs`/`artifacts`) se definió con el resultado
  real de la investigación de la sesión, no de forma especulativa antes de tener el caso concreto.

## 8. Validation Criteria

| Escenario | Input | Resultado esperado |
|---|---|---|
| Backfill completo | 19 runs históricos con `owner_id` de texto libre conocido | 19/19 migrados a FK real, sin nulls remanentes |
| Backfill con dato no contemplado | Un `owner_id` histórico fuera de la lista esperada | La migración aborta con excepción explícita, no continúa |
| Login válido | `handle` existente con `password_hash` poblado + contraseña correcta | Sesión local creada en `~/.orquestador/session.json` |
| Login inválido | `handle` sin `password_hash` (sin `seed:user` previo), o contraseña incorrecta | Rechazado con `"Credenciales inválidas."` — mensaje genérico, no distingue entre "usuario no existe/sin password" y "contraseña incorrecta" |

### Validation Evidence

Verificado contra la base de datos real de la VPS (no solo contra un test aislado): 19/19 runs
backfilleados, `owner_id` con `not null` aplicado exitosamente, `project_id` poblado sin nulls por
validación de migración (sin constraint `not null` en la columna), comandos
`login`/`logout`/`seed:user` ejecutados contra la sesión real.

## 9. Risks

- Expiración de sesión de 30 días es alta para un entorno de producción — riesgo ya identificado
  y registrado como ítem Tentativo en el Roadmap, condicionado a que no exista otro mecanismo de
  autenticación antes de esa fecha.
- Sin validación server-side de sesión, un archivo `session.json` copiado a otra máquina sería
  válido igual — riesgo aceptado a propósito en este modo de desarrollo, no evaluado como
  bloqueante hoy.

## 10. Approval Gate

Ya implementado y aprobado por el owner en la sesión original. Este documento formaliza
retroactivamente el registro — no habilita ninguna implementación nueva.