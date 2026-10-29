#!/usr/bin/env bash
# Exports the project workflows from the running n8n into n8n/workflows/ (clean, ready to commit).
# Usage: ./scripts/export-workflows.sh
set -euo pipefail
# Git Bash on Windows rewrites paths like /repo/... into C:/...; this keeps them as container paths
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

# file name -> workflow id
declare -A WORKFLOWS=(
  [extract-process-invoice]=pR4cI9nV2xT7kLmQ
  [ingest-upload-api]=uP7lD3aP5iK8nWqE
  [ingest-sync-google-drive]=sY6nC2gD8rV4eQwT
)

for name in "${!WORKFLOWS[@]}"; do
  docker compose exec -T n8n n8n export:workflow --id="${WORKFLOWS[$name]}" --pretty --output="/repo/workflows/$name.json"
done

docker compose exec -T n8n node /repo/scripts/clean-export.js
