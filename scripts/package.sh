#!/bin/sh
# Builds the zip uploaded to the Chrome Web Store: extension files only.
set -eu
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
mkdir -p dist
out="dist/getset-$version.zip"
rm -f "$out"
zip -qr "$out" manifest.json popup.html popup.js styles.css lib images -x '*.DS_Store'
echo "$out"
