# FEATURE-008 Parte 2: imagen para correr la invocacion COMPLETA de Codex dentro de Docker.
# Codex se invoca con --sandbox danger-full-access en este contenedor: Docker (mounts +
# capabilities) impone el limite real, evitando el camino de bubblewrap que falla en la VPS.
FROM node:22-alpine

RUN apk add --no-cache git bash \
    && npm install -g @openai/codex

# node:22-alpine ya trae un usuario "node" (uid 1000) no root.
USER node
WORKDIR /workspace
