#!/bin/zsh
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
CACHE_ROOT="$HOME/Library/Caches/electron-browser-dev"
STAGE_DIR="$CACHE_ROOT/app"

mkdir -p "$CACHE_ROOT"

echo "Staging Electron into $STAGE_DIR ..."
rsync -a --delete \
  --exclude ".git/" \
  --exclude ".DS_Store" \
  --exclude "node_modules/.cache/" \
  --exclude ".npm/" \
  "$SOURCE_DIR/" "$STAGE_DIR/"

cd "$STAGE_DIR"
echo "Launching Electron from local cache ..."
exec ./node_modules/.bin/electron desktop/main.cjs
