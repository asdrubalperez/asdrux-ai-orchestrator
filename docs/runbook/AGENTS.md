# AGENTS.md

# AGENTS.md — Runbook

Versión: v0.1 (borrador de diseño, pendiente de aprobación)

Este producto gestionado usa el Runbook del Orquestador. Este archivo es el punto de entrada
obligatorio para inicializar el contexto de trabajo de cualquier agente antes de operar sobre
este producto.

## Bootstrap

Antes de comenzar cualquier trabajo:

1. Leer `BOOTSTRAP.md`.
2. Seguir el proceso definido allí para determinar si este producto gestionado es nuevo o ya
   existente, e inicializar el Runbook cuando corresponda.
3. Todo producto gestionado usa el Runbook completo. Lo único que varía por producto son las
   secciones "Editable por producto" que Architect completa.
4. No comenzar implementación antes de completar Discovery, Planning y el Approval Gate
   automático (`06-DELIVERY-WORKFLOW.md`, Stages 1 a 3).
5. Respetar todos los documentos del Runbook — no se cargan subconjuntos condicionales.

## Fuente de Verdad

El Runbook define cómo se trabaja: gobernanza, arquitectura, workflow, testing, estándares,
templates.

Las Features definen qué se construye.

La documentación funcional de este producto gestionado vive junto a él. **[PENDIENTE-DB-PROJECTS]**

## Prioridad

Mismo orden que la Prioridad Constitucional de `03-AI-CONSTITUTION.md`:

1. Instrucción humana explícita
2. Architecture vigente de este producto gestionado (`02`)
3. La Constitución (`03`)
4. Conveniencia técnica

Este archivo es el punto de entrada que aplica esa jerarquía — no compite con ella ni define una
propia.

La gobernanza prevalece sobre la improvisación.