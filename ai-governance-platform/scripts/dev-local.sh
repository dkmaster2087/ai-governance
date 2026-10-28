#!/bin/bash
# Run the platform locally against LocalStack (http://localhost:4566).
#
#   scripts/dev-local.sh start    # LocalStack (docker) + gateway, policy engine, data protection, analytics, dashboard
#   scripts/dev-local.sh stop     # stop the Node processes (LocalStack keeps running; `docker rm -f ai-gov-localstack` to remove it)
#   scripts/dev-local.sh status
#
# Logs go to .dev-logs/. The dashboard uses local demo accounts (admin@platform.com / admin123, etc.)
# and the gateway runs with AUTH_DEV_MODE=true so those accounts work. Never use this setup in a deployed stage.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$ROOT/.dev-logs"
mkdir -p "$LOGS"

export AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1 STAGE=dev
export AUDIT_LOG_BUCKET=ai-gov-audit-logs-dev-000000000000 POLICIES_TABLE=ai-gov-policies-dev METRICS_TABLE=ai-gov-metrics-dev
export COMPLIANCE_TABLE=ai-gov-compliance-dev AUDIT_LOGS_TABLE=ai-gov-audit-logs-dev

start_service() { # name dir port [extra env...]
  local name=$1 dir=$2 port=$3; shift 3
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "  $name: port $port already in use, skipping"; return; fi
  (cd "$ROOT/$dir" && nohup env PORT="$port" "$@" npx ts-node-dev --transpile-only -r tsconfig-paths/register src/index.ts \
    > "$LOGS/$name.log" 2>&1 &)
  echo "  $name → http://localhost:$port (log: .dev-logs/$name.log)"
}

case "${1:-start}" in
  start)
    if ! docker ps --format '{{.Names}}' | grep -q '^ai-gov-localstack$'; then
      echo "Starting LocalStack..."
      (cd "$ROOT" && docker compose -p aegis up -d localstack)
      until docker logs ai-gov-localstack 2>&1 | grep -q "LocalStack init complete"; do sleep 1; done
    fi
    echo "Building shared packages..."
    (cd "$ROOT" && npm run build -w shared/types -w shared/utils >/dev/null)
    echo "Starting services:"
    start_service policy-engine services/policy-engine 3001
    start_service data-protection services/data-protection 3002 COMPREHEND_ENABLED=false
    start_service analytics services/analytics 3003
    start_service gateway services/gateway 3000 AUTH_DEV_MODE=true \
      POLICY_ENGINE_URL=http://localhost:3001 DATA_PROTECTION_URL=http://localhost:3002 ALLOWED_ORIGINS=http://localhost:5174
    if lsof -tiTCP:5174 -sTCP:LISTEN >/dev/null 2>&1; then echo "  dashboard: port 5174 already in use, skipping"
    else (cd "$ROOT/frontend/dashboard" && nohup npx vite --port 5174 > "$LOGS/dashboard.log" 2>&1 &); echo "  dashboard → http://localhost:5174"; fi
    ;;
  stop)
    for port in 3000 3001 3002 3003 5174; do
      pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
      [ -n "$pids" ] && kill $pids && echo "  stopped :$port"
    done
    pkill -f "ts-node-dev.*$ROOT/services" 2>/dev/null || true
    ;;
  status)
    for port in 3000 3001 3002 3003; do printf "  :%s  " "$port"; curl -s "localhost:$port/health" || printf "down"; echo; done
    printf "  :5174  "; curl -s -o /dev/null -w "%{http_code}\n" localhost:5174 || echo down
    ;;
  *) echo "usage: $0 start|stop|status"; exit 1 ;;
esac
