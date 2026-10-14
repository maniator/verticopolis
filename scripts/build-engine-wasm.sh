#!/usr/bin/env bash
# Install the toolchain the engine's WASM package needs, then build it with
# `npm run wasm:build` (engine-rs/pkg/ for Node, src/public/engine/ for the
# browser). The package is build output and is not checked in: the Vercel
# deploy (scripts/vercel-build.sh) and CI (.github/actions/engine-wasm) both
# build it through this script.
#
# Toolchain: rustup (minimal profile, the `rust-version` engine-rs/Cargo.toml
# declares, so every build compiles with the same release the conformance gate
# runs on), the wasm32-unknown-unknown target, and the wasm-bindgen CLI at
# exactly the version Cargo.toml pins, from its prebuilt release archive
# (scripts/wasm-build.ts refuses any other version). Needs curl, tar and a
# host C linker (cargo builds the crate's build scripts for the host). The
# prebuilt wasm-bindgen it fetches is the x86_64 Linux one; elsewhere, install
# the toolchain by hand (engine-rs/README.md) and run npm run wasm:build.
set -euo pipefail

if [ "$(uname -s)" != "Linux" ] || [ "$(uname -m)" != "x86_64" ]; then
  echo "build-engine-wasm: this script fetches the x86_64 Linux wasm-bindgen; on $(uname -s) $(uname -m), install the toolchain by hand (engine-rs/README.md) and run npm run wasm:build" >&2
  exit 1
fi

PIN=$(node -e 'const t=require("fs").readFileSync("engine-rs/Cargo.toml","utf8");const m=/^\s*wasm-bindgen\s*=\s*\{[^}]*version\s*=\s*"=([0-9.]+)"/m.exec(t);if(!m)throw new Error("engine-rs/Cargo.toml does not pin wasm-bindgen");process.stdout.write(m[1])')
RUST=$(node -e 'const t=require("fs").readFileSync("engine-rs/Cargo.toml","utf8");const m=/^rust-version\s*=\s*"([0-9.]+)"/m.exec(t);if(!m)throw new Error("engine-rs/Cargo.toml does not declare rust-version");process.stdout.write(m[1])')
# rust-version names a minor release (1.97); the conformance gate in
# engine-rs.yml runs its .0 patch release, so build with exactly that one
# rather than whatever patch rustup resolves today (CI keys its package cache
# on Cargo.toml, so a moving patch release would hide behind a cache hit).
case "$RUST" in *.*.*) ;; *) RUST="${RUST}.0" ;; esac
export PATH="$HOME/.cargo/bin:$PATH"

# The build image may ship its own cargo (an older release without rustup);
# the crate's rust-version refuses it. Key the install on rustup, put rustup's
# shims first on PATH, and pin the toolchain for every cargo call below.
if ! command -v rustup >/dev/null 2>&1; then
  echo "build-engine-wasm: installing rustup with Rust ${RUST}"
  curl -sSf --retry 3 --retry-all-errors https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path --default-toolchain "${RUST}"
else
  rustup toolchain install "${RUST}" --profile minimal
fi
export RUSTUP_TOOLCHAIN="${RUST}"
rustup target add wasm32-unknown-unknown
cargo --version

if ! wasm-bindgen --version 2>/dev/null | grep -qxF "wasm-bindgen ${PIN}"; then
  echo "build-engine-wasm: installing wasm-bindgen ${PIN}"
  mkdir -p "$HOME/.cargo/bin"
  ARCHIVE="wasm-bindgen-${PIN}-x86_64-unknown-linux-musl"
  curl -sSfL --retry 3 --retry-all-errors "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${PIN}/${ARCHIVE}.tar.gz" \
    | tar -xz -C "$HOME/.cargo/bin" --strip-components=1 "${ARCHIVE}/wasm-bindgen"
  chmod +x "$HOME/.cargo/bin/wasm-bindgen"
fi

npm run wasm:build
