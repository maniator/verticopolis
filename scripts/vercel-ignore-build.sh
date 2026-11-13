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
# A production deploy is also held (skipped) while a pending change note in
# .changes/ asks for an app or crate release (see held_notes below), and it
# builds only for a commit that changes the app or crate version, so production
# moves only on a release merge. Vercel's git integration no longer deploys
# production (vercel.json turns it off for main); the production deploy
# workflow (.github/workflows/deploy-production.yml) runs this script with
# VERCEL_ENV=production against the release tag's commit and deploys only when
# it exits 1, so this production branch is still the release gate.
#
# A deploy is skipped when every changed file is one that never reaches the
# deployed app, its WASM engine package or the build checks that gate them.
# This is a denylist on purpose: a path nobody listed builds, so a forgotten
# entry costs one harmless extra build and never a missed deploy.
#
# What is skipped (see affects_deploy below for the exact patterns):
#   - docs, skills, bmad artifacts, workflows, e2e, and the tools/ folder
#   - the root doc markdown and the lint and Playwright configs
#   - unit and integration test files, and src/tests
#   - the engine's Rust tests and consumer crate, and its markdown
#   - the hour-boundary bench crate (engine-bench/), which only its weekly
#     workflow builds
#   - .pr_agent.toml, the PR review bot's settings, and .mcp.json, the
#     agents' MCP servers
#   - the conformance suite, except the files the engine crate compiles in
#   - standalone dev scripts (screenshots, perf, fuzz, PostHog, rollback,
#     release and version check)
#
# What always builds, so do not add it above:
#   - .gitattributes: it sets line endings and the binary list for Vercel's own
#     checkout, so it can change the bytes of built files
#   - docs/screenshots: the help site's pages (help-site/src/content/docs/)
#     show those pictures at /help
#   - docs/engine-site/src/styles: the help site wears the engine docs site's
#     theme
#   - docs/engine-site/src/components/TitleBar.astro and
#     docs/engine-site/title-bar.mjs: the help site draws the shared title bar
#   - CHANGELOG.md: the build reads it into version.json `notes`
#   - the conformance lock files (catalog-digests, events/, expected,
#     loader-cases, tdt-cases): the engine crate includes some with
#     include_str!, and src/build/engineCompat.ts digests all five
#   - .changes/: the release PR deletes the notes, and the production deploy
#     that lifts the hold must see that diff and build
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
    # Reach the deployed /help site: its pages show the screenshots, and it
    # wears the engine docs site's theme and title bar.
    docs/screenshots/* | docs/engine-site/src/styles/*) return 0 ;;
    docs/engine-site/src/components/TitleBar.astro | docs/engine-site/title-bar.mjs) return 0 ;;

    # Documentation, agent skills, workflows and other repo meta.
    docs/* | _bmad/* | _bmad-output/* | .agents/* | .claude/* | .github/* | .vscode/*) return 1 ;;
    e2e/* | tools/*) return 1 ;;
    .gitignore | .pr_agent.toml | .mcp.json) return 1 ;;
    README.md | CONTRIBUTING.md | AGENTS.md | CLAUDE.md | ARCHITECTURE.md | PARITY.md | SECURITY.md | SOUNDS.md) return 1 ;;
    playwright.config.ts | eslint.config.js) return 1 ;;

    # Test files. The case patterns match across folders.
    src/*.test.ts | src/*.test.tsx) return 1 ;;
    src/tests/*) return 1 ;;

    # The engine crate's Rust tests, consumer crate and markdown. Its src/,
    # Cargo.toml and Cargo.lock build.
    engine-rs/tests/* | engine-rs/consumer/*) return 1 ;;
    engine-rs/README.md | engine-rs/CRATE_README.md | engine-rs/API.md | engine-rs/CHANGELOG.md) return 1 ;;
    # The weekly hour-boundary bench, a crate of its own that no build reads.
    engine-bench/*) return 1 ;;

    # The conformance suite. The lock files build (engineCompat.ts LOCK_FILES);
    # the fixtures, scenarios and fuzz corpus are read only by tests.
    conformance/catalog-digests.json | conformance/expected.json) return 0 ;;
    conformance/loader-cases.json | conformance/tdt-cases.json) return 0 ;;
    # The fixtures the engine's rule tests compile in with include_str!.
    conformance/fixtures/sixseven_2.vctower | conformance/fixtures/split-tower.vctower | conformance/fixtures/towerone_6.vctower) return 0 ;;
    conformance/*) return 1 ;;

    # Standalone dev scripts that no build step imports or runs.
    scripts/screenshot* | scripts/scenes/*) return 1 ;;
    scripts/perf-* | scripts/fuzz-* | scripts/posthog-* | scripts/rollback-*) return 1 ;;
    scripts/test-port.ts | scripts/derive-fixture.ts) return 1 ;;
    scripts/release.ts | scripts/version-check.ts) return 1 ;;
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

# The pending change notes whose app or crate level is not `none`, one path per
# line. A merged feature PR leaves its note in .changes/ (src/build/changeNotes.ts)
# and the release PR raises the versions and deletes the notes. Until then a
# production build would ship the new behavior under the old version and the old
# "What's new" notes, and report the old crate version beside a new lock, so
# production waits for the release PR. Previews still build.
held_notes() {
  local note
  for note in .changes/*.md; do
    [ -f "$note" ] || continue
    [ "${note##*/}" = README.md ] && continue
    # Reads the front matter the way parseNote does: each line trimmed, and
    # a "# ..." comment dropped.
    awk '{ sub(/\r$/, "") }
      NR == 1 && $0 != "---" { exit }
      NR > 1 && $0 == "---" { exit }
      { v = $0; sub(/[ \t]*#.*$/, "", v); sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v) }
      v ~ /^(app|crate):/ {
        sub(/^[a-z]+:[ \t]*/, "", v)
        if (v != "none") { print FILENAME; exit }
      }' "$note"
  done
}

if [ "${VERCEL_ENV:-}" = "production" ]; then
  held="$(held_notes)"
  if [ -n "$held" ]; then
    echo "vercel-ignore-build: holding production until the release PR; pending notes ask for a release: $(printf '%s' "$held" | tr '\n' ' ')"
    exit 0
  fi
fi

# Fetches one commit and its trees (no file contents) from the GitHub repo
# Vercel cloned, so a previous deploy outside the shallow clone can still be
# diffed: one a force-push removed from the branch (GitHub still serves it by
# SHA), or an ancestor older than the clone depth. The fetch leaves the clone a
# partial clone (it registers the URL as a promisor remote and adds a shallow
# boundary); the build only runs `git rev-parse HEAD`, which that does not
# affect. Prints why and returns non-zero when it cannot fetch.
# Production deploys only on a release merge (owner, 2026-11-11): a push to main
# whose commit leaves the app version (package.json) and the engine crate
# version (engine-rs/Cargo.toml) as its first parent had them is skipped,
# however much else changed. The release PR raises one or both, so its merge
# commit is the deploy. This reads the push's own commit and its first parent,
# which every clone has, and not the previous deploy, which can arrive without
# its file contents or fail to fetch; it runs before the previous deploy is
# resolved, so neither can bypass it. With no parent to read, it falls through
# to the per-path diff below. Previews build per change below.
app_version() { git show "$1:package.json" 2>/dev/null | sed -n 's/^  "version": "\(.*\)",$/\1/p' | head -n 1; }
crate_version() { git show "$1:engine-rs/Cargo.toml" 2>/dev/null | awk '/^\[package\]/ { p = 1; next } /^\[/ { p = 0 } p && /^version *=/ { gsub(/.*= *"|".*/, ""); print; exit }'; }
if [ "${VERCEL_ENV:-}" = "production" ]; then
  parent="$(git rev-parse --verify --quiet 'HEAD^1' || true)"
  if [ -n "$parent" ] && [ "$(app_version "$parent")" = "$(app_version HEAD)" ] && [ "$(crate_version "$parent")" = "$(crate_version HEAD)" ]; then
    echo "vercel-ignore-build: production deploys only on a release merge, and this commit changes no version; skipping."
    exit 0
  fi
fi

fetch_commit() {
  if [ "${VERCEL_GIT_PROVIDER:-}" != "github" ] || [ -z "${VERCEL_GIT_REPO_OWNER:-}" ] || [ -z "${VERCEL_GIT_REPO_SLUG:-}" ]; then
    echo "vercel-ignore-build: no GitHub repo to fetch from."
    return 1
  fi
  local url="https://github.com/${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}.git"
  # No credential prompt: a repo that needs one fails at once and builds.
  local fetch=(env GIT_TERMINAL_PROMPT=0 git fetch --quiet --no-tags --no-write-fetch-head --depth=1 --filter=blob:none "$url" "$1")
  local err
  if command -v timeout >/dev/null 2>&1; then fetch=(timeout 60 "${fetch[@]}"); fi
  if ! err="$("${fetch[@]}" 2>&1 >/dev/null)"; then
    echo "vercel-ignore-build: fetching ${1} failed: ${err:-timed out or no message}"
    return 1
  fi
  git cat-file -e "${1}^{commit}" 2>/dev/null
}

# Diff base: the previously deployed commit when Vercel provides it, else this
# commit's parent. A previous deploy missing from the clone is fetched; if that
# fails it builds, since falling back to the parent would compare only the last
# commit. With neither a previous deploy nor a parent (first deploy), build to
# be safe.
base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -n "$base" ]; then
  # Only a full SHA (in either case): a name like HEAD would diff against
  # itself, and a value starting with "-" would read as a git option.
  base="$(printf '%s' "$base" | tr 'A-F' 'a-f')"
  if ! [[ "$base" =~ ^[0-9a-f]{40}$ ]]; then
    echo "vercel-ignore-build: previous deploy ${base} is not a full commit SHA; building."
    exit 1
  fi
  if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
    if ! fetch_commit "$base"; then
      echo "vercel-ignore-build: previous deploy ${base} is not in this clone and could not be fetched; building."
      exit 1
    fi
    echo "vercel-ignore-build: fetched previous deploy ${base}, which was not in this clone."
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
