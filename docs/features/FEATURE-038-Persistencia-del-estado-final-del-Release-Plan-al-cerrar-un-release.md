# FEATURE-038 — Persistencia del estado final del Release Plan al cerrar un release

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: diseño original de ARIA (AI Product Architect), revisado y validado
> técnicamente contra el código real antes de aprobar la implementación. Aprobado con dos ajustes
> incorporados al documento antes del handoff: (1) los cierres inconsistentes usan
> `FeatureLifecycleEscalationError` explícitamente, nunca `throw new Error()` genérico; (2) la
> Regla 12 compara `featureJustCompleted` contra el Release Plan vigente de **entrada** (el que
> Planning recibió como contexto), nunca contra el `RELEASE_PLAN` declarado de salida (que siempre
> trae `featureActualId: null` en un cierre válido).

---

## 1. Feature Identity

- **Name**: Persistencia del estado final del Release Plan al cerrar un release
- **Type**: Lifecycle Consistency / Release Plan Persistence
- **Owner**: asdru
- **Status**: ✅ Ejecutada — validada con suite automatizada y E2E real en VPS (2026-07-31)
- **Priority**: P1
- **Origin**: Hallazgo detectado durante la validación E2E de FEATURE-036, el 2026-07-30
- **Related Features**: FEATURE-018, FEATURE-019, FEATURE-020, FEATURE-023, FEATURE-028,
  FEATURE-036

---

## 2. Problem Statement

Cuando Planning declara `RELEASE_COMPLETO` (no queda ninguna Feature pendiente en el release
activo), su resultado tiene `ESTADO: escalated` — es un Approval Gate de gobernanza, no un error.
Sin embargo, `persistReleasePlanIfDeclared` (el runtime que persiste `RELEASE_PLAN`) solo actuaba
cuando `result.status === "completed"`, así que el `RELEASE_PLAN` final que Planning sí declaraba
correctamente (última Feature `Completada`, `featureActualId: null`) nunca llegaba a persistirse.
El `release_plan` vigente en la base seguía mostrando la última Feature `"En curso"`, contradiciendo
el hecho de que QA ya la había aprobado y Planning había declarado el cierre. Detectado durante la
validación E2E de FEATURE-036 (observación 1 del hallazgo original, separado de FEATURE-038 en
Discovery — ver observación 2, que corresponde a FEATURE-028).

---

## 3. Functional Goal

Cuando Planning declara válidamente `RELEASE_COMPLETO`, el Orquestador valida el `RELEASE_PLAN`
final contra el Release Plan vigente de entrada y, si es coherente, lo persiste **antes** de exponer
el Approval Gate — dejando el estado persistido (`todas las Features → Completada`,
`featureActualId → null`) consistente con la decisión que Planning acaba de tomar. Si el cierre es
inconsistente, no se persiste nada y el runtime escala explícitamente (`FeatureLifecycleEscalationError`),
en vez de abrir un Gate engañoso o fallar como error genérico de infraestructura.

---

## 4. Scope

### Included

- Persistencia condicionada: `status = escalated` + `RELEASE_COMPLETO = true` + cierre válido →
  persiste; `status = escalated` sin `RELEASE_COMPLETO` → no-op (sin cambios); `status = completed`
  → persistencia normal (sin cambios).
- Validación del `RELEASE_PLAN` final contra el Release Plan vigente de **entrada**
  (`context.releasePlan`, el mismo objeto que ya vio Planning — nunca una relectura posterior):
  `featureActualId` final debe ser `null`; todas las Features finales deben estar `Completada`;
  mismas identidades que el plan de entrada (sin altas/bajas/duplicados); `featureJustCompleted`
  debe coincidir con `inputReleasePlan.featureActualId`, y esa Feature debe existir en el plan de
  entrada con estado `"En curso"`; `COMANDO_TEST`/`FEATURE_UPDATE` deben venir nulos.
- Cierre inconsistente → `FeatureLifecycleEscalationError` con razón específica, nunca
  `throw new Error()` genérico — reutiliza el mecanismo de escalación ya existente en
  `src/features/lifecycle.ts`.

### Excluded

Asociar el Release Plan inequívocamente al release activo (FEATURE-028), agregar `releaseId` al
contrato, modificar `activeReleaseId`/`release_roadmap`, cambiar `respondService.ts`, activar el
siguiente release, cerrar el proyecto, migrar/reparar datos históricos, crear tablas o migraciones
SQL, permitir persistencia genérica de resultados `escalated`.

---

## 5. Functional Rules

Ver diseño completo (20 reglas) en el historial de la sesión de diseño — resumen de las
determinantes: persistencia normal sin cambios (Regla 1); excepción exclusiva para
`RELEASE_COMPLETO` válido (Regla 2); ninguna otra escalación persiste (Regla 3); `RELEASE_PLAN`
final obligatorio, `featureActualId: null`, todas `Completada`, sin `Pendiente`/`En curso` (Reglas
4-8); identidades estables sin altas/bajas/duplicados (Regla 9); `featureJustCompleted` debe
coincidir con `inputReleasePlan.featureActualId`, y esa Feature debe existir `En curso` en el plan
de entrada (Regla 12, ajustada); `COMANDO_TEST`/`FEATURE_UPDATE` nulos (Reglas 13-14); persistir
antes de clasificar el Gate (Regla 16); cierre inválido → `FeatureLifecycleEscalationError`, nunca
error genérico (Regla 19, ajustada); sin corrección automática — Planning declara, el runtime solo
valida y persiste (Regla 20).

---

## 6. Technical Considerations

- `src/cli/commands/runStart.ts`: nueva función pura exportada
  `validateFinalReleasePlanTransition(params)` — sin I/O, sin DB — que implementa el pseudoflujo del
  diseño y devuelve `{valid: true} | {valid: false; reason: string}`.
- `persistReleasePlanIfDeclared` ampliada: recibe dos parámetros nuevos, `featureJustCompleted:
  string | null` e `inputReleasePlan: unknown` — ambos extraídos del mismo `context` ya armado para
  Planning en esa invocación (`planningInputFieldsFromContext`, nueva función), sin ninguna consulta
  adicional a la base. Esto resuelve de fábrica el riesgo de carrera de concurrencia del diseño
  (7.6/Riesgo 5): no hay ventana entre lo que Planning vio y lo que se valida, porque es literalmente
  el mismo objeto.
- Cuando la validación falla, se lanza `FeatureLifecycleEscalationError` (ya definida y usada en
  `src/features/lifecycle.ts` para invariantes equivalentes) — el `catch` existente en
  `executePipelineRun` (`runStart.ts`) ya distingue este tipo de excepción de un error genérico y
  produce una escalación real y visible (artifact + evento `escalation_opened`), sin necesitar
  ningún cambio adicional en el manejo de errores.
- `src/cli/escalation.ts`: nueva función exportada `isTaggedFieldNull(outputArtifact, tag,
  property)` — determina si `COMANDO_TEST`/`FEATURE_UPDATE` fueron declarados explícitamente como
  ausentes, en las tres formas posibles (`undefined`, `null` real, o el string `"null"` de la
  convención de texto plano de Codex). Reutiliza `isReleaseCompletionEscalation` (ya exportada) para
  detectar `RELEASE_COMPLETO = true` sin duplicar parsing de etiquetas.
- `planning.txt`: sin cambios — el contrato ya exige exactamente lo que se valida (Regla 5/6 del
  rol); el Orquestador solo verifica y persiste, no corrige.

---

## 7. Validation Criteria

20 escenarios según el diseño original (continuación normal, cierre válido, escalación ordinaria,
`RELEASE_COMPLETO` sin plan, `featureActualId` no nulo, Feature `Pendiente`/`En curso` en el final,
Feature eliminada/agregada/duplicada, retroceso de estado, `featureJustCompleted` no coincide,
`COMANDO_TEST`/`FEATURE_UPDATE` no nulos, orden de persistencia antes del Gate, rechazo/aprobación
humana del cierre, E2E con una y con varias Features, regresión de FEATURE-028).

### Validation Evidence

**Automatizada**: 16 tests nuevos, sin mocks sobre el código real de producción —
`runStart.test.ts`: `validateFinalReleasePlanTransition` cubierta con 13 casos (cierre válido;
sin plan de entrada; plan de entrada sin Feature activa; `featureJustCompleted` no coincide; Feature
activa no `En curso`; `featureActualId` final no nulo; Feature `Pendiente`/`En curso` en el final;
`COMANDO_TEST`/`FEATURE_UPDATE` no nulos; Feature eliminada/agregada/duplicada del plan final);
`persistReleasePlanIfDeclared` con 3 casos de integración que confirman que la validación corre
**antes** de cualquier llamada a la base de datos (los tests no usan una DB real — si la
implementación intentara tocar la base antes de fallar, fallarían por timeout/error de conexión en
vez de por el `FeatureLifecycleEscalationError` esperado): `featureJustCompleted` no coincide,
`RELEASE_COMPLETO` sin `RELEASE_PLAN`, `COMANDO_TEST` declarado en un cierre. Suite completa: 227
tests, 217 pass, 10 skip (específicos de plataforma en Windows), 0 fail. `tsc --noEmit` limpio.

**E2E real en VPS (2026-07-31, proyecto `pruebas-ia`, caso de negocio con dos releases —
`calculateTip`/r1, `calculateSplitTip`/r2)**: consultada directamente la tabla
`project_config_versions` durante la corrida real. Al cerrar r1 (única Feature f1), se confirmó una
nueva versión de `release_plan` (`changed_in_run_id` = el run donde Planning declaró
`RELEASE_COMPLETO`) con `valid_from` exactamente en el timestamp del `phase_finished` de Planning —
21 segundos **antes** de que el humano respondiera al Approval Gate — conteniendo
`{"features":[{"id":"f1","estado":"Completada",...}],"featureActualId":null}`. La versión
inmediatamente anterior en la misma consulta seguía mostrando `f1` `"En curso"`, confirmando el
contraste directo entre el estado obsoleto que quedaba persistido antes del fix y el estado correcto
persistido ahora. Repetido para el cierre del proyecto completo (r2, última Feature del release
final): la UI mostró "Sin release activo" y **ambas** Features (`calculateTip` y `calculateSplitTip`)
con el check verde de "Completada" — antes del fix, la última Feature de cada release quedaba
indefinidamente con el ícono "en curso" pese a la aprobación de QA. Evidencia real y específica de
las Reglas 2, 6, 9, 11, 12 y 16 funcionando en runs genuinos, cubriendo tanto el cierre de un release
intermedio como el cierre del último release del proyecto.

---

## 8. Risks

Ver diseño original (9 riesgos) — los más relevantes: persistir escalaciones incorrectas (mitigado
con la excepción exclusiva para `RELEASE_COMPLETO` válido); validación demasiado débil que permita a
Planning alterar la lista silenciosamente (mitigado con comparación exacta de identidades); Riesgo 4
(plan de entrada incorrecto porque pertenece a otro release) — corresponde a FEATURE-028, no se
resuelve acá, FEATURE-038 depende operativamente de que ese plan sea el correcto; Riesgo 5
(concurrencia) — resuelto de fábrica al no volver a consultar la base, usando el mismo objeto que
vio Planning; Riesgo 10 (clasificación incorrecta del fallo) — mitigado usando explícitamente
`FeatureLifecycleEscalationError`, nunca una excepción genérica.

---

## 9. Approval Gate

Aprobado por el owner, con los dos ajustes de la nota de proceso incorporados al documento antes del
handoff de implementación. Validado real en VPS — ver sección 7. Mergeada a `main`.

---

## Estado de la implementación

**✅ Ejecutada.** Implementada en rama `feature/038-release-plan-cierre-consistente`, validada con
suite automatizada (`tsc --noEmit` limpio, 227 tests) y con E2E real en VPS que confirmó, vía consulta
directa a `project_config_versions`, que el `RELEASE_PLAN` final queda persistido con la Feature en
`"Completada"` segundos antes de que el Approval Gate reciba respuesta humana — tanto para el cierre
de un release intermedio como para el cierre del último release del proyecto. Mergeada a `main`.
