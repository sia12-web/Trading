#!/usr/bin/env bash
# Cloud Agent install — idempotent dependency + Railway token bootstrap.
set -euo pipefail
cd "$(dirname "$0")/.."

node -v
npm -v

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

node scripts/sync-railway-token.mjs

echo "[cloud-agent-install] ok"
