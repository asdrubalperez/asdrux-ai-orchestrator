# 06-DELIVERY-WORKFLOW.md

# Delivery Workflow

Versión: v1.1

## Propósito

Este documento define el workflow obligatorio que debe seguir la AI durante el ciclo de delivery de software.

Su objetivo es asegurar:

* trabajo estructurado
* decisiones conscientes
* menor retrabajo
* control de cambios
* validación consistente
* releases previsibles

La AI no debe omitir etapas salvo instrucción humana explícita.

---

# 🔒 BASELINE — Workflow Core

Estas etapas forman parte del baseline permanente del Playbook.

No deberían modificarse salvo evolución del propio estándar.

---

# Stage 1 — Discovery

Objetivo:

Comprender el problema antes de proponer soluciones.

La AI debe:

* entender necesidad funcional
* identificar alcance
* detectar restricciones
* aclarar ambigüedades
* identificar riesgos tempranos

Evitar:

* asumir requisitos
* diseñar prematuramente
* comenzar implementación

Entregable esperado:

Definición clara del problema.

---

# Stage 2 — Architecture & Design

Objetivo:

Diseñar antes de implementar.

La AI debe:

* proponer enfoque
* explicar arquitectura
* identificar componentes
* evaluar impacto
* presentar alternativas cuando existan

Evitar:

* implementación temprana
* cambios no aprobados
* diseño implícito

Formato recomendado:

Problema

Opciones

Recomendación

Impacto

Riesgos

Entregable esperado:

Diseño entendible y revisable.

---

# Stage 3 — Approval Gate

Objetivo:

Establecer un checkpoint obligatorio antes del Development.

La AI debe:

* esperar aprobación humana
* confirmar entendimiento
* pausar implementación

No debe:

* asumir aprobación
* avanzar por iniciativa propia

Principio:

Diseño aprobado antes de Development.

Entregable esperado:

Go / No-Go explícito.

---

# Stage 4 — Controlled Development

Objetivo:

Implementar de forma controlada.

La AI debe:

* aplicar cambios mínimos
* mantener scope controlado
* respetar arquitectura
* preservar backward compatibility

Evitar:

* refactor no aprobado
* cambios laterales
* modificaciones oportunistas

Formato recomendado:

Objetivo

Archivos afectados

Plan

Implementación

Impacto

Entregable esperado:

Cambio localizado y entendible.

---

# Stage 5 — Validation & QA

Objetivo:

Validar sin testing innecesario.

La AI debe:

* seguir política de testing aprobada
* ejecutar validación dirigida
* confirmar resultado esperado
* detectar regresiones relevantes

Evitar:

* testing masivo
* loops innecesarios
* validación improvisada
* exploración excesiva

Principio:

Testing con propósito.

Entregable esperado:

Resultado validado.

---

# Stage 6 — Release & Deployment

Objetivo:

Liberar cambios de forma disciplinada.

La AI debe:

* identificar impacto de release
* verificar readiness
* considerar cache
* explicar dependencias relevantes

Evitar:

* deploy implícito
* producción sin autorización
* cambios silenciosos

Entregable esperado:

Release entendible y controlado.

---

## Disciplina de Branching (activa para este proyecto)

Basado en la regla "una feature por branch" de 03-AI-CONSTITUTION.md (Strict Change Mode) — se activa esta regla puntual sin activar el modo completo.

* Cada Feature vive en su propia rama, creada desde `main` al aprobarse (Approval Gate).
* Todo el trabajo de esa Feature —spec, implementación, evidencia— se commitea en esa rama.
* Al cerrar la Feature, se mergea a `main` sin dejar merges pendientes acumulados de más de una Feature a la vez.

**Sobre cuándo pushear el merge a `main` — dos escenarios distintos, no confundir:**

* **Hoy (desarrollo temprano, sin CI, sin nada desplegado desde `main`)**: push inmediato después de cada merge. El costo de un error es bajo — no hay producción ni pipeline que dependa de `main` en este momento.
* **Una vez que exista CI/CD real, o que algo desplegado dependa de `main`**: el push deja de ser automático. Antes de pushear un merge, debe confirmarse "readiness" explícito — que la validación de la Feature (Stage 5) haya pasado, y si existe pipeline de CI, que corra en verde. El humano decide el momento del push a `main`, no se asume.

**Disparador para endurecer esta regla**: la primera vez que se configure CI/CD (sección "Deployment Strategy" de `02-ARCHITECTURE.md`, hoy `[Pendiente]`) o la primera vez que algo en producción lea de `main`, esta sección debe actualizarse para reflejar el gate real — no seguir con "push inmediato" por inercia.

---

# Stage 7 — Post-Release Review

Objetivo:

Aprender y estabilizar.

La AI debe:

* resumir cambios
* identificar hallazgos
* registrar lessons learned
* proponer mejoras futuras cuando agreguen valor

Las lessons learned deben clasificarse según su naturaleza y alcance:

* conocimiento permanente del Playbook
* decisiones de arquitectura del proyecto
* conocimiento específico de una Feature o implementación

Solo el conocimiento verdaderamente reusable entre proyectos debe proponerse para evolucionar el Playbook.

Las decisiones arquitectónicas deben permanecer en la documentación del proyecto correspondiente.

Los hallazgos específicos de una Feature o implementación deben conservarse en su contexto original y no trasladarse automáticamente al baseline.

Evitar:

* asumir cierre prematuro
* ignorar efectos posteriores

Entregable esperado:

Feedback útil para futuras iteraciones.

---

# ⚙️ PROJECT CONFIGURATION — Configuración Editable

Estas reglas pueden adaptarse según proyecto.

---

## Workflow Rigidity

[Editable]

Define cuán estricto será el workflow.

Suggested modes:

Light

* approval flexible
* menor formalidad

Standard

* workflow recomendado
* checkpoints normales

Strict

* approval obligatorio
* validación explícita
* mayor control

Cada proyecto puede elegir su rigor.

---

## Approval Model

[Editable]

Posibles configuraciones:

Single Approval

* una aprobación humana

Multi Approval

* múltiples validaciones
* arquitectura + implementación

Risk-Based Approval

* rigor proporcional al riesgo

La AI debe respetar el modelo definido.

---

## Release Strategy

[Editable]

Ejemplos:

* manual deploy
* CI/CD
* staged release
* canary
* rollback policy

La AI debe alinearse con la estrategia aprobada.

---

# 🧩 OPTIONAL EXTENSIONS — Extensiones Opcionales

---

## Sprint Mode

[Optional]

Workflow adaptado a ciclos iterativos.

La AI debe:

* trabajar por sprint
* definir scope acotado
* cerrar objetivos concretos

Útil en desarrollo incremental.

---

## Parking Lot Mode

[Optional]

Ideas o mejoras fuera de scope deben:

* registrarse
* documentarse
* no implementarse automáticamente

Útil para controlar scope creep.

---

## Change Freeze Mode

[Optional]

La AI debe:

* evitar cambios fuera de fixes críticos
* respetar freeze windows
* minimizar riesgo operativo

Útil antes de releases importantes.

---

# Principios del Workflow

Orden de prioridad:

1. Comprender
2. Diseñar
3. Aprobar
4. Implementar
5. Validar
6. Liberar
7. Aprender

La velocidad nunca debe prevalecer sobre el control.
