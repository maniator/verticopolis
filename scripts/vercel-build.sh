#!/usr/bin/env bash
# The Vercel build. The Rust engine's WASM package (src/public/engine/) is
# build output and is not checked in, so every deploy builds it here before
# Vite runs (scripts/build-engine-wasm.sh installs the pinned toolchain).
# A failed engine build fails the deploy: the app would otherwise ship without
# the engine it runs on.
set -euo pipefail

# The old emergency switch skipped the rebuild and served the committed
# package; there is none to serve now, so say plainly that it does nothing.
if [ -n "${VC_ENGINE_REBUILD:-}" ]; then
  echo "vercel-build: VC_ENGINE_REBUILD is no longer honored (the engine package is not committed, so it is always built); remove it from the project settings" >&2
fi

bash scripts/build-engine-wasm.sh

# Every deploy is the wasm-only build: the Rust engine is the only engine, with
# no cohort, no runtime switch and no TypeScript fallback (see
# src/build/engineBundle.ts). A dev serve and the test lanes keep the default
# switchable build until the TypeScript engine's code is deleted.
VC_ENGINE=wasm npm run build
