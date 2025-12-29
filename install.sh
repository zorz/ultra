#!/bin/bash
#
# Ultra Editor Install Script
# Usage: curl -fsSL https://raw.githubusercontent.com/zorz/ultra/release/install.sh | bash
#

set -e

REPO_URL="https://github.com/zorz/ultra.git"
INSTALL_DIR="${ULTRA_INSTALL_DIR:-$HOME/ultra}"
BRANCH="release"

echo "Installing Ultra Editor..."
echo ""

# Check for Bun
if ! command -v bun &> /dev/null; then
  echo "Error: Bun is required but not installed."
  echo "Install Bun first: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

echo "✓ Bun found: $(bun --version)"

# Check for Git
if ! command -v git &> /dev/null; then
  echo "Error: Git is required but not installed."
  exit 1
fi

echo "✓ Git found"

# Clone or update repo
if [ -d "$INSTALL_DIR" ]; then
  echo "→ Updating existing installation in $INSTALL_DIR..."
  cd "$INSTALL_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  echo "→ Cloning Ultra to $INSTALL_DIR..."
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Install dependencies
echo "→ Installing dependencies..."
bun install

# Build
echo "→ Building Ultra..."
bun run build

# Verify
if [ -f "./ultra" ]; then
  echo ""
  echo "✓ Ultra installed successfully!"
  echo ""
  echo "To run Ultra:"
  echo "  cd $INSTALL_DIR && ./ultra"
  echo ""
  echo "To add to your PATH, run:"
  echo "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.bashrc"
  echo "  # or for zsh:"
  echo "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.zshrc"
  echo ""
else
  echo "Error: Build failed - ultra binary not found"
  exit 1
fi
