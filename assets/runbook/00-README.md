# 00-README.md

# Runbook README

Versión: v1.0

## Propósito

Este directorio contiene el Runbook que el Orquestador usa para operar sobre cualquier producto
gestionado. El Runbook define: gobernanza, arquitectura, workflow de delivery, estándares de
código, testing, y templates de trabajo — para que los cinco agentes del pipeline (Architect,
Functional, Planning, Developer, QA) colaboren entre sí de forma consistente y predecible.

---

# Cómo Funciona

El flujo general, de punta a punta:

`AGENTS.md` → `BOOTSTRAP.md` → Architect (`01`, `02`, Roadmap de Releases) →
`06-DELIVERY-WORKFLOW.md` (Functional → Planning → Developer → QA → Release, repetido por cada
Feature del release activo) → cierre de release → release siguiente o fin del proyecto.

---

## 1. AGENTS.md

Punto de entrada obligatorio. Inicia el Bootstrap y aplica la Prioridad Constitucional definida
en `03-AI-CONSTITUTION.md`.

## 2. BOOTSTRAP.md

Determina si el producto gestionado es nuevo o ya existente, inicializa el Runbook cuando
corresponde, y entrega el business case a Architect.

## 3. Documentación del Runbook

Ubicada en `docs/runbook/` de este repo (la copia de referencia). Las secciones editables por
producto se persisten en `project_config_versions` por `project_id` + `config_key` (FEATURE-011).

---

# Core Documents

| Documento | Propósito | Dueño |
|---|---|---|
| `01-PROJECT-BRIEF-TEMPLATE.md` | Molde del primer entregable del Architect: contexto, chequeo declarativo, evaluación preliminar | Architect |
| `02-ARCHITECTURE-TEMPLATE.md` | Molde del segundo entregable del Architect: arquitectura técnica, riesgo, Roadmap de Releases | Architect |
| `03-AI-CONSTITUTION.md` | Reglas de comportamiento, autoridad de decisión, escalamiento, Ownership de Artefactos | — (rige a los cinco roles) |
| `04-TESTING-POLICY.md` | Reglas de testing que Planning aplica al diseñar el Test Plan de cada Feature | Planning |
| `05-CODING-STANDARDS.md` | Estándares de código que Developer aplica directamente | Developer |
| `06-DELIVERY-WORKFLOW.md` | Workflow de delivery por Release: Stages 1 a 7, Approval Model automático, loop Developer↔QA, ciclo de Features | — (orquesta a los cinco roles) |
| `07-FEATURE-TEMPLATE.md` | Molde de cada Feature que Functional produce | Functional |
| `09-RELEASE-PLAN-TEMPLATE.md` | Molde único del Release Plan: secuencia de Features, enfoque técnico y Test Plan de cada una | Planning |
| `08-CODE-SYSTEM-PROMPT.md` | Core Behavior compartido + sección de comportamiento específica de cada rol | — (una sección por rol) |

---

# Bootstrap Documents

| Documento | Propósito |
|---|---|
| `AGENTS.md` | Punto de entrada del Runbook |
| `BOOTSTRAP.md` | Inicialización del contexto — sin modos, sin pasos conversacionales |

---

# Project Documentation

El Runbook define cómo se trabaja. Cada Feature (`07`) define qué se construye.

La documentación funcional de cada producto gestionado (sus Features ya completadas, análogas a
`docs/features/` de este mismo repo) vive junto a ese producto; las configuraciones vigentes por
producto se consultan desde `project_config_versions` (FEATURE-011).

---

# Principios del Runbook

El Runbook NO busca: burocracia, ni reemplazar al humano donde su intervención es genuinamente
necesaria.

Busca: preservar contexto entre agentes, reducir ambigüedad, evitar retrabajo, y resolver de
forma automática todo lo que hoy un humano resolvería solo por costumbre — no por necesidad real.

La intervención humana existe, pero está acotada a puntos concretos, no es el default:

* datos genuinamente declarativos que ningún agente puede inferir (`01`, sección 0)
* la Regla 9 de `03` — producción, siempre, sin excepción
* el tope de reintentos del loop Developer↔QA (`06`, Stage 5)
* el agotamiento del circuito de escalamiento con reinicio (`06`, Stage 3)
* la aprobación del Roadmap de Releases y de cada release siguiente (`02`, sección 0)
* el riesgo de un release demasiado grande, detectado por Planning (`06`, Stage 2)

Fuera de estos seis puntos, el pipeline avanza solo.

Principio central: primero automatizar lo que agrega fricción sin agregar valor; conservar
intervención humana donde de verdad importa.

---

# Prioridad de Gobernanza

Mismo orden que la Prioridad Constitucional de `03-AI-CONSTITUTION.md`:

1. Instrucción humana explícita
2. Architecture vigente del producto gestionado (`02`)
3. Esta Constitución (`03`)
4. Conveniencia técnica

La gobernanza prevalece sobre la improvisación.
