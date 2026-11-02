#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

WORKFLOW="${1:-daily}"

case "$WORKFLOW" in
  daily)
    node workflows/daily-content-pipeline.js "${2:-}" "${3:-}" "${4:-medium}"
    ;;
  weekly)
    node workflows/weekly-strategy-review.js
    ;;
  *)
    echo "Usage: $0 [daily|weekly]"
    exit 1
    ;;
esac
