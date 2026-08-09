#!/usr/bin/env bash
# Fetch the ddddocr OCR model (common_old.onnx, ~13.6 MB) into ocr-model/ddddocr.onnx.
# The model ships inside the ddddocr PyPI package; we don't vendor the binary in git
# (charset.json, the small text charset, IS vendored next to it). Requires python3+pip.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/ocr-model"
DEST="$DIR/ddddocr.onnx"
mkdir -p "$DIR"

if [ -f "$DEST" ]; then
  echo "already present: $DEST"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "downloading ddddocr from PyPI ..."
python3 -m pip download ddddocr --no-deps -d "$TMP" >/dev/null

ARCHIVE="$(ls "$TMP"/ddddocr* | head -1)"
case "$ARCHIVE" in
  *.whl|*.zip) (cd "$TMP" && unzip -o "$ARCHIVE" >/dev/null) ;;
  *.tar.gz|*.tgz) (cd "$TMP" && tar xzf "$ARCHIVE") ;;
  *) echo "unexpected archive: $ARCHIVE" >&2; exit 1 ;;
esac

SRC="$(find "$TMP" -name common_old.onnx | head -1)"
if [ -z "$SRC" ]; then
  echo "common_old.onnx not found inside the ddddocr package" >&2
  exit 1
fi

cp "$SRC" "$DEST"
echo "installed $DEST"
