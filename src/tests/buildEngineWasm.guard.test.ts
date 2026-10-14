import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * `scripts/build-engine-wasm.sh` installs the engine's toolchain for Vercel and
 * CI, and checks each download against a SHA-256 it records (#962). This guard
 * keeps that check in place: the recorded wasm-bindgen version must match the
 * pin in `engine-rs/Cargo.toml` (so a pin bump fails in `npm test` before it
 * reaches a deploy), every recorded hash is a full SHA-256, both downloads
 * go through `verify_sha256` before they are used, and nothing is piped to a
 * shell.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const script = readFileSync(resolve(ROOT, "scripts/build-engine-wasm.sh"), "utf8");
const cargo = readFileSync(resolve(ROOT, "engine-rs/Cargo.toml"), "utf8");

function recorded(name: string): string {
  const m = new RegExp(`^${name}="([^"]*)"$`, "m").exec(script);
  expect(m, `${name} must be recorded in scripts/build-engine-wasm.sh`).not.toBeNull();
  return m![1];
}

describe("build-engine-wasm download checks", () => {
  it("records the archive checksum for the wasm-bindgen version Cargo.toml pins", () => {
    const pin = /^\s*wasm-bindgen\s*=\s*\{[^}]*version\s*=\s*"=([0-9.]+)"/m.exec(cargo);
    expect(pin, "engine-rs/Cargo.toml must pin wasm-bindgen").not.toBeNull();
    expect(recorded("WASM_BINDGEN_VERSION")).toBe(pin![1]);
  });

  it("records full SHA-256 hashes and a rustup version", () => {
    expect(recorded("WASM_BINDGEN_SHA256")).toMatch(/^[0-9a-f]{64}$/);
    expect(recorded("RUSTUP_INIT_SHA256")).toMatch(/^[0-9a-f]{64}$/);
    expect(recorded("RUSTUP_VERSION")).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("verifies each download before it runs or is unpacked", () => {
    const rustupCheck = script.indexOf('verify_sha256 "$WORK/rustup-init" "$RUSTUP_INIT_SHA256"');
    const rustupRun = script.indexOf('"$WORK/rustup-init" -y');
    expect(rustupCheck).toBeGreaterThan(-1);
    expect(rustupRun).toBeGreaterThan(rustupCheck);

    const archiveCheck = script.indexOf('verify_sha256 "$WORK/${ARCHIVE}.tar.gz" "$WASM_BINDGEN_SHA256"');
    const unpack = script.indexOf('tar -xzf "$WORK/${ARCHIVE}.tar.gz"');
    expect(archiveCheck).toBeGreaterThan(-1);
    expect(unpack).toBeGreaterThan(archiveCheck);
  });

  it("pipes no download into a shell or tar", () => {
    expect(script).not.toMatch(/\|\s*(ba)?sh\b/);
    expect(script).not.toMatch(/\|\s*tar\b/);
  });
});
