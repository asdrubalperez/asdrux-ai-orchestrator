# 06-DELIVERY-WORKFLOW.md

# Delivery Workflow — Runbook

Versión: v0.1 (borrador de diseño, pendiente de aprobación)

## Propósito

Este documento define el workflow obligatorio que el pipeline del Orquestador sigue **por
Release** (un conjunto acotado de Features que se construyen y mergean secuencialmente), dentro
de un producto gestionado que ya tiene Project Brief y Architecture vigentes (`01`, `02`). No
repite el trabajo de Architect al inicio del proyecto — rige el ciclo Functional → Planning →
Developer → QA → Release del release activo, más el Approval Model automático y el circuito de
escalamiento que reemplazan la espera de aprobación humana paso a paso.

Si el business case no requiere dividirse en releases (`02-ARCHITECTURE-TEMPLATE.md`, sección 0
en No Aplica), todo el proyecto es, en los hechos, un único release — el workflow no cambia.

Ningún rol omite etapas salvo lo que el Approval Model o una instrucción humana explícita
autoricen.

---

# 🔒 BASELINE — Workflow Core

Estas etapas forman parte del baseline permanente del Runbook. No deberían modificarse entre
productos gestionados salvo evolución del propio Runbook.

---

# Stage 1 — Discovery

Dueño del entregable: **Functional**

Objetivo: comprender el release activo dentro del Project Brief y la Architecture ya vigentes —
no se vuelve a discutir el proyecto completo.

Functional debe, para **todas las Features del release activo** (o del proyecto completo, si no
existe Roadmap de Releases):

* entender la necesidad funcional de cada Feature
* identificar su alcance dentro de lo ya definido en Architecture
* detectar restricciones
* aclarar ambigüedades — si son genuinamente declarativas (ver `01-PROJECT-BRIEF-TEMPLATE.md`,
  sección 0), consolidar y escalar; si son investigables, resolverlas explorando
* identificar riesgos tempranos
* leer la sección de Lecciones Aprendidas de la Feature inmediatamente anterior antes de
  iniciar Discovery, si existe
* definir, como mínimo, 3 escenarios de prueba por Feature que sirvan de input al Test Plan de
  Planning: un caso feliz, un caso no feliz, y un caso intermedio — simulables, con base en el
  comportamiento de negocio esperado

Evitar: asumir requisitos, diseñar la solución técnica (eso es Planning), comenzar
implementación.

Entregable esperado: definición funcional clara de cada Feature del release activo.

---

# Stage 2 — Planning

Dueño del entregable: **Planning**

Objetivo: organizar el release y diseñar el cómo de cada Feature, antes de implementar — sin
redefinir la Architecture vigente.

Planning debe, primero, con todas las Features del release activo que Functional entregó:

* organizar el **Release Plan**: secuencia en la que se van a implementar las Features de este
  release
* evaluar si el release resulta demasiado grande — si el riesgo es real, escala al humano (ver
  Regla 8 de `03-AI-CONSTITUTION.md`) antes de continuar; si no, sigue con el resto de este Stage

Luego, para cada Feature del Release Plan:

* proponer el enfoque técnico dentro de la Architecture ya fijada por Architect
* identificar componentes afectados
* evaluar impacto
* presentar alternativas cuando existan
* diseñar el Test Plan de la Feature, siguiendo `04-TESTING-POLICY.md`, partiendo como mínimo de
  los 3 escenarios (caso feliz, no feliz, intermedio) que Functional entregó en Stage 1

Todo esto —secuencia, enfoque técnico y Test Plan de cada Feature— se documenta en un único
artefacto: el Release Plan (`09-RELEASE-PLAN-TEMPLATE.md`), no en documentos separados.

Evitar: cambiar la Architecture vigente sin escalar (ver Regla 2 de `03-AI-CONSTITUTION.md`),
implementación temprana, diseño implícito.

Entregable esperado: Release Plan del release activo (`09`), completo para todas sus Features.

---

# Stage 3 — Approval Gate (Approval Model Automático)

Objetivo: checkpoint obligatorio antes de Development, resuelto por defecto **sin esperar a un
humano** — la espera es la excepción, no la regla.

Mecanismo: el pipeline avanza automáticamente a Development salvo que se dispare alguno de los
criterios de escalamiento ya definidos en la Regla 8 de `03-AI-CONSTITUTION.md` (cambio
arquitectónico, requisito ambiguo, riesgo relevante) o un dato genuinamente declarativo pendiente
(`01-PROJECT-BRIEF-TEMPLATE.md`, sección 0). Si ninguno se dispara, hay Go automático.

Si se dispara un escalamiento: el circuito entra siempre por Architect (camino único, ver Regla
10 de `03-AI-CONSTITUTION.md`) y avanza en el orden normal de este mismo workflow hasta llegar al
dueño real que corresponde resolver el hallazgo, llevando consigo los hallazgos que registró el
agente de origen (el mecanismo concreto de persistencia de ese contexto entre reinicios queda
pendiente de diseño técnico — no bloquea el resto de este documento).

### Cuándo este circuito escala al humano

El circuito de escalamiento con reinicio no está pensado para dar vueltas indefinidamente. Escala
al humano cuando ocurra cualquiera de estas dos condiciones:

* **Tope duro: 3 pasadas completas del circuito** para el mismo hallazgo, sin llegar a
  resolución — mismo criterio de rigidez que el tope de Developer↔QA (Stage 5), no configurable
  por producto sin decisión explícita.
* **Hallazgo repetido**: el circuito detecta que el mismo hallazgo vuelve a presentarse sin haber
  sido resuelto en el camino (nadie a lo largo de la cadena lo corrigió) — esto escala de
  inmediato, sin esperar a agotar el tope de 3, porque es una señal más fuerte de que nadie se está
  haciendo cargo que solo contar intentos.

Ambos mecanismos dependen del mismo diseño técnico de persistencia de contexto que ya quedó
pendiente arriba — no se pueden implementar sin resolver primero cómo se lleva el hallazgo de un
paso al siguiente.

No debe: asumir aprobación de algo que sí requiere escalar; avanzar por iniciativa propia cuando
el Approval Model indica detenerse.

Entregable esperado: Go automático, o escalamiento con contexto claro de qué lo disparó.

---

# Stage 4 — Controlled Development

Dueño del entregable: **Developer**

Objetivo: implementar de forma controlada, dentro del enfoque técnico ya aprobado en el Release
Plan (`09-RELEASE-PLAN-TEMPLATE.md`).

Developer debe: aplicar cambios mínimos, mantener scope controlado, respetar la Architecture
vigente, preservar backward compatibility, seguir `05-CODING-STANDARDS.md`.

Evitar: refactor no aprobado, cambios laterales, modificaciones oportunistas (ver Reglas 3, 4 y 7
de `03-AI-CONSTITUTION.md`).

Entregable esperado: cambio localizado y entendible.

---

# Stage 5 — Validation & QA

Dueño del entregable: **QA**, ejecutando contra el Test Plan que Planning diseñó en Stage 2.

QA debe: seguir el Test Plan (no reinterpretar `04-TESTING-POLICY.md` por su cuenta — ver
encabezado de ese documento), ejecutar validación dirigida, confirmar resultado esperado,
detectar regresiones relevantes según lo que el Test Plan haya definido.

## Loop Developer ↔ QA

Si QA encuentra que el resultado no cumple lo esperado, vuelve a Developer con el hallazgo
puntual — no todo el ciclo se reinicia desde Functional o Planning por un fallo de QA.

**Tope duro: 3 reintentos.** Agotado el tercero sin que QA confirme el resultado esperado, el
loop no continúa indefinidamente — escala, entrando por Architect según el mecanismo de Stage 3.
No es configurable por producto sin una decisión explícita que lo autorice — mismo criterio de
rigidez que usa hoy este propio repo para sí mismo.

Evitar: testing masivo, loops innecesarios más allá del tope, validación improvisada, exploración
excesiva.

Entregable esperado: resultado validado, o escalamiento tras agotar el tope de reintentos.

---

# Stage 6 — Release & Deployment

Objetivo: liberar cambios de forma disciplinada, con la menor intervención humana posible sin
comprometer el único punto que es innegociable: la Regla 9 de `03-AI-CONSTITUTION.md` (producción
requiere autorización humana explícita, siempre, sin excepción, en cualquier modo).

## Estructura de ramas del producto gestionado

El producto gestionado tiene su propia rama principal (análoga a `main` de un repo cualquiera).
Cada Feature vive en su propia sub-rama, creada desde esa rama principal al recibir Go en Stage 3.
Todo el trabajo de la Feature —spec, plan, implementación, evidencia, Lecciones Aprendidas— se
commitea en esa sub-rama, nunca directo en la rama principal.

## Modos de operación (Nivel de Rigor del Approval Model, ver `03-AI-CONSTITUTION.md`)

Hoy, fijo — decidido por Architect al configurar el producto (o, hasta que la parametrización de
modelos esté disponible, fijado por quienes operan el Orquestador como producto). A futuro,
parametrizable — ver ítem Tentativo del Roadmap.

**Modo A (default hoy)**: el Orquestador automatiza todo hasta el push de la sub-rama de la
Feature. Antes de mergear esa sub-rama a la rama principal del producto, un humano revisa.

**Modo Auto**: el Orquestador también ejecuta el merge a la rama principal automáticamente, sin
revisión humana intermedia. El único punto que sigue siendo siempre humano, en cualquier modo, es
la promoción de la rama principal a producción real (deploy), por la Regla 9 de `03`.

Pasos obligatorios, en orden, sin saltar ni combinar:

1. Commit del trabajo en la sub-rama de la Feature, incluyendo Lecciones Aprendidas (ver Stage 7).
2. Push de la sub-rama.
3. Según el modo vigente: esperar revisión humana (Modo A) o proceder directo (Modo Auto).
4. Checkout a la rama principal del producto.
5. Merge de la sub-rama hacia la rama principal — sin dejar merges pendientes acumulados de más
   de una Feature a la vez.
6. Push de la rama principal.

La promoción de la rama principal a producción real es un paso **separado y siempre humano**,
fuera de esta secuencia — no ocurre como consecuencia automática del paso 6.

Evitar: deploy implícito, producción sin autorización, cambios silenciosos.

Entregable esperado: release entendible y controlado, con historial de la rama principal que
refleja fielmente el orden real de merges.

---

## Ciclo de Features dentro de un Release

Al completar el paso 6 de la secuencia de branching para una Feature, Developer consulta el
Release Plan de Planning (Stage 2):

* **Si hay una Feature siguiente en el Release Plan**: el ciclo vuelve a Stage 4 con esa Feature
  siguiente — no se repiten Stage 1 ni Stage 2 completos, porque Functional y Planning ya
  trabajaron sobre todas las Features del release al principio.
* **Si el release está completo**: recién ahí se pasa a Stage 7 para cerrar ese release.

Este ciclo se repite Stage 4 → 5 → 6 → (consulta) tantas veces como Features tenga el Release Plan,
o hasta que algo lo interrumpa (escalamiento, tope de reintentos agotado, o instrucción humana
explícita).

---

# Stage 7 — Post-Release Review

Objetivo: aprender y estabilizar.

Cada rol registra, antes del paso 2 de la secuencia de Stage 6, las Lecciones Aprendidas de su
propia parte de la Feature, clasificadas en:

* conocimiento permanente del Runbook
* decisiones de arquitectura del producto gestionado
* conocimiento específico de esta Feature o implementación

Solo el conocimiento verdaderamente reusable entre productos gestionados se propone para
evolucionar el Runbook — y esa evolución no es autónoma: sigue el mismo criterio de gobernanza
que usamos nosotros para este propio Runbook (revisión humana antes de aplicarse). Las decisiones
de arquitectura permanecen en la Architecture del producto correspondiente (`02`). Los hallazgos
específicos de una Feature se conservan en su contexto original, sin trasladarse automáticamente
al baseline.

Evitar: asumir cierre prematuro, ignorar efectos posteriores.

Entregable esperado: feedback útil para la próxima Feature, y candidatos a evolución del Runbook
si corresponde.

## Cierre del Release y Release Siguiente

Al cerrar Stage 7 para el release activo, se consulta el Roadmap de Releases de Architect
(`02-ARCHITECTURE-TEMPLATE.md`, sección 0):

* **Si no existe Roadmap de Releases** (el proyecto siempre fue un único release): el proyecto
  queda cerrado en este punto.
* **Si existe y hay un release siguiente**: se escala a Architect, quien a su vez escala al
  humano para dar curso (mismo criterio que la aprobación inicial del Roadmap) — no se asume
  continuidad automática entre releases.
* **Si existe y no hay más releases pendientes**: el proyecto queda cerrado.

---

# ⚙️ PROJECT CONFIGURATION — Configuración Editable por Producto Gestionado

Esta sección la completa **Architect**, una sola vez, al configurar el producto gestionado (ver
`03-AI-CONSTITUTION.md`, Regla 10, Ownership de Artefactos).

---

## Release Strategy

[Editable por producto — decidido por Architect]

Ejemplos: manual deploy, CI/CD, staged release, canary, rollback policy. El resto del pipeline
debe alinearse con la estrategia definida acá.

---

# 🧩 OPTIONAL EXTENSIONS

Activadas por **Architect**, al configurar el producto.

---

## Sprint Mode

[Optional] — workflow adaptado a ciclos iterativos: trabajar por sprint, definir scope acotado,
cerrar objetivos concretos por sprint. Útil en desarrollo incremental.

## Parking Lot Mode

[Optional] — ideas o mejoras fuera de scope se registran y documentan, no se implementan
automáticamente. Útil para controlar scope creep.

## Change Freeze Mode

[Optional] — evitar cambios fuera de fixes críticos, respetar freeze windows, minimizar riesgo
operativo. Útil antes de releases importantes del producto gestionado.

---

# Principios del Workflow

1. Comprender
2. Diseñar
3. Aprobar (automático por defecto)
4. Implementar
5. Validar
6. Liberar
7. Aprender

La velocidad nunca debe prevalecer sobre el control — pero el control tampoco depende, por
default, de que un humano confirme cada paso.