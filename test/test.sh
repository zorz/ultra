#!/bin/bash

# Bash Test File
# Tests syntax highlighting for shell scripts

set -euo pipefail

# Variables
NAME="Ultra Editor"
VERSION=1.0
DEBUG=${DEBUG:-false}

# Arrays
LANGUAGES=("typescript" "javascript" "python" "rust")
declare -A COLORS=(
  ["red"]="#ff0000"
  ["green"]="#00ff00"
  ["blue"]="#0000ff"
)

# Functions
log() {
  local level="$1"
  local message="$2"
  echo "[$(date +%Y-%m-%d\ %H:%M:%S)] [$level] $message"
}

build() {
  log "INFO" "Building $NAME v$VERSION..."
  
  if [[ "$DEBUG" == "true" ]]; then
    echo "Debug mode enabled"
  fi
  
  for lang in "${LANGUAGES[@]}"; do
    echo "  Processing: $lang"
  done
}

# Conditionals
if [ -f "package.json" ]; then
  log "INFO" "Found package.json"
elif [ -f "Cargo.toml" ]; then
  log "INFO" "Found Cargo.toml"
else
  log "WARN" "No project file found"
fi

# Loops
for i in {1..5}; do
  echo "Iteration $i"
done

# Command substitution
FILES=$(find . -name "*.ts" | wc -l)
echo "Found $FILES TypeScript files"

# Here document
cat <<EOF
Welcome to $NAME
Version: $VERSION
EOF

build "$@"
