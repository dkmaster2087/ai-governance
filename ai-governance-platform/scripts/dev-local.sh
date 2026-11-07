#!/bin/bash
# Run the platform locally against LocalStack (http://localhost:4566).
#
#   scripts/dev-local.sh start             # LocalStack (docker) + gateway, policy engine, data protection, analytics, dashboard
#   scripts/dev-local.sh start --postgres  # the same, storing records in PostgreSQL (docker, :5433), files on disk and
#                                          # secrets in the database (SECRET_STORE=database)
#   scripts/dev-local.sh stop     # stop the Node processes (LocalStack keeps running; `docker rm -f ai-gov-localstack` to remove it)
#   scripts/dev-local.sh status
#   SITES=off scripts/dev-local.sh start   # services only, no website, docs or dashboard (CI)
#   GLOBAL_RATE_LIMIT=10000000 scripts/dev-local.sh start   # for scripts/load-test.mjs (the per-address limit)
#
# Sample traffic: node scripts/seed-traffic.mjs (uses the mock model on :4010).
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
  # Detach fully (stdin/stdout/stderr) so `start` returns even when its output is piped.
  (cd "$ROOT/$dir" && nohup env PORT="$port" "$@" npx ts-node-dev --transpile-only -r tsconfig-paths/register src/index.ts \
    > "$LOGS/$name.log" 2>&1 < /dev/null &) > /dev/null 2>&1
  echo "  $name → http://localhost:$port (log: .dev-logs/$name.log)"
}

case "${1:-start}" in
  start)
    if [ "${2:-}" = "--postgres" ] || [ "${STORAGE_BACKEND:-}" = "postgres" ]; then
      export STORAGE_BACKEND=postgres OBJECT_STORE=file OBJECT_STORE_DIR="$ROOT/.dev-data/objects"
      export DATABASE_URL="${DATABASE_URL:-postgres://probaline:probaline-dev@localhost:5433/probaline}"
      # Secrets in the database too, encrypted under a key made once, as a self-hosted install without AWS runs.
      mkdir -p "$ROOT/.dev-data"
      [ -f "$ROOT/.dev-data/secrets.key" ] || (umask 077 && openssl rand -base64 32 > "$ROOT/.dev-data/secrets.key")
      export SECRET_STORE=database SECRETS_ENCRYPTION_KEY="$(cat "$ROOT/.dev-data/secrets.key")"
      if ! docker ps --format '{{.Names}}' | grep -q '^probaline-postgres$'; then
        echo "Starting PostgreSQL..."
        docker start probaline-postgres >/dev/null 2>&1 || (cd "$ROOT" && docker compose -p probaline up -d postgres)
      fi
      until docker exec probaline-postgres pg_isready -U probaline >/dev/null 2>&1; do sleep 1; done
    fi
    echo "Storage: ${STORAGE_BACKEND:-dynamodb} (restart with 'stop' first to switch)"
    if ! docker ps --format '{{.Names}}' | grep -q '^ai-gov-localstack$'; then
      echo "Starting LocalStack..."
      (cd "$ROOT" && docker compose -p probaline up -d localstack)
      until docker logs ai-gov-localstack 2>&1 | grep -q "LocalStack init complete"; do sleep 1; done
    fi
    # A container made before KMS was added can't encrypt archive copies; it has to be recreated.
    if ! docker inspect ai-gov-localstack --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -q '^SERVICES=.*kms'; then
      echo "  LocalStack was created without KMS, so archive copies of audit records fail. Recreate it (its data is temporary anyway):"
      echo "    docker rm -f ai-gov-localstack && scripts/dev-local.sh stop && scripts/dev-local.sh start"
    fi
    echo "Building shared packages..."
    (cd "$ROOT" && npm run build -w shared/types -w shared/utils -w shared/storage >/dev/null)
    if [ "${STORAGE_BACKEND:-}" = "postgres" ]; then (cd "$ROOT" && node scripts/seed-dev-data.mjs); fi
    echo "Starting services:"
    if ! lsof -tiTCP:4010 -sTCP:LISTEN >/dev/null 2>&1; then
      (cd "$ROOT" && nohup node scripts/mock-llm.mjs 4010 > "$LOGS/mock-llm.log" 2>&1 < /dev/null &) > /dev/null 2>&1
      echo "  mock-llm → http://localhost:4010/v1 (OpenAI-compatible stand-in)"
    fi
    if ! lsof -tiTCP:4030 -sTCP:LISTEN >/dev/null 2>&1; then
      (cd "$ROOT" && nohup node scripts/dev-idp.mjs 4030 > "$LOGS/dev-idp.log" 2>&1 < /dev/null &) > /dev/null 2>&1
      echo "  dev-idp → http://localhost:4030 (stand-in company sign-in: client probaline-dev / dev-secret)"
    fi
    # Internal services answer only requests the gateway signs. Only the gateway gets the private key; every
    # service gets the public keys. Made once and kept in .dev-data (in AWS they live in Secrets Manager).
    eval "$(node "$ROOT/scripts/internal-keys.mjs" local "$ROOT/.dev-data/internal-keys.json")"
    export INTERNAL_TRUSTED_KEYS
    # Mutual TLS between services: a private CA and one certificate per service, made once in .dev-data/pki.
    PKI="$ROOT/.dev-data/pki"
    node "$ROOT/scripts/internal-pki.mjs" local "$PKI" > /dev/null
    tls() { echo "INTERNAL_TLS_CA=$(cat "$PKI/ca.pem")"; }
    start_service policy-engine services/policy-engine 3001 "$(tls)" "INTERNAL_TLS_CERT=$(cat "$PKI/policy-engine.pem")" "INTERNAL_TLS_KEY=$(cat "$PKI/policy-engine.key")"
    start_service data-protection services/data-protection 3002 "$(tls)" "INTERNAL_TLS_CERT=$(cat "$PKI/data-protection.pem")" "INTERNAL_TLS_KEY=$(cat "$PKI/data-protection.key")" COMPREHEND_ENABLED=false
    start_service analytics services/analytics 3003 "$(tls)" "INTERNAL_TLS_CERT=$(cat "$PKI/analytics.pem")" "INTERNAL_TLS_KEY=$(cat "$PKI/analytics.key")"
    # MCP: local stand-in APIs run on http://localhost, which a deployed gateway refuses.
    # PUBLIC_GATEWAY_URL: the address agents and the sign-in flow use.
    # Log export: local collectors run on http://127.0.0.1, and records go out within seconds instead of a minute.
    start_service gateway services/gateway 3000 "INTERNAL_SIGNING_KEY=$INTERNAL_SIGNING_KEY_GATEWAY" "$(tls)" "INTERNAL_TLS_CERT=$(cat "$PKI/gateway.pem")" "INTERNAL_TLS_KEY=$(cat "$PKI/gateway.key")" \
      AUTH_DEV_MODE=true MCP_ALLOW_PRIVATE_BACKENDS=true MCP_ALLOW_HTTP_BACKENDS=true PUBLIC_GATEWAY_URL=http://localhost:3000 ANALYTICS_URL=https://localhost:3003 \
      LOG_EXPORT_ALLOW_HTTP=true LOG_EXPORT_ALLOW_PRIVATE_DESTINATIONS=true LOG_EXPORT_INTERVAL_MS=1000 LOG_EXPORT_SETTLE_MS=2000 LOG_EXPORT_RETRY_BASE_MS=1000 \
      POLICY_ENGINE_URL=https://localhost:3001 DATA_PROTECTION_URL=https://localhost:3002 ALLOWED_ORIGINS=http://localhost:5174,http://localhost:5173 \
      OPENAI_BASE_URL=http://localhost:4010/v1 PROXY_TARGET_OPENAI=http://localhost:4010 GLOBAL_RATE_LIMIT=${GLOBAL_RATE_LIMIT:-2000}
    # SITES=off skips the website, docs and dashboard (the end-to-end suite in CI needs only the services).
    if [ "${SITES:-on}" = "off" ]; then exit 0; fi
    if lsof -tiTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then echo "  website: port 5173 already in use, skipping"
    else (cd "$ROOT/frontend/website" && nohup npx vite --port 5173 > "$LOGS/website.log" 2>&1 < /dev/null &) > /dev/null 2>&1; echo "  website → http://localhost:5173"; fi
    if lsof -tiTCP:5175 -sTCP:LISTEN >/dev/null 2>&1; then echo "  docs: port 5175 already in use, skipping"
    else (cd "$ROOT/frontend/docs" && nohup npx vite --port 5175 > "$LOGS/docs.log" 2>&1 < /dev/null &) > /dev/null 2>&1; echo "  docs → http://localhost:5175"; fi
    if lsof -tiTCP:5174 -sTCP:LISTEN >/dev/null 2>&1; then echo "  dashboard: port 5174 already in use, skipping"
    else (cd "$ROOT/frontend/dashboard" && VITE_GATEWAY_PUBLIC_URL=http://localhost:3000 nohup npx vite --port 5174 > "$LOGS/dashboard.log" 2>&1 < /dev/null &) > /dev/null 2>&1; echo "  dashboard → http://localhost:5174"; fi
    ;;
  stop)
    for port in 3000 3001 3002 3003 4010 4030 5173 5174 5175; do
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
