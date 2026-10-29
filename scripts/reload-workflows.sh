#!/usr/bin/env bash
# Imports every workflow in n8n/workflows/ (filling in values from .env) and publishes them all again,
# then restarts n8n. Importing unpublishes a workflow, so never import one without running this whole script
# (a scheduled workflow left unpublished simply stops running, without any error).
# Usage: ./scripts/reload-workflows.sh
set -euo pipefail
# Git Bash on Windows rewrites paths like /repo/... into C:/...; this keeps them as container paths
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env}"
set -a; source "$ENV_FILE"; set +a
docker() { if [ "$1" = compose ]; then shift; command docker compose --env-file "$ENV_FILE" "$@"; else command docker "$@"; fi; }

docker compose exec -T -e DRIVE_FOLDER_ID n8n node /repo/scripts/prepare-import.js
docker compose exec -T n8n sh -c 'n8n import:workflow --separate --input=/tmp/workflows-to-import; status=$?; rm -rf /tmp/workflows-to-import; exit $status'

# Sub-workflows first, so they exist when their callers are published
for id in pR4cI9nV2xT7kLmQ uP7lD3aP5iK8nWqE sY6nC2gD8rV4eQwT; do
  docker compose exec -T n8n n8n publish:workflow --id="$id"
done

# Published workflows are loaded at startup
docker compose restart n8n
