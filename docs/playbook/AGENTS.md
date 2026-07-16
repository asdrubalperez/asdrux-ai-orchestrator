# AGENTS.md

Proyecto utiliza AI Playbook.

Este archivo es el punto de entrada obligatorio para inicializar el contexto de trabajo del asistente.

## Bootstrap

Antes de comenzar cualquier trabajo:

1. Leer `docs/playbook/PLAYBOOK-BOOTSTRAP.md`.
2. Seguir el proceso definido allí para:
   - determinar el Playbook Mode aplicable;
   - identificar los documentos que deben cargarse;
   - localizar la documentación funcional del proyecto;
   - confirmar el nivel de gobernanza con el usuario.
3. No asumir automáticamente un modo Lite, Standard o Full.
4. No comenzar implementación antes de completar Discovery, Diseño y Approval Gate cuando correspondan.
5. Respetar los documentos activos del Playbook cargados para el modo confirmado.

## Fuente de Verdad

El AI Playbook define cómo se trabaja:

- gobernanza;
- arquitectura;
- workflow;
- testing;
- estándares;
- templates.

Las Features definen qué se construye.

La documentación funcional del proyecto vive en:

`docs/features/`

## Prioridad

Cuando exista conflicto, aplicar este orden:

1. Instrucción humana explícita.
2. `AGENTS.md` del repositorio.
3. Arquitectura y decisiones aprobadas.
4. Documentos activos del AI Playbook.
5. Conveniencia técnica.

La gobernanza prevalece sobre la improvisación.
