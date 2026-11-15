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

if [ -n "${VC_ENGINE:-}" ]; then
  echo "vercel-build: VC_ENGINE is no longer honored (every build is the Rust-only build); remove it from the project settings" >&2
fi

bash scripts/build-engine-wasm.sh

# Where the player's manual is served. Production puts it at the root of its
# own host, help.verticopolis.com (vercel.json serves that host from
# dist/help/ and sends verticopolis.com/help there), so the installed app opens
# it in the browser over the running game. Every other deploy keeps it under
# /help on its own host. A project variable may set VC_HELP_ORIGIN for one
# branch to try the manual's host on a preview. The game's links to the manual
# (src/helpAddress.ts) and the manual's own build (help-site/site.mjs) both
# read it.
if [ -z "${VC_HELP_ORIGIN:-}" ] && [ "${VERCEL_ENV:-}" = "production" ]; then
  export VC_HELP_ORIGIN="https://help.verticopolis.com"
fi
echo "vercel-build: the manual is served from ${VC_HELP_ORIGIN:-/help on this host}"

# Every build is the Rust-only build: the Rust engine is the only engine, with
# no cohort, no runtime switch and no TypeScript fallback (see
# src/build/engineBundle.ts).
npm run build

# The player help site (help-site/, Astro + Starlight) builds into dist/help/
# after the game, from the same Markdown the game's Help window reads.
npm ci --prefix help-site
npm run build --prefix help-site

# A preview deployment ships a worker that removes itself instead of the
# game's precaching one, so a branch link always serves the latest push (see
# src/build/previewDeploy.ts). Production and other builds are left as built.
# Every build also writes dist/help/sw.js, the manual host's worker that
# removes a game worker a browser installed there.
node scripts/preview-service-worker.ts
