#!/usr/bin/env bash
# Regenerates icons/icon-{16,32,48,128}.png (requires ImageMagick).
# The glyph: a contact card + download arrow on a cyan→indigo gradient.
set -euo pipefail
cd "$(dirname "$0")/../icons"

convert -size 512x512 gradient:'#22d3ee-#6366f1' /tmp/ce-grad.png
convert -size 512x512 xc:none -fill white -draw "roundrectangle 24,24 488,488 112,112" /tmp/ce-mask.png
convert /tmp/ce-grad.png /tmp/ce-mask.png -alpha off -compose CopyOpacity -composite \
  -stroke '#07141f' -strokewidth 34 -fill none \
  -draw "circle 206,196 206,134" \
  -draw "path 'M 104,392 C 104,336 150,296 206,296 C 262,296 308,336 308,392'" \
  -draw "line 352,196 352,364" \
  -draw "polyline 302,314 352,366 402,314" \
  /tmp/ce-icon512.png

for size in 16 32 48 128; do
  convert /tmp/ce-icon512.png -resize "${size}x${size}" -depth 8 -strip "icon-${size}.png"
done

rm -f /tmp/ce-grad.png /tmp/ce-mask.png /tmp/ce-icon512.png
echo "icons regenerated: $(ls icon-*.png | tr '\n' ' ')"
