/**
 * The engine crate's compatibility record (#963, release plan section 7.4).
 * `engine-rs/src/compat-record.json` pins the crate version beside what must
 * move it: the conformance lock (the scenario, catalog, loader and `.TDT`
 * tables and the gameplay event catalog), the save version it writes and the
 * oldest it loads, the frame layout, catalog and identity record versions, and
 * the public Rust/WASM interface (the checked-in `src/dualrun/engine.d.ts`,
 * comments and spacing aside).
 * `src/tests/engineCompat.guard.test.ts` recomputes all of it from the tree and
 * fails when a pin moved and the record did not. After a deliberate change,
 * bump `version` in `engine-rs/Cargo.toml` and run `npm run engine:compat`,
 * which rewrites the record from the tree and refuses to when a pin differs
 * from `origin/main`'s record under the same crate version (`unbumpedPins`),
 * so a version that has not merged yet can be re-recorded as main's lock moves
 * under it. A record edited by hand skips that check; review owns that case.
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
  catalogVersion: number;
  identitySchema: number;
  interfaceDigest: string;
}

/** Where each version constant lives: the Rust file, its name and its type. */
export const VERSION_CONSTANTS: Record<
  | "saveVersion"
  | "oldestSaveVersion"
  | "frameLayoutVersion"
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

/** One `const NAME: TYPE = N;` declaration, with any `pub` or `pub(crate)`, at the start of a line. */
export function rustConstant(
  source: string,
  name: string,
  type: string,
): number {
  const m = new RegExp(
    `^(?:pub(?:\\(crate\\))? )?const ${name}: ${type} = (\\d+);`,
    "m",
  ).exec(source);
  if (!m)
    throw new Error(`no \`const ${name}: ${type} = N;\` in the Rust source`);
  return Number(m[1]);
}

/** `SAVE_VERSION` as `engine-rs/src/sim.rs` declares it. */
export function saveVersion(simSource: string): number {
  return rustConstant(simSource, "SAVE_VERSION", "i64");
}

/** The crate version `engine-rs/Cargo.toml` declares in its `[package]` table. */
export function cargoVersion(cargoToml: string): string {
  const pkg = /\[package\]([\s\S]*?)(?:\n\s*\[|$)/.exec(cargoToml)?.[1] ?? "";
  const m = /^version\s*=\s*"([^"]+)"/m.exec(pkg);
  if (!m) throw new Error("engine-rs/Cargo.toml has no [package] version");
  return m[1];
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

export const COMPAT_RECORD_PATH = "engine-rs/src/compat-record.json";

/** The record's file text: one key per line, a final newline. */
export function recordText(r: CompatRecord): string {
  return `${JSON.stringify(r, null, 2)}\n`;
}
