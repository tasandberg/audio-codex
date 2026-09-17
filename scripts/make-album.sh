#!/usr/bin/env bash
set -euo pipefail
if [ $# -lt 2 ]; then
  echo "usage: $0 <out-dir> <count> [artist] [album]" >&2
  exit 1
fi
out="$1"
count="$2"
artist="${3:-Codex Test Artist}"
album="${4:-$(basename "$out")}"
mkdir -p "$out"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
ffmpeg -v error -y -f lavfi -i "sine=frequency=330:duration=2" -c:a libmp3lame -b:a 64k "$tmp/base.mp3"
for i in $(seq 1 "$count"); do
  name="$(printf '%s-%s' "$album" "$i" | shasum | cut -c1-10)"
  ffmpeg -v error -y -i "$tmp/base.mp3" -c copy -id3v2_version 3 \
    -metadata "title=Track $(printf '%02d' "$i")" -metadata "artist=$artist" \
    -metadata "album=$album" -metadata "track=$i/$count" "$out/$name.mp3"
done
