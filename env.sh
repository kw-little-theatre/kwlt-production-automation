#!/usr/bin/env bash
#
# env.sh — Switch between production and test clasp environments
#
# Usage:
#   ./env.sh prod     Switch to production
#   ./env.sh test     Switch to test
#   ./env.sh status   Show which environment is active
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLASP_FILE="$SCRIPT_DIR/.clasp.json"
PROD_FILE="$SCRIPT_DIR/.clasp-prod.json"
TEST_FILE="$SCRIPT_DIR/.clasp-test.json"

# --- Helpers ---

_check_file_exists() {
  local file="$1" label="$2"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: $label not found at $file"
    echo "Create it first. See README.md → Test Environment."
    exit 1
  fi
}

_get_script_id() {
  local file="$1"
  grep -o '"scriptId"[[:space:]]*:[[:space:]]*"[^"]*"' "$file" | head -1 | sed 's/.*"scriptId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/'
}

_detect_env() {
  if [[ ! -f "$CLASP_FILE" ]]; then
    echo "none"
    return
  fi

  local current prod test
  current=$(_get_script_id "$CLASP_FILE")

  if [[ -f "$PROD_FILE" ]]; then
    prod=$(_get_script_id "$PROD_FILE")
    if [[ "$current" == "$prod" ]]; then
      echo "prod"
      return
    fi
  fi

  if [[ -f "$TEST_FILE" ]]; then
    test=$(_get_script_id "$TEST_FILE")
    if [[ "$current" == "$test" ]]; then
      echo "test"
      return
    fi
  fi

  echo "unknown"
}

# --- Commands ---

cmd_switch() {
  local env="$1"
  local source_file label warning

  case "$env" in
    prod)
      source_file="$PROD_FILE"
      label="PRODUCTION"
      warning="⚠️  Now targeting PRODUCTION — clasp push will update the live system"
      ;;
    test)
      source_file="$TEST_FILE"
      label="TEST"
      warning="🧪 Now targeting TEST — safe to experiment"
      ;;
    *)
      echo "Unknown environment: $env"
      echo "Usage: ./env.sh [prod|test|status]"
      exit 1
      ;;
  esac

  _check_file_exists "$source_file" ".clasp-${env}.json"

  # Check for placeholder script ID
  local script_id
  script_id=$(_get_script_id "$source_file")
  if [[ "$script_id" == "PASTE_YOUR_TEST_SCRIPT_ID_HERE" ]]; then
    echo "ERROR: .clasp-${env}.json still has the placeholder script ID."
    echo "Replace PASTE_YOUR_TEST_SCRIPT_ID_HERE with your actual Apps Script project ID."
    echo ""
    echo "To find it: open your test spreadsheet → Extensions → Apps Script → Project Settings → Script ID"
    exit 1
  fi

  cp "$source_file" "$CLASP_FILE"
  echo "$warning"
  echo ""
  echo "Active environment: $label"
  echo "Script ID: $script_id"
}

cmd_status() {
  local env
  env=$(_detect_env)

  case "$env" in
    prod)
      echo "Active environment: PRODUCTION"
      echo "Script ID: $(_get_script_id "$CLASP_FILE")"
      ;;
    test)
      echo "Active environment: TEST"
      echo "Script ID: $(_get_script_id "$CLASP_FILE")"
      ;;
    none)
      echo "No .clasp.json found. Run ./env.sh prod or ./env.sh test to set up."
      ;;
    unknown)
      echo "Active environment: UNKNOWN"
      echo "Script ID: $(_get_script_id "$CLASP_FILE")"
      echo ""
      echo ".clasp.json does not match either .clasp-prod.json or .clasp-test.json"
      ;;
  esac
}

# --- Main ---

if [[ $# -lt 1 ]]; then
  echo "Usage: ./env.sh [prod|test|status]"
  echo ""
  cmd_status
  exit 0
fi

case "$1" in
  prod|test) cmd_switch "$1" ;;
  status)    cmd_status ;;
  *)
    echo "Usage: ./env.sh [prod|test|status]"
    exit 1
    ;;
esac
