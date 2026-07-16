# 00-README.md

# AI Playbook README

Versión: v1.2

## Propósito

Este directorio contiene el AI Playbook utilizado por el proyecto.

El Playbook define:

-   gobernanza AI
-   arquitectura
-   workflow
-   estándares de código
-   testing
-   templates de trabajo

Su objetivo es asegurar colaboración consistente entre humanos y AI
durante todo el ciclo de diseño y delivery.

------------------------------------------------------------------------

# Cómo Funciona

El AI Playbook se inicializa mediante un proceso de Bootstrap antes de
cargar la gobernanza del proyecto.

El flujo general es:

Global Instructions

↓

Repo `AGENTS.md`

↓

`PLAYBOOK-BOOTSTRAP.md`

↓

Determinación del Playbook Mode

↓

Carga de documentos del Playbook

↓

Discovery, Diseño y Gobernanza

------------------------------------------------------------------------

## 1. Global Instructions

Define:

-   filosofía general de trabajo
-   principios transversales
-   estilo operativo personal

Este nivel es global y reutilizable.

------------------------------------------------------------------------

## 2. Repo AGENTS.md

Ubicado en:

`docs/playbook/AGENTS.md`

Es el punto de entrada del Playbook.

Su responsabilidad es iniciar el Bootstrap y delegar la inicialización
en `PLAYBOOK-BOOTSTRAP.md`.

------------------------------------------------------------------------

## 3. PLAYBOOK-BOOTSTRAP.md

Define:

-   proceso de inicialización
-   detección del contexto del proyecto
-   determinación del Playbook Mode
-   carga de documentos
-   transición hacia Discovery

------------------------------------------------------------------------

## 4. Documentación del Playbook

Ubicada en:

`docs/playbook/`

Contiene la gobernanza, arquitectura y workflow reutilizable del
proyecto.

------------------------------------------------------------------------

# Playbook Mode

El modo del Playbook no se configura manualmente.

Es determinado durante el Bootstrap.

La AI debe:

-   inferir un modo recomendado;
-   explicar brevemente el motivo;
-   solicitar confirmación al usuario.

Modos disponibles:

-   Lite
-   Standard
-   Full

------------------------------------------------------------------------

# Bootstrap Documents

  -----------------------------------------------------------------------
  Documento                           Propósito
  ----------------------------------- -----------------------------------
  AGENTS.md                           Punto de entrada del Playbook

  PLAYBOOK-BOOTSTRAP.md               Inicialización del contexto y
                                      selección del modo
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# Core Documents

  Documento                  Propósito
  -------------------------- ------------------------
  01-PROJECT-CHARTER.md      Identidad y alcance
  02-ARCHITECTURE.md         Diseño técnico
  03-AI-CONSTITUTION.md      Reglas AI
  04-TESTING-POLICY.md       Gobernanza de testing
  05-CODING-STANDARDS.md     Convenciones de código
  06-DELIVERY-WORKFLOW.md    Workflow de delivery
  07-FEATURE-TEMPLATE.md     Template de Features
  08-CODE-SYSTEM-PROMPT.md   Conducta operativa

------------------------------------------------------------------------

# Project Documentation

El AI Playbook define cómo se trabaja.

La documentación funcional vive en:

`docs/features/`

Cada Feature define qué se construye.

El Playbook define:

-   gobernanza
-   arquitectura
-   workflow
-   estándares
-   testing

------------------------------------------------------------------------

# Principios del Playbook

El Playbook NO busca:

-   burocracia
-   frenar creatividad
-   reemplazar conversación

Busca:

-   preservar contexto
-   reducir ambigüedad
-   evitar retrabajo
-   mejorar calidad y continuidad

Principio central:

> Primero crear. Luego estructurar cuando agregue valor.

------------------------------------------------------------------------

# Prioridad de Gobernanza

Orden de autoridad:

1.  Instrucción humana.
2.  Repo AGENTS.md.
3.  Arquitectura aprobada.
4.  Documentos activos del Playbook.
5.  Conveniencia técnica.

La gobernanza prevalece sobre la improvisación.
