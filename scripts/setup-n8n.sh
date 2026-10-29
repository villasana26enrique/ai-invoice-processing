#!/usr/bin/env bash
# Sets up a fresh n8n with everything this project needs: credentials (from .env), workflows and publishing.
# Usage: docker compose up -d && ./scripts/setup-n8n.sh
set -euo pipefail
# Git Bash on Windows rewrites paths like /repo/... into C:/...; this keeps them as container paths
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

# ENV_FILE allows targeting another environment (e.g. a throwaway test stack)
ENV_FILE="${ENV_FILE:-.env}"
set -a; source "$ENV_FILE"; set +a
docker() { if [ "$1" = compose ]; then shift; command docker compose --env-file "$ENV_FILE" "$@"; else command docker "$@"; fi; }

# The service account key stays in its file outside the repository; it is read here and handed to n8n,
# which stores it encrypted with N8N_ENCRYPTION_KEY
if [ -n "${GOOGLE_SERVICE_ACCOUNT_KEY_FILE:-}" ]; then
  GOOGLE_SERVICE_ACCOUNT_JSON="$(cat "$GOOGLE_SERVICE_ACCOUNT_KEY_FILE")"
  export GOOGLE_SERVICE_ACCOUNT_JSON
fi

# Secrets go to this one command only; they are never stored in the n8n container's environment
docker compose exec -T \
  -e POSTGRES_DB -e INVOICE_APP_PASSWORD -e GOOGLE_SERVICE_ACCOUNT_JSON -e GEMINI_API_KEY -e UPLOAD_API_KEY \
  n8n sh -c 'node /repo/scripts/build-credentials.js \
    && n8n import:credentials --input=/tmp/credentials-to-import.json \
    ; rm -f /tmp/credentials-to-import.json'

ENV_FILE="$ENV_FILE" ./scripts/reload-workflows.sh
echo "Done. Open n8n, create the owner account, and send an invoice:"
echo "  python scripts/upload-invoice.py demo/build/invoices/01-*.pdf"
