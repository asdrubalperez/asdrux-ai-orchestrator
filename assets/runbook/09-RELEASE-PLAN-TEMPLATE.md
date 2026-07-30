# 09-RELEASE-PLAN-TEMPLATE.md

# Release Plan Template — Runbook

Versión: v1.0
Dueño: Planning (ver `03-AI-CONSTITUTION.md`, Regla 10, Ownership de Artefactos)
Consumido por: Developer (implementa dentro del enfoque técnico de cada Feature), QA (ejecuta
contra el Test Plan de cada Feature)
Precondición: existen las Features del release activo, completas según `07-FEATURE-TEMPLATE.md`

## Propósito

Este documento define el molde único que Planning usa para organizar el release activo y diseñar
el "cómo" de cada una de sus Features — el enfoque técnico y el Test Plan de cada Feature viven
en el mismo artefacto que la secuencia del release, porque son el mismo trabajo de Planning,
sobre el mismo conjunto de Features, en el mismo momento (`06-DELIVERY-WORKFLOW.md`, Stage 2). Un
solo artefacto evita la ambigüedad entre "el plan de la Feature" y "el plan del release".

---

## 0. Evaluación de Tamaño del Release

Antes de organizar la secuencia, Planning evalúa si el release resulta demasiado grande para
completarse con un riesgo razonable.

Si el riesgo es real: **detener acá y escalar** (ver Regla 8 de `03-AI-CONSTITUTION.md`) — no se
continúa con las secciones siguientes hasta que el humano resuelva.

Si no hay riesgo real: continuar normalmente.

* Cantidad de Features en este release:
* Factores de riesgo considerados (dependencias entre Features, tamaño acumulado, plazo, etc.):
* Conclusión: Riesgo razonable / Riesgo real — se escala

---

## 1. Secuencia del Release

Orden en que se van a implementar las Features de este release, y por qué ese orden (dependencias
entre ellas, riesgo, valor de negocio, o cualquier otro criterio explícito — no un orden
arbitrario).

| Orden | Feature | Motivo del orden |
|---|---|---|
| 1 | | |
| 2 | | |

---

## 2. Por Feature — Enfoque Técnico y Test Plan

Se repite este bloque completo para cada Feature de la secuencia de la sección 1.

### 2.X — [Nombre de la Feature]

**Enfoque técnico** (dentro de la Architecture vigente — `02-ARCHITECTURE-TEMPLATE.md`; si el
enfoque la excede, se detiene y se escala, no se avanza):

* Componentes afectados:
* Impacto:
* Alternativas consideradas (si existen):

**Test Plan** (siguiendo `04-TESTING-POLICY.md`; parte, como mínimo, de los 3 escenarios que
Functional entregó en `07-FEATURE-TEMPLATE.md`, sección 8, para esta Feature):

* Nivel de testing (L1-L4, ver `04-TESTING-POLICY.md`):
* Escenarios (Escenario / Acción / Esperado):
* Evidencia requerida:
* Ambiente de validación:
* Si hay escrituras externas: Efecto externo esperado / Método de confirmación / Consideraciones
  de seguridad, idempotencia o limpieza

---

## 3. Hallazgos y Anomalías

Espacio para inconsistencias detectadas entre Features del release, decisiones que requirieron
desvío de lo esperado en Architecture, o cualquier observación que no encaje en las secciones
anteriores.

---

## 4. Chequeo Interno Antes de Entrega

*(Igual en espíritu al del Project Brief y la Architecture — revisión del propio Planning sobre
su propio entregable, no un gate de aprobación humana)*

Antes de marcar este Release Plan como listo para Developer, Planning verifica:

- [ ] La Evaluación de Tamaño del Release (sección 0) concluyó Riesgo razonable, o el
      escalamiento correspondiente ya se resolvió
- [ ] Cada Feature de la secuencia (sección 1) tiene su bloque completo en la sección 2 — ninguna
      quedó sin Enfoque Técnico o sin Test Plan
- [ ] Ningún Test Plan quedó con un escenario ambiguo — todos parten de los 3 mínimos que
      Functional ya definió por Feature
- [ ] Ningún Enfoque Técnico excede la Architecture vigente sin haber sido escalado y resuelto

Si algo de esto falla, Planning corrige antes de entregar.
