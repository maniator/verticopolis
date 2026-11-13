/**
 * Build a Rust crate's WASM binding. With no argument it builds the engine
 * twice. The player build (the `wasm` feature) goes to src/public/engine/ for
 * the browser and engine-rs/pkg-player/ for Node; the tooling build (`wasm`
 * and `tooling`, which adds the tier 3 ops the tests and harnesses use) goes to
 * engine-rs/pkg/ for Node and engine-rs/pkg-web-tooling/ for the browser.
 * Each is `cargo rustc` for wasm32 as a cdylib, `wasm-bindgen`
 * for the JavaScript glue, and a package.json marking the output CommonJS (the
 * repository is ESM, and wasm-bindgen's Node target emits `require`). For the
 * engine, the declaration wasm-bindgen writes is copied to
 * src/engineBinding/engine.d.ts, the one checked-in file, so the TypeScript side
 * types against the binding as the Rust source declares it (CI fails when the
 * copy is stale). The engine build also refreshes src/events/gameplayEvents.d.ts
 * (and the bridge's rules beside it, src/events/gameplayEventRules.ts)
 * from engine-rs/src/gameplay/catalog.json (the same as `npm run gen:events`).
 * Each browser target lands with a BUILD.json naming the
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
import { checkCatalog, renderGameplayEventRules, renderGameplayEventsDts } from "../src/events/gameplayCatalog.ts";

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
// The engine is built twice (#1057). The player build (`wasm`) is what ships:
// src/public/engine/ for the browser and engine-rs/pkg-player/ for the npm
// package's Node tree. The tooling build (`tooling`, which adds the binding's
// tier 3 ops, src/engineBinding/exportTiers.ts) is what the test suites and
// the screenshot and e2e harnesses drive: engine-rs/pkg/ for Node and
// engine-rs/pkg-web-tooling/ for the browser, which a VC_TOOLING=1 build and
// a dev serve put in place of src/public/engine/ (vite.config.ts). The other
// crates have one build, into pkg/.
const PLAYER_FEATURES = "wasm";
const TOOLING_FEATURES = "wasm,tooling";
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: crate, stdio: "inherit" });
const wasm = `target/wasm32-unknown-unknown/release/${target.lib}.wasm`;
/** Compile the cdylib with `features`. The crate is an rlib; the cdylib is
 *  asked for here so the native build stays as it is. */
function compile(features: string): void {
  run("cargo", ["rustc", "--locked", "--release", "--lib", "--target", "wasm32-unknown-unknown", "--features", features, "--crate-type", "cdylib"]);
}
// The hash of the sources every binary is stamped with and BUILD.json records.
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
/** The Node target into `dir` (relative to the crate), marked CommonJS (the
 *  repository is ESM, and wasm-bindgen's Node target emits `require`). */
function nodePackage(dir: string): void {
  rmSync(resolve(crate, dir), { recursive: true, force: true });
  run("wasm-bindgen", ["--target", "nodejs", "--out-dir", dir, wasm]);
  writeFileSync(resolve(crate, dir, "package.json"), '{ "type": "commonjs" }\n');
  for (const f of [`${target.lib}.js`, `${target.lib}_bg.wasm`]) {
    if (!existsSync(resolve(crate, dir, f))) throw new Error(`wasm-bindgen did not write ${target.dir}/${dir}/${f}`);
  }
  if (which === "engine") stamp(resolve(crate, dir, `${target.lib}_bg.wasm`));
}
/**
 * The browser target into `web`, with the BUILD.json and THIRD-PARTY.json
 * the served package carries. Its BUILD.json records a hash of the Rust
 * sources it was built from: CI keys its cache on that hash, and
 * src/wasmhost/packageHash.test.ts fails when the sources moved on without a
 * rebuild. `record` is the crates and standard library compiled in, with
 * their licenses (#955).
 */
function webPackage(web: string, label: string, record: ReturnType<typeof engineThirdParty>): void {
  rmSync(web, { recursive: true, force: true });
  run("wasm-bindgen", ["--target", "web", "--out-dir", web, wasm]);
  for (const f of [ENGINE_GLUE, ENGINE_WASM]) {
    if (!existsSync(resolve(web, f))) throw new Error(`wasm-bindgen did not write ${label}/${f}`);
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
  const build = engineBuildRecord(readFileSync(resolve(web, ENGINE_GLUE)), readFileSync(resolve(web, ENGINE_WASM)), sources, sha256Hex, crateRecord);
  writeFileSync(resolve(web, ENGINE_BUILD_RECORD), `${JSON.stringify(build, null, 2)}\n`);
  // The record also names the .wasm it describes, so the site build can tell a
  // record from another build of the same sources (or a .wasm copied in).
  const wasmSha = createHash("sha256").update(readFileSync(resolve(web, ENGINE_WASM))).digest("hex");
  writeFileSync(resolve(web, ENGINE_THIRD_PARTY), `${JSON.stringify({ sources, wasm: wasmSha, crates: record }, null, 2)}\n`);
  // Every file left in the package must be listed in engineAssets.ts, which
  // says whether the game fetches it at run time (and so whether the service
  // worker must precache it, #985). A new file from wasm-bindgen (a
  // `snippets/` folder, say) or from this script stops the build here.
  const listed = new Set(ENGINE_PACKAGE.map((f) => f.name));
  const written = readdirSync(web, { recursive: true, withFileTypes: true })
    .filter((e) => !e.isDirectory())
    .map((e) => relative(web, resolve(e.parentPath, e.name)).split("\\").join("/"));
  const unlisted = written.filter((f) => !listed.has(f));
  if (unlisted.length > 0) throw new Error(`${label}/ holds files src/wasmhost/engineAssets.ts does not list; add each with whether the game fetches it at run time: ${unlisted.join(", ")}`);
  const absent = [...listed].filter((f) => !written.includes(f));
  if (absent.length > 0) throw new Error(`src/wasmhost/engineAssets.ts lists files the build did not write to ${label}/: ${absent.join(", ")}`);
}

if (which === "engine") {
  // The crates and the standard library compiled into each build, with their
  // licenses, gathered before anything is compiled or written, so a crate
  // that cannot be attributed stops the build with the old packages still in
  // place (#955). One feature list for each record and its compile, so they
  // describe the same build.
  const playerRecord = engineThirdParty(crate, PLAYER_FEATURES);
  const toolingRecord = engineThirdParty(crate, TOOLING_FEATURES);
  // The old packages go first, so a failed run leaves no stale package behind
  // for the suite to replay.
  for (const dir of ["pkg", "pkg-player", "pkg-web-tooling"]) rmSync(resolve(crate, dir), { recursive: true, force: true });
  compile(PLAYER_FEATURES);
  webPackage(resolve(crate, "../src/public/engine"), "src/public/engine", playerRecord);
  nodePackage("pkg-player");
  compile(TOOLING_FEATURES);
  nodePackage("pkg");
  webPackage(resolve(crate, "pkg-web-tooling"), `${target.dir}/pkg-web-tooling`, toolingRecord);
  // The class declaration is the same for both targets; the tooling Node copy
  // is the committed one (`src/engineBinding/binding.ts` types against it),
  // so the tooling harnesses type against the tier 3 ops the player build
  // leaves out.
  copyFileSync(resolve(crate, "pkg/verticopolis_engine.d.ts"), resolve(crate, "../src/engineBinding/engine.d.ts"));
  // The gameplay event types and the bridge's runtime rules come from the
  // catalog both engines are held to, so they are refreshed with the
  // binding's own declaration.
  const catalog = checkCatalog(JSON.parse(readFileSync(resolve(crate, "src/gameplay/catalog.json"), "utf8")));
  writeFileSync(resolve(crate, "../src/events/gameplayEvents.d.ts"), renderGameplayEventsDts(catalog));
  writeFileSync(resolve(crate, "../src/events/gameplayEventRules.ts"), renderGameplayEventRules(catalog));
  console.log("src/public/engine and engine-rs/pkg-player (player build), engine-rs/pkg and engine-rs/pkg-web-tooling (tooling build): built; src/engineBinding/engine.d.ts, src/events/gameplayEvents.d.ts and gameplayEventRules.ts refreshed");
} else {
  compile(PLAYER_FEATURES);
  nodePackage("pkg");
  console.log(`${target.dir}/pkg: built`);
}
