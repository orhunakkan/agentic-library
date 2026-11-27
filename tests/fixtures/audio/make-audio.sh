#!/usr/bin/env bash
set -euo pipefail

out=tests/fixtures/audio
cover=tests/fixtures/images/cover.jpg
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }

tones=(330 440 550)
titles=('The Arrival' 'The Dinner' 'The Departure')
for n in 1 2 3; do
  ff -f lavfi -i "sine=frequency=${tones[n - 1]}:duration=10:sample_rate=22050" -i "$cover" \
    -map 0:a -map 1:v -c:a libmp3lame -b:a 16k -ac 1 -c:v copy -disposition:v attached_pic \
    -id3v2_version 3 \
    -metadata title="${titles[n - 1]}" -metadata album='The Fixture Audiobook' \
    -metadata album_artist='Ada Fixture' -metadata artist='Ada Fixture' -metadata composer='Rex Reader' \
    -metadata track="$n/3" -metadata date=2024 -metadata comment='A short audiobook for the tests.' \
    "$out/chapter-$n.mp3"
done

cat >"$work/chapters.txt" <<'EOF'
;FFMETADATA1
title=The Fixture Audiobook
album=The Fixture Audiobook
artist=Ada Fixture
album_artist=Ada Fixture
composer=Rex Reader
date=2023
description=Three short chapters, in one file.

[CHAPTER]
TIMEBASE=1/1000
START=0
END=3000
title=Opening Credits

[CHAPTER]
TIMEBASE=1/1000
START=3000
END=6000
title=The Storm

[CHAPTER]
TIMEBASE=1/1000
START=6000
END=9000
title=The Calm
EOF

ff -f lavfi -i 'sine=frequency=440:duration=9:sample_rate=22050' -i "$work/chapters.txt" -i "$cover" \
  -map 0:a -map 2:v -map_metadata 1 -map_chapters 1 -c:a aac -b:a 24k -ac 1 -c:v copy \
  -disposition:v attached_pic -brand 'M4B ' -movflags +faststart -f mp4 "$out/three-chapters.m4b"

node -e '
  const fs = require("node:fs")
  const bytes = fs.readFileSync(process.argv[1])
  const at = bytes.indexOf("mp4a")
  if (at < 0) throw new Error("no mp4a sample entry")
  bytes.write("drms", at)
  fs.writeFileSync(process.argv[2], bytes)
' "$out/three-chapters.m4b" "$out/drm.m4b"

head -c 2048 "$out/three-chapters.m4b" >"$out/truncated.m4b"

ls -l "$out"
