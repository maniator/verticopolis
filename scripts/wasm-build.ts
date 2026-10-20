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
 * (and the bridge's rules beside it, src/engine/gameplayEventRules.ts)
 * from conformance/events/catalog.json (the same as `npm run gen:events`).
 * The browser target lands in src/public/engine/ with a BUILD.json naming the
 * sources it came from (see src/wasmhost/packageHash.ts) and the digests of
 * its glue and binary (src/wasmhost/enginePackageRecord.ts) and a
 * THIRD-PARTY.json listing the crates compiled into it (see
 * scripts/engine-third-party.ts).
 * Needs the wasm32-unknown-unknown target and a wasm-bindgen CLI of the
 * version Cargo.toml pins (`rustup target add wasm32-unknown-unknown`,
 * `cargo install wasm-bindgen-cli --locked --version <pinned>`).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { engineSourceHash } from "../src/wasmhost/packageHash.ts";
import { engineBuildRecord } from "../src/wasmhost/enginePackageRecord.ts";
import { BUILD_SECTION, customSectionsOf, parseBuildMetadata, stampBuildSection } from "../src/wasmhost/buildSection.ts";
import { cargoPackage } from "../src/build/engineCompat.ts";
import { ENGINE_BUILD_RECORD, ENGINE_GLUE, ENGINE_PACKAGE, ENGINE_WASM } from "../src/wasmhost/engineAssets.ts";
import { ENGINE_THIRD_PARTY, checkToolchain, engineThirdParty } from "./engine-third-party.ts";
import { checkCatalog, renderGameplayEventRules, renderGameplayEventsDts } from "../src/engine/gameplayCatalog.ts";

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

// The engine's notices record names the standard library it links, so the
// toolchain is checked before the compile rather than after it.
if (which === "engine") {
  const rustVersion = /^rust-version\s*=\s*"([0-9.]+)"/m.exec(readFileSync(resolve(crate, "Cargo.toml"), "utf8"))?.[1];
  if (!rustVersion) throw new Error(`${target.dir}/Cargo.toml declares no rust-version`);
  checkToolchain(crate, rustVersion);
}
// The engine's crates and the Rust standard library, with their licenses,
// gathered before anything is compiled or written, so a crate that cannot be
// attributed stops the build with the old package still in place (#955).
// One feature list for the record and the compile, so they describe the same build.
const FEATURES = "wasm";
const engineRecord = which === "engine" ? engineThirdParty(crate, FEATURES) : [];
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: crate, stdio: "inherit" });
// The crate is an rlib; the cdylib is asked for here so the native build
// stays as it is. The old package goes first, so a failed run leaves no
// stale package behind for the suite to replay.
rmSync(resolve(crate, "pkg"), { recursive: true, force: true });
run("cargo", ["rustc", "--locked", "--release", "--lib", "--target", "wasm32-unknown-unknown", "--features", FEATURES, "--crate-type", "cdylib"]);
const wasm = `target/wasm32-unknown-unknown/release/${target.lib}.wasm`;
// The hash of the sources both binaries are stamped with and BUILD.json records.
// It covers the sources only, so stamping a binary with it cannot change it.
const sources = which === "engine" ? engineSourceHash(crate) : "";
/** Append the build metadata section to a binary wasm-bindgen wrote, then read
 *  it back from the file, so a section the pipeline dropped or garbled stops
 *  the build. This runs before any digest of the file is taken (#963). */
function stamp(file: string): void {
  writeFileSync(file, stampBuildSection(readFileSync(file), sources));
  const back = parseBuildMetadata(customSectionsOf(readFileSync(file), BUILD_SECTION));
  if (back.state !== "ok" || back.sourceHash !== sources) throw new Error(`${file} does not carry the ${BUILD_SECTION} section after stamping`);
}
run("wasm-bindgen", ["--target", "nodejs", "--out-dir", "pkg", wasm]);
writeFileSync(resolve(crate, "pkg/package.json"), '{ "type": "commonjs" }\n');
for (const f of [`${target.lib}.js`, `${target.lib}_bg.wasm`]) {
  if (!existsSync(resolve(crate, "pkg", f))) throw new Error(`wasm-bindgen did not write ${target.dir}/pkg/${f}`);
}
if (which === "engine") stamp(resolve(crate, "pkg", `${target.lib}_bg.wasm`));
if (which === "engine") {
  // The browser build, served beside the app from src/public/engine/ (the WASM
  // host and the dual run's worker load it by URL). It is build output, not
  // checked in; Vercel and CI build it (scripts/build-engine-wasm.sh). Its
  // BUILD.json records a hash of the Rust sources it was built from: CI keys
  // its cache on that hash, and src/wasmhost/packageHash.test.ts fails when
  // the sources moved on without a rebuild.
  const web = resolve(crate, "../src/public/engine");
  rmSync(web, { recursive: true, force: true });
  run("wasm-bindgen", ["--target", "web", "--out-dir", web, wasm]);
  for (const f of [ENGINE_GLUE, ENGINE_WASM]) {
    if (!existsSync(resolve(web, f))) throw new Error(`wasm-bindgen did not write src/public/engine/${f}`);
  }
  // The web target's own declaration is not needed next to the served files.
  rmSync(resolve(web, "verticopolis_engine.d.ts"), { force: true });
  rmSync(resolve(web, "verticopolis_engine_bg.wasm.d.ts"), { force: true });
  stamp(resolve(web, ENGINE_WASM));
  // Schema 2 (#985 criterion 5): `sources` keeps its meaning, and `package`
  // and `files` name the exact glue and binary bytes, so the page can refuse a
  // glue or binary from another build.
  const sha256Hex = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
  // The crate's name and version ride along (#963) so About can name them when
  // the engine never loads; they are not part of the package id.
  const crateRecord = cargoPackage(readFileSync(resolve(crate, "Cargo.toml"), "utf8"));
  const record = engineBuildRecord(readFileSync(resolve(web, ENGINE_GLUE)), readFileSync(resolve(web, ENGINE_WASM)), sources, sha256Hex, crateRecord);
  writeFileSync(resolve(web, ENGINE_BUILD_RECORD), `${JSON.stringify(record, null, 2)}\n`);
  // The crates and the standard library compiled into the package, with
  // their licenses, so the site's notices can list them without a Rust
  // toolchain (#955).
  // The record also names the .wasm it describes, so the site build can tell a
  // record from another build of the same sources (or a .wasm copied in).
  const wasmSha = createHash("sha256").update(readFileSync(resolve(web, ENGINE_WASM))).digest("hex");
  writeFileSync(resolve(web, ENGINE_THIRD_PARTY), `${JSON.stringify({ sources, wasm: wasmSha, crates: engineRecord }, null, 2)}\n`);
  // Every file left in the package must be listed in engineAssets.ts, which
  // says whether the game fetches it at run time (and so whether the service
  // worker must precache it, #985). A new file from wasm-bindgen (a
  // `snippets/` folder, say) or from this script stops the build here.
  const listed = new Set(ENGINE_PACKAGE.map((f) => f.name));
  const written = readdirSync(web, { recursive: true, withFileTypes: true })
    .filter((e) => !e.isDirectory())
    .map((e) => relative(web, resolve(e.parentPath, e.name)).split("\\").join("/"));
  const unlisted = written.filter((f) => !listed.has(f));
  if (unlisted.length > 0) throw new Error(`src/public/engine/ holds files src/wasmhost/engineAssets.ts does not list; add each with whether the game fetches it at run time: ${unlisted.join(", ")}`);
  const absent = [...listed].filter((f) => !written.includes(f));
  if (absent.length > 0) throw new Error(`src/wasmhost/engineAssets.ts lists files the build did not write to src/public/engine/: ${absent.join(", ")}`);
  // The class declaration is the same for both targets; the Node copy is the
  // committed one (`src/dualrun/binding.ts` types against it).
  copyFileSync(resolve(crate, "pkg/verticopolis_engine.d.ts"), resolve(crate, "../src/dualrun/engine.d.ts"));
  // The gameplay event types and the bridge's runtime rules come from the
  // catalog both engines are held to, so they are refreshed with the
  // binding's own declaration.
  const catalog = checkCatalog(JSON.parse(readFileSync(resolve(crate, "../conformance/events/catalog.json"), "utf8")));
  writeFileSync(resolve(crate, "../src/engine/gameplayEvents.d.ts"), renderGameplayEventsDts(catalog));
  writeFileSync(resolve(crate, "../src/engine/gameplayEventRules.ts"), renderGameplayEventRules(catalog));
  console.log("engine-rs/pkg and src/public/engine: built; src/dualrun/engine.d.ts, src/engine/gameplayEvents.d.ts and gameplayEventRules.ts refreshed");
} else {
  console.log(`${target.dir}/pkg: built`);
}
