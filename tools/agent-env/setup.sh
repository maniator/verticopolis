#!/bin/bash
# Agent environment setup: one script any coding agent's Linux sandbox can run
# (Claude Code cloud sessions run it from .claude/hooks/session-start.sh; a
# Codex environment's setup script and a person's fresh Linux box can call it
# directly). It installs what CI uses, so the agent can run every quality
# gate, build the engine, run e2e and render screenshots in the pinned
# Playwright image itself:
#
#   - Node.js at the .nvmrc version (package.json engines asks for 26.x)
#   - npm dependencies (npm ci, skipped while the lockfile is unchanged)
#   - Rust at the engine's rust-version, as the default toolchain, with
#     rustfmt, clippy and the wasm32 target
#   - the engine WASM package (scripts/build-engine-wasm.sh, which pins and
#     checksums wasm-bindgen), skipped while it matches the Rust sources
#   - Docker: starts dockerd when it is installed and not running, and pulls
#     the pinned Playwright image in the background
#   - the Playwright MCP server package, so .mcp.json starts it quickly
#
# Usage: bash tools/agent-env/setup.sh [--claude-user]
#   --claude-user          also register the session hook and the Playwright MCP
#                          server with Claude Code at user scope
#                          (tools/agent-env/claude-user.mjs) and pull the
#                          pinned image before exiting: for a cloud
#                          environment's setup script, whose sessions may start
#                          above the checkout and never read .claude/ here.
#                          The exports also go to /etc/profile.d/vc-agent-env.sh,
#                          which login shells read and the top of ~/.bashrc
#                          sources (above its interactive-only guard)
#   AGENT_ENV_FILE=<file>  append `export` lines (PATH, PW_CHROMIUM_PATH,
#                          VC_PLAYWRIGHT_IMAGE) for later shells to source
#   AGENT_ENV_NO_DOCKER=1  skip the Docker step
#
# Linux x64 only. Each step skips work that is already done, so a rerun costs
# about a second. A failed step prints why and the script goes on, so the
# agent still starts and can see what is missing; logs go to $LOG_DIR.
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1
CLAUDE_USER=""
PROFILE_FILE=/etc/profile.d/vc-agent-env.sh
if [ "${1:-}" = "--claude-user" ]; then CLAUDE_USER=1; fi
LOG_DIR="${TMPDIR:-/tmp}/vc-agent-setup"
mkdir -p "$LOG_DIR"
# One run at a time: the checkout's hook and the user-scope hook, or a hook and
# a hand run, would otherwise race on npm ci and on starting dockerd.
if command -v flock >/dev/null 2>&1; then
  exec 9> "$LOG_DIR/setup.lock"
  flock 9  # background children below close fd 9, so the lock ends with this script
fi
say() { echo "agent-setup: $*" >&2; }
warn() { echo "agent-setup: WARNING: $*" >&2; }
env_line() {
  if [ -n "${AGENT_ENV_FILE:-}" ]; then echo "$1" >> "$AGENT_ENV_FILE"; fi
  if [ -n "$CLAUDE_USER" ] && [ -w "$PROFILE_FILE" ]; then echo "$1" >> "$PROFILE_FILE"; fi
}
if [ -n "$CLAUDE_USER" ] && [ -d /etc/profile.d ]; then
  : > "$PROFILE_FILE" 2>/dev/null || warn "cannot write $PROFILE_FILE; shells keep the old PATH"
fi

if [ "$(uname -s)" != "Linux" ] || [ "$(uname -m)" != "x86_64" ]; then
  warn "this script sets up Linux x64 only; see tools/agent-env/README.md for other hosts"
  exit 0
fi

# --- Node.js at the .nvmrc version --------------------------------------------
NODE_WANT="$(tr -d ' \r\n' < .nvmrc 2>/dev/null)"
NODE_DIR="/opt/node-v${NODE_WANT}"
if [ -n "$NODE_WANT" ] && [ "$(node -v 2>/dev/null)" != "v${NODE_WANT}" ]; then
  if [ ! -x "$NODE_DIR/bin/node" ]; then
    say "installing Node.js ${NODE_WANT}"
    tarball="node-v${NODE_WANT}-linux-x64.tar.xz"
    tmp="$(mktemp -d)"
    if curl -fsSL --retry 3 -o "$tmp/$tarball" "https://nodejs.org/dist/v${NODE_WANT}/$tarball" \
      && curl -fsSL --retry 3 -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/v${NODE_WANT}/SHASUMS256.txt" \
      && (cd "$tmp" && grep " ${tarball}\$" SHASUMS256.txt | sha256sum --check --status) \
      && mkdir -p "$NODE_DIR" && tar -xJf "$tmp/$tarball" -C "$NODE_DIR" --strip-components=1; then
      say "Node.js ${NODE_WANT} installed in ${NODE_DIR}"
    else
      rm -rf "$NODE_DIR"
      warn "could not install Node.js ${NODE_WANT} from nodejs.org; staying on $(node -v 2>/dev/null || echo 'no node')"
    fi
    rm -rf "$tmp"
  fi
fi
# Exported even when this shell already has it, so the env file and the
# profile file always carry it.
if [ -n "$NODE_WANT" ] && [ -x "$NODE_DIR/bin/node" ]; then
  case "$PATH:" in "$NODE_DIR/bin:"*) ;; *) export PATH="$NODE_DIR/bin:$PATH" ;; esac  # first, ahead of any other Node
  env_line "export PATH=\"$NODE_DIR/bin:\$PATH\""
fi

# A cloud container ships its own Node in /opt (Claude Code's: /opt/node22/bin),
# early on the PATH of agent shells that read no profile file. In an
# environment's setup script, point that copy's node, npm, npx and corepack at
# the .nvmrc Node, keeping each original beside it as <name>.vc-agent-orig.
if [ -n "$CLAUDE_USER" ] && [ -x "$NODE_DIR/bin/node" ]; then
  for other in $(type -ap node); do
    dir="$(dirname "$other")"
    case "$dir" in "$NODE_DIR/bin" | /opt/*/*/* ) continue ;; /opt/*/bin) ;; *) continue ;; esac
    [ -w "$dir" ] || continue
    linked=""
    for tool in node npm npx corepack; do
      [ -e "$NODE_DIR/bin/$tool" ] || continue
      [ "$(readlink "$dir/$tool" 2>/dev/null)" = "$NODE_DIR/bin/$tool" ] && continue
      if [ -e "$dir/$tool" ] || [ -L "$dir/$tool" ]; then mv -f "$dir/$tool" "$dir/$tool.vc-agent-orig"; fi
      ln -s "$NODE_DIR/bin/$tool" "$dir/$tool" && linked=1
    done
    if [ -n "$linked" ]; then say "$dir/node now runs Node.js ${NODE_WANT} (originals kept as *.vc-agent-orig)"; fi
  done
fi

# --- npm dependencies -----------------------------------------------------------
hashes=node_modules/.agent-setup.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  rm -f "$hashes"
  say "npm ci"
  if npm ci --no-audit --no-fund > "$LOG_DIR/npm-ci.log" 2>&1; then
    sha256sum package.json package-lock.json .nvmrc > "$hashes"
  else
    warn "npm ci failed (log: $LOG_DIR/npm-ci.log)"
  fi
fi

# --- Rust toolchain -------------------------------------------------------------
# The version engine-rs.yml pins, made the default so cargo fmt, clippy, test
# and the wasm build all use it without RUSTUP_TOOLCHAIN.
if [ -x "$HOME/.cargo/bin/rustup" ]; then
  case ":$PATH:" in *":$HOME/.cargo/bin:"*) ;; *) export PATH="$HOME/.cargo/bin:$PATH" ;; esac
  env_line "export PATH=\"$HOME/.cargo/bin:\$PATH\""
fi
RUST_WANT="$(sed -n 's/^rust-version *= *"\([0-9.]*\)"/\1/p' engine-rs/Cargo.toml 2>/dev/null | head -1)"
case "$RUST_WANT" in *.*.*) ;; ?*) RUST_WANT="${RUST_WANT}.0" ;; esac
if [ -n "$RUST_WANT" ] && ! command -v rustup >/dev/null 2>&1; then
  warn "rustup is not installed; scripts/build-engine-wasm.sh installs it below"
elif [ -n "$RUST_WANT" ]; then
  if ! rustup target list --installed --toolchain "$RUST_WANT" 2>/dev/null | grep -qx wasm32-unknown-unknown \
    || ! rustup component list --installed --toolchain "$RUST_WANT" 2>/dev/null | grep -q '^clippy' \
    || ! rustup component list --installed --toolchain "$RUST_WANT" 2>/dev/null | grep -q '^rustfmt'; then
    say "installing Rust ${RUST_WANT} (rustfmt, clippy, wasm32)"
    if ! { rustup toolchain install "$RUST_WANT" --profile minimal --component rustfmt,clippy \
        && rustup target add wasm32-unknown-unknown --toolchain "$RUST_WANT"; } > "$LOG_DIR/rustup.log" 2>&1; then
      warn "Rust ${RUST_WANT} install failed (log: $LOG_DIR/rustup.log)"
    fi
  fi
  rustup default "$RUST_WANT" > /dev/null 2>&1 || true
fi

# --- Engine WASM package --------------------------------------------------------
# Built when missing or stale against the Rust sources (the check the
# engine-wasm action makes). After an engine-rs edit, run `npm run wasm:build`.
engine_current() {
  [ -f src/public/engine/BUILD.json ] && [ -f engine-rs/pkg/verticopolis_engine.js ] || return 1
  local want built
  want="$(node --input-type=module -e 'import { engineSourceHash } from "./src/wasmhost/packageHash.ts"; process.stdout.write(engineSourceHash("engine-rs"))' 2>/dev/null)" || return 1
  built="$(node -p 'require("./src/public/engine/BUILD.json").sources' 2>/dev/null)" || return 1
  [ -n "$want" ] && [ "$want" = "$built" ]
}
if [ -d node_modules ] && ! engine_current; then
  say "building the engine WASM package (one to three minutes)"
  if bash scripts/build-engine-wasm.sh > "$LOG_DIR/engine-wasm.log" 2>&1; then
    say "engine package built"
  else
    warn "engine build failed (log: $LOG_DIR/engine-wasm.log); rerun: bash scripts/build-engine-wasm.sh"
  fi
fi

# --- Playwright on the host -----------------------------------------------------
# The lockfile's Playwright wants its own Chromium build, and its download host
# may be blocked; point e2e and the MCP server at a preinstalled Chromium
# (playwright.config.ts reads PW_CHROMIUM_PATH). Canonical pixels still come
# from the pinned image.
if [ -z "${PW_CHROMIUM_PATH:-}" ] && [ -x /opt/pw-browsers/chromium ]; then
  env_line 'export PW_CHROMIUM_PATH=/opt/pw-browsers/chromium'
fi

# --- Playwright MCP server package ----------------------------------------------
# Installed once into a cache folder that playwright-mcp.mjs runs from, on the
# host or mounted into the pinned image (which then needs no network).
MCP_PKG="$(sed -n 's/^const MCP_PACKAGE = "\(.*\)";$/\1/p' tools/agent-env/playwright-mcp.mjs)"
MCP_DIR="$HOME/.cache/vc-agent/${MCP_PKG//[@\/]/_}"
if [ -n "$MCP_PKG" ] && [ ! -f "$MCP_DIR/node_modules/@playwright/mcp/cli.js" ]; then
  say "installing $MCP_PKG"
  mkdir -p "$MCP_DIR"
  npm install --prefix "$MCP_DIR" --no-audit --no-fund --no-save "$MCP_PKG" > "$LOG_DIR/playwright-mcp.log" 2>&1 \
    || warn "could not install $MCP_PKG (log: $LOG_DIR/playwright-mcp.log)"
fi

# --- Claude Code at user scope (--claude-user) ----------------------------------
if [ -n "$CLAUDE_USER" ]; then
  node tools/agent-env/claude-user.mjs || warn "could not register with Claude Code at user scope"
  # Debian's ~/.bashrc returns early for non-interactive shells, so an export
  # appended to it never reaches a script or an agent's command. Source the
  # profile file from its first line instead.
  source_line="[ -f $PROFILE_FILE ] && . $PROFILE_FILE  # vc-agent-env"
  if [ -f "$PROFILE_FILE" ] && ! grep -qF "# vc-agent-env" "$HOME/.bashrc" 2>/dev/null; then
    # Rewritten in place, so a symlinked ~/.bashrc and its mode survive.
    { echo "$source_line"; cat "$HOME/.bashrc" 2>/dev/null; } > "$LOG_DIR/bashrc.new" \
      && cat "$LOG_DIR/bashrc.new" > "$HOME/.bashrc"
  fi
fi

# --- Docker and the pinned Playwright image -------------------------------------
if [ -z "${AGENT_ENV_NO_DOCKER:-}" ] && command -v dockerd >/dev/null 2>&1; then
  if ! docker info > /dev/null 2>&1; then
    say "starting dockerd"
    nohup dockerd > "$LOG_DIR/dockerd.log" 2>&1 9>&- &
    for _ in $(seq 1 30); do docker info > /dev/null 2>&1 && break; sleep 1; done
  fi
  image="$(bash tools/agent-env/pinned.sh --image 2>/dev/null)"
  if docker info > /dev/null 2>&1 && [ -n "$image" ]; then
    env_line "export VC_PLAYWRIGHT_IMAGE=\"$image\""
    if docker image inspect "$image" > /dev/null 2>&1; then
      :
    elif [ -n "$CLAUDE_USER" ]; then
      # An environment's setup script: the image lands in the container that
      # later sessions start from, so wait for it.
      say "pulling $image"
      docker pull "$image" > "$LOG_DIR/docker-pull.log" 2>&1 || warn "docker pull failed (log: $LOG_DIR/docker-pull.log)"
    else
      say "pulling $image in the background (log: $LOG_DIR/docker-pull.log)"
      nohup docker pull "$image" > "$LOG_DIR/docker-pull.log" 2>&1 9>&- &
    fi
  else
    warn "Docker is not running (log: $LOG_DIR/dockerd.log)"
  fi
fi

say "ready: node $(node -v 2>/dev/null), $(rustc --version 2>/dev/null | cut -d' ' -f1-2), $(wasm-bindgen --version 2>/dev/null)"
exit 0
