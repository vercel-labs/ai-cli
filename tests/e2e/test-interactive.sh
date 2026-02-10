#!/bin/bash
# Interactive spacing tests — run this in a real terminal.
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

assert_blank_lines_between() {
  local output="$1"
  local after_pattern="$2"
  local expected="$3"
  local label="$4"

  local line_num
  line_num=$(echo "$output" | grep -n "$after_pattern" | head -1 | cut -d: -f1)

  if [ -z "$line_num" ]; then
    echo "  FAIL ($label): could not find '$after_pattern' in output"
    FAIL=$((FAIL + 1))
    return
  fi

  local empty=0
  local i=$((line_num + 1))
  local total
  total=$(echo "$output" | wc -l)
  while [ "$i" -le "$total" ]; do
    local content
    content=$(echo "$output" | sed -n "${i}p" | tr -d '[:space:]')
    if [ -z "$content" ]; then
      empty=$((empty + 1))
    else
      break
    fi
    i=$((i + 1))
  done

  if [ "$empty" -eq "$expected" ]; then
    echo "  PASS ($label): $expected blank line(s) after '$after_pattern'"
    PASS=$((PASS + 1))
  else
    echo "  FAIL ($label): expected $expected blank line(s), got $empty"
    echo "  Context:"
    echo "$output" | sed -n "$((line_num > 1 ? line_num - 1 : 1)),$((line_num + expected + 3))p" | cat -An
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Interactive spacing tests ==="
echo ""

# ---------------------------------------------------------------
# Test 1: single blank line between prompt and text response
# ---------------------------------------------------------------
echo "Test 1: single blank line between prompt and text response"
OUTPUT=$(
  (sleep 1; echo "respond with just the word pong"; sleep 8; printf '\x03') \
  | script -q /dev/null node "$CLI" --no-color 2>&1 \
  | strip_ansi
)
assert_blank_lines_between "$OUTPUT" "respond with just the word pong" 1 "prompt → response"

echo ""

# ---------------------------------------------------------------
# Test 2: single blank line between prompt and tool result (Ran)
# ---------------------------------------------------------------
echo "Test 2: single blank line between prompt and 'Ran' tool result"
OUTPUT=$(
  (sleep 1; echo "run ls"; sleep 8; printf '\x03') \
  | script -q /dev/null node "$CLI" --no-color 2>&1 \
  | strip_ansi
)
# The confirm is auto-accepted (if 'always' was set) or manually accepted.
# Either way, "Ran ls" should have 1 blank line after the prompt.
assert_blank_lines_between "$OUTPUT" "run ls" 1 "prompt → Ran"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
exit $FAIL
