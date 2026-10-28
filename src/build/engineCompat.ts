/**
 * The engine crate's compatibility record (#963, release plan section 7.4).
 * `engine-rs/src/compat-record.json` pins the crate version beside what must
 * move it: the conformance lock (the scenario, catalog, loader and `.TDT`
 * tables and the gameplay event catalog), the save version it writes and the
 * oldest it loads, the frame layout, view layout, catalog and identity record
 * versions, and
 * the public Rust/WASM interface (the checked-in `src/dualrun/engine.d.ts`,
 * comments and spacing aside).
 * `src/tests/engineCompat.guard.test.ts` recomputes all of it from the tree and
 * fails when a pin moved and the record did not. After a deliberate change,
 * bump `version` in `engine-rs/Cargo.toml` (and the two `Cargo.lock` files)
 * and run `npm run engine:compat`, which rewrites the record from the tree and
 * refuses when a pin differs from `origin/main`'s record under the same crate
 * version (`unbumpedPins`), when the version is not a later `x.y.z`
 * (`isSemverIncrease`), or when main's record cannot be read (`baseRecord`). A
 * version that has not merged yet can be re-recorded as main's lock moves under
 * it. A record edited by hand skips that comparison; review owns that case.
 *
 * The digests are the first 16 hex digits of a SHA-256, as the conformance
 * digests are. `identity_tests.rs` recomputes the lock digest in Rust and
 * checks the version pins against the constants.
 *
 * Node only, and ERASABLE (see scripts/screenshot-env.ts) so `scripts/engine-compat.ts`
 * runs it under plain `node`; never imported by the app.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Where the record lives, inside the crate so the package ships it. */
export const COMPAT_RECORD_PATH = "engine-rs/src/compat-record.json";

/** The lock files under `conformance/`, in digest order. */
export const LOCK_FILES = [
  "catalog-digests.json",
  "events/catalog.json",
  "expected.json",
  "loader-cases.json",
  "tdt-cases.json",
];

export interface CompatRecord {
  crateVersion: string;
  lockDigest: string;
  saveVersion: number;
  oldestSaveVersion: number;
  frameLayoutVersion: number;
  viewLayoutVersion: number;
  catalogVersion: number;
  identitySchema: number;
  interfaceDigest: string;
}

/** Where each version constant lives: the Rust file, its name and its type. */
export const VERSION_CONSTANTS: Record<
  | "saveVersion"
  | "oldestSaveVersion"
  | "frameLayoutVersion"
  | "viewLayoutVersion"
  | "catalogVersion"
  | "identitySchema",
  { file: string; name: string; type: string }
> = {
  saveVersion: {
    file: "engine-rs/src/sim.rs",
    name: "SAVE_VERSION",
    type: "i64",
  },
  oldestSaveVersion: {
    file: "engine-rs/src/load.rs",
    name: "OLDEST_SAVE_VERSION",
    type: "i64",
  },
  frameLayoutVersion: {
    file: "engine-rs/src/frame.rs",
    name: "FRAME_LAYOUT_VERSION",
    type: "u32",
  },
  viewLayoutVersion: {
    file: "engine-rs/src/view/layout.rs",
    name: "VIEW_LAYOUT_VERSION",
    type: "u32",
  },
  catalogVersion: {
    file: "engine-rs/src/catalog.rs",
    name: "CATALOG_VERSION",
    type: "u32",
  },
  identitySchema: {
    file: "engine-rs/src/identity.rs",
    name: "IDENTITY_SCHEMA",
    type: "u32",
  },
};

const hex16 = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

/** A checkout with CRLF line endings must digest like one with LF. */
function lf(data: Buffer): Buffer {
  return data.includes(0)
    ? data
    : Buffer.from(data.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
}

/** For each lock file in order: its name, a newline, its length, a newline, then its bytes. */
export function lockDigest(conformanceDir: string): string {
  const h = createHash("sha256");
  for (const name of LOCK_FILES) {
    const bytes = lf(readFileSync(resolve(conformanceDir, name)));
    h.update(`${name}\n${bytes.length}\n`);
    h.update(bytes);
  }
  return h.digest("hex").slice(0, 16);
}

/**
 * The declaration with comments dropped and whitespace collapsed, so a doc edit
 * is not an interface change. One pass reads strings, block comments and line
 * comments in the order they start, so a `//` or `/*` inside a string or inside
 * the other kind of comment is read for what it is.
 */
export function interfaceDigest(declaration: string): string {
  const code = declaration
    .replace(
      /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
      (m) => (m[0] === "/" ? " " : m),
    )
    .replace(/\s+/g, " ")
    .trim();
  return hex16(code);
}

/**
 * The one `const NAME: TYPE = N;` declaration, with any `pub` or `pub(crate)`,
 * at the start of a line. Comments are dropped first, and a second
 * match (a `#[cfg(test)]` copy, a raw string that quotes it) is an error, so
 * the constant read here is the constant the engine compiles.
 */
export function rustConstant(
  source: string,
  name: string,
  type: string,
): number {
  // One pass in the order things start, so a `/*` inside a line comment (as in
  // `migrations/*`) does not open a block comment that eats the declaration.
  const code = source.replace(
    /"(?:[^"\\]|\\[\s\S])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (m) => (m[0] === "/" ? " " : m),
  );
  const found = [
    ...code.matchAll(
      new RegExp(
        `^(?:pub(?:\\(crate\\))? )?const ${name}: ${type} = (\\d+);`,
        "gm",
      ),
    ),
  ];
  if (found.length === 0)
    throw new Error(`no \`const ${name}: ${type} = N;\` in the Rust source`);
  if (found.length > 1)
    throw new Error(
      `\`const ${name}: ${type}\` is declared ${found.length} times in the Rust source`,
    );
  return Number(found[0][1]);
}

/** The `[package]` name and version of `engine-rs/Cargo.toml`. */
export function cargoPackage(cargoToml: string): {
  name: string;
  version: string;
} {
  const pkg = /\[package\]([\s\S]*?)(?:\n\s*\[|$)/.exec(cargoToml)?.[1] ?? "";
  const field = (key: string) =>
    new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m").exec(pkg)?.[1];
  const name = field("name");
  const version = field("version");
  if (!name) throw new Error("engine-rs/Cargo.toml has no [package] name");
  if (!version)
    throw new Error("engine-rs/Cargo.toml has no [package] version");
  return { name, version };
}

/** The crate version `engine-rs/Cargo.toml` declares in its `[package]` table. */
export function cargoVersion(cargoToml: string): string {
  return cargoPackage(cargoToml).version;
}

/** Every file `computeCompat` reads, relative to the repository root. */
export function compatInputs(): string[] {
  return [
    "engine-rs/Cargo.toml",
    ...new Set(Object.values(VERSION_CONSTANTS).map((c) => c.file)),
    "src/dualrun/engine.d.ts",
    ...LOCK_FILES.map((f) => `conformance/${f}`),
  ];
}

/** What the tree says today. */
export function computeCompat(root: string): CompatRecord {
  const read = (p: string) => readFileSync(resolve(root, p), "utf8");
  const constant = (k: keyof typeof VERSION_CONSTANTS) => {
    const c = VERSION_CONSTANTS[k];
    return rustConstant(read(c.file), c.name, c.type);
  };
  return {
    crateVersion: cargoVersion(read("engine-rs/Cargo.toml")),
    lockDigest: lockDigest(resolve(root, "conformance")),
    saveVersion: constant("saveVersion"),
    oldestSaveVersion: constant("oldestSaveVersion"),
    frameLayoutVersion: constant("frameLayoutVersion"),
    viewLayoutVersion: constant("viewLayoutVersion"),
    catalogVersion: constant("catalogVersion"),
    identitySchema: constant("identitySchema"),
    interfaceDigest: interfaceDigest(read("src/dualrun/engine.d.ts")),
  };
}

/**
 * The pins that moved from `old` to `now` while the crate version stayed. A
 * non-empty answer means the rule was skipped: the version must move with any
 * of them (release plan 7.4).
 */
export function unbumpedPins(old: CompatRecord, now: CompatRecord): string[] {
  if (old.crateVersion !== now.crateVersion) return [];
  return (Object.keys(now) as (keyof CompatRecord & string)[]).filter(
    (k) => k !== "crateVersion" && old[k] !== now[k],
  );
}

/** `x.y.z` with nothing after it: a release a bump can name. */
const PLAIN_SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Whether `to` is a later plain `x.y.z` than `from`. A pre-release, a build
 * suffix, a lower number or the same number is not a bump.
 */
export function isSemverIncrease(from: string, to: string): boolean {
  const a = PLAIN_SEMVER.exec(from);
  const b = PLAIN_SEMVER.exec(to);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    const d = Number(b[i]) - Number(a[i]);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** Runs `git` with these arguments and returns its output; throws when git fails. */
export type Git = (args: string[]) => string;

export interface BaseRecord {
  /** Main's record, or null when main has never had one (a new file needs no bump). */
  record: CompatRecord | null;
  /** Where it came from, for the script's output. */
  source: string;
}

/**
 * The record `origin/main` holds, for `npm run engine:compat` to judge a bump
 * against. It refuses, with what to do, in each case it cannot tell: no
 * `origin/main`, a record main deleted or moved, a record that cannot be read.
 * It never falls back to the working tree's record, which a PR can edit.
 */
export function baseRecord(git: Git): BaseRecord {
  let sha: string;
  try {
    sha = git(["rev-parse", "--verify", "--quiet", "origin/main"]).trim();
  } catch {
    throw new Error(
      "no origin/main to compare with: run `git fetch origin main` (a fork needs its upstream as origin)",
    );
  }
  const source = `origin/main@${sha.slice(0, 8)}`;
  let text: string;
  try {
    text = git(["show", `origin/main:${COMPAT_RECORD_PATH}`]);
  } catch {
    const ever = git([
      "log",
      "--format=%H",
      "-1",
      "origin/main",
      "--",
      COMPAT_RECORD_PATH,
    ]).trim();
    if (ever)
      throw new Error(
        `${source} no longer has ${COMPAT_RECORD_PATH} (deleted or moved); restore it before re-recording`,
      );
    return { record: null, source: `${source} (no record yet)` };
  }
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch {
    throw new Error(`${source}'s ${COMPAT_RECORD_PATH} cannot be read as JSON`);
  }
  if (
    typeof record !== "object" ||
    record === null ||
    typeof (record as CompatRecord).crateVersion !== "string"
  )
    throw new Error(`${source}'s ${COMPAT_RECORD_PATH} has no crateVersion`);
  return { record: record as CompatRecord, source };
}

/** The record's file text: one key per line, a final newline. */
export function recordText(r: CompatRecord): string {
  return `${JSON.stringify(r, null, 2)}\n`;
}
