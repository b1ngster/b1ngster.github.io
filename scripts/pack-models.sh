#!/usr/bin/env bash
# Pack the character GLBs for the web, preserving detail:
#  - WebP textures at quality 90, full resolution (no downsizing)
#  - meshopt quantization + EXT_meshopt_compression for geometry, morph
#    targets, and animation tracks (no polygon reduction)
# three r147's GLTFLoader reads both natively (drei's useGLTF wires the
# meshopt decoder by default), so no loader changes are needed.
# Run after copying fresh exports into public/models/.
set -euo pipefail
cd "$(dirname "$0")/.."
GT=node_modules/.bin/gltf-transform

for m in "$@"; do
  in="public/models/$m.glb"
  tmp="$(mktemp --suffix=.glb)"
  "$GT" webp "$in" "$tmp" --quality 90
  "$GT" meshopt "$tmp" "$in"
  rm -f "$tmp"
done
ls -la public/models/*.glb
