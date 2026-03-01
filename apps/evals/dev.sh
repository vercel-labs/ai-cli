#!/bin/bash
# Auto-restart wrapper for the evals dev server.
# Restarts on crash; Ctrl-C stops cleanly.

trap 'echo "[dev.sh] stopping"; exit 0' INT TERM

while true; do
  echo "[dev.sh] starting next dev..."
  ./node_modules/.bin/next dev -p "${PORT:-3456}" "$@"
  CODE=$?
  echo "[dev.sh] server exited with code $CODE — restarting in 2s..."
  sleep 2
done
