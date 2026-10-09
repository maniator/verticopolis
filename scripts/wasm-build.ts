/**
 * Build the Rust engine's WASM binding into engine-rs/pkg/ for Node:
 * `cargo rustc` for wasm32 with the `wasm` feature as a cdylib, `wasm-bindgen`
 * for the JavaScript glue, and a package.json marking the output CommonJS (the
 * repository is ESM, and wasm-bindgen's Node target emits `require`).
 * Needs the wasm32-unknown-unknown target and a wasm-bindgen CLI of the
 * version Cargo.toml pins (`rustup target add wasm32-unknown-unknown`,
 * `cargo install wasm-bindgen-cli --locked --version <pinned>`).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const crate = resolve(dirname(fileURLToPath(import.meta.url)), "../engine-rs");

/** The exact wasm-bindgen version Cargo.toml pins, found on the dependency's
 *  line whatever the spacing, or in a `[dependencies.wasm-bindgen]` table. */
function pinnedWasmBindgen(cargoToml: string): string | undefined {
  return /^\s*wasm-bindgen\s*=\s*\{[^}]*version\s*=\s*"=([0-9.]+)"/m.exec(cargoToml)?.[1]
    ?? /^\s*wasm-bindgen\s*=\s*"=([0-9.]+)"/m.exec(cargoToml)?.[1]
    ?? /^\[dependencies\.wasm-bindgen\]\s*\n(?:(?!\[)[^\n]*\n)*?\s*version\s*=\s*"=([0-9.]+)"/m.exec(cargoToml)?.[1];
}

const pinned = pinnedWasmBindgen(readFileSync(resolve(crate, "Cargo.toml"), "utf8"));
if (!pinned) throw new Error("engine-rs/Cargo.toml does not pin wasm-bindgen with an exact version");
const install = `install it with: cargo install wasm-bindgen-cli --locked --version ${pinned}`;
let probe: string;
try {
  probe = execFileSync("wasm-bindgen", ["--version"], { encoding: "utf8" });
} catch (e) {
  const code = (e as { code?: string }).code;
  throw new Error(code === "ENOENT" ? `the wasm-bindgen CLI is not on PATH; ${install}` : `wasm-bindgen --version failed: ${String(e)}`);
}
const cli = /^wasm-bindgen (\d+\.\d+\.\d+)\r?$/m.exec(probe)?.[1];
if (!cli) throw new Error(`wasm-bindgen --version printed something unexpected: ${probe.trim()}`);
if (cli !== pinned) throw new Error(`wasm-bindgen CLI ${cli} does not match the pinned crate ${pinned}; ${install}`);

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: crate, stdio: "inherit" });
// The crate is an rlib; the cdylib is asked for here so the native build
// stays as it is. The old package goes first, so a failed run leaves no
// stale package behind for the suite to replay.
rmSync(resolve(crate, "pkg"), { recursive: true, force: true });
run("cargo", ["rustc", "--locked", "--release", "--lib", "--target", "wasm32-unknown-unknown", "--features", "wasm", "--crate-type", "cdylib"]);
run("wasm-bindgen", ["--target", "nodejs", "--out-dir", "pkg", "target/wasm32-unknown-unknown/release/verticopolis_engine.wasm"]);
writeFileSync(resolve(crate, "pkg/package.json"), '{ "type": "commonjs" }\n');
for (const f of ["verticopolis_engine.js", "verticopolis_engine_bg.wasm"]) {
  if (!existsSync(resolve(crate, "pkg", f))) throw new Error(`wasm-bindgen did not write engine-rs/pkg/${f}`);
}
console.log("engine-rs/pkg: built");
