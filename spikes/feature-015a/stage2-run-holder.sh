#!/usr/bin/env sh
set -eu

NAME="${1:?container name is required}"
MODE="${2:?runner mode is required}"
case "$NAME" in
  feature015a-etapa2-holder-*) ;;
  *) echo "invalid holder name" >&2; exit 64 ;;
esac
case "$MODE" in
  baseline|access-only|refresh-only) ;;
  *) echo "invalid runner mode" >&2; exit 64 ;;
esac

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker create --name "$NAME" \
  --network feature015a-etapa2-egress \
  --read-only \
  --user 1000:1000 \
  --tmpfs /tmp:rw,uid=1000,gid=1000,mode=1777 \
  --env-file /tmp/feature015a-stage2/channel.env \
  -e FEATURE015A_WORKER_URL=http://feature015a-etapa2-worker:8080/tool \
  -e HOME=/tmp/home \
  -e CLAUDE_CONFIG_DIR=/cred \
  -e CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  -e DISABLE_TELEMETRY=1 \
  -e DISABLE_ERROR_REPORTING=1 \
  -e DISABLE_UPDATES=1 \
  -e ENABLE_CLAUDEAI_MCP_SERVERS=false \
  -e CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1 \
  -v /tmp/feature015a-stage2:/stage2:ro \
  -v feature015a-etapa2-private-cache:/cred \
  ai-orchestrator-developer:latest \
  node /stage2/stage2-claude-runner.mjs "$MODE" >/dev/null
docker network connect feature015a-etapa2-internal "$NAME"
timeout 180 docker start -a "$NAME"
