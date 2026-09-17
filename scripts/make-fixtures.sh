#!/usr/bin/env bash
set -euo pipefail
out="$(cd "$(dirname "$0")/.." && pwd)/test/fixtures"
mkdir -p "$out"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
tags=(-metadata "title=Test Title" -metadata "artist=Test Artist" -metadata "album=Test Album" -metadata "track=3/12")
tone=(-f lavfi -i "sine=frequency=440:duration=12")
bitexact=(-fflags +bitexact -flags:a +bitexact)
key="$(printf '00%.0s' $(seq 1 32))"
iv="$(printf '00%.0s' $(seq 1 16))"
openssl enc -aes-256-ctr -K "$key" -iv "$iv" -in /dev/zero 2>/dev/null | head -c 270000 > "$tmp/noise.raw" || true
ffmpeg -v error -y -fflags +bitexact -f rawvideo -pixel_format rgb24 -video_size 300x300 -i "$tmp/noise.raw" -frames:v 1 "$tmp/cover.png"
ffmpeg -v error -y "${tone[@]}" -c:a libmp3lame -b:a 128k -id3v2_version 3 "${tags[@]}" "${bitexact[@]}" "$out/cbr-xing.mp3"
ffmpeg -v error -y "${tone[@]}" -c:a libmp3lame -b:a 128k -write_xing 0 -id3v2_version 3 "${tags[@]}" "${bitexact[@]}" "$out/cbr-noxing.mp3"
ffmpeg -v error -y "${tone[@]}" -i "$tmp/cover.png" -map 0 -map 1 -c:a libmp3lame -b:a 128k -c:v copy -disposition:v attached_pic -id3v2_version 3 "${tags[@]}" "${bitexact[@]}" "$out/big-cover.mp3"
ffmpeg -v error -y "${tone[@]}" -c:a aac -b:a 128k "${tags[@]}" "${bitexact[@]}" "$out/moov-end.m4a"
ffmpeg -v error -y "${tone[@]}" -c:a aac -b:a 128k -movflags +faststart "${tags[@]}" "${bitexact[@]}" "$out/moov-start.m4a"
ffmpeg -v error -y "${tone[@]}" -i "$tmp/cover.png" -map 0 -map 1 -c:a aac -b:a 128k -c:v copy -disposition:v attached_pic -movflags +faststart "${tags[@]}" "${bitexact[@]}" "$out/moov-start-big-cover.m4a"
ffmpeg -v error -y "${tone[@]}" -c:a vorbis -strict -2 -ac 2 "${tags[@]}" "${bitexact[@]}" "$out/vorbis.ogg"
ffmpeg -v error -y "${tone[@]}" -c:a libopus -b:a 64k "${tags[@]}" "${bitexact[@]}" "$out/tone.opus"
ffmpeg -v error -y "${tone[@]}" -c:a libopus -b:a 64k "${tags[@]}" "${bitexact[@]}" "$out/tone.webm"
ffmpeg -v error -y "${tone[@]}" -c:a flac "${tags[@]}" "${bitexact[@]}" "$out/tone.flac"
ffmpeg -v error -y "${tone[@]}" -i "$tmp/cover.png" -map 0 -map 1 -c:a flac -c:v copy -disposition:v attached_pic "${tags[@]}" "${bitexact[@]}" "$out/big-cover.flac"
ffmpeg -v error -y "${tone[@]}" -ar 8000 "${tags[@]}" "${bitexact[@]}" "$out/tone.wav"
ffmpeg -v error -y -f lavfi -i "sine=frequency=440:duration=1" -c:a libmp3lame -b:a 64k "${bitexact[@]}" "$out/untagged.mp3"
printf 'not audio' > "$out/garbage.mp3"
