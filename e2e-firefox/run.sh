#!/usr/bin/env bash
# Real-Firefox smoke test runner for the Tabox Firefox port.
#
# Builds build-firefox/ if it doesn't exist yet, installs selenium-webdriver
# + geckodriver into a throwaway prefix (NOT into this project's
# package.json/yarn.lock), and runs e2e-firefox/smoke.cjs against a real
# Firefox binary.
#
# Usage:
#   bash e2e-firefox/run.sh
#
# Env overrides:
#   FIREFOX_BINARY   path to the Firefox binary (default: the macOS app bundle)
#   HEADFUL=1        run with a visible window instead of headless

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

if [ ! -f "$REPO_ROOT/build-firefox/manifest.json" ]; then
  echo "build-firefox/ missing or incomplete - running yarn build:firefox..."
  yarn build:firefox
fi

DEPS_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$DEPS_DIR"
}
trap cleanup EXIT

echo "Installing selenium-webdriver + geckodriver into a throwaway prefix (not added to package.json/yarn.lock)..."
npm install --prefix "$DEPS_DIR" --no-save --silent selenium-webdriver geckodriver

echo "Running Firefox smoke test..."
NODE_PATH="$DEPS_DIR/node_modules" \
MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 \
  node "$SCRIPT_DIR/smoke.cjs"
