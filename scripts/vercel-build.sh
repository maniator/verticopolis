#!/usr/bin/env bash
# The Vercel build. The Rust engine's WASM package is built here on every
# deploy, so a change under engine-rs/ reaches the preview and production
# without anyone committing a binary first. The committed src/public/engine/
# stays for checkouts without a Rust toolchain (npm test's hash guard keeps it
# in step); this build overwrites it with a fresh one before Vite runs.
#
# Toolchain: rustup (minimal profile, the `rust-version` engine-rs/Cargo.toml
# declares, so the deploy compiles with the same release the conformance gate
# runs on), the wasm32-unknown-unknown target, and the
# wasm-bindgen CLI at exactly the version Cargo.toml pins, from its prebuilt
# release archive (scripts/wasm-build.ts refuses any other version).
set -euo pipefail

PIN=$(node -e 'const t=require("fs").readFileSync("engine-rs/Cargo.toml","utf8");const m=/^\s*wasm-bindgen\s*=\s*\{[^}]*version\s*=\s*"=([0-9.]+)"/m.exec(t);if(!m)throw new Error("engine-rs/Cargo.toml does not pin wasm-bindgen");process.stdout.write(m[1])')
RUST=$(node -e 'const t=require("fs").readFileSync("engine-rs/Cargo.toml","utf8");const m=/^rust-version\s*=\s*"([0-9.]+)"/m.exec(t);if(!m)throw new Error("engine-rs/Cargo.toml does not declare rust-version");process.stdout.write(m[1])')
export PATH="$HOME/.cargo/bin:$PATH"

# The build image may ship its own cargo (an older release without rustup);
# the crate's rust-version refuses it. Key the install on rustup, put rustup's
# shims first on PATH, and pin the toolchain for every cargo call below.
if ! command -v rustup >/dev/null 2>&1; then
  echo "vercel-build: installing rustup with Rust ${RUST}"
  curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path --default-toolchain "${RUST}"
else
  rustup toolchain install "${RUST}" --profile minimal
fi
export RUSTUP_TOOLCHAIN="${RUST}"
rustup target add wasm32-unknown-unknown
cargo --version

if ! wasm-bindgen --version 2>/dev/null | grep -qxF "wasm-bindgen ${PIN}"; then
  echo "vercel-build: installing wasm-bindgen ${PIN}"
  mkdir -p "$HOME/.cargo/bin"
  ARCHIVE="wasm-bindgen-${PIN}-x86_64-unknown-linux-musl"
  curl -sSfL "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${PIN}/${ARCHIVE}.tar.gz" \
    | tar -xz -C "$HOME/.cargo/bin" --strip-components=1 "${ARCHIVE}/wasm-bindgen"
  chmod +x "$HOME/.cargo/bin/wasm-bindgen"
fi

npm run wasm:build
npm run build
