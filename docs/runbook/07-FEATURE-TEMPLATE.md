# 07-FEATURE-TEMPLATE.md

# Feature Template — Runbook

Versión: v0.1 (borrador de diseño, pendiente de aprobación)
Dueño: Functional (ver `03-AI-CONSTITUTION.md`, Regla 10, Ownership de Artefactos)
Consumido por: Planning (construye el Release Plan — `09-RELEASE-PLAN-TEMPLATE.md` — a partir de
esto),
Developer (implementa dentro de este Scope y estas Reglas Funcionales), QA (valida contra los
Criterios de Validación de este documento)

## Propósito

Esta plantilla define la estructura estándar que Functional usa para documentar cada Feature de un
producto gestionado, a partir del Project Brief y la Architecture ya vigentes (`01`, `02`).

Toda implementación significativa comienza a partir de una Feature completa según esta plantilla.

---

# 1. Feature Identity

* Name
* Type
* Owner (stakeholder de negocio de esta Feature puntual, si existe — no confundir con Ownership
  de artefactos del pipeline, que ya está definido en `03-AI-CONSTITUTION.md`, Regla 10)
* Status
* Priority

---

# 2. Problem Statement

Describir: limitación actual, necesidad de negocio, motivación — dentro del alcance ya fijado por
el Project Brief (`01`). No describir la implementación primero.

---

# 3. Functional Goal

Describir el comportamiento observable esperado después de la implementación.

---

# 4. Scope

Definir explícitamente: Incluido, Excluido, Ideas futuras (opcional — ver Parking Lot Mode de
`06-DELIVERY-WORKFLOW.md`).

---

# 5. Functional Rules

Describir todas las reglas de negocio. Cuando exista optimización, definir prioridad de reglas
explícitamente.

Ejemplo:

1. Cumplimiento exacto de un slot
2. Preferencia de continuidad
3. Cantidad mínima de tareas
4. Desempate por orden

---

# 6. Estrategia Algorítmica (Opcional)

Obligatoria únicamente cuando la Feature introduzca o modifique lógica de decisión.

Documentar: objetivo, entradas, salidas, restricciones obligatorias, preferencias de
optimización, reglas de desempate, comportamiento determinístico esperado, impacto sobre el
comportamiento existente, escenarios de regresión requeridos.

La estrategia aprobada constituye el contrato de implementación para el componente de lógica de
decisión del producto gestionado, cuando exista uno (no todo producto lo tiene).

---

# 7. Technical Considerations

Describir: arquitectura afectada (con referencia directa a `02-ARCHITECTURE-TEMPLATE.md`),
integraciones, dependencias, riesgos técnicos preliminares.

---

# 8. Criterios de Validación

Cada criterio debe especificar: Escenario, Input, Output esperado.

Como mínimo, deben estar acá los 3 escenarios que Functional ya definió en Stage 1 de
`06-DELIVERY-WORKFLOW.md` (caso feliz, caso no feliz, caso intermedio) — este es el lugar donde
se formalizan, no un paso aparte. Planning parte de estos criterios para diseñar el Test Plan
(`04-TESTING-POLICY.md`) — Functional define QUÉ es correcto, Planning define CÓMO se valida eso.

Las Features que introduzcan lógica de decisión (sección 6) deben incluir escenarios de regresión
determinísticos.

### Evidencia de Validación Esperada

Cuando la Feature produzca una salida funcional observable para un usuario o para un sistema
externo, Functional debe indicar como mínimo: qué evidencia observable se espera obtener, qué
comportamiento funcional permite verificar, cómo complementa las pruebas automatizadas cuando
existan (ver `04-TESTING-POLICY.md`, Regla 8 y Regla 9). Esta evidencia complementa la estrategia
de testing de Planning — no la reemplaza.

---

# 9. Riesgos

Documentar: incertidumbres, supuestos sobre APIs, impactos de migración — como insumo preliminar
para el Análisis de Riesgo formal que Architect ya haya hecho en `02-ARCHITECTURE-TEMPLATE.md`,
sección 3 (tabla Riesgo × Impacto → Severidad). Si esta Feature revela un riesgo no contemplado
ahí, se escala según el circuito de `06-DELIVERY-WORKFLOW.md`, Stage 3 — no se resuelve
unilateralmente acá.

---

# 10. Approval Gate

Sin cambios respecto al resto del pipeline: la implementación no arranca por iniciativa propia —
sigue el Approval Model automático de `06-DELIVERY-WORKFLOW.md`, Stage 3. La espera de un humano
es la excepción (declarativo sin resolver, Regla 9 de `03`, tope de reintentos agotado, o
agotamiento del circuito de escalamiento), no el default.

---

# Design Principle

Problem → Rules → Architecture → Validation → Implementation

Nunca invertir este orden.