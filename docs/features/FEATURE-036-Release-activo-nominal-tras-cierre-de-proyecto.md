# FEATURE-036 — Release activo nominal tras cierre de proyecto sin release siguiente

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: diseño original de ARIA (AI Product Architect), revisado y validado
> técnicamente contra el código real antes de aprobar la implementación. Aprobado con una
> corrección de orden: la revisión de datos reales (Regla 13/Escenario 15) se corrió como primer
> paso de la implementación, antes de tocar el validador, en vez de dejarla como paso posterior.

---

## 1. Feature Identity

- **Name**: Release activo nominal tras cierre de proyecto sin release siguiente
- **Type**: Lifecycle Consistency / Release Governance
- **Owner**: asdru
- **Status**: Implementada — pendiente de validación E2E real en VPS antes de merge a `main`
- **Priority**: P1
- **Origin**: Hallazgo de la prueba E2E real del 2026-07-29, asociada a FEATURE-024
- **Related Features**: FEATURE-018, FEATURE-019, FEATURE-020, FEATURE-024

---

## 2. Problem Statement

Cuando Planning declaraba `RELEASE_COMPLETO` y no existía un release `Pendiente` siguiente, el
Orquestador marcaba el release actual como `Completado` pero conservaba su ID en
`activeReleaseId`, dejando conviviendo dos verdades contradictorias: el evento `project_closed`
(proyecto cerrado) y un `activeReleaseId` que seguía apuntando a un release — ya completado — como
si estuviera vigente. `activeReleaseFromRoadmap` tampoco comprobaba el estado del release
encontrado, así que devolvía ese release completado en vez de `null`. El contrato
(`activeReleaseId: string`, no-nullable) no podía representar "no hay release activo".

---

## 3. Functional Goal

El Roadmap ahora puede representar explícitamente la ausencia de release activo:
`activeReleaseId: string | null`. Con release siguiente, el comportamiento no cambia. Sin release
siguiente: el release actual pasa a `Completado`, ningún release queda `Activo`,
`activeReleaseId` pasa a `null`, y los consumidores (backend, UI) deben interpretar eso como
"proyecto sin release activo" sin usar el último release completado como fallback.

---

## 4. Scope

### Included

- Contrato `RoadmapApprovalPayload.activeReleaseId: string | null` (`src/cli/escalation.ts`).
- Validador `isRoadmapApprovalPayload` con invariantes cruzados: `activeReleaseId` string exige
  exactamente un release `Activo` con ese ID; `null` exige cero releases `Activo`.
- `activeReleaseFromRoadmap` filtra también por estado `Activo` (defensa local, Regla 8), no solo
  por coincidencia de ID.
- `respondService.ts`: al cerrar sin release siguiente, cierra por estado (`"Activo"` →
  `"Completado"`) en vez de por coincidencia con el `activeReleaseId` leído, y persiste
  `activeReleaseId: null`. Extraído como función pura `computeReleaseClosureRoadmap` para poder
  testearla sin DB.
- `runView.ts` / `ReleasePlanPanel.tsx`: aceptan `activeReleaseId: string | null` y la UI muestra
  "Sin release activo" cuando corresponde, sin usar el último release como fallback.
- Revisión de datos reales en la base **antes** de endurecer el validador (ver sección 8).

### Excluded

Nuevo estado global de proyecto, tabla de lifecycle, reapertura de proyectos cerrados, reactivar
releases completados, migración masiva preventiva de datos históricos, cambios al mecanismo de
`RELEASE_COMPLETO`/Approval Gate/runs hijos/Release Plan/evento `project_closed`.

---

## 5. Functional Rules

Ver diseño completo (14 reglas) en el historial de la sesión de diseño — resumen de las
determinantes:

1. `activeReleaseId = null` representa ausencia real de release activo, nunca datos incompletos.
2. Un `activeReleaseId` no nulo exige que ese release tenga estado `Activo`.
3. `null` exige cero releases `Activo`.
4. Cuando existe release activo, exactamente uno tiene estado `Activo` y su ID coincide.
5-6. Cierre con/sin release siguiente — comportamiento descrito en la sección 3.
7. El payload persistido en `project_closed` es exactamente el mismo que se guarda en
   `project_config_versions` — nunca un evento con un estado distinto al persistido.
8. `activeReleaseFromRoadmap` no confía únicamente en `activeReleaseId`: exige payload válido, no
   nulo, release existente y estado `Activo`.
9. Los puntos del pipeline que ya fallan/escalan ante `activeReleaseFromRoadmap === null` no
   cambian — FEATURE-036 no altera esas reglas.
10. La UI no usa el último release, el último completado, ni el primero de la lista como fallback.
11-12. Historial preservado; snapshots pinneados de runs históricos no se reescriben.
13. Un roadmap con `activeReleaseId` apuntando a un release no `Activo` es inválido.
14. Sin migración masiva preventiva salvo evidencia real de datos afectados.

---

## 6. Technical Considerations

- `src/cli/escalation.ts`: tipo y validador actualizados; `activeReleaseFromRoadmap` con filtro de
  estado.
- `src/cli/respondService.ts`: nueva función exportada `computeReleaseClosureRoadmap(roadmap)`
  (pura, sin I/O) — cierra por estado, no por coincidencia de ID, garantizando determinísticamente
  cero releases `Activo` cuando no hay siguiente.
- `src/server/runView.ts`, `web/src/ReleasePlanPanel.tsx`: tipo `activeReleaseId: string | null`;
  el panel muestra "Sin release activo" cuando es `null`.
- `src/db/repository.ts` (`getReleasePlansByRelease`) y `src/features/lifecycle.ts`
  (`assertRunProjectAndPinnedRelease`) — revisados, no requirieron cambios: el primero ya filtra
  `is not null` sobre el JSONB (un `null` real se excluye naturalmente, no se convierte en el
  string `"null"`); el segundo compara contra un `releaseKey` siempre string, nunca `null`.

---

## 7. Validation Criteria

15 escenarios según el diseño original — ver sección 8 "Validation Evidence" del documento de
diseño (cierre con/sin release siguiente, ID apuntando a release completado, null con release
activo, ID sin releases activos, varios releases activos, ID activo diferente, vista backend y UI
sin release activo, consumidor que requiere release activo, evento/config coincidentes, snapshots
históricos, regresión de aprobación y de continuidad entre releases, base real).

### Validation Evidence

**Datos reales (paso previo a tocar el validador, 2026-07-30)**: consulta sobre
`project_config_versions` vigentes (`config_key = 'release_roadmap'`, `valid_to IS NULL`) —
**0 filas**. No había ningún roadmap vigente persistido al momento de implementar; no hizo falta
ninguna reparación de datos antes de endurecer el validador.

**Automatizada**: 14 tests nuevos, sin mocks sobre el código real de producción —
`escalation.test.ts` (validador: roadmap cerrado válido, ID apuntando a release no-Activo, null con
release Activo, ID sin releases activos, varios Activos simultáneos, ID activo diferente al
release realmente Activo; `activeReleaseFromRoadmap` con `null` y con release no-Activo),
`respondService.test.ts` (`computeReleaseClosureRoadmap`: cierre con release siguiente, cierre del
último release, defensa ante más de un release Activo en el roadmap leído), `runView.test.ts`
(vista expone `activeReleaseId: null` sin fallback; rechaza roadmap inconsistente),
`ReleasePlanPanel.test.tsx` (UI muestra "Sin release activo", no marca ningún release como Activo).
Suite completa: 211 tests, 201 pass, 10 skip (específicos de plataforma en Windows), 0 fail.
`tsc --noEmit` limpio en raíz y en `web/`.

**Pendiente antes de merge a `main`**: evidencia E2E real en VPS con un Roadmap de al menos dos
releases — cerrar el primero y confirmar que el segundo se activa (`activeReleaseId` pasa al
siguiente, proyecto no se cierra), luego cerrar el último y confirmar `activeReleaseId: null`,
evento `project_closed`, y que la UI muestra "Sin release activo".

---

## 8. Risks

Ver diseño original (8 riesgos) — los más relevantes: consumidores que asumían `string` no-nullable
(mitigado con búsqueda global + TypeScript + tests, sin hallazgos adicionales); payloads históricos
inconsistentes que el validador nuevo rechazaría (mitigado: 0 filas vigentes en la base real al
momento de implementar); UI podría confundir "cerrado" con "aún no aprobado" (mitigado con el
mensaje mínimo seguro "Sin release activo", sin afirmar "Proyecto cerrado"); reparación de datos
automática incorrecta (evitado explícitamente, sin migración heurística).

---

## 9. Approval Gate

Aprobado por el owner, con la corrección de orden indicada en la nota de proceso. Pendiente de
validación E2E real en VPS (Roadmap con dos releases) antes de mergear a `main`.

---

## Estado de la implementación

**Implementada** en rama `feature/036-release-activo-consistente` — pendiente de validación E2E
real en VPS antes de mergear a `main`. `tsc --noEmit` (raíz y `web/`) y suite completa (211 tests)
verificados en la rama.
