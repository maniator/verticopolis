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
 *   srcEngine   `src/engine` without its `*.test.ts` files
 *   scripts     the scripts the nightly runs, with their import closure
 *               outside `src/engine`, and `tsconfig.json`
 *   wasmBuild   the WASM build's inputs (the closure of `scripts/wasm-build.ts`,
 *               the build script, the cache action and the `wasm:build` line)
 *   pins        the lockfile without its root `version` fields, `.nvmrc` and
 *               `engine-fuzz.yml`
 *   fixtures    `conformance/fixtures/`
 * A version bump leaves the key alone.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { engineSourceHash } from "../../wasmhost/packageHash.ts";

/** The scripts the nightly runs. The WASM runner and the shrinker join it
 *  when they land. */
export const FUZZ_ENTRIES = ["scripts/fuzz-compare.ts", "scripts/fuzz-key.ts"];
/** The entry of the WASM package build. */
export const WASM_BUILD_ENTRY = "scripts/wasm-build.ts";

export const PART_NAMES = ["engine", "srcEngine", "scripts", "wasmBuild", "pins", "fixtures"] as const;
export type PartName = (typeof PART_NAMES)[number];
export type KeyParts = Record<PartName, string>;

const sha = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const posix = (p: string): string => p.split(sep).join("/");

/** Every file under a directory, sorted, as paths relative to `root`. */
function walk(root: string, dir: string, skip: (rel: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const rel = posix(relative(root, p));
      if (skip(rel)) continue;
      if (statSync(p).isDirectory()) visit(p);
      else out.push(rel);
    }
  };
  if (existsSync(dir)) visit(dir);
  return out;
}

/** A hash over the files' paths and contents, so a rename or an edit moves it. */
function filesHash(root: string, rels: readonly string[]): string {
  const lines = [...new Set(rels)].sort().map((rel) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) throw new Error(`fuzz key: ${rel} is listed but missing`);
    return `${rel}\0${sha(readFileSync(abs))}`;
  });
  return sha(lines.join("\n"));
}

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
/** Relative specifiers: `from "./x"`, bare `import "./x"` and `import("./x")`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;

function resolveSpecifier(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  const swapped = base.replace(/\.js$/, ".ts");
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.d.ts`, swapped, join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  throw new Error(`fuzz key: cannot resolve "${spec}" imported from ${from}`);
}

/** Every file reachable from the entries through relative imports, entries
 *  included, as paths relative to `root`. An import it cannot resolve throws,
 *  so a file never drops out of the key unnoticed. */
export function importClosure(root: string, entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const queue = entries.map((e) => resolve(root, e));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    if (!existsSync(file)) throw new Error(`fuzz key: ${relative(root, file)} is listed but missing`);
    seen.add(file);
    if (!SOURCE_EXT.test(file)) continue;
    // Comments are dropped first, so prose that shows an import does not count.
    const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
    for (const m of text.matchAll(SPECIFIER)) queue.push(resolveSpecifier(file, m[1]));
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

/** The files each part hashes, by path (the two parts that are not plain file
 *  sets are the crate and the pins' lockfile; see `fuzzKeyParts`). */
export function fuzzKeyFiles(root: string = process.cwd()): Record<"srcEngine" | "scripts" | "wasmBuild" | "fixtures", string[]> {
  const srcEngine = walk(root, join(root, "src/engine"), (rel) => rel.endsWith(".test.ts"));
  const closure = importClosure(root, FUZZ_ENTRIES).filter((f) => !f.startsWith("src/engine/"));
  return {
    srcEngine,
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
  const wasmLine = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts["wasm:build"];
  if (typeof wasmLine !== "string") throw new Error("fuzz key: package.json has no wasm:build script");
  return {
    engine: engineSourceHash(join(root, "engine-rs")),
    srcEngine: filesHash(root, files.srcEngine),
    scripts: filesHash(root, files.scripts),
    wasmBuild: sha(`${filesHash(root, files.wasmBuild)}\n${wasmLine}`),
    pins: sha(
      [
        sha(lockfileText(root)),
        filesHash(root, [".nvmrc", ".github/workflows/engine-fuzz.yml"]),
      ].join("\n"),
    ),
    fixtures: filesHash(root, files.fixtures),
  };
}

/** The window key: one hash over the named parts. */
export function fuzzKey(parts: KeyParts): string {
  return sha(PART_NAMES.map((n) => `${n}:${parts[n]}`).join("\n"));
}
