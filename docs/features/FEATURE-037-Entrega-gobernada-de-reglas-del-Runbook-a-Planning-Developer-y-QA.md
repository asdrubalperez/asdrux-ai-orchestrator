# FEATURE-037 — Entrega gobernada de reglas del Runbook a Planning, Developer y QA

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: diseño original de ARIA (AI Product Architect), revisado y validado
> técnicamente contra el código real antes de aprobar la implementación. Aprobado con dos
> correcciones de redacción incorporadas al documento (sin cambios de alcance ni mecanismo): (1) la
> entrada original de FEATURE-037 en el Roadmap no decía literalmente "inyectar ambos documentos
> completos a QA/Developer" — era una frase genérica ("esos documentos... al contexto de
> QA/Developer") que este diseño **desambigua** por ownership, no corrige un error puntual; (2) el
> único uso previo de `runbookProvider.readText` (para Functional) resuelve el asset **después**
> de que la fase ya completó, para persistir un `template_snapshot` en la tabla `features` — no
> inyecta contenido en el contexto que un agente lee antes de actuar. FEATURE-037 introduce un
> patrón genuinamente nuevo (inyección pre-invocación), no replica uno existente.

---

## 1. Feature Identity

- **Name**: Entrega gobernada de reglas del Runbook a Planning, Developer y QA
- **Type**: Governance Delivery / Runtime Context Integrity
- **Owner**: asdru
- **Status**: Implementada — pendiente de validación E2E real en VPS antes de merge a `main`
- **Priority**: P1
- **Origin**: Hallazgo derivado de las Reglas 11 y 12 de `04-TESTING-POLICY.md`
- **Related Features**: FEATURE-011, FEATURE-020, FEATURE-022, FEATURE-023 Parte 2, FEATURE-029

---

## 2. Problem Statement

Ni Planning, ni Developer, ni QA tenían garantía estructural de recibir las reglas de gobernanza del
Runbook que les corresponde aplicar en cada invocación — `assets/runbook/` no está montado en sus
entornos, esos documentos no son artifacts del proyecto, y el contexto no persiste entre
invocaciones. El ownership vigente del Runbook (confirmado literalmente contra el texto real:
`04-TESTING-POLICY.md:6` — *"Dueño y único consultor directo: Planning"*; `05-CODING-STANDARDS.md:6-8`
— *"Dueño y consultor directo: Developer"*) distingue responsabilidades específicas: inyectar ambos
documentos completos a todos los roles habría contradicho ese ownership y creado múltiples fuentes
normativas simultáneas (Test Plan de Planning + reinterpretación propia de Developer + reinterpretación
propia de QA).

---

## 3. Functional Goal

En cada invocación relevante, el Orquestador entrega:
- **Planning**: `governance.testingPolicy` (`04-TESTING-POLICY.md`), para que lo traduzca al Test
  Plan concreto de la Feature.
- **Developer**: `governance.codingStandards` (`05-CODING-STANDARDS.md`), junto con el Test Plan
  vigente que Planning ya produjo.
- **QA**: solo el Test Plan vigente — no recibe Testing Policy ni Coding Standards completos.

Cada invocación queda autosuficiente respecto de las reglas que el rol debe aplicar, sin depender de
memoria entre invocaciones ni de acceso directo al filesystem del Runbook.

---

## 4. Scope

### Included

- Entrega fresca en cada invocación aplicable (nunca cacheada de un intento anterior).
- `governance.testingPolicy` para Planning en toda invocación (primera planificación,
  continuaciones, reingresos).
- `governance.codingStandards` para Developer en todo intento (primero, todos los reintentos, y el
  turno de readiness post-QA — sin que su presencia autorice cambios de código en ese turno).
- QA recibe únicamente el Test Plan vigente, sin Testing Policy ni Coding Standards.
- `TESTING_POLICY_ASSET`/`CODING_STANDARDS_ASSET` agregados a `REQUIRED_RUNBOOK_ASSETS` (validación
  obligatoria de arranque).
- Namespace `governance` protegido: cualquier campo `governance` en el contexto entrante (nunca
  debería venir de un agente o business case, pero no es un dato confiable) queda ignorado —
  `shared` se aplica siempre al final del merge.
- Auditoría por evento (`runbook_governance_delivered`) con metadata (rol, path, versión, hash), sin
  persistir el contenido completo.
- Refuerzo mínimo de `planning.txt`, `developer.txt`, `qa.txt` según ownership.

### Excluded

Entregar Testing Policy completa a Developer/QA, entregar Coding Standards a QA, permitir que QA
redefina el Test Plan o que Developer amplíe testing por interpretación propia, modificar el
contenido sustantivo de ambos documentos, RAG o resumen automático, mounts o tools arbitrarias de
lectura del Runbook, convertir estos documentos en artifacts del proyecto, persistir copias
completas por run, agregar `releaseId`-like nuevo campo de negocio (no aplica acá, mencionado solo
por completitud de scope).

---

## 5. Functional Rules

Ver diseño completo (20 reglas) — resumen de las determinantes: ownership antes que conveniencia
(Regla 1); Planning recibe Testing Policy en cada invocación relevante, Developer recibe Coding
Standards en cada intento incluido readiness (Reglas 2-3); QA no consulta Testing Policy ni recibe
Coding Standards — ejecuta el Test Plan y escala si es insuficiente (Reglas 4-6); entrega fresca sin
caché entre invocaciones (Regla 8); paths como constantes internas, nunca provistos por el agente
(Regla 9); contenido/versión/hash viajan juntos, sin mezclar versiones (Regla 10); orden de
precedencia con escalamiento ante contradicción (Regla 11); Test Plan concreto prevalece para
ejecución, sin ampliar alcance desde reglas generales (Regla 12); fallo cerrado si el asset
obligatorio no está disponible — la fase no se invoca (Regla 13); ausencia de asset es fallo de
infraestructura, nunca atribuible al rol o al proyecto (Regla 14); auditoría por metadata, sin
contenido completo (Regla 15); reintentos y readiness reciben gobernanza fresca de nuevo (Reglas
16-17); escalamiento cuando el Test Plan es insuficiente (Regla 18); sin acceso directo al
filesystem del Runbook (Regla 19); secciones de configuración editable sin completar se tratan como
no configuradas, sin inventar valores (Regla 20).

---

## 6. Technical Considerations

- `src/runbook/runbookProvider.ts`: nuevas constantes `TESTING_POLICY_ASSET`
  (`04-TESTING-POLICY.md`), `CODING_STANDARDS_ASSET` (`05-CODING-STANDARDS.md`), ambas agregadas a
  `REQUIRED_RUNBOOK_ASSETS` — el Orquestador falla al arrancar si el paquete está incompleto.
- `src/cli/commands/runStart.ts`:
  - `shapeRoleContext` amplía su parámetro `shared` con `governance?: unknown`, aplicado siempre al
    final del merge (protección contra sobrescritura, Regla 13/Escenario 14).
  - `withRoleContext` (Planning) recibe ahora `runId` además de `projectId`; carga
    `testingPolicy` fresco en cada llamada vía `defaultRunbookProvider.readText` y registra el
    evento de auditoría antes de armar el contexto compartido.
  - Nueva función `loadDeveloperGovernance(runbookProvider, recordEvent, runId)`: carga
    `codingStandards` fresco y registra el evento de auditoría — se invoca en cada intento del loop
    Developer↔QA (`runDeveloperQaLoop`) y en el turno de readiness post-QA.
  - Nuevo servicio inyectable `runbookProvider` en `runDeveloperQaLoop` (`Pick<RunbookProvider,
    "readText">`, default `defaultRunbookProvider`), mismo patrón de DI ya usado para
    `buildExecutor`/`testExecutor`/`dependencyInstaller` — permite testear sin tocar el filesystem
    real del Runbook.
  - QA no recibió ningún cambio de contexto — sigue recibiendo únicamente `plan`, `testCommand`,
    `testResult`, `developerSummary`.
- `planning.txt`, `developer.txt`, `qa.txt`: reglas nuevas reforzando el ownership (ver sección 7
  del diseño original) sin cambiar el formato de respuesta esperado de ningún rol.

---

## 7. Validation Criteria

20 escenarios según el diseño original (Planning recibe Testing Policy en primera invocación,
continuación y reingreso; Developer recibe Coding Standards en cada tipo de reintento y en
readiness; QA no recibe ninguno de los dos documentos completos; asset inexistente bloquea la
invocación del rol correspondiente; protección contra path malicioso y contexto de gobernanza
falso; hash auditable; independencia de proveedor Claude/Codex; regresión de las Reglas 11/12 de
Testing Policy).

### Validation Evidence

**Automatizada**: 20 tests nuevos, sin mocks sobre el código real de producción —
`runbookProvider.test.ts` (fixture ampliada con Testing Policy/Coding Standards, catálogo
obligatorio de arranque actualizado, nuevo test de fallo cuando falta cualquiera de los dos assets
nuevos); `runStart.test.ts` (`shapeRoleContext`: la gobernanza real siempre gana sobre un campo
`governance` falso en el contexto entrante, tanto en la forma de reingreso como en la forma
envuelta en `functionalArtifact`; `runDeveloperQaLoop`: Developer recibe
`governance.codingStandards` en cada uno de dos intentos consecutivos, con hash distinto en cada
uno — confirma lectura fresca, no cacheada). Suite completa: 237 tests, 227 pass, 10 skip
(específicos de plataforma en Windows), 0 fail. `tsc --noEmit` limpio.

**Pendiente antes de merge a `main`**: evidencia E2E real en VPS — ejecutar una Feature real
(Architect → Functional → Planning → Developer → fallo/retry → QA) y confirmar, vía los eventos
`runbook_governance_delivered` persistidos, que cada rol recibió exactamente la gobernanza que le
corresponde (Planning: Testing Policy; Developer: Coding Standards, con hash consistente en cada
intento; QA: ninguno de los dos) y que ningún run se ejecutó con gobernanza parcial.

---

## 8. Risks

Ver diseño original (10 riesgos) — los más relevantes: contradicción con la formulación original
del Roadmap (mitigado con las dos correcciones de redacción de esta nota de proceso); crecimiento
de contexto por inyectar documentos completos (mitigado: solo el documento aplicable al rol, nunca
ambos a todos); doble fuente normativa para testing si se hubiera entregado Testing Policy
directamente a QA/Developer (mitigado con la matriz de entrega estricta); Runbook actualizado a
mitad de un run produciendo hashes distintos entre invocaciones (aceptado como coherente con la
entrega fresca, sin pinning por run — fuera de alcance); prompt injection intentando invalidar la
gobernanza entregada (mitigado con el namespace `governance` protegido, aplicado siempre al final
del merge).

---

## 9. Approval Gate

Aprobado por el owner, con las dos correcciones de redacción de la nota de proceso incorporadas al
documento antes del handoff de implementación. Pendiente de validación E2E real en VPS antes de
mergear a `main`.

---

## Estado de la implementación

**Implementada** en rama `feature/037-runbook-governance-planning-developer` — pendiente de
validación real en VPS antes de mergear a `main`. `tsc --noEmit` y suite completa (237 tests)
verificados en la rama.
