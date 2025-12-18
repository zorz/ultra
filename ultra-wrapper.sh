#!/bin/bash
# ultra-wrapper.sh - Restart-capable wrapper for Ultra

ULTRA_BIN="${ULTRA_BIN:-./ultra}"
RESTART_CODE=75

# Pass through all arguments
while true; do
  "$ULTRA_BIN" "$@"
  EXIT_CODE=$?
  
  if [ $EXIT_CODE -ne $RESTART_CODE ]; then
    # Normal exit or crash - pass through exit code
    exit $EXIT_CODE
  fi
  
  # Restart requested - clear screen and loop
  clear
done