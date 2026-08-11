#!/usr/bin/env bash
#
# Vercel "Ignored Build Step" script. Point the project's Ignored Build Step
# (Settings -> Build and Deployment) Custom command at:
#
#     bash scripts/vercel-ignore-build.sh
#
# Exit-code contract (Vercel's, not ours):
#   exit 1  -> BUILD  (something that affects the deployed app changed)
#   exit 0  -> SKIP   (nothing that reaches dist/ changed)
#
# We skip a deploy when a commit changed only things that never reach dist/:
# docs, skills, bmad artifacts, workflows, e2e, and the root doc markdown.
# Everything that feeds the build (src/, package.json, vite.config.ts,
# CHANGELOG.md, and the build/tooling config) still deploys. This is a denylist
# on purpose: a forgotten entry costs only a harmless extra build, never a
# missed deploy. Do NOT add CHANGELOG.md here: the build reads it into
# version.json `notes`, so it is a real build input.
#
# No `set -e`: `git diff --quiet` deliberately returns non-zero, and we branch on
# that ourselves.
set -uo pipefail

# Diff base: the previously deployed commit when Vercel provides it, else this
# commit's parent. If neither resolves (first deploy, or a shallow clone with no
# parent), build to be safe.
base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$base" ] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  base="$(git rev-parse --verify --quiet 'HEAD^' || true)"
fi
if [ -z "$base" ]; then
  echo "vercel-ignore-build: no base commit to diff against; building."
  exit 1
fi

# --quiet: git exits 1 when differences exist outside the excludes (-> build), 0
# when there are none (-> skip). Any other (error) exit is non-zero, so the `if`
# is false and we fall through to the build path, which is the safe default.
if git diff --quiet "$base" HEAD -- . \
  ':(exclude)docs' \
  ':(exclude)_bmad' \
  ':(exclude)_bmad-output' \
  ':(exclude).agents' \
  ':(exclude).claude' \
  ':(exclude).github' \
  ':(exclude)e2e' \
  ':(exclude)README.md' \
  ':(exclude)CONTRIBUTING.md' \
  ':(exclude)AGENTS.md' \
  ':(exclude)CLAUDE.md'; then
  echo "vercel-ignore-build: no build-affecting changes since ${base}; skipping."
  exit 0
fi

echo "vercel-ignore-build: build-affecting changes since ${base}; building."
exit 1
