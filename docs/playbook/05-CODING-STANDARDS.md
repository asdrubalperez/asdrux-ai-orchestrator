# 05-CODING-STANDARDS.md

# Coding Standards

Versión: v1.0

## Propósito

Este documento define estándares de código y convenciones de diseño orientadas a:

* legibilidad
* consistencia
* mantenibilidad
* reducción de deuda técnica
* colaboración efectiva entre humanos y AI

---

# 🔒 BASELINE — Estándares Core

Estas reglas forman parte del baseline permanente del Playbook.

No deberían modificarse entre proyectos salvo evolución del propio estándar.

---

## 1. Claridad Antes que Cleverness

El código debe priorizar:

* claridad
* simplicidad
* comprensión rápida

Evitar:

* lógica innecesariamente compleja
* clever code
* optimizaciones prematuras
* expresiones difíciles de leer

Objetivo:

Código entendible antes que código ingenioso.

---

## 2. Consistencia Antes que Preferencia Personal

La consistencia del módulo o feature prevalece sobre preferencias individuales.

Evitar:

* múltiples estilos coexistiendo
* naming inconsistente
* estructuras contradictorias

La uniformidad reduce fricción cognitiva.

---

## 3. Convención de Idioma

El idioma debe favorecer:

* claridad
* mantenibilidad
* alineación con el dominio funcional

No existe prohibición dogmática sobre español o inglés.

La consistencia prevalece.

---

### Reglas de idioma

| Elemento                               | Idioma                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Gobernanza / reglas / explicaciones    | Español                                                                                                  |
| Terminología Dev estándar              | Inglés                                                                                                  |
| Código                                 | Inglés por defecto                                                                                       |
| Variables / funciones                  | Inglés por defecto. Español permitido en conceptos de negocio o dominio funcional cuando mejore claridad |
| APIs externas                          | Inglés                                                                                                  |
| Nombres técnicos ampliamente adoptados | Inglés                                                                                                  |
| Títulos de archivos                    | Inglés                                                                                                  |

---

### Ejemplos recomendados

Infraestructura técnica:

```ts
fetchWorklogs()
loadingState
useCapacity()
```

Dominio funcional:

```ts
masterSeleccionada
horasDisponibles
iniciativaRelacionada
```

Evitar mezcla arbitraria dentro del mismo contexto:

```ts
masterSeleccionada
loadingState
fetchDatos()
```

La coherencia del contexto prevalece.

---

## 4. Naming Significativo

Variables y funciones deben expresar intención.

Preferir:

* nombres descriptivos
* lenguaje de dominio
* significado explícito

Evitar:

* abreviaturas oscuras
* nombres genéricos
* siglas ambiguas

Evitar:

```ts
x
tmp
data2
calc
```

Preferir:

```ts
remainingHours
masterSeleccionada
calculateCapacity
```

---

## 5. Responsabilidad Acotada

Funciones y componentes deben tener responsabilidad clara.

Evitar:

* componentes gigantes
* funciones multipropósito
* lógica excesivamente acoplada

Objetivo:

Alta cohesión.

---

## 6. Reutilización con Criterio

Reutilizar cuando aporte valor real.

Evitar:

* abstracción prematura
* shared logic innecesaria
* generic wrappers sin necesidad

No abstraer antes de validar necesidad.

---

## 7. Comentarios con Propósito

Los comentarios deben explicar:

* intención
* decisiones
* contexto no evidente

Evitar comentar lo obvio.

Evitar:

```ts
// incrementa i
i++
```

Preferir:

```ts
// evita doble contabilización de worklogs Tempo
```

---

## 8. Backward Compatibility de Código

Cambios nuevos deben minimizar impacto sobre:

* módulos existentes
* interfaces validadas
* workflows aprobados

Evitar romper comportamiento validado.

---

# ⚙️ PROJECT CONFIGURATION — Configuración Editable

Estas reglas pueden variar según proyecto.

---

## Framework Conventions

[Editable]

Ejemplos:

React:

* hooks
* custom hooks
* server/client boundaries

Backend:

* service layer
* repository pattern
* middleware rules

---

## Formatting Rules

[Editable]

Ejemplos:

* linting
* prettier
* indentation
* semicolons
* quotes

La herramienta de formatting debe prevalecer sobre preferencias individuales.

---

## Folder Structure

[Editable]

El proyecto puede definir:

* feature-based
* layer-based
* hybrid architecture

La AI debe respetar la estructura aprobada.

---

# 🧩 OPTIONAL EXTENSIONS — Extensiones Opcionales

---

## Strict Naming Mode

[Optional]

Naming altamente explícito.

Evitar:

```ts
items
data
result
```

Preferir:

```ts
capacityWorklogs
masterIssues
tempoResponse
```

---

## Clean Code Mode

[Optional]

Mayor énfasis en:

* small functions
* modularidad
* separación estricta de responsabilidades

---

## Documentation Mode

[Optional]

La AI debe generar:

* docstrings
* component notes
* interface documentation

cuando agregue lógica relevante.

---

# Prioridad

Orden de prioridad:

1. Claridad
2. Consistencia
3. Dominio funcional
4. Conveniencia técnica
