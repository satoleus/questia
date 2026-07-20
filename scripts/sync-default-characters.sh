#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/examples/images"
FULL_DIR="$ROOT_DIR/assets/default-characters/full"
THUMB_DIR="$ROOT_DIR/assets/default-characters/thumb"
MANIFEST_FILE="$ROOT_DIR/default-characters.js"

if ! command -v convert >/dev/null 2>&1; then
  echo "ImageMagickのconvertコマンドが必要です。" >&2
  exit 1
fi

mkdir -p "$FULL_DIR" "$THUMB_DIR"
find "$FULL_DIR" "$THUMB_DIR" -type f -delete

TEMP_FILE="$(mktemp)"
trap 'rm -f "$TEMP_FILE"' EXIT

printf '%s\n' '(function (scope) {' > "$TEMP_FILE"
printf '%s\n' '  "use strict";' >> "$TEMP_FILE"
printf '%s\n' '  scope.QUESTIA_DEFAULT_CHARACTERS = Object.freeze([' >> "$TEMP_FILE"

count=0
while IFS= read -r -d '' source_file; do
  folder_name="$(basename "$(dirname "$source_file")")"
  case "$folder_name" in
    "レア（R）"|"R") rarity="R" ;;
    "超レア（SR）"|"SR") rarity="SR" ;;
    "超激レア（SSR）"|"SSR") rarity="SSR" ;;
    *) continue ;;
  esac

  file_name="$(basename "$source_file")"
  character_name="${file_name%.*}"
  extension="${file_name##*.}"
  case "${extension,,}" in
    png|jpg|jpeg|webp) ;;
    *) continue ;;
  esac

  hash="$(printf '%s' "$rarity:$character_name" | sha256sum | cut -c1-16)"
  output_name="${rarity,,}-$hash.webp"
  full_relative="assets/default-characters/full/$output_name"
  thumb_relative="assets/default-characters/thumb/$output_name"

  convert "$source_file" -resize '1000x1000>' -strip -quality 76 -define webp:method=6 "$ROOT_DIR/$full_relative"
  convert "$source_file" -resize '320x320>' -strip -quality 68 -define webp:method=6 "$ROOT_DIR/$thumb_relative"

  escaped_name="${character_name//\\/\\\\}"
  escaped_name="${escaped_name//\"/\\\"}"
  printf '    { id: "builtin-%s-%s", name: "%s", rarity: "%s", image: "%s", thumbnail: "%s", isDefault: true },\n' \
    "$rarity" "$hash" "$escaped_name" "$rarity" "$full_relative" "$thumb_relative" >> "$TEMP_FILE"
  count=$((count + 1))
done < <(find "$SOURCE_DIR" -mindepth 2 -maxdepth 2 -type f -print0 | sort -z)

printf '%s\n' '  ]);' >> "$TEMP_FILE"
printf '%s\n' '})(globalThis);' >> "$TEMP_FILE"
mv "$TEMP_FILE" "$MANIFEST_FILE"
trap - EXIT

echo "デフォルトキャラクター${count}体を同期しました。"
