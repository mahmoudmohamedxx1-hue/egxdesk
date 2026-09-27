#!/usr/bin/env bash
# EGX Desk CI gate (Task 20) — the same checks every task ran manually.
# Usage: bash scripts/ci.sh [--with-server]
#   --with-server also runs the live-server suites (api-test.js,
#   t16, t18-chats, t20) against BASE_URL (default http://localhost:3000).
#   NOTE: live suites consume the 60/h agent budget on the server's IP —
#   run them on a fresh window or accept 429s in the later ones.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── 1/4 typecheck ──────────────────────────────"
bunx tsc --noEmit
echo "✓ tsc clean"

echo "── 2/4 lint ───────────────────────────────────"
bunx eslint .
echo "✓ eslint clean"

echo "── 3/4 build (type errors fail the build) ─────"
bun run build
echo "✓ production build clean"

if [[ "${1:-}" == "--with-server" ]]; then
  echo "── 4/4 live suites against ${BASE_URL:-http://localhost:3000} ──"
  BASE_URL="${BASE_URL:-http://localhost:3000}" node scripts/e2e/api-test.js
  BASE_URL="${BASE_URL:-http://localhost:3000}" bun scripts/e2e/t16-endpoints-test.js
  BASE_URL="${BASE_URL:-http://localhost:3000}" bun scripts/e2e/t18-chats-test.js
  BASE_URL="${BASE_URL:-http://localhost:3000}" bun scripts/e2e/t20-ai-signals-test.ts
  echo "✓ live suites green"
else
  echo "── 4/4 live suites skipped (pass --with-server) ──"
fi

echo "✓ CI green"
