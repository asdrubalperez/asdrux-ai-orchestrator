# 07-FEATURE-TEMPLATE.md

# Plantilla de Feature

Versión: v2.1

## Propósito

Esta plantilla define la estructura estándar para diseñar y aprobar nuevas **Features** del proyecto.

Toda implementación significativa debe comenzar a partir de una **Feature** aprobada.

---

# 1. Feature Identity

- Name
- Type
- Owner
- Status
- Priority

---

# 2. Problem Statement

Describe:

- current limitation;
- business need;
- motivation.

Avoid describing implementation first.

---

# 3. Functional Goal

Describe observable behavior expected after implementation.

---

# 4. Scope

Explicitly define:

Included

Excluded

Future ideas (optional)

---

# 5. Functional Rules

Describe all business rules.

When optimization exists, define rule priority explicitly.

Example:

1. Exact slot completion
2. Contiguous KEY preference
3. Minimum task count
4. KEY ordering tie-breaker

---

# 6. Estrategia Algorítmica (Opcional)

Obligatoria únicamente cuando la **Feature** introduzca o modifique lógica de decisión.

Documentar:

- objetivo;
- entradas;
- salidas;
- restricciones obligatorias;
- preferencias de optimización;
- reglas de desempate;
- comportamiento determinístico esperado;
- impacto sobre el comportamiento existente;
- escenarios de regresión requeridos.

La estrategia aprobada constituye el contrato de implementación para el **Core Engine del proyecto** (el componente responsable de la lógica de decisión, cuando aplique).

---

# 7. Technical Considerations

Describe:

- affected architecture;
- integrations;
- dependencies;
- risks.

---

# 8. Validation Criteria

Each validation must specify:

Scenario

Input

Expected output

Algorithmic Features must include deterministic regression scenarios.

### Validation Evidence

[Editable]

Cuando la Feature produzca una salida funcional observable para el usuario o para un sistema externo, deberá definir explícitamente la evidencia esperada durante la validación.

Como mínimo debería indicar:

* qué evidencia observable se espera obtener;
* qué comportamiento funcional permite verificar;
* cómo complementa las pruebas automatizadas, cuando existan.

La evidencia funcional complementa la estrategia de testing definida para la Feature y no reemplaza las validaciones automatizadas.

---

# 9. Risks

Document:

- uncertainties;
- API assumptions;
- migration impacts.

---

# 10. Approval Gate

Implementation is forbidden until explicit human approval.

---

# Design Principle

Problem

↓

Rules

↓

Architecture

↓

Validation

↓

Implementation

Never invert this order.
