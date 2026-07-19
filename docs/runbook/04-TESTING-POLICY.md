# 04-TESTING-POLICY.md

# Testing Policy — Runbook

Versión: v0.1 (borrador de diseño, pendiente de aprobación)
Dueño y único consultor directo de este documento: Planning (lo usa para diseñar el Test Plan de
cada Feature, dentro del Release Plan — `09-RELEASE-PLAN-TEMPLATE.md`, sección 2 — ver
`03-AI-CONSTITUTION.md`, Regla 10, Ownership de Artefactos)
QA y Developer no consultan este documento directamente — su documento de referencia para
ejecutar testing es el Test Plan dentro del Release Plan que Planning produce a partir de estas
reglas. Si el Test Plan no cubre un caso que surge durante la ejecución, QA o Developer escalan
hacia Planning (dueño), en vez de reinterpretar esta política por su cuenta. La Regla 9 de
`03-AI-CONSTITUTION.md` (seguridad de producción) es la única excepción: rige a todos los roles
siempre, exista o no contemplada en el Test Plan.

## Propósito

Este documento define las reglas y principios que Planning debe aplicar al diseñar el Test Plan
de cada Feature (sección 2 de `09-RELEASE-PLAN-TEMPLATE.md`) de cualquier producto gestionado por
el Orquestador. QA y Developer ejecutan contra el Test Plan resultante — no consultan este
documento ni lo reinterpretan por su cuenta.

Su objetivo es asegurar:

* testing eficiente
* validación confiable
* evidencia funcional observable
* menor consumo innecesario de ciclos Developer↔QA
* reducción de retrabajo
* control sobre alcance y esfuerzo de validación
* confirmación explícita de efectos externos cuando existan

El testing es una actividad diseñada, no exploratoria.

Las secciones marcadas **[Editable por producto]** siguen la misma lógica ya fijada en
`03-AI-CONSTITUTION.md`: **[PENDIENTE-DB-PROJECTS]**

---

# 🔒 BASELINE — Reglas Core de Testing

Estas reglas forman parte del baseline permanente del Runbook. No deberían modificarse entre
productos gestionados salvo evolución del propio Runbook.

---

## 1. Testing con Propósito

Todo testing debe tener propósito explícito. Planning debe identificar esto al diseñar el Test
Plan:

* qué valida
* por qué lo valida
* qué riesgo intenta reducir
* qué evidencia permitirá concluir que la validación fue exitosa

QA y Developer, al ejecutar, deben confirmar que entienden ese propósito antes de correr una
prueba — no ejecutan pasos sin saber qué están validando.

Evitar: testing por costumbre, validaciones sin objetivo, exploración innecesaria, ejecución de
pruebas sin criterio de cierre.

Principio: no testear por testear.

---

## 2. Prueba Mínima Válida

Planning debe preferir, al definir el alcance del Test Plan: la menor prueba válida, la menor
superficie de validación, el menor costo razonable, y evidencia suficiente para confirmar el
comportamiento esperado. QA y Developer ejecutan dentro de ese alcance — no lo amplían por
iniciativa propia durante la ejecución.

Objetivo: confirmar comportamiento sin sobredimensionar testing.

Evitar: validación excesiva, auditorías innecesarias, cobertura desproporcionada, acumulación
automática de escenarios sin riesgo que la justifique.

La prueba mínima no debe confundirse con una prueba incompleta — debe ser suficientemente precisa
para validar el comportamiento aprobado y suficientemente acotada para evitar esfuerzo innecesario.

---

## 3. Mass Testing No Es Comportamiento por Defecto

Planning no debe incluir en el Test Plan, ni QA/Developer proponer durante la ejecución, testing
masivo, barridos completos, regression total, loops extensivos, ni exploración indiscriminada,
salvo que el riesgo, la superficie de cambio, o la criticidad del release —según lo registrado en
la Architecture vigente o en el Análisis de Riesgo de la Feature— lo justifiquen explícitamente.

Principio: una validación amplia se justifica por riesgo real, no por hábito.

---

## 4. Estrategia de Validación Primero

Antes de que QA o Developer prueben algo, Planning debe definir en el Test Plan: alcance,
estrategia, resultado esperado, criterio de éxito, evidencia que será observada, ambiente en el
que se realizará la validación.

Ningún agente comienza testing sin un Test Plan entendible ya definido por Planning. La estrategia
debe permitir distinguir, cuando corresponda, entre: ejecución técnica exitosa, comportamiento
funcional correcto, y efecto externo realmente producido.

---

## 5. Regresión con Intención

La regresión debe ser proporcional y deliberada. Planning decide, al armar el Test Plan, incluir
únicamente: componentes afectados, dependencias relevantes, riesgos razonables, reglas de negocio
que deban preservarse, decisiones arquitectónicas protegidas por comportamiento verificable,
defectos con riesgo razonable de repetición. QA ejecuta esos escenarios — no agrega regresiones
propias fuera del Test Plan durante la ejecución.

No todas las pruebas ejecutadas durante una Feature deben convertirse en regresiones permanentes.

Evitar: regression indiscriminada, expansión automática de alcance, conservación permanente de
escenarios circunstanciales, duplicación de pruebas que protegen el mismo riesgo, crecimiento del
suite sin valor preventivo claro.

Principio: la regresión preserva intencionalmente, no es un reflejo automático de toda validación
pasada.

---

## 6. Resultado Esperado Explícito

Toda validación debe tener resultado esperado, definido por Planning en el Test Plan. Formato
sugerido: Escenario / Acción / Esperado (Planning) / Resultado (QA o Developer, al ejecutar). Sin
esperado explícito, no existe validación real.

El resultado esperado debe ser observable y suficientemente preciso para evitar conclusiones
ambiguas. Cuando exista más de una capa de comportamiento, Planning debe distinguir en el Test
Plan entre resultado técnico, resultado funcional, y efecto externo.

---

## 7. Validación en Ambiente Real

Cuando una Feature dependa de integraciones, configuración, infraestructura, permisos, datos
reales, o comportamiento de sistemas externos, la validación local o simulada puede no ser
suficiente. Planning debe identificar esto al diseñar el Test Plan e indicar cuándo corresponde
validar en un ambiente real autorizado; QA y Developer ejecutan esa validación siguiendo lo que el
Test Plan estableció.

La validación en ambiente real debe ser: intencional, acotada, segura, autorizada, reproducible
cuando sea razonable.

Evitar: asumir que mocks o fixtures representan completamente el sistema externo; declarar éxito
basándose únicamente en ejecución local cuando el riesgo está en la integración; usar producción
sin la autorización que exige la Regla 9 de `03-AI-CONSTITUTION.md`; realizar operaciones
irreversibles solo para obtener evidencia.

Principio: cuando el riesgo depende del entorno real, la evidencia también debe provenir del
entorno real autorizado.

---

## 8. Evidencia Funcional Observable

Una prueba no es suficiente solo porque el proceso terminó sin error, el comando devolvió código
exitoso, el test automatizado pasó, o la respuesta técnica tuvo formato válido.

QA o Developer, al ejecutar, deben procurar evidencia funcional observable que demuestre que el
comportamiento esperado ocurrió: salida funcional legible, estado visible, dato persistido,
cambio verificable en el sistema, respuesta consistente con la regla de negocio, registro o
artefacto generado, comportamiento comprobado antes y después de la acción.

La evidencia debe estar vinculada al criterio de aceptación.

Evitar: confundir ausencia de error con éxito funcional; validar solo implementación interna;
aceptar señales indirectas cuando existe una comprobación directa razonable; declarar cierre sin
evidencia suficiente.

Principio: el testing debe demostrar comportamiento, no solamente ejecución.

---

## 9. Evidencia de Escritura Externa

Cuando el sistema realice escrituras fuera de su propio proceso o memoria local (base de datos,
archivos, sistemas de terceros, colas, eventos, configuración operativa), la validación debe
confirmar que el efecto externo ocurrió realmente.

No es suficiente validar solo que se construyó una solicitud, se invocó una función, se recibió
una respuesta sin error, o se registró un mensaje interno de éxito.

Cuando sea seguro y viable, QA o Developer, al ejecutar, deben buscar evidencia posterior a la
escritura: lectura de confirmación, consulta del estado actualizado, verificación del recurso
creado o modificado, comprobación de persistencia, correlación mediante identificadores.

La estrategia —definida por Planning en el Test Plan— debe considerar: idempotencia, duplicados,
consistencia eventual, permisos, rollback o limpieza cuando aplique, seguridad del ambiente.

Principio: una escritura externa se considera validada cuando existe evidencia del efecto
producido, no solo del intento realizado.

---

## 10. Seguridad de Producción en Testing

Esta regla no repite la Regla 9 de `03-AI-CONSTITUTION.md` (autorización humana explícita para
cualquier acción sobre producción) — la complementa con lo específico de testing: cuando una
validación autorizada deba ejecutarse sobre un ambiente sensible, QA o Developer deben minimizar
superficie, usar datos controlados cuando sea posible, declarar el efecto esperado, evitar
duplicados, confirmar resultado, y considerar rollback o limpieza.

La necesidad de evidencia nunca justifica una operación insegura.

---

# Test Levels

La profundidad del testing debe ser proporcional al riesgo. Planning selecciona el nivel al
diseñar el Test Plan de cada Feature. Los niveles indican alcance y rigurosidad — no sustituyen la
necesidad de definir propósito, resultado esperado y evidencia.

## L1 — Smoke Test

Confirmación mínima. Usar para: UI, cambios visuales, fixes pequeños, comportamiento aislado,
disponibilidad básica de una función. Alcance mínimo.

## L2 — Targeted Test

Validación funcional puntual. Usar para: lógica localizada, APIs puntuales, componentes
afectados, reglas funcionales acotadas, integraciones específicas con superficie controlada.
Alcance controlado — debería ser el modo más frecuente.

## L3 — Regression Test

Confirmar estabilidad razonable. Usar cuando lógica compartida, backend central, dependencias
relevantes, impacto transversal, reglas de negocio reutilizables puedan verse afectadas, o exista
un defecto con riesgo razonable de repetición. Alcance moderado y justificado — no implica
ejecutar toda la historia de pruebas del proyecto.

## L4 — Full Validation

Cobertura amplia. Usar únicamente para: cambios mayores, releases críticos, modificaciones
arquitectónicas significativas, áreas de alto riesgo, o cuando el Approval Model
(`06-DELIVERY-WORKFLOW.md`) lo exija explícitamente. No es comportamiento baseline.

---

# Test Plan

Planning declara esto como parte del Test Plan, antes de que QA o Developer ejecuten testing:
Objetivo, Alcance, Nivel de testing, Ambiente, Escenarios, Resultado esperado, Evidencia
requerida, Criterio de éxito. Cuando existan escrituras externas, agrega: Efecto externo esperado,
Método de confirmación, Consideraciones de seguridad, idempotencia o limpieza.

---

# Evidencia de Validación

La evidencia debe ser proporcional al riesgo y al tipo de comportamiento validado: resultado de
tests automatizados, salida de consola, captura de interfaz, respuesta de integración, lectura
posterior de datos, archivo generado, registro operativo, comparación antes y después.

Cada evidencia debe responder al menos una pregunta: ¿qué comportamiento demuestra?, ¿qué riesgo
reduce?, ¿qué criterio de aceptación confirma?, ¿qué efecto externo verifica?

La evidencia no debe exponer: credenciales, secretos, datos sensibles innecesarios, información
productiva no autorizada.

---

# ⚙️ PROJECT CONFIGURATION — Configuración Editable por Producto Gestionado

Esta sección la completa **Architect**, una sola vez, al configurar el producto gestionado (no
Planning, y no por Feature) — ver `03-AI-CONSTITUTION.md`, Regla 10, Ownership de Artefactos.
Planning trabaja dentro de estos límites ya fijados al diseñar cada Test Plan.

## Default Test Level

[Editable por producto] — L1, L2 o L3. El nivel por defecto puede elevarse cuando el riesgo real
del cambio lo justifique.

## Áreas de Validación Sensibles

[Editable por producto] — áreas que requieren testing reforzado. Ejemplos: Authentication,
Billing, Database, Infra, Security, Shared services, External writes, Integrations.

## Ambientes de Testing Autorizados

[Editable por producto] — ejemplos: Local, Dev, QA, Staging, Controlled production validation.
Debe quedar explícito: qué ambientes permiten lectura, qué ambientes permiten escritura, qué datos
pueden utilizarse, qué autorización requiere cada ambiente.

## Requisitos de Evidencia

[Editable por producto] — evidencia mínima según tipo de cambio. Ejemplos: test automatizado,
evidencia funcional observable, captura de interfaz, confirmación de persistencia, lectura
posterior de una escritura externa.

## Criterios de Retención de Regresión

[Editable por producto] — qué escenarios se conservan como regresiones permanentes. Criterios
sugeridos: protege una regla de negocio reutilizable, protege una decisión arquitectónica, cubre
un defecto con riesgo razonable de repetición, evita una falla de alto impacto, representa un
contrato estable del sistema. No conservar automáticamente todos los escenarios ejecutados durante
Development.

---

# 🧩 OPTIONAL EXTENSIONS

Activadas por **Architect**, al configurar el producto — mismo criterio que la sección anterior.

## API Documentation First Mode

[Optional] — cuando exista integración externa, consultar documentación, validar contratos,
confirmar operaciones soportadas, evitar supuestos. La documentación prevalece sobre inferencias,
pero no reemplaza la validación en ambiente real cuando el riesgo depende de permisos,
configuración o comportamiento operativo.

## Test Budget Mode

[Optional] — el producto puede limitar profundidad, tiempo, alcance, ciclos de testing, cantidad
de ambientes, volumen de evidencia. El presupuesto no debe eliminar validaciones necesarias para
riesgos críticos.

## Strict Validation Mode

[Optional] — declarar evidencia, registrar validación, justificar cobertura, diferenciar ejecución
técnica de éxito funcional, confirmar escrituras externas cuando existan. Útil en sistemas
críticos.

## Cache Awareness Mode

[Optional] — considerar cache local, cache browser, cache deploy, persistencia temporal,
consistencia eventual, antes de concluir defectos funcionales.

## Real Environment Validation Mode

[Optional] — el producto puede exigir validación en un ambiente real autorizado para
determinadas categorías de cambio (integraciones externas, autenticación, permisos, persistencia,
instalación o distribución, configuración operativa). Debe definirse: ambiente autorizado, datos
permitidos, operaciones permitidas, evidencia requerida, mecanismo de limpieza o rollback cuando
aplique.

## External Write Verification Mode

[Optional] — toda operación que produzca cambios fuera del proceso local debe incluir una
comprobación posterior (inmediata, eventual, manual o automatizada según la naturaleza del
sistema). QA o Developer, al ejecutar, deben documentar cualquier limitación que impida confirmar
directamente el efecto externo.

---

# Principios de Testing

1. Propósito
2. Precisión
3. Evidencia
4. Proporcionalidad
5. Seguridad
6. Cobertura

Más testing no implica mejor testing. La evidencia debe demostrar el comportamiento aprobado con
el menor alcance suficiente.