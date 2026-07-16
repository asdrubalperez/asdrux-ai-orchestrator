# 04-TESTING-POLICY.md

# Testing Policy

Versión: v1.1

## Propósito

Este documento define las reglas y principios que la AI debe seguir al diseñar, ejecutar o proponer testing sobre un proyecto.

Su objetivo es asegurar:

* testing eficiente
* validación confiable
* evidencia funcional observable
* menor consumo innecesario de ciclos de Dev
* reducción de retrabajo
* control sobre alcance y esfuerzo de validación
* confirmación explícita de efectos externos cuando existan

La AI debe entender que testing es una actividad diseñada, no exploratoria.

---

# 🔒 BASELINE — Reglas Core de Testing

Estas reglas forman parte del baseline permanente del Playbook.

No deberían modificarse salvo evolución del propio estándar.

---

## 1. Purpose-Driven Testing

Todo testing debe tener propósito explícito.

La AI debe identificar:

* qué valida
* por qué lo valida
* qué riesgo intenta reducir
* qué evidencia permitirá concluir que la validación fue exitosa

Evitar:

* testing por costumbre
* validaciones sin objetivo
* exploración innecesaria
* ejecución de pruebas sin criterio de cierre

Principio:

No testear por testear.

---

## 2. Smallest Valid Test

La AI debe preferir:

* menor prueba válida
* menor superficie de validación
* menor costo razonable
* evidencia suficiente para confirmar el comportamiento esperado

Objetivo:

Confirmar comportamiento sin sobredimensionar testing.

Evitar:

* validación excesiva
* auditorías innecesarias
* cobertura desproporcionada
* acumulación automática de escenarios sin riesgo que la justifique

La prueba mínima no debe confundirse con una prueba incompleta.

Debe ser suficientemente precisa para validar el comportamiento aprobado y suficientemente acotada para evitar esfuerzo innecesario.

---

## 3. No Mass Testing by Default

La AI NO debe ejecutar ni proponer:

* testing masivo
* barridos completos
* regression total
* loops extensivos
* exploración indiscriminada

salvo aprobación explícita.

Principio:

Mass testing no es comportamiento por defecto.

Una validación amplia solo se justifica cuando el riesgo, la superficie de cambio o la criticidad del release requieren una cobertura mayor.

---

## 4. Validation Strategy First

Antes de probar, la AI debe definir:

* alcance
* estrategia
* resultado esperado
* criterio de éxito
* evidencia que será observada
* ambiente en el que se realizará la validación

No comenzar testing sin plan entendible.

La estrategia debe permitir distinguir entre:

* ejecución técnica exitosa
* comportamiento funcional correcto
* efecto externo realmente producido

cuando esas dimensiones apliquen.

---

## 5. Regression with Intent

La regresión debe ser proporcional y deliberada.

Validar únicamente:

* componentes afectados
* dependencias relevantes
* riesgos razonables
* reglas de negocio que deban preservarse
* decisiones arquitectónicas protegidas por comportamiento verificable
* defectos con riesgo razonable de repetición

Los escenarios de regresión deben incorporarse únicamente cuando protejan:

* reglas de negocio reutilizables
* decisiones arquitectónicas
* defectos con riesgo razonable de repetición

Debe preferirse el conjunto mínimo de regresiones necesario para preservar el comportamiento aprobado.

No todas las pruebas ejecutadas durante una Feature deben convertirse en regresiones permanentes.

Evitar:

* regression indiscriminada
* expansión automática de alcance
* conservación permanente de escenarios circunstanciales
* duplicación de pruebas que protegen el mismo riesgo
* crecimiento del suite sin valor preventivo claro

Principio:

La regresión es una herramienta de preservación intencional, no un reflejo automático de toda validación pasada.

---

## 6. Explicit Expected Results

Toda validación debe tener resultado esperado.

Formato sugerido:

Escenario

Acción

Esperado

Resultado

Sin esperado explícito, no existe validación real.

El resultado esperado debe ser observable y suficientemente preciso para evitar conclusiones ambiguas.

Cuando exista más de una capa de comportamiento, debe distinguirse entre:

* resultado técnico
* resultado funcional
* efecto externo

---

## 7. Real Environment Validation

Cuando una Feature dependa de integraciones, configuración, infraestructura, permisos, datos reales o comportamiento de sistemas externos, la validación local o simulada puede no ser suficiente.

La AI debe identificar cuándo corresponde validar en un ambiente real autorizado.

Real Environment Validation puede incluir:

* ejecución contra una integración real
* uso de configuración representativa
* validación de credenciales o permisos autorizados
* comprobación de contratos externos
* confirmación de comportamiento bajo condiciones operativas reales

La validación en ambiente real debe ser:

* intencional
* acotada
* segura
* autorizada
* reproducible cuando sea razonable

Evitar:

* asumir que mocks o fixtures representan completamente el sistema externo
* declarar éxito basándose únicamente en ejecución local cuando el riesgo está en la integración
* utilizar producción sin aprobación explícita
* realizar operaciones irreversibles para obtener evidencia

Principio:

Cuando el riesgo depende del entorno real, la evidencia también debe provenir del entorno real autorizado.

---

## 8. Observable Functional Evidence

Una prueba no debe considerarse suficiente únicamente porque:

* el proceso terminó sin error
* el comando devolvió código exitoso
* el test automatizado pasó
* la respuesta técnica tuvo formato válido

La AI debe procurar evidencia funcional observable que demuestre que el comportamiento esperado ocurrió.

La evidencia puede consistir en:

* salida funcional legible
* estado visible en la interfaz
* dato persistido
* cambio verificable en el sistema
* respuesta consistente con la regla de negocio
* registro o artefacto generado
* comportamiento comprobado antes y después de la acción

La evidencia debe estar vinculada al criterio de aceptación.

Evitar:

* confundir ausencia de error con éxito funcional
* validar solo implementación interna
* aceptar señales indirectas cuando existe una comprobación directa razonable
* declarar cierre sin evidencia suficiente

Principio:

El testing debe demostrar comportamiento, no solamente ejecución.

---

## 9. External Write Evidence

Cuando el sistema realice escrituras fuera de su propio proceso o memoria local, la validación debe confirmar que el efecto externo ocurrió realmente.

Una escritura externa puede incluir:

* persistencia en una base de datos
* creación o modificación de archivos
* actualización de un sistema de terceros
* publicación de mensajes o eventos
* cambios en colas, almacenamiento o servicios remotos
* modificación de configuración o estado operativo

No es suficiente validar únicamente que:

* se construyó una solicitud
* se invocó una función
* se recibió una respuesta sin error
* se registró un mensaje interno de éxito

Cuando sea seguro y viable, la AI debe buscar evidencia posterior a la escritura, por ejemplo:

* lectura de confirmación
* consulta del estado actualizado
* verificación del recurso creado o modificado
* comprobación de persistencia
* correlación mediante identificadores o evidencia equivalente

La estrategia debe considerar:

* idempotencia
* duplicados
* consistencia eventual
* permisos
* rollback o limpieza cuando aplique
* seguridad del ambiente

Principio:

Una escritura externa se considera validada cuando existe evidencia del efecto producido, no solo del intento realizado.

---

## 10. Production Safety

La AI debe tratar testing sobre ambientes sensibles con criterio conservador.

Evitar:

* acciones destructivas
* datos productivos
* modificaciones irreversibles
* operaciones no autorizadas
* escrituras externas sin mecanismo de control

Producción requiere aprobación explícita.

Cuando una validación autorizada deba ejecutarse sobre un ambiente sensible, la AI debe:

* minimizar superficie
* utilizar datos controlados cuando sea posible
* declarar el efecto esperado
* evitar duplicados
* confirmar resultado
* considerar rollback o limpieza

La necesidad de evidencia nunca justifica una operación insegura.

---

# Test Levels

La profundidad del testing debe ser proporcional al riesgo.

Los niveles indican alcance y rigurosidad.

No sustituyen la necesidad de definir propósito, resultado esperado y evidencia.

---

## L1 — Smoke Test

Objetivo:

Confirmación mínima.

Usar para:

* UI
* cambios visuales
* fixes pequeños
* comportamiento aislado
* disponibilidad básica de una función

Alcance:

Mínimo.

La evidencia debe confirmar que el comportamiento principal está disponible y no presenta una falla inmediata.

---

## L2 — Targeted Test

Objetivo:

Validación funcional puntual.

Usar para:

* lógica localizada
* APIs puntuales
* componentes afectados
* reglas funcionales acotadas
* integraciones específicas con superficie controlada

Alcance:

Controlado.

Este debería ser el modo más frecuente.

Debe incluir evidencia funcional observable y, cuando corresponda, confirmación de efectos externos.

---

## L3 — Regression Test

Objetivo:

Confirmar estabilidad razonable.

Usar cuando:

* lógica compartida
* backend central
* dependencias relevantes
* impacto transversal
* reglas de negocio reutilizables puedan verse afectadas
* exista un defecto con riesgo razonable de repetición

Alcance:

Moderado y justificado.

La selección de escenarios debe proteger el comportamiento aprobado con el conjunto mínimo de regresiones necesario.

No implica ejecutar toda la historia de pruebas del proyecto.

---

## L4 — Full Validation

Objetivo:

Cobertura amplia.

Usar únicamente:

* cambios mayores
* releases críticos
* modificaciones arquitectónicas significativas
* áreas de alto riesgo
* aprobación explícita

No es comportamiento baseline.

Debe existir justificación clara de alcance, ambientes, costo y criterio de cierre.

---

# Test Plan Template

Antes de ejecutar testing, la AI debe declarar:

1. Objetivo
2. Alcance
3. Nivel de testing
4. Ambiente
5. Escenarios
6. Resultado esperado
7. Evidencia requerida
8. Criterio de éxito

Formato recomendado:

Objetivo

Alcance

Nivel

Ambiente

Escenarios

Esperado

Evidencia

Criterio de éxito

Cuando existan escrituras externas, agregar:

Efecto externo esperado

Método de confirmación

Consideraciones de seguridad, idempotencia o limpieza

---

# Evidencia de Validación

La evidencia debe ser proporcional al riesgo y al tipo de comportamiento validado.

Puede incluir:

* resultado de tests automatizados
* salida de consola
* captura de interfaz
* respuesta de integración
* lectura posterior de datos
* archivo generado
* registro operativo
* comparación antes y después

La AI debe evitar acumular evidencia sin propósito.

Cada evidencia debe responder al menos una de estas preguntas:

* ¿Qué comportamiento demuestra?
* ¿Qué riesgo reduce?
* ¿Qué criterio de aceptación confirma?
* ¿Qué efecto externo verifica?

La evidencia no debe exponer:

* credenciales
* secretos
* datos sensibles innecesarios
* información productiva no autorizada

---

# ⚙️ PROJECT CONFIGURATION — Configuración Editable

Estas reglas pueden variar según proyecto.

---

## Default Test Level

[Editable]

Modo por defecto del proyecto.

Suggested:

L1

L2

L3

La AI debe respetar el baseline definido.

El nivel por defecto puede elevarse cuando el riesgo real del cambio lo justifique.

---

## Sensitive Validation Areas

[Editable]

Áreas que requieren testing reforzado.

Ejemplos:

* Authentication
* Billing
* Database
* Infra
* Security
* Shared services
* External writes
* Integrations

La AI debe incrementar rigurosidad en estas zonas.

---

## Approved Test Environments

[Editable]

Ejemplos:

* Local
* Dev
* QA
* Staging
* Controlled production validation

La AI debe respetar ambientes autorizados.

Debe quedar explícito:

* qué ambientes permiten lectura
* qué ambientes permiten escritura
* qué datos pueden utilizarse
* qué aprobación requiere cada ambiente

---

## Evidence Requirements

[Editable]

El proyecto puede definir evidencia mínima según tipo de cambio.

Ejemplos:

* test automatizado
* evidencia funcional observable
* captura de interfaz
* confirmación de persistencia
* lectura posterior de una escritura externa
* validación por usuario

La AI debe utilizar únicamente la evidencia necesaria para confirmar el comportamiento aprobado.

---

## Regression Retention Criteria

[Editable]

El proyecto puede definir qué escenarios deben conservarse como regresiones permanentes.

Criterios sugeridos:

* protege una regla de negocio reutilizable
* protege una decisión arquitectónica
* cubre un defecto con riesgo razonable de repetición
* evita una falla de alto impacto
* representa un contrato estable del sistema

No conservar automáticamente todos los escenarios ejecutados durante Development.

---

# 🧩 OPTIONAL EXTENSIONS — Extensiones Opcionales

---

## API Documentation First Mode

[Optional]

Cuando exista integración externa, la AI debe:

* consultar documentación
* validar contratos
* confirmar operaciones soportadas
* evitar supuestos

Principio:

La documentación prevalece sobre inferencias.

La documentación no reemplaza la validación en ambiente real cuando el riesgo depende de permisos, configuración o comportamiento operativo.

---

## Test Budget Mode

[Optional]

El proyecto puede limitar:

* profundidad
* tiempo
* alcance
* ciclos de testing
* cantidad de ambientes
* volumen de evidencia

Útil cuando existen restricciones de costo o créditos.

El presupuesto no debe eliminar validaciones necesarias para riesgos críticos.

---

## Strict Validation Mode

[Optional]

La AI debe:

* declarar evidencia
* registrar validación
* justificar cobertura
* diferenciar ejecución técnica de éxito funcional
* confirmar escrituras externas cuando existan

Útil en sistemas críticos.

---

## Cache Awareness Mode

[Optional]

La AI debe considerar:

* cache local
* cache browser
* cache deploy
* persistencia temporal
* consistencia eventual

antes de concluir defectos funcionales.

Útil en sistemas web, integraciones, almacenamiento distribuido y CI/CD.

---

## Real Environment Validation Mode

[Optional]

El proyecto puede exigir validación en un ambiente real autorizado para determinadas categorías de cambio.

Ejemplos:

* integraciones externas
* autenticación
* permisos
* persistencia
* instalación o distribución
* configuración operativa

Debe definirse:

* ambiente autorizado
* datos permitidos
* operaciones permitidas
* evidencia requerida
* mecanismo de limpieza o rollback cuando aplique

---

## External Write Verification Mode

[Optional]

Toda operación que produzca cambios fuera del proceso local debe incluir una comprobación posterior.

La comprobación puede ser:

* inmediata
* eventual
* manual
* automatizada

según la naturaleza del sistema.

La AI debe documentar cualquier limitación que impida confirmar directamente el efecto externo.

---

# Principios de Testing

Orden de prioridad:

1. Propósito
2. Precisión
3. Evidencia
4. Proporcionalidad
5. Seguridad
6. Cobertura

Más testing no implica mejor testing.

La evidencia debe demostrar el comportamiento aprobado con el menor alcance suficiente.
