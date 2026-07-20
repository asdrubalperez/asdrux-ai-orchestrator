# 05-CODING-STANDARDS.md

# Coding Standards — Runbook

Versión: v1.0
Dueño y consultor directo: Developer (lo aplica directamente al escribir código — no hay un
entregable intermedio tipo Test Plan acá; el código mismo es el entregable, y Developer es su
dueño, ver `03-AI-CONSTITUTION.md`, Regla 10, Ownership de Artefactos)

## Propósito

Este documento define estándares de código y convenciones de diseño orientadas a:

* legibilidad
* consistencia
* mantenibilidad
* reducción de deuda técnica
* colaboración efectiva entre agentes autónomos

Las secciones marcadas **[Editable por producto — decidido por Architect]** siguen la misma
lógica ya fijada en `03-AI-CONSTITUTION.md` y `04-TESTING-POLICY.md`: Architect las completa una
sola vez al configurar el producto gestionado; Developer trabaja dentro de esos límites, sin
modificarlos.

---

# 🔒 BASELINE — Estándares Core

Estas reglas forman parte del baseline permanente del Runbook. No deberían modificarse entre
productos gestionados salvo evolución del propio Runbook.

---

## 1. Claridad Antes que Cleverness

El código debe priorizar: claridad, simplicidad, comprensión rápida.

Evitar: lógica innecesariamente compleja, clever code, optimizaciones prematuras, expresiones
difíciles de leer.

Objetivo: código entendible antes que código ingenioso.

---

## 2. Consistencia Antes que Preferencia

La consistencia del módulo o Feature prevalece sobre cualquier variación entre ejecuciones o
runs — incluso si el mismo Developer (u otro proveedor/modelo) trabaja distinto entre una Feature y otra.

Evitar: múltiples estilos coexistiendo, naming inconsistente, estructuras contradictorias.

La uniformidad reduce fricción cognitiva — para el siguiente agente que lea el código, no solo
para un humano.

---

## 3. Convención de Idioma

El idioma debe favorecer: claridad, mantenibilidad, alineación con el dominio funcional. No existe
prohibición dogmática sobre español o inglés — la consistencia prevalece.

### Reglas de idioma

| Elemento | Idioma |
|---|---|
| Gobernanza / reglas / explicaciones | Español |
| Terminología Dev estándar | Inglés |
| Código | Inglés por defecto |
| Variables / funciones | Inglés por defecto. Español permitido en conceptos de negocio o dominio funcional cuando mejore claridad |
| APIs externas | Inglés |
| Nombres técnicos ampliamente adoptados | Inglés |
| Títulos de archivos | Inglés |

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

Variables y funciones deben expresar intención. Preferir: nombres descriptivos, lenguaje de
dominio, significado explícito. Evitar: abreviaturas oscuras, nombres genéricos, siglas ambiguas.

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

Funciones y componentes deben tener responsabilidad clara. Evitar: componentes gigantes, funciones
multipropósito, lógica excesivamente acoplada.

Objetivo: alta cohesión.

---

## 6. Reutilización con Criterio

Reutilizar cuando aporte valor real. Evitar: abstracción prematura, shared logic innecesaria,
generic wrappers sin necesidad. No abstraer antes de validar necesidad.

---

## 7. Comentarios con Propósito

Los comentarios deben explicar: intención, decisiones, contexto no evidente. Evitar comentar lo
obvio.

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

Cambios nuevos deben minimizar impacto sobre módulos existentes, interfaces validadas, workflows
aprobados. Evitar romper comportamiento validado — ver también Regla 5 de
`03-AI-CONSTITUTION.md` (Backward Compatibility Primero).

---

# ⚙️ PROJECT CONFIGURATION — Configuración Editable por Producto Gestionado

Esta sección la completa **Architect**, una sola vez, al configurar el producto gestionado.
Developer trabaja dentro de estos límites ya fijados, sin modificarlos.

---

## Framework Conventions

[Editable por producto — decidido por Architect]

Ejemplos: React (hooks, custom hooks, server/client boundaries); Backend (service layer,
repository pattern, middleware rules).

---

## Formatting Rules

[Editable por producto — decidido por Architect]

Ejemplos: linting, prettier, indentation, semicolons, quotes. La herramienta de formatting
prevalece sobre cualquier otra convención — Developer no decide formato a criterio propio.

---

## Folder Structure

[Editable por producto — decidido por Architect]

El producto puede definir: feature-based, layer-based, o híbrida. Developer debe respetar la
estructura ya fijada — no la rediseña por su cuenta (ver Regla 2 de `03-AI-CONSTITUTION.md`,
Respeto por la Arquitectura).

---

# 🧩 OPTIONAL EXTENSIONS

Activadas por **Architect**, al configurar el producto — mismo criterio que la sección anterior.

---

## Strict Naming Mode

[Optional] — naming altamente explícito.

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

[Optional] — mayor énfasis en: small functions, modularidad, separación estricta de
responsabilidades.

---

## Documentation Mode

[Optional] — Developer debe generar: docstrings, component notes, interface documentation, cuando
agregue lógica relevante.

---

# Prioridad

1. Claridad
2. Consistencia
3. Dominio funcional
4. Conveniencia técnica
