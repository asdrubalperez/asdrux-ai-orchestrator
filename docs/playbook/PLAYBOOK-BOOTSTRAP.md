# PLAYBOOK-BOOTSTRAP.md

# AI Playbook Bootstrap

Versión: v1.0

## Propósito

Este documento define el proceso obligatorio para inicializar el contexto de trabajo antes de aplicar el AI Playbook.

Su objetivo es:

- comprender el contexto del trabajo;
- determinar el nivel adecuado de gobernanza;
- cargar únicamente los documentos necesarios;
- minimizar fricción durante Discovery.

No debe asumirse automáticamente un modo del Playbook.

---

# Bootstrap Workflow

## Stage 1 — Discovery Inicial

Antes de hablar de repositorios, documentación o implementación:

- escuchar la idea del usuario;
- comprender el problema;
- permitir exploración creativa.

Evitar interrumpir Discovery con preguntas técnicas prematuras.

---

## Stage 2 — Contexto del Proyecto

Cuando exista suficiente contexto, preguntar de forma natural:

> ¿Ya tienes un repositorio para este proyecto?

### Si el usuario responde SÍ

Solicitar la URL del repositorio.

Intentar localizar:

`docs/playbook/AGENTS.md`

#### Si existe

Utilizar el AI Playbook del proyecto.

#### Si no existe

Utilizar temporalmente el AI Playbook Base.

Continuar normalmente la conversación.

Cuando corresponda, preparar un handoff para que el asistente IA de desarrollo inicialice el Playbook en ese repositorio.

---

### Si el usuario responde NO

Utilizar temporalmente el AI Playbook Base.

No exigir crear un repositorio.

Continuar Discovery normalmente.

Cuando el proyecto alcance suficiente madurez, preparar un handoff para que el asistente IA de desarrollo cree el repositorio e inicialice el Playbook.

---

# Stage 3 — Determinar el Playbook Mode

Después de comprender la idea:

1. Inferir el modo recomendado.
2. Explicar brevemente el razonamiento.
3. Solicitar confirmación.

Ejemplo:

> Por lo que describes, parece un proyecto existente. Recomiendo comenzar utilizando Playbook Standard. ¿Te parece correcto?

Si no puede inferirse con suficiente confianza, preguntar:

1. ¿Estamos explorando una idea nueva donde buscamos creatividad y un MVP?
2. ¿Vamos a continuar un proyecto existente?
3. ¿Trabajaremos sobre un sistema maduro donde la gobernanza sea prioritaria?

## Mapeo

Respuesta 1

→ Lite

Respuesta 2

→ Standard

Respuesta 3

→ Full

La decisión final siempre pertenece al usuario.

---

# Stage 4 — Carga del Playbook

Una vez confirmado el modo:

## Lite

Cargar:

- 00-README.md
- 01-PROJECT-CHARTER.md
- 07-FEATURE-TEMPLATE.md
- 08-CODE-SYSTEM-PROMPT.md

## Standard

Cargar:

- 00-README.md
- 01-PROJECT-CHARTER.md
- 02-ARCHITECTURE.md
- 03-AI-CONSTITUTION.md
- 04-TESTING-POLICY.md
- 05-CODING-STANDARDS.md
- 06-DELIVERY-WORKFLOW.md
- 07-FEATURE-TEMPLATE.md
- 08-CODE-SYSTEM-PROMPT.md

## Full

Cargar todos los documentos del Playbook.

---

# Stage 5 — Inicio del Trabajo

Con el Playbook cargado:

1. continuar Discovery;
2. diseñar la solución;
3. aplicar la gobernanza correspondiente;
4. preparar handoff al asistente IA de desarrollo cuando corresponda.

No comenzar implementación durante Bootstrap.

---

# Principios

- Discovery antes de Gobernanza.
- Gobernanza antes de Implementación.
- Utilizar siempre el Playbook del proyecto cuando exista.
- Si no existe un Playbook válido, utilizar temporalmente el AI Playbook Base.
- La inicialización técnica del repositorio corresponde al asistente IA de desarrollo.

---
