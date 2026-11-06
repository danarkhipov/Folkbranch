#!/bin/sh
# Checks the assistant's backend against a real model, on a throwaway instance with the fictional
# demo family: no interface, and never your archive. It spends money on the provider's key.
#
#   OPENROUTER_API_KEY=... scripts/agent-check.sh            (or put the key in .env.check)
#   AGENT_MODEL=openai/gpt-6-luna CHECK_ONLY=pdf scripts/agent-check.sh
set -eu
cd "$(dirname "$0")/.."
[ -f .env.check ] && { set -a; . ./.env.check; set +a; }
[ -n "${OPENROUTER_API_KEY:-}${ANTHROPIC_API_KEY:-}${OPENAI_API_KEY:-}${GOOGLE_GENERATIVE_AI_API_KEY:-}" ] || { echo "No provider key: set OPENROUTER_API_KEY or put it in .env.check."; exit 2; }
PORT="${CHECK_PORT:-3431}"; NAME="fg-check-$$"
docker build -q -t folkbranch:check . >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
CODE=check-code
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:3000" -e BETTER_AUTH_URL="http://localhost:$PORT" -e SETUP_TOKEN="$CODE" \
  -e OPENROUTER_API_KEY -e ANTHROPIC_API_KEY -e ANTHROPIC_BASE_URL -e OPENAI_API_KEY -e GOOGLE_GENERATIVE_AI_API_KEY -e AGENT_PROVIDER -e AGENT_MODEL -e AGENT_SELF_CHECK -e AGENT_REASONING -e AGENT_ALL_TOOLS folkbranch:check >/dev/null
until curl -sf "http://localhost:$PORT/api/health" >/dev/null; do sleep 0.3; done
CHECK_URL="http://localhost:$PORT" CHECK_CODE="$CODE" node scripts/agent-check.mjs
