#!/usr/bin/env bash
#
# Vercel "Ignored Build Step" script. Point the project's Ignored Build Step
# (Settings -> Build and Deployment) Custom command at:
#
#     bash scripts/vercel-ignore-build.sh
#
# Exit-code contract (Vercel's, not ours):
#   exit 1  -> BUILD  (something that affects the deployed app changed)
#   exit 0  -> SKIP   (nothing that reaches the deployed app changed)
#
# A deploy is skipped when every changed file is one that never reaches the
# deployed app, its WASM engine package or the build checks that gate them.
# This is a denylist on purpose: a path nobody listed builds, so a forgotten
# entry costs one harmless extra build and never a missed deploy.
#
# What is skipped (see affects_deploy below for the exact patterns):
#   - docs, skills, bmad artifacts, workflows, e2e, and the tools/ folder
#   - the root doc markdown and the lint and Playwright configs
#   - unit and integration test files, and src/tests except portKit, which
#     vite.config.ts imports
#   - the engine's Rust tests and consumer crate, and its markdown
#   - the conformance suite, except the files the engine crate compiles in
#   - standalone dev scripts (screenshots, perf, fuzz, PostHog, rollback)
#
# What always builds, so do not add it above:
#   - .gitattributes: it sets line endings and the binary list for Vercel's own
#     checkout, so it can change the bytes of built files
#   - docs/screenshots: src/ui/templates/compareFigures.ts imports those
#     pictures into the /help page
#   - CHANGELOG.md: the build reads it into version.json `notes`
#   - the conformance lock files (catalog-digests, events/, expected,
#     loader-cases, tdt-cases): the engine crate includes some with
#     include_str!, and src/build/engineCompat.ts digests all five
#   - src/tests/portKit: vite.config.ts imports it
#   - everything else, including api/, scripts the build runs, package files
#     and configs
#
# src/tests/vercelIgnoreBuild.guard.test.ts runs this table against the repo: it
# follows every import and include from the build's entry points and fails if
# one lands on a skipped path, so a new import cannot slip past this list.
#
# No `set -e`: `git diff` deliberately returns non-zero in some modes, and we
# branch on that ourselves.
set -uo pipefail

# Returns 0 when the path can change the deployed app or its build checks
# (build), 1 when it cannot (skip). Unknown paths build.
affects_deploy() {
  case "$1" in
    # Reaches the deployed /help page through compareFigures.ts.
    docs/screenshots/*) return 0 ;;

    # Documentation, agent skills, workflows and other repo meta.
    docs/* | _bmad/* | _bmad-output/* | .agents/* | .claude/* | .github/* | .vscode/*) return 1 ;;
    e2e/* | tools/*) return 1 ;;
    .gitignore) return 1 ;;
    README.md | CONTRIBUTING.md | AGENTS.md | CLAUDE.md | ARCHITECTURE.md | PARITY.md | SECURITY.md | SOUNDS.md) return 1 ;;
    playwright.config.ts | eslint.config.js) return 1 ;;

    # Test files. The case patterns match across folders.
    src/*.test.ts | src/*.test.tsx) return 1 ;;
    src/tests/portKit/*) return 0 ;;
    src/tests/*) return 1 ;;

    # The engine crate's Rust tests, consumer crate and markdown. Its src/,
    # Cargo.toml and Cargo.lock build.
    engine-rs/tests/* | engine-rs/consumer/*) return 1 ;;
    engine-rs/README.md | engine-rs/API.md | engine-rs/CHANGELOG.md) return 1 ;;

    # The conformance suite. The lock files build (engineCompat.ts LOCK_FILES);
    # the fixtures, scenarios and fuzz corpus are read only by tests.
    conformance/catalog-digests.json | conformance/events/* | conformance/expected.json) return 0 ;;
    conformance/loader-cases.json | conformance/tdt-cases.json) return 0 ;;
    conformance/*) return 1 ;;

    # Standalone dev scripts that no build step imports or runs.
    scripts/screenshot* | scripts/scenes/*) return 1 ;;
    scripts/perf-* | scripts/fuzz-* | scripts/posthog-* | scripts/rollback-*) return 1 ;;
    scripts/test-port.ts | scripts/derive-fixture.ts | scripts/loader-case-dump.ts) return 1 ;;
    scripts/engine-bundle-size.ts | scripts/engine-compat.ts | scripts/export-atlas.ts | scripts/atlas-bundle.ts) return 1 ;;
    scripts/persistence-failures.* | scripts/reliability-coverage.* | scripts/engine-reliability.* | scripts/backlog-priority-labels.*) return 1 ;;
  esac
  return 0
}

# `--classify PATH...` prints "build" or "skip" for each path and exits. The
# test uses it; Vercel never passes arguments.
if [ "${1:-}" = "--classify" ]; then
  shift
  for path in "$@"; do
    if affects_deploy "$path"; then echo "build $path"; else echo "skip $path"; fi
  done
  exit 0
fi

# Diff base: the previously deployed commit when Vercel provides it, else this
# commit's parent. A previous deploy that does not resolve (a shallow clone
# without it) builds, since falling back to the parent would compare only the
# last commit. With neither a previous deploy nor a parent (first deploy), build
# to be safe.
base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -n "$base" ]; then
  if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
    echo "vercel-ignore-build: previous deploy ${base} is not in this clone; building."
    exit 1
  fi
else
  base="$(git rev-parse --verify --quiet 'HEAD^' || true)"
fi
if [ -z "$base" ]; then
  echo "vercel-ignore-build: no base commit to diff against; building."
  exit 1
fi

# --no-renames lists both sides of a move, so a file moved out of a built folder
# into a skipped one still counts the built side. A failed diff builds.
if ! changed="$(git -c core.quotepath=off diff --name-only --no-renames "$base" HEAD 2>/dev/null)"; then
  echo "vercel-ignore-build: could not diff against ${base}; building."
  exit 1
fi

while IFS= read -r path; do
  [ -n "$path" ] || continue
  if affects_deploy "$path"; then
    echo "vercel-ignore-build: ${path} changed since ${base}; building."
    exit 1
  fi
done <<< "$changed"

echo "vercel-ignore-build: nothing that reaches the deployed app changed since ${base}; skipping."
exit 0
