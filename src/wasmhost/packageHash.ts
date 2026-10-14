import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** Build output (the crate's own, or a nested crate's), never an input. */
const SKIP_DIRS = new Set(["target", "pkg"]);
/** `include_str!("…")` and `include_bytes!("…")` with a literal path. */
const INCLUDE = /\binclude_(?:str|bytes)!\(\s*"([^"]+)"\s*\)/g;
/** Every include macro, whatever its argument or delimiter. */
const ANY_INCLUDE = /\binclude(?:_str|_bytes)?\s*!\s*[({[]/g;

/**
 * A hash over everything the served package is built from, by path and
 * content, so `src/public/engine/BUILD.json` can say which engine it holds,
 * CI can key its package cache on it, and a test can tell when the sources
 * moved on without a rebuild. It covers:
 *
 * - every file in the crate (`engine-rs/`) except build output (`target/`,
 *   `pkg/`, at any depth), Markdown and local clutter (dotfiles, `~` backups,
 *   symlinks), so build scripts, manifest targets and modules in any
 *   layout are in without parsing Cargo.toml or module attributes;
 * - `conformance/events/`, the gameplay event catalog the engine compiles in;
 * - every file a `.rs` source names in a literal `include_str!` or
 *   `include_bytes!`, wherever it lives. An include macro this cannot read
 *   (`include!`, a raw string, a computed path, other delimiters) or a literal
 *   include whose file is missing throws, so such a file never drops out of
 *   the hash unnoticed.
 *
 * Not modeled: Rust code compiled in from outside the crate through a
 * `#[path]` attribute or a Cargo path dependency, and files a build script
 * reads from outside the crate. The engine has none of these; a change that
 * adds one should widen this hash. The cache only serves CI's
 * test runs (every deploy builds the package from source), so a miss here
 * could stale a test run, never a release.
 *
 * Node only (the build script, CI and the test); never imported by the app.
 */
export function engineSourceHash(crate: string): string {
  const files = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".") || name.endsWith("~")) continue;
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(p);
      } else if (st.isFile() && !name.endsWith(".md")) files.add(resolve(p));
    }
  };
  walk(crate);
  const events = resolve(crate, "../conformance/events");
  if (existsSync(events)) walk(events);
  for (const p of [...files]) {
    if (!p.endsWith(".rs")) continue;
    const text = readFileSync(p, "utf8");
    const literal = [...text.matchAll(INCLUDE)];
    // Every include macro must be one of the literal ones, matched at the same
    // place (comparing counts alone would let one miss cancel another).
    const literalAt = new Set(literal.map((m) => m.index));
    if ([...text.matchAll(ANY_INCLUDE)].some((m) => !literalAt.has(m.index))) {
      throw new Error(`${p} has an include the engine source hash cannot follow (only include_str!/include_bytes! with a plain "..." path are read); extend engineSourceHash in src/wasmhost/packageHash.ts`);
    }
    for (const m of literal) {
      const target = resolve(dirname(p), m[1]);
      if (!existsSync(target)) throw new Error(`${p} includes ${m[1]}, which does not exist`);
      files.add(target);
    }
  }
  // Sort by the label hashed, not the absolute path, so the order is the
  // same on every machine and separator.
  const labeled = [...files].map((p) => [relative(crate, p).split("\\").join("/"), p] as const);
  // Code-unit order, the same everywhere (localeCompare would vary by locale).
  labeled.sort(([a], [b]) => {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  });
  const h = createHash("sha256");
  for (const [label, p] of labeled) {
    h.update(label);
    h.update("\0");
    h.update(readFileSync(p));
    h.update("\0");
  }
  return h.digest("hex");
}
