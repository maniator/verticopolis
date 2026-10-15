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
# (scripts/wasm-build.ts refuses any other version). Needs curl, tar,
# sha256sum and a host C linker (cargo builds the crate's build scripts for
# the host). The prebuilt binaries it fetches are the x86_64 Linux ones;
# elsewhere, install the toolchain by hand (engine-rs/README.md) and run
# npm run wasm:build.
#
# Every download is checked against a SHA-256 recorded below before it runs or
# is unpacked. CI caches the built package under a key that hashes the sources
# and this script, so a tampered download would otherwise be served from the
# cache until either changed.
set -euo pipefail

# The wasm-bindgen CLI archive, recorded for the version engine-rs/Cargo.toml
# pins (the script stops when the two disagree). Bumping that pin means
# updating both lines here: take the hash from the release's own
# `<archive>.tar.gz.sha256sum` asset and confirm it with sha256sum on a fresh
# download. src/tests/buildEngineWasm.guard.test.ts checks the pairing.
WASM_BINDGEN_VERSION="0.2.129"
WASM_BINDGEN_SHA256="82d12bb940e2d4e72e0d5605387fc1b8ca179044e012b620f0ce4e7440e8320e"
# rustup-init for x86_64-unknown-linux-gnu, from static.rust-lang.org's
# versioned archive: the same binary https://sh.rustup.rs downloads, run
# directly so no unverified script is piped to sh. The hash is the published
# `rustup-init.sha256` for that version. This version only installs rustup
# itself; the Rust toolchain is still the rust-version below.
RUSTUP_VERSION="1.29.1"
RUSTUP_INIT_SHA256="dda7234360b7f578ca8b0ddcb80145646fa61a67c1720a5abc7051b35c9fcb71"

if [ "$(uname -s)" != "Linux" ] || [ "$(uname -m)" != "x86_64" ]; then
  echo "build-engine-wasm: this script fetches the x86_64 Linux wasm-bindgen and rustup-init; on $(uname -s) $(uname -m), install the toolchain by hand (engine-rs/README.md) and run npm run wasm:build" >&2
  exit 1
fi

# verify_sha256 FILE EXPECTED: stop the build unless FILE hashes to EXPECTED.
verify_sha256() {
  local actual
  actual=$(sha256sum "$1" | cut -d' ' -f1)
  if [ "$actual" != "$2" ]; then
    echo "build-engine-wasm: checksum mismatch for $(basename "$1")" >&2
    echo "  expected sha256 $2" >&2
    echo "  actual   sha256 $actual" >&2
    echo "build-engine-wasm: refusing to use the download, since it does not match the hash recorded in scripts/build-engine-wasm.sh" >&2
    exit 1
  fi
}

PIN=$(node -e 'const t=require("fs").readFileSync("engine-rs/Cargo.toml","utf8");const m=/^\s*wasm-bindgen\s*=\s*\{[^}]*version\s*=\s*"=([0-9.]+)"/m.exec(t);if(!m)throw new Error("engine-rs/Cargo.toml does not pin wasm-bindgen");process.stdout.write(m[1])')
RUST=$(node -e 'const t=require("fs").readFileSync("engine-rs/Cargo.toml","utf8");const m=/^rust-version\s*=\s*"([0-9.]+)"/m.exec(t);if(!m)throw new Error("engine-rs/Cargo.toml does not declare rust-version");process.stdout.write(m[1])')
if [ "$PIN" != "$WASM_BINDGEN_VERSION" ]; then
  echo "build-engine-wasm: engine-rs/Cargo.toml pins wasm-bindgen ${PIN}, but this script records the archive checksum for ${WASM_BINDGEN_VERSION}; update WASM_BINDGEN_VERSION and WASM_BINDGEN_SHA256 here" >&2
  exit 1
fi
# rust-version names a minor release (1.97); the conformance gate in
# engine-rs.yml runs its .0 patch release, so build with exactly that one
# rather than whatever patch rustup resolves today (CI keys its package cache
# on Cargo.toml, so a moving patch release would hide behind a cache hit).
case "$RUST" in *.*.*) ;; *) RUST="${RUST}.0" ;; esac
export PATH="$HOME/.cargo/bin:$PATH"

# Downloads land here and are checked before use; nothing unverified reaches
# ~/.cargo/bin.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# The build image may ship its own cargo (an older release without rustup);
# the crate's rust-version refuses it. Key the install on rustup, put rustup's
# shims first on PATH, and pin the toolchain for every cargo call below.
if ! command -v rustup >/dev/null 2>&1; then
  echo "build-engine-wasm: installing rustup ${RUSTUP_VERSION} with Rust ${RUST}"
  curl -sSf --retry 3 --retry-all-errors -o "$WORK/rustup-init" \
    "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init"
  verify_sha256 "$WORK/rustup-init" "$RUSTUP_INIT_SHA256"
  chmod +x "$WORK/rustup-init"
  "$WORK/rustup-init" -y --profile minimal --no-modify-path --default-toolchain "${RUST}"
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
  curl -sSfL --retry 3 --retry-all-errors -o "$WORK/${ARCHIVE}.tar.gz" \
    "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${PIN}/${ARCHIVE}.tar.gz"
  verify_sha256 "$WORK/${ARCHIVE}.tar.gz" "$WASM_BINDGEN_SHA256"
  tar -xzf "$WORK/${ARCHIVE}.tar.gz" -C "$HOME/.cargo/bin" --strip-components=1 "${ARCHIVE}/wasm-bindgen"
  chmod +x "$HOME/.cargo/bin/wasm-bindgen"
fi

npm run wasm:build
