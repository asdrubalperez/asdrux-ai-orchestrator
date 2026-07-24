# Reproduction spike for the owner-approved tuple in docker/codex-pin.json.
FROM node:22-alpine@sha256:b74031e546d7f4faf561d797ac1b76beccac856a042815ca77db4fd047581605

RUN apk add --no-cache git bash \
    && npm install -g @openai/codex@0.145.0

USER node
WORKDIR /holder-empty
