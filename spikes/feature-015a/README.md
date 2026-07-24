# FEATURE-015A Etapa 1 — spikes descartables

Estos archivos validan el Approval Gate sin credenciales OAuth. No son implementación final de
Executors.

- `schema.test.ts`: suite Draft 2020-12 con Ajv.
- `protocol.test.ts`: límites, token, replay/cancel, allowlists Claude/Codex y fail-closed.
- `lock.integration.ts`: Postgres real aislado, concurrencia, fencing, promoción sintética y
  pérdida real de una conexión DB.
- `claude-mcp-adapter.mjs`: servidor MCP `stdio` mínimo para el smoke pre-auth.
- `codex-schema-contract.mjs`: comprueba la allowlist contra los schemas generados por la versión
  candidata de `app-server`.
- `claude-mcp-worker-adapter.mjs` + `stage2-worker.mjs`: E2E real Claude MCP → worker aislado.
- `stage2-claude-runner.mjs`: ejecuta probes baseline/access/refresh sin imprimir credenciales.
- `stage2-credential-summary.mjs`: emite sólo hashes y metadata para comparar copias.
- `stage2-fenced-promotion.ts`: promoción real condicionada por fencing Postgres.
- `stage2-run-holder.sh`: holder efímero con redes y mounts cerrados.

Los scripts `stage2-*` sólo se ejecutan con una cuenta desechable expresamente autorizada. Nunca
deben apuntar a una sesión de trabajo real.

Comandos:

```bash
npx tsx --test spikes/feature-015a/schema.test.ts spikes/feature-015a/protocol.test.ts
FEATURE015A_DATABASE_URL=postgres://postgres:synthetic@127.0.0.1:55432/postgres \
  npx tsx spikes/feature-015a/lock.integration.ts
```
