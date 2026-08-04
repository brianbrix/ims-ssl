#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

load_env_file() {
  local env_path="$1"
  if [[ -f "$env_path" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_path"
    set +a
  fi
}

load_env_file "$PROJECT_ROOT/.env"
if [[ "$PWD" != "$PROJECT_ROOT" ]]; then
  load_env_file "$PWD/.env"
fi

DRY_RUN="${DRY_RUN:-0}"
FAIL_ON_ERROR="${FAIL_ON_ERROR:-0}"

is_true() {
  case "$1" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

args=()
if is_true "$DRY_RUN"; then
  args+=("--dry-run")
fi
if is_true "$FAIL_ON_ERROR"; then
  args+=("--fail-on-error")
fi

cd "$PROJECT_ROOT"

if [[ -n "${NODE_BIN:-}" ]]; then
  node_cmd="$NODE_BIN"
elif command -v node >/dev/null 2>&1; then
  node_cmd="$(command -v node)"
else
  echo "Node.js executable not found. Set NODE_BIN=/absolute/path/to/node or ensure node is on PATH." >&2
  exit 1
fi

"$node_cmd" server/backfillPdfOptimization.js "${args[@]}"
