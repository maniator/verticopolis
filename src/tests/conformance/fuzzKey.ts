/**
 * The differential's window key (plan section 4.2, B2): a SHA-256 over every
 * input that decides what a nightly fuzz run proves. A night counts toward the
 * 14-night window only on one unchanged key, and the freeze guard fails a pull
 * request that moves it. Usage:
 *   npx tsx scripts/fuzz-key.ts            prints the key
 *   npx tsx scripts/fuzz-key.ts --parts    prints the key and each part's hash
 * (the script is a thin wrapper; the code lives here so `tsc` and the tests see it)
 *
 * The key is deliberately wide: an extra reset costs time, a missing input
 * lets an untested change through. It covers
 *   engine      the Rust crate and the event catalog (`engineSourceHash`)
 *   scripts     the scripts the nightly runs, with their import closure, and
 *               `tsconfig.json`
 *   wasmBuild   the WASM build's inputs (the closure of `scripts/wasm-build.ts`,
 *               the build script, the cache action and the `wasm:build` line)
 *   pins        the lockfile without its root `version` fields, `.nvmrc`,
 *               `engine-fuzz.yml`, `package.json`'s `type` and `engines`, and
 *               the cargo configuration and `rust-toolchain` files when there are any
 *   fixtures    `conformance/fixtures/`
 * A version bump leaves the key alone: the app's (the lockfile's root `version`
 * fields are blanked) and the crate's, since a release PR (`npm run release`)
 * would otherwise restart the window with no simulation change. The engine part
 * hashes the crate through `releaseNeutral`, which drops the `[package]`
 * version from `Cargo.toml`, the crate's own version from both `Cargo.lock`
 * files, and `src/compat-record.json` (identity metadata the release rewrites,
 * not a simulation input).
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { engineSourceHash, type SourceView } from "../../wasmhost/packageHash.ts";

/** The scripts the nightly runs, and the shrinker and the corpus replay that
 *  share its compare. The WASM runner is reached through `fuzz-compare.ts`. */
export const FUZZ_ENTRIES = ["scripts/fuzz-compare.ts", "scripts/fuzz-corpus.ts", "scripts/fuzz-key.ts", "scripts/fuzz-shrink.ts"];
/** The entry of the WASM package build. */
export const WASM_BUILD_ENTRY = "scripts/wasm-build.ts";

/** Cargo's own configuration (it merges the files from the crate's folder up) and
 *  the toolchain files rustup reads, which change how the crate builds. All are optional. */
const CARGO_CONFIG = [
  "engine-rs/.cargo/config.toml",
  "engine-rs/.cargo/config",
  ".cargo/config.toml",
  ".cargo/config",
  "rust-toolchain.toml",
  "rust-toolchain",
  "engine-rs/rust-toolchain.toml",
  "engine-rs/rust-toolchain",
];

export const PART_NAMES = ["engine", "scripts", "wasmBuild", "pins", "fixtures"] as const;
export type PartName = (typeof PART_NAMES)[number];
export type KeyParts = Record<PartName, string>;

const sha = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const posix = (p: string): string => p.split(sep).join("/");

/** Every file under a directory, sorted, as paths relative to `root`. Like
 *  `engineSourceHash`, it skips dotfiles and symlinks, so a stray `.DS_Store`
 *  or editor backup cannot make a local key differ from CI's. A missing
 *  directory throws: a rename must not turn into an empty hash. */
function walk(root: string, dir: string): string[] {
  if (!existsSync(dir)) throw new Error(`fuzz key: ${posix(relative(root, dir))} is listed but missing`);
  const out: string[] = [];
  const visit = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name.startsWith(".")) continue;
      const p = join(d, name);
      const rel = posix(relative(root, p));
      const st = lstatSync(p);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) visit(p);
      else out.push(rel);
    }
  };
  visit(dir);
  return out;
}

/** A text file hashes the same whatever its checkout's line endings, so a key
 *  computed on a Windows checkout with `core.autocrlf` matches CI's. A file with
 *  a NUL byte is binary and hashes as it is. */
function lineEndingsAsLF(data: Buffer): Buffer {
  if (data.includes(0)) return data;
  return Buffer.from(data.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
}

/** A hash over the files' paths and contents, so a rename or an edit moves it. */
function filesHash(root: string, rels: readonly string[]): string {
  const lines = [...new Set(rels)].sort().map((rel) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) throw new Error(`fuzz key: ${rel} is listed but missing`);
    return `${rel}\0${sha(lineEndingsAsLF(readFileSync(abs)))}`;
  });
  return sha(lines.join("\n"));
}

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;

function resolveSpecifier(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  // TypeScript and tsx read "./x.js" as "./x.ts" first.
  const swapped = base.replace(/\.js$/, ".ts");
  for (const c of [swapped, base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.d.ts`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  throw new Error(`fuzz key: cannot resolve "${spec}" imported from ${from}`);
}

/** Every file reachable from the entries through relative imports, entries
 *  included, as paths relative to `root`. TypeScript's own scanner reads the
 *  imports (`import`, `export ... from`, `import()`, `require`), so comments and
 *  strings that look like one do not count and a real one is not lost. An import
 *  it cannot resolve throws, so a file never drops out of the key unnoticed. */
export function importClosure(root: string, entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const queue = entries.map((e) => resolve(root, e));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    if (!existsSync(file)) throw new Error(`fuzz key: ${relative(root, file)} is listed but missing`);
    seen.add(file);
    if (!SOURCE_EXT.test(file)) continue;
    const info = ts.preProcessFile(readFileSync(file, "utf8"), true, true);
    for (const imp of info.importedFiles) {
      if (imp.fileName.startsWith(".")) queue.push(resolveSpecifier(file, imp.fileName));
    }
  }
  return [...seen].map((f) => posix(relative(root, f))).sort();
}

/** The lockfile with its root `version` fields blanked, so a version bump
 *  leaves the key alone. */
function lockfileText(root: string): string {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
    version?: string;
    packages?: Record<string, { version?: string }>;
  };
  delete lock.version;
  if (lock.packages?.[""]) delete lock.packages[""].version;
  return JSON.stringify(lock);
}

/** The `[package]` table's `version` line in a Cargo.toml, by line index, or -1. */
function packageVersionLine(lines: readonly string[]): number {
  const start = lines.findIndex((l) => l.trim() === "[package]");
  if (start < 0) return -1;
  for (let i = start + 1; i < lines.length && !lines[i].trim().startsWith("["); i++) {
    if (/^version\s*=/.test(lines[i].trim())) return i;
  }
  return -1;
}

/** The `[package]` table's `name`, when the Cargo.toml states one. */
function packageName(cargoToml: string): string | null {
  const lines = cargoToml.split("\n");
  const start = lines.findIndex((l) => l.trim() === "[package]");
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length && !lines[i].trim().startsWith("["); i++) {
    const m = /^name\s*=\s*"([^"]+)"/.exec(lines[i].trim());
    if (m) return m[1];
  }
  return null;
}

/** The crate's files without what a release PR edits: its own version in the
 *  manifest and both lockfiles, and the compatibility record. A dependency's
 *  version, the edition and every other line still move the key. */
export function releaseNeutral(crateToml: string): SourceView {
  const name = packageName(crateToml.replace(/\r\n/g, "\n"));
  const own = name === null ? null : `name = "${name}"`;
  return (label, data) => {
    if (label === "src/compat-record.json") return null;
    if (label === "Cargo.toml") {
      const lines = data.toString("utf8").split("\n");
      const i = packageVersionLine(lines);
      return i < 0 ? data : Buffer.from(lines.filter((_, j) => j !== i).join("\n"), "utf8");
    }
    if ((label === "Cargo.lock" || label === "consumer/Cargo.lock") && own !== null) {
      const lines = data.toString("utf8").split("\n");
      const drop = new Set<number>();
      lines.forEach((l, i) => {
        if (l === own && lines[i + 1]?.startsWith("version = ")) drop.add(i + 1);
      });
      return Buffer.from(lines.filter((_, j) => !drop.has(j)).join("\n"), "utf8");
    }
    return data;
  };
}

/** The files each part hashes, by path (the two parts that are not plain file
 *  sets are the crate and the pins' lockfile; see `fuzzKeyParts`). */
export function fuzzKeyFiles(root: string = process.cwd()): Record<"scripts" | "wasmBuild" | "fixtures", string[]> {
  const closure = importClosure(root, FUZZ_ENTRIES);
  return {
    scripts: [...closure, "tsconfig.json"].sort(),
    wasmBuild: [
      ...importClosure(root, [WASM_BUILD_ENTRY]),
      "scripts/build-engine-wasm.sh",
      ".github/actions/engine-wasm/action.yml",
    ].sort(),
    fixtures: walk(root, join(root, "conformance/fixtures")),
  };
}

export function fuzzKeyParts(root: string = process.cwd()): KeyParts {
  const files = fuzzKeyFiles(root);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string>; type?: string; engines?: unknown };
  const wasmLine = pkg.scripts["wasm:build"];
  if (typeof wasmLine !== "string") throw new Error("fuzz key: package.json has no wasm:build script");
  return {
    engine: engineSourceHash(join(root, "engine-rs"), releaseNeutral(readFileSync(join(root, "engine-rs/Cargo.toml"), "utf8"))),
    scripts: filesHash(root, files.scripts),
    wasmBuild: sha(`${filesHash(root, files.wasmBuild)}\n${wasmLine}`),
    pins: sha(
      [
        sha(lockfileText(root)),
        filesHash(root, [".nvmrc", ".github/workflows/engine-fuzz.yml", ...CARGO_CONFIG.filter((rel) => existsSync(join(root, rel)))]),
        // How Node reads the scripts and which Node they need, which the lockfile does not carry.
        sha(JSON.stringify({ type: pkg.type ?? null, engines: pkg.engines ?? null })),
      ].join("\n"),
    ),
    fixtures: filesHash(root, files.fixtures),
  };
}

/** The window key: one hash over the named parts. */
export function fuzzKey(parts: KeyParts): string {
  return sha(PART_NAMES.map((n) => `${n}:${parts[n]}`).join("\n"));
}
