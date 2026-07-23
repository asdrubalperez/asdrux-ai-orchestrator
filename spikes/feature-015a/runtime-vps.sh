#!/usr/bin/env sh
set -eu

STAGE_ROOT="${FEATURE015A_STAGE_ROOT:-/tmp/feature015a-stage1}"
CLAUDE_HOLDER="feature015a-claude-holder"
CODEX_HOLDER="feature015a-codex-holder"
TOPO_HOLDER="feature015a-topology-holder"
TOPO_WORKER="feature015a-topology-worker"
EGRESS_NET="feature015a-egress"
INTERNAL_NET="feature015a-internal"
PRIVATE_VOLUME="feature015a-private-cache"

cleanup() {
  docker rm -f "$CLAUDE_HOLDER" "$CODEX_HOLDER" "$TOPO_HOLDER" "$TOPO_WORKER" >/dev/null 2>&1 || true
  docker network rm "$EGRESS_NET" "$INTERNAL_NET" >/dev/null 2>&1 || true
  docker volume rm "$PRIVATE_VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

mkdir -p "$STAGE_ROOT/claude-config" "$STAGE_ROOT/codex-home" "$STAGE_ROOT/holder-empty"
chmod 700 "$STAGE_ROOT/claude-config" "$STAGE_ROOT/codex-home" "$STAGE_ROOT/holder-empty"

cat >"$STAGE_ROOT/claude-mcp.json" <<'JSON'
{
  "mcpServers": {
    "feature015a": {
      "type": "stdio",
      "command": "node",
      "args": ["/stage1/spikes/feature-015a/claude-mcp-adapter.mjs"]
    }
  }
}
JSON

cat >"$STAGE_ROOT/codex-home/config.toml" <<'TOML'
check_for_update_on_startup = false
web_search = "disabled"

[analytics]
enabled = false

[otel]
exporter = "none"
trace_exporter = "none"
metrics_exporter = "none"

[apps._default]
enabled = false

[mcp_servers]

[features]
browser_use = false
browser_use_full_cdp_access = false
browser_use_external = false
in_app_browser = false
computer_use = false
TOML

echo "=== CLI versions ==="
docker run --rm --network none ai-orchestrator-developer:latest claude --version
docker run --rm --network none ai-orchestrator-codex-developer:latest codex --version

echo "=== Claude holder inspect (no OAuth mount/env) ==="
docker create --name "$CLAUDE_HOLDER" --network none \
  --read-only --tmpfs /tmp:rw,uid=1000,gid=1000,mode=1777 \
  -e HOME=/tmp/holder-home \
  -e CLAUDE_CONFIG_DIR=/tmp/claude-config \
  -e CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  -e DISABLE_TELEMETRY=1 \
  -e DISABLE_ERROR_REPORTING=1 \
  -e DISABLE_UPDATES=1 \
  -e ENABLE_CLAUDEAI_MCP_SERVERS=false \
  -e CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1 \
  -v "$STAGE_ROOT:/stage1:ro" \
  ai-orchestrator-developer:latest sleep 60 >/dev/null
docker inspect "$CLAUDE_HOLDER" --format \
  'ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} NetworkMode={{.HostConfig.NetworkMode}} Mounts={{json .Mounts}} Env={{json .Config.Env}}'

echo "=== Claude pre-auth command ==="
set +e
docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,uid=1000,gid=1000,mode=1777 \
  -e HOME=/tmp/holder-home \
  -e CLAUDE_CONFIG_DIR=/tmp/claude-config \
  -e CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  -e DISABLE_TELEMETRY=1 \
  -e DISABLE_ERROR_REPORTING=1 \
  -e DISABLE_UPDATES=1 \
  -e ENABLE_CLAUDEAI_MCP_SERVERS=false \
  -e CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1 \
  -v "$STAGE_ROOT:/stage1:ro" \
  ai-orchestrator-developer:latest \
  claude -p "Return exactly PREAUTH_SHOULD_NOT_RUN" \
  --tools "" \
  --mcp-config /stage1/claude-mcp.json \
  --strict-mcp-config \
  --no-session-persistence
CLAUDE_STATUS=$?
set -e
echo "claude_pre_auth_exit=$CLAUDE_STATUS"
test "$CLAUDE_STATUS" -ne 0

echo "=== Codex strict config startup and initialize ==="
docker create --name "$CODEX_HOLDER" --network none \
  --read-only --tmpfs /tmp:rw,uid=1000,gid=1000,mode=1777 \
  -e HOME=/tmp/holder-home \
  -e CODEX_HOME=/codex-home \
  -v "$STAGE_ROOT:/stage1:ro" \
  -v "$STAGE_ROOT/codex-home:/codex-home" \
  ai-orchestrator-codex-developer:latest sleep 60 >/dev/null
docker inspect "$CODEX_HOLDER" --format \
  'ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} NetworkMode={{.HostConfig.NetworkMode}} Mounts={{json .Mounts}} Env={{json .Config.Env}}'

set +e
printf '%s\n%s\n' \
  '{"method":"initialize","id":1,"params":{"clientInfo":{"name":"feature015a_stage1","title":"FEATURE-015A Stage 1","version":"0.1.0"},"capabilities":{"experimentalApi":true,"optOutNotificationMethods":["remoteControl/status/changed","thread/status/changed","thread/tokenUsage/updated","turn/diff/updated","turn/plan/updated","item/reasoning/summaryPartAdded","item/reasoning/summaryTextDelta","item/reasoning/textDelta"]}}}' \
  '{"method":"initialized","params":{}}' |
  timeout 5 docker run --rm -i --network none --read-only \
    --tmpfs /tmp:rw,uid=1000,gid=1000,mode=1777 \
    -e HOME=/tmp/holder-home \
    -e CODEX_HOME=/codex-home \
    -v "$STAGE_ROOT:/stage1:ro" \
    -v "$STAGE_ROOT/codex-home:/codex-home" \
    ai-orchestrator-codex-developer:latest \
    codex app-server --strict-config --listen stdio://
CODEX_STATUS=$?
set -e
echo "codex_initialize_timeout_exit=$CODEX_STATUS"
test "$CODEX_STATUS" -eq 124

echo "=== Docker topology ==="
docker network create --label asdrux.feature=015a-stage1 "$EGRESS_NET" >/dev/null
docker network create --internal --label asdrux.feature=015a-stage1 "$INTERNAL_NET" >/dev/null
docker volume create --label asdrux.feature=015a-stage1 "$PRIVATE_VOLUME" >/dev/null
docker run --rm -v "$PRIVATE_VOLUME:/private-cache" node:22-alpine \
  sh -c 'chown 1000:1000 /private-cache'
docker run -d --name "$TOPO_HOLDER" --network "$EGRESS_NET" --read-only --user 1000:1000 \
  --tmpfs /tmp:rw,uid=1000,gid=1000,mode=1777 \
  -v "$PRIVATE_VOLUME:/private-cache" \
  node:22-alpine sh -c 'printf SYNTHETIC_CREDENTIAL_CANARY >/private-cache/cache.txt; sleep 300' >/dev/null
docker network connect "$INTERNAL_NET" "$TOPO_HOLDER"
docker run -d --name "$TOPO_WORKER" --network "$INTERNAL_NET" --read-only --user 1000:1000 \
  --tmpfs /tmp:rw,uid=1000,gid=1000,mode=1777 \
  node:22-alpine sleep 300 >/dev/null

docker inspect "$INTERNAL_NET" --format 'Internal={{.Internal}} Containers={{len .Containers}}'
docker inspect "$TOPO_HOLDER" --format 'holder Networks={{json .NetworkSettings.Networks}} Mounts={{json .Mounts}}'
docker inspect "$TOPO_WORKER" --format 'worker Networks={{json .NetworkSettings.Networks}} Mounts={{json .Mounts}}'

echo "holder_egress_probe="
docker exec "$TOPO_HOLDER" node -e \
  'fetch("https://example.com").then(r=>{console.log(r.status);process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})'

set +e
docker exec "$TOPO_WORKER" node -e \
  'fetch("https://example.com",{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(0)).catch(()=>process.exit(23))'
WORKER_EGRESS=$?
docker exec "$TOPO_WORKER" node -e \
  'const n=require("net").connect(8080,"feature015a-topology-holder");n.setTimeout(2000);n.on("connect",()=>process.exit(0));n.on("error",()=>process.exit(24));n.on("timeout",()=>process.exit(25))'
WORKER_CONTROL=$?
docker exec "$TOPO_WORKER" sh -c \
  'test -e /private-cache/cache.txt || grep -R -q SYNTHETIC_CREDENTIAL_CANARY /workspace /tmp /run 2>/dev/null'
WORKER_SECRET=$?
set -e
echo "worker_egress_exit=$WORKER_EGRESS (expected nonzero)"
echo "worker_holder_control_exit=$WORKER_CONTROL (expected nonzero)"
echo "worker_secret_search_exit=$WORKER_SECRET (expected nonzero)"
test "$WORKER_EGRESS" -ne 0
test "$WORKER_CONTROL" -ne 0
test "$WORKER_SECRET" -ne 0

echo "runtime_vps_status=passed"
