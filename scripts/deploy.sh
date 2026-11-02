#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env file. Copy .env.example to .env and configure credentials first."
  exit 1
fi

npm ci --omit=dev
npm run db:init
pm2 startOrReload ecosystem.config.cjs --env production
pm2 save

echo "Deployment complete."
