# FEATURE-006 (resuelve H14): imagen para correr la invocación COMPLETA de Claude Code (incluida
# su herramienta Bash interna) confinada dentro de un contenedor — a diferencia de QA (que no
# necesita Bash en absoluto, ver TestExecutor), Developer sí necesita Bash real (npm, git, correr
# el propio código), así que el confinamiento tiene que ser a nivel de contenedor, no de toolset.
#
# Costo de mantenimiento real (no ocultarlo, ver FEATURE-006 Risks): esta imagen fija versión de
# Node y de Claude Code CLI en el momento del build — actualizarla es una tarea operativa
# recurrente, no puntual.
FROM node:22-alpine

RUN apk add --no-cache git bash \
    && npm install -g @anthropic-ai/claude-code

# node:22-alpine ya trae un usuario "node" (uid 1000) no root — se reutiliza en vez de crear uno
# nuevo.
USER node
WORKDIR /workspace
