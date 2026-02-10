#!/bin/bash
# Interactive spacing test — run this in a real terminal.
# Requires: API key configured, CLI built (bun run build)
#
# Usage: bash tests/e2e/test-interactive.sh

set -e

CLI="$(dirname "$0")/../../dist/ai.mjs"
PASS=0
FAIL=0

strip_ansi() {
  sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | sed 's/\x1b\][^\x07]*\x07//g' | tr -d '\r'
}

echo "=== Interactive spacing tests ==="
echo ""

# Test: single blank line between prompt and response
echo "Test 1: single blank line between prompt and response"
OUTPUT=$(
  (sleep 1; echo "respond with just the word pong"; sleep 8; printf '\x03') \
  | script -q /dev/null node "$CLI" --no-color 2>&1 \
  | strip_ansi
)

# Find the prompt line and count blank lines after it
PROMPT_LINE=$(echo "$OUTPUT" | grep -n "respond with just the word pong" | head -1 | cut -d: -f1)

if [ -z "$PROMPT_LINE" ]; then
  echo "  FAIL: could not find prompt line in output"
  FAIL=$((FAIL + 1))
else
  # Count empty lines between prompt and next non-empty line
  EMPTY=0
  LINE=$((PROMPT_LINE + 1))
  TOTAL=$(echo "$OUTPUT" | wc -l)
  while [ "$LINE" -le "$TOTAL" ]; do
    CONTENT=$(echo "$OUTPUT" | sed -n "${LINE}p" | tr -d '[:space:]')
    if [ -z "$CONTENT" ]; then
      EMPTY=$((EMPTY + 1))
    else
      break
    fi
    LINE=$((LINE + 1))
  done

  if [ "$EMPTY" -eq 1 ]; then
    echo "  PASS: exactly 1 blank line after prompt"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: expected 1 blank line, got $EMPTY"
    echo "  Output around prompt:"
    echo "$OUTPUT" | sed -n "$((PROMPT_LINE-1)),$((PROMPT_LINE+4))p" | cat -A
    FAIL=$((FAIL + 1))
  fi
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
exit $FAIL
