/**
 * Build a Rust crate's WASM binding. With no argument it builds the engine
 * into engine-rs/pkg/ for Node and src/public/engine/ for the browser:
 * `cargo rustc` for wasm32 with the `wasm` feature as a cdylib, `wasm-bindgen`
 * for the JavaScript glue, and a package.json marking the output CommonJS (the
 * repository is ESM, and wasm-bindgen's Node target emits `require`). For the
 * engine, the declaration wasm-bindgen writes is copied to
 * src/dualrun/engine.d.ts, the one checked-in file, so the TypeScript side
 * types against the binding as the Rust source declares it (CI fails when the
 * copy is stale). The engine build also refreshes src/engine/gameplayEvents.d.ts
 * from conformance/events/catalog.json (the same as `npm run gen:events`).
 * The browser target lands in src/public/engine/ with a BUILD.json naming the
 * sources it came from (see src/wasmhost/packageHash.ts).
 * Needs the wasm32-unknown-unknown target and a wasm-bindgen CLI of the
 * version Cargo.toml pins (`rustup target add wasm32-unknown-unknown`,
 * `cargo install wasm-bindgen-cli --locked --version <pinned>`).
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { engineSourceHash } from "../src/wasmhost/packageHash.ts";
import { checkCatalog, renderGameplayEventsDts } from "../src/engine/gameplayCatalog.ts";

const CRATES: Record<string, { dir: string; lib: string }> = {
  engine: { dir: "engine-rs", lib: "verticopolis_engine" },
};
if (process.argv.length > 3) throw new Error(`expected at most one argument (the crate), got ${process.argv.slice(2).join(" ")}`);
const which = process.argv[2] ?? "engine";
const target = Object.hasOwn(CRATES, which) ? CRATES[which] : undefined;
if (!target) throw new Error(`unknown crate ${which}; expected one of ${Object.keys(CRATES).join(", ")}`);
const crate = resolve(dirname(fileURLToPath(import.meta.url)), "..", target.dir);

/** The exact wasm-bindgen version Cargo.toml pins, found on the dependency's
 *  line whatever the spacing, or in a `[dependencies.wasm-bindgen]` table. */
function pinnedWasmBindgen(cargoToml: string): string | undefined {
  return /^\s*wasm-bindgen\s*=\s*\{[^}]*version\s*=\s*"=([0-9.]+)"/m.exec(cargoToml)?.[1]
    ?? /^\s*wasm-bindgen\s*=\s*"=([0-9.]+)"/m.exec(cargoToml)?.[1]
    ?? /^\[dependencies\.wasm-bindgen\]\s*\n(?:(?!\[)[^\n]*\n)*?\s*version\s*=\s*"=([0-9.]+)"/m.exec(cargoToml)?.[1];
}

const pinned = pinnedWasmBindgen(readFileSync(resolve(crate, "Cargo.toml"), "utf8"));
if (!pinned) throw new Error(`${target.dir}/Cargo.toml does not pin wasm-bindgen with an exact version`);
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
const wasm = `target/wasm32-unknown-unknown/release/${target.lib}.wasm`;
run("wasm-bindgen", ["--target", "nodejs", "--out-dir", "pkg", wasm]);
writeFileSync(resolve(crate, "pkg/package.json"), '{ "type": "commonjs" }\n');
for (const f of [`${target.lib}.js`, `${target.lib}_bg.wasm`]) {
  if (!existsSync(resolve(crate, "pkg", f))) throw new Error(`wasm-bindgen did not write ${target.dir}/pkg/${f}`);
}
if (which === "engine") {
  // The browser build, served beside the app from src/public/engine/ (the WASM
  // host and the dual run's worker load it by URL) and committed, so a
  // deployment without a Rust toolchain (the preview) ships the engine. Its
  // BUILD.json records a hash of the Rust sources it was built from;
  // src/wasmhost/packageHash.test.ts fails when the sources moved on without
  // a rebuild.
  const web = resolve(crate, "../src/public/engine");
  rmSync(web, { recursive: true, force: true });
  run("wasm-bindgen", ["--target", "web", "--out-dir", web, wasm]);
  for (const f of ["verticopolis_engine.js", "verticopolis_engine_bg.wasm"]) {
    if (!existsSync(resolve(web, f))) throw new Error(`wasm-bindgen did not write src/public/engine/${f}`);
  }
  // The web target's own declaration is not needed next to the served files.
  rmSync(resolve(web, "verticopolis_engine.d.ts"), { force: true });
  rmSync(resolve(web, "verticopolis_engine_bg.wasm.d.ts"), { force: true });
  writeFileSync(resolve(web, "BUILD.json"), `${JSON.stringify({ sources: engineSourceHash(crate) }, null, 2)}\n`);
  // The class declaration is the same for both targets; the Node copy is the
  // committed one (`src/dualrun/binding.ts` types against it).
  copyFileSync(resolve(crate, "pkg/verticopolis_engine.d.ts"), resolve(crate, "../src/dualrun/engine.d.ts"));
  // The gameplay event types come from the catalog both engines are held to,
  // so they are refreshed with the binding's own declaration.
  writeFileSync(
    resolve(crate, "../src/engine/gameplayEvents.d.ts"),
    renderGameplayEventsDts(checkCatalog(JSON.parse(readFileSync(resolve(crate, "../conformance/events/catalog.json"), "utf8")))),
  );
  console.log("engine-rs/pkg and src/public/engine: built; src/dualrun/engine.d.ts and src/engine/gameplayEvents.d.ts refreshed");
} else {
  console.log(`${target.dir}/pkg: built`);
}
