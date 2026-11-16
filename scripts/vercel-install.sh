#!/usr/bin/env bash
# Installs a package folder's npm dependencies for a Vercel build:
#
#     bash scripts/vercel-install.sh [DIR]     # DIR defaults to the repo root
#
# Vercel restores node_modules from the previous deployment's build cache, but
# `npm ci` deletes it and installs every package again. Here a preview
# (VERCEL_ENV=preview, the staging custom environment included) keeps the
# restored node_modules when it is exactly the tree `npm ci` left: the same
# package.json, package-lock.json, Node, npm and CPU, and the same hidden
# lockfile (node_modules/.package-lock.json), which npm rewrites whenever an
# install changes the tree.
# Anything else runs `npm ci` and records what it installed. Production, and
# any build that is not a preview, always runs `npm ci`.
#
# Vercel's post-build install (for the api/ functions) reports two changed
# packages on every build but leaves the hidden lockfile as it was, so a warm
# preview keeps both the root tree and the help site's.
#
# `npm ci` would also delete the preview's engine package cache, which lives
# in node_modules/.cache/vc-engine (scripts/vercel-engine-cache.ts) because
# node_modules is what Vercel's build cache carries; it is set aside for the
# install and put back.
set -euo pipefail

dir="${1:-.}"
stamp="$dir/node_modules/.vc-install-stamp"
tree="$dir/node_modules/.package-lock.json"

# What an install depends on. Any change here means a fresh `npm ci`.
inputs="$(
  {
    sha256sum "$dir/package.json" "$dir/package-lock.json" | cut -d' ' -f1
    echo "node $(node --version)"
    echo "npm $(npm --version 2>/dev/null)"
    echo "arch $(uname -s) $(uname -m)"
  } | sha256sum | cut -d' ' -f1
)"
# The stamp: the inputs, then the hidden lockfile npm wrote for that install.
tree_hash() { if [ -f "$tree" ]; then sha256sum "$tree" | cut -d' ' -f1; else echo none; fi; }

if [ "${VERCEL_ENV:-}" = "preview" ] && [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$(printf '%s\n%s' "$inputs" "$(tree_hash)")" ]; then
  echo "vercel-install: $dir/node_modules is the tree npm ci installed from this lockfile, Node and npm; keeping the cached install"
  exit 0
fi

kept=""
engine_cache="$dir/node_modules/.cache/vc-engine"
if [ "${VERCEL_ENV:-}" = "preview" ] && [ -d "$engine_cache" ]; then
  kept="$(mktemp -d)"
  mv "$engine_cache" "$kept/vc-engine"
fi

# The stamp goes before the install, so a failed or interrupted `npm ci` never
# leaves one behind (npm ci also deletes node_modules, stamp included, first).
rm -f "$stamp"
npm ci --prefix "$dir" --no-audit --no-fund
printf '%s\n%s' "$inputs" "$(tree_hash)" > "$stamp"

if [ -n "$kept" ]; then
  mkdir -p "$dir/node_modules/.cache"
  mv "$kept/vc-engine" "$engine_cache"
  rmdir "$kept"
fi
echo "vercel-install: installed $dir from its lockfile"
