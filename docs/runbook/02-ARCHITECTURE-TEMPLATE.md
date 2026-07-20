# 02-ARCHITECTURE-TEMPLATE.md

# Architecture Template — Runbook

Versión: v0.1 (borrador de diseño, pendiente de aprobación)
Rol que lo produce: Architect
Rol que lo consume: Functional (y, en adelante, todo el pipeline)
Precondición: existe un `01-PROJECT-BRIEF-TEMPLATE.md` completo y sin huecos conocidos para el
mismo proyecto (ver su sección 6 — Chequeo Interno Antes de Entrega)

## Propósito

Este documento define el molde del segundo entregable del Architect: la arquitectura técnica de
la solución, construida a partir del Project Brief ya validado. A diferencia del Project Brief
(que se produce una vez, al inicio del proyecto), este documento es **vivo por producto**: se
inicializa la primera vez que el Architect trabaja sobre el business case, y se retroalimenta
Feature a Feature a medida que surgen nuevas decisiones técnicas — análogo a como
`docs/playbook/02-ARCHITECTURE.md` de este mismo repo acumula decisiones desde Milestone 0.

Es mayormente **investigable** — el Architect ya tiene lo que el humano solo él puede aportar (vía
el Project Brief), y ahora explora, diseña y decide. Las decisiones editables por producto se
persisten en `project_config_versions` (FEATURE-011).

El mecanismo concreto de *cuándo y cómo* se retroalimenta este documento durante el ciclo de una
Feature en curso (no solo entre Features) es un tema abierto — depende de cómo se resuelva el loop
de escalamiento hacia Architect/Functional en `06-DELIVERY-WORKFLOW.md`. No bloquea el contenido de
este molde, que es válido tanto para la carga inicial como para cualquier actualización posterior.

Si durante esta etapa surge un dato genuinamente declarativo que no estaba en el Project Brief
(ej. una credencial de acceso a un sistema no mencionado antes), se aplica la misma regla ya
fijada: no se pregunta en rondas sueltas, se consolida y se vuelve al humano una sola vez.

---

## 0. Roadmap de Releases (condicional)

Solo aplica cuando el alcance del business case (`01-PROJECT-BRIEF-TEMPLATE.md`) es demasiado
amplio para completarse en un único release. Si el alcance ya viene acotado a uno solo, esta
sección queda **No Aplica** y el resto del documento funciona igual que si no existiera.

Cuando aplica:

* Architect propone una secuencia de releases, siempre empezando por un MVP.
* Antes de entregar nada a Functional, Architect escala esta propuesta al humano (ver Regla 8,
  punto 4, de `03-AI-CONSTITUTION.md`) — es una aprobación única al inicio del proyecto, no por
  Feature.
* Una vez aprobado, se registra cuál es el **release activo** (el que Functional, Planning,
  Developer y QA trabajan en este momento).
* Al completarse un release (ver `06-DELIVERY-WORKFLOW.md`, Stage 7), Architect actualiza cuál es
  el release activo siguiente y vuelve a escalar al humano antes de dar curso — no se asume
  continuidad automática entre releases, el mismo criterio que la aprobación inicial.

| Release | Alcance (resumen) | Estado |
|---|---|---|
| MVP | | Activo / Pendiente / Completado |
| | | |

---

## 1. Análisis Técnico

- Descripción macro de la arquitectura:
- Backend: servicios, lenguaje/framework, patrones
- Frontend (si aplica): flujos, pantallas
- Bases de datos: nuevas o existentes
- Integraciones y APIs: listado
- ¿Requiere infraestructura nueva? Sí/No → detalle
- ¿Consume servicios externos? Sí/No → detalle
- ¿Usa alguna tecnología no utilizada antes **en este producto** (el sistema real que el
  Orquestador construye para este cliente, a través de todas sus Features — no solo esta Feature
  puntual)? Sí/No → detalle. El Architect verifica esto contra el registro acumulado de
  decisiones técnicas ya tomadas para este producto, no solo contra lo escrito en este documento

*"Información no disponible en la fuente actual"* si corresponde — igual que en el Project Brief,
ningún campo se omite ni se resume por falta de info.

---

## 2. Componentes Técnicos

| Componente | Tipo (servicio / contenedor / interfaz / cron / etc.) | Descripción (responsabilidad, tecnología, lenguaje) |
|---|---|---|
| | | |

El Architect agrega tantas filas como componentes reales identifique — no se limita a un número
fijo ni se fuerza a completar filas sin contenido real.

---

## 3. Análisis de Riesgo

Para cada riesgo identificado, se completa una fila. Riesgo e Impacto se estiman en Bajo/Medio/Alto
y la Severidad **se deriva de la tabla siguiente, nunca a criterio libre del Architect**:

| Riesgo ↓ / Impacto → | Bajo | Medio | Alto |
|---|---|---|---|
| **Bajo** | Baja | Baja | Media |
| **Medio** | Baja | Alta | Alta |
| **Alto** | Media | Alta | Alta |

Acción según Severidad (también determinística, no a criterio libre):

- **Baja** → Aceptar (sin acción, salvo que sobren tiempo/recursos)
- **Media** → Gestionar o Transferir (definir acción a seguir si el riesgo ocurre)
- **Alta** → Mitigar, Reducir o Eliminar (acción activa para bajar la probabilidad u ocurrencia)

| Situación Analizada | Riesgo | Impacto | Severidad (derivada de la tabla) | Acción Recomendada |
|---|---|---|---|---|
| | | | | |

Regla de consistencia: si la Severidad que se completa no coincide con lo que arroja la tabla, el
Architect corrige automáticamente y deja una nota en Hallazgos (sección 4 de este documento) — no
se deja pasar una severidad manual que contradiga la tabla.

---

## 4. Hallazgos y Anomalías

Espacio para inconsistencias detectadas (ver regla de consistencia en sección 3), decisiones
técnicas que requirieron desvío de lo esperado en el Project Brief, o cualquier observación que no
encaje en las secciones anteriores.

---

## 5. Chequeo Interno Antes de Entrega

*(Igual en espíritu al del Project Brief — revisión del propio Architect sobre su propio
entregable, no un gate de aprobación humana)*

Antes de marcar esta Architecture como lista para Functional, el Architect verifica:

- [ ] Ningún campo de las secciones 1-2 quedó vacío sin la marca explícita de "no disponible"
- [ ] Cada fila de la tabla de Riesgo (sección 3) tiene Severidad consistente con la tabla de
      lookup — ninguna severidad quedó puesta a criterio libre
- [ ] Los Componentes Técnicos (sección 2) reflejan lo mencionado en el Análisis Técnico
      (sección 1) — no hay componentes mencionados en un lado y ausentes en el otro
- [ ] No quedan datos genuinamente declarativos pendientes de consolidar hacia el humano
- [ ] Si el Roadmap de Releases (sección 0) aplica, el release activo está identificado sin
      ambigüedad, y la propuesta de secuencia ya fue escalada al humano antes de entregar a
      Functional

Si algo de esto falla, el Architect corrige antes de entregar.
