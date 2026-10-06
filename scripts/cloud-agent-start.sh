#!/usr/bin/env bash
# Cloud Agent start — materialize local env + keep Next.js ready for agents.
set -euo pipefail
cd "$(dirname "$0")/.."

node scripts/sync-railway-token.mjs

# Minimal desk env for Cloud Agents when production secrets are not injected.
# Prefer Cursor secrets when present; never echo secret values.
if [[ ! -f .env.local ]]; then
  umask 077
  {
    echo "ALLOW_DEV_AUTH=${ALLOW_DEV_AUTH:-true}"
    echo "DESK_GATE_PASSWORD=${DESK_GATE_PASSWORD:-desk-cloud-agent}"
    echo "DESK_AUTH_SECRET=${DESK_AUTH_SECRET:-cloud-agent-desk-auth-secret-change-me}"
    echo "DESK_MODE=${DESK_MODE:-single}"
    echo "DESK_USER_ID=${DESK_USER_ID:-00000000-0000-0000-0000-000000000001}"
    echo "NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-https://example.supabase.co}"
    echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder}"
    echo "SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder}"
    echo "CRON_SECRET=${CRON_SECRET:-cloud-agent-cron-secret}"
    echo "LOG_LEVEL=${LOG_LEVEL:-info}"
  } > .env.local
  echo "[cloud-agent-start] wrote .env.local (dev desk defaults)"
fi

# Idempotent: reuse existing Next if healthy.
if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:3000/api/health" 2>/dev/null; then
  echo "[cloud-agent-start] Next.js already healthy on :3000"
  exit 0
fi

# Free stale listener if needed.
if command -v fuser >/dev/null 2>&1; then
  fuser -k 3000/tcp >/dev/null 2>&1 || true
fi

exec npm run dev -- -H 0.0.0.0 -p 3000
