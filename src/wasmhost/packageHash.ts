import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

/** Build output (the crate's own, or a nested crate's), never an input. */
const SKIP_DIRS = new Set(["target", "pkg", "pkg-player", "pkg-web-tooling"]);
/** Folders at the crate's top that are separate crates the WASM build never
 *  compiles: `consumer/` builds against the packaged engine (#1945). A file
 *  in one still counts when a source includes it or a manifest points at it. */
const SKIP_TOP_DIRS = new Set(["consumer"]);
/** `include_str!("…")` and `include_bytes!("…")` with a literal path. */
const INCLUDE = /\binclude_(?:str|bytes)!\(\s*"([^"]+)"\s*\)/g;
/** Every include macro, whatever its argument or delimiter. */
const ANY_INCLUDE = /\binclude(?:_str|_bytes)?\s*!\s*[({[]/g;
/** The start of an outer or inner attribute, `#[` or `#![`. */
const ATTRIBUTE = /#!?\s*\[/g;
/** The opening of a raw string (`r"`, `r#"`, `br#"`, `cr#"`), read in place. */
const RAW_OPEN = /[bc]?r(#*)"/y;
/** A `path =` key in a Cargo manifest, read from the manifest with its
 *  strings and comments blanked (a quoted `"path"` or `'path'` key kept):
 *  where a key starts (a line, or after `{` or `,` in an inline table),
 *  dotted keys (`helper.path = …`, `"my crate".path = …`) included, so a
 *  `readme-path` key is not one. */
const MANIFEST_PATH_KEY = /(?:^|[{,])[ \t]*(?:(?:[A-Za-z0-9_-]+|"[^"\n]*"|'[^'\n]*')[ \t]*\.[ \t]*)*(?:path|"path"|'path')[ \t]*=[ \t]*/gm;

/**
 * A text file hashes the same whatever line endings its checkout has (a Windows
 * checkout with `core.autocrlf=true` has CRLF in every file, and the repo has
 * no `.gitattributes`), so two checkouts of one commit agree. A file with a NUL
 * byte is binary and hashes as it is. A Linux checkout has no CRLF in the
 * hashed files, so its hash does not move.
 */
function lineEndingsAsLF(data: Buffer): Buffer {
  if (data.includes(0)) return data;
  return Buffer.from(data.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
}

/**
 * What a caller hashes of each file instead of its bytes: `label` is the path
 * relative to the crate, `data` the LF-normalized contents, and null leaves the
 * file out. The fuzz window key uses it to ignore a release's version edits.
 */
export type SourceView = (label: string, data: Buffer) => Buffer | null;

/** A string literal in a Rust file: where its token starts, and its contents
 *  (null for a raw or byte string, or one with an escape, which a path
 *  attribute does not take here). */
type RustString = { at: number; value: string | null };

/**
 * A Rust file with every comment and the contents of every string and
 * character literal blanked to spaces (offsets unchanged), and its string
 * literals. Enough of Rust's lexer to find attributes in code alone: nested
 * block comments, raw strings with any number of `#`, byte strings, and
 * character literals told apart from lifetimes.
 */
function rustCode(text: string): { code: string; strings: RustString[] } {
  const out = text.split("");
  const strings: RustString[] = [];
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const ident = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_]/.test(c);
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && text[i + 1] === "*") {
      let depth = 0;
      let j = i;
      do {
        if (text.startsWith("/*", j)) {
          depth++;
          j += 2;
        } else if (text.startsWith("*/", j)) {
          depth--;
          j += 2;
        } else j++;
      } while (depth > 0 && j < text.length);
      blank(i, j);
      i = j;
    } else if ((c === "r" || c === "b" || c === "c") && !ident(text[i - 1]) && ((RAW_OPEN.lastIndex = i), RAW_OPEN.test(text))) {
      const open = RAW_OPEN.exec(((RAW_OPEN.lastIndex = i), text)) as RegExpExecArray;
      const close = `"${open[1]}`;
      const end = text.indexOf(close, i + open[0].length);
      const stop = end < 0 ? text.length : end + close.length;
      strings.push({ at: i, value: null });
      blank(i + open[0].length, stop - close.length);
      i = stop;
    } else if (c === '"' || (c === "b" && text[i + 1] === '"' && !ident(text[i - 1]))) {
      const start = c === "b" ? i + 1 : i;
      let j = start + 1;
      let escaped = false;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\") {
          escaped = true;
          j += 2;
        } else j++;
      }
      strings.push({ at: i, value: c === "b" || escaped ? null : text.slice(start + 1, j) });
      blank(start + 1, j);
      i = j + 1;
    } else if (c === "'") {
      // A character literal ('x', '\n', '\u{..}'), else a lifetime or label.
      const m = /^'(?:\\(?:u\{[0-9A-Fa-f]*\}|.)|[^\\'\n])'/u.exec(text.slice(i, i + 12));
      if (m) {
        blank(i + 1, i + m[0].length - 1);
        i += m[0].length;
      } else i++;
    } else i++;
  }
  return { code: out.join(""), strings };
}

/**
 * The `path = "…"` values in a Rust file's attributes (`#[path = "…"]` on a
 * module, or inside `cfg_attr`), read from code alone, so a comment or a
 * string that only looks like one is not taken for it. A `path =` in an
 * attribute whose value is not a plain `"…"` literal (a raw string, an escape)
 * throws, so such a module never drops out of the hash unnoticed.
 */
function attributePaths(text: string, file: string): string[] {
  // Most files name no path at all; only those are lexed.
  if (!/\bpath\s*=/.test(text)) return [];
  const { code, strings } = rustCode(text);
  const stringAt = new Map(strings.map((s) => [s.at, s.value]));
  const found: string[] = [];
  for (const m of code.matchAll(ATTRIBUTE)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = open;
    for (; close < code.length; close++) {
      if (code[close] === "[") depth++;
      else if (code[close] === "]" && --depth === 0) break;
    }
    const attribute = code.slice(open, close);
    for (const p of attribute.matchAll(/\bpath\s*=\s*/g)) {
      const value = stringAt.get(open + p.index + p[0].length);
      if (value === undefined || value === null) {
        throw new Error(`${file} has a path attribute the engine source hash cannot follow (only a plain "..." path is read); extend engineSourceHash in src/wasmhost/packageHash.ts`);
      }
      found.push(value);
    }
  }
  return found;
}

/** In a masked Rust file: a `mod name;` or `mod name {` item, or a brace. */
const MOD_OR_BRACE = /\bmod\s+(?:r#)?([A-Za-z_][A-Za-z0-9_]*)\s*([;{])|[{}]/g;
/** The attributes and visibility that end right before a `mod` keyword. */
const MOD_PREFIX = /((?:#\s*\[[^\]]*\]\s*)*)(?:pub\b\s*(?:\([^)]*\)\s*)?)?$/;

/**
 * The files a module file's own `mod name;` items load, found the way rustc
 * finds them: beside the file when it owns its folder (a `mod.rs`, `lib.rs`
 * or `main.rs`, or a file a `#[path]` named), else in the folder named after
 * it, one folder deeper for each inline `mod a { … }` around the item, as
 * `name.rs` or `name/mod.rs`. Items with a `path` key in their attributes
 * are left to `attributePaths`. A file neither candidate finds throws.
 * Returns each file with whether it owns its folder.
 */
function childModules(text: string, file: string, ownsDir: boolean): [string, boolean][] {
  if (!/\bmod\b/.test(text)) return [];
  const { code } = rustCode(text);
  const base = ownsDir ? dirname(file) : join(dirname(file), basename(file, ".rs"));
  const inline: (string | null)[] = [];
  const found: [string, boolean][] = [];
  for (const m of code.matchAll(MOD_OR_BRACE)) {
    if (m[0] === "{") inline.push(null);
    else if (m[0] === "}") inline.pop();
    else if (m[2] === "{") inline.push(m[1]);
    else {
      const prefix = MOD_PREFIX.exec(code.slice(Math.max(0, m.index - 400), m.index)) as RegExpExecArray;
      if (/\bpath\s*=/.test(prefix[1])) continue;
      const dir = join(base, ...inline.filter((name): name is string => name !== null));
      const flat = join(dir, `${m[1]}.rs`);
      const nested = join(dir, m[1], "mod.rs");
      if (existsSync(flat)) found.push([flat, false]);
      else if (existsSync(nested)) found.push([nested, true]);
      else throw new Error(`${file} declares mod ${m[1]}, and neither ${flat} nor ${nested} exists`);
    }
  }
  return found;
}

/**
 * A Cargo manifest with every comment and the contents of every string
 * blanked to spaces (offsets unchanged), and its strings: a one-line basic
 * (`"…"`) or literal (`'…'`) string keeps its value, while an empty one, a
 * basic one with an escape, and a multi-line one (three quotes) get null,
 * which a path key does not take here.
 */
function tomlCode(text: string): { code: string; strings: RustString[] } {
  const out = text.split("");
  const strings: RustString[] = [];
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "#") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      const triple = text.startsWith(c.repeat(3), i);
      const quote = triple ? c.repeat(3) : c;
      let j = i + quote.length;
      let escaped = false;
      while (j < text.length && !text.startsWith(quote, j) && (triple || text[j] !== "\n")) {
        if (c === '"' && text[j] === "\\") {
          escaped = true;
          j += 2;
        } else j++;
      }
      const value = text.slice(i + quote.length, j);
      strings.push({ at: i, value: triple || escaped || value === "" ? null : value });
      blank(i + quote.length, j);
      i = j + quote.length;
    } else i++;
  }
  return { code: out.join(""), strings };
}

/** A table header line in a masked manifest, `[a.b]` or `[[a.b]]`. */
const TABLE_HEADER = /^[ \t]*\[\[?([^\]\n]*)\]\]?/gm;
/** Cargo's free-form tables, whose keys are no build input. */
const METADATA_TABLE = /^(?:package|workspace)\.metadata(?:\.|$)/;

/** The `path = "…"` values in a Cargo manifest (path dependencies, and the
 *  `[lib]` and `[[bin]]` targets), read with its strings and comments blanked,
 *  so a `path =` inside a string or a comment is not one. A key under
 *  `[package.metadata]` or `[workspace.metadata]` (free-form, never a build
 *  input) is left alone. A `path` key whose value is not a plain one-line
 *  string throws, so an empty path or a multi-line string never names the
 *  manifest's own folder. */
function manifestPaths(text: string, file: string): string[] {
  const masked = tomlCode(text);
  const strings = masked.strings;
  // A quoted key spelled `path` is still the path key, so it stays readable.
  let code = masked.code;
  for (const s of strings) if (s.value === "path") code = code.slice(0, s.at + 1) + "path" + code.slice(s.at + 5);
  const stringAt = new Map(strings.map((s) => [s.at, s.value]));
  const headers = [...code.matchAll(TABLE_HEADER)].map((h) => ({ at: h.index, name: h[1].replace(/\s+/g, "") }));
  const found: string[] = [];
  for (const m of code.matchAll(MANIFEST_PATH_KEY)) {
    let table = "";
    for (const h of headers) if (h.at < m.index) table = h.name;
    // The full key: the table, then any dotted prefix before `path`.
    const prefix = m[0]
      .replace(/^[{,]/, "")
      .replace(/\s+/g, "")
      .replace(/\.?(?:path|"path"|'path')=$/, "")
      .replace(/["']/g, "");
    const key = [table, prefix].filter((part) => part !== "").join(".");
    if (METADATA_TABLE.test(key)) continue;
    const value = stringAt.get(m.index + m[0].length);
    if (value === undefined || value === null) {
      throw new Error(`${file} has a path key the engine source hash cannot follow (only a plain "..." or '...' path is read); extend engineSourceHash in src/wasmhost/packageHash.ts`);
    }
    found.push(value);
  }
  return found;
}

/**
 * A hash over everything the served package is built from, by path and
 * content, so `src/public/engine/BUILD.json` can say which engine it holds,
 * CI can key its package cache on it, and a test can tell when the sources
 * moved on without a rebuild. It covers:
 *
 * - every file in the crate (`engine-rs/`) except build output (`target/`,
 *   `pkg/`, at any depth), the separate `consumer/` crate at its top (#1945),
 *   Markdown and local clutter (dotfiles, `~` backups, symlinks), so build
 *   scripts, manifest targets and modules in any layout inside the crate are
 *   in whatever Cargo.toml or the module attributes say;
 * - every file a `.rs` source names in a literal `include_str!` or
 *   `include_bytes!`, wherever it lives;
 * - every module a `#[path = "…"]` attribute (or a `cfg_attr` path) names,
 *   wherever it lives, read relative to the naming file's folder (#978),
 *   and, for one the walk did not take, the modules its own
 *   `mod name;` items load, in turn (see `childModules`);
 * - every folder or file a Cargo manifest's `path = "…"` names (a path
 *   dependency, walked like the crate, its own manifests and sources followed
 *   in turn), wherever it lives (#978).
 *
 * Whatever this cannot read throws, so a file never drops out of the hash
 * unnoticed: an include macro it cannot follow (`include!`, a raw string, a
 * computed path, other delimiters), a path attribute or manifest path that is
 * not a plain string, and a named file that is missing. A `#[path]` inside an
 * inline module, which Rust reads from a deeper folder, is found there only
 * when the same name also exists beside the file; otherwise it is missing and
 * throws.
 *
 * Not modeled: files a build script reads from outside the crate (the engine
 * has no build script). A change that adds one should widen this hash. The
 * caches keyed on it serve CI's test runs and Vercel previews
 * (src/build/engineCache.ts); a production deploy builds the package from
 * source, so a miss here could stale a test run or a preview, never a
 * release.
 *
 * With a `view`, each file hashes as the view returns it (see `SourceView`);
 * without one, as it is.
 *
 * Node only (the build script, CI and the test); never imported by the app.
 */
export function engineSourceHash(crate: string, view?: SourceView): string {
  const files = new Set<string>();
  const pending: string[] = [];
  const add = (p: string) => {
    if (files.has(p)) return;
    files.add(p);
    pending.push(p);
  };
  const walked = new Set<string>();
  /** Files the walk itself took: their child modules sit in folders it takes too. */
  const walkedFiles = new Set<string>();
  const walk = (dir: string, top: boolean) => {
    if (walked.has(dir)) return;
    walked.add(dir);
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".") || name.endsWith("~")) continue;
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name) && !(top && SKIP_TOP_DIRS.has(name))) walk(resolve(p), false);
      } else if (st.isFile() && !name.endsWith(".md")) {
        walkedFiles.add(resolve(p));
        add(resolve(p));
      }
    }
  };
  /** A file or folder a source or manifest names: a folder is walked, a file
   *  added. */
  const follow = (from: string, named: string, what: string) => {
    const target = resolve(dirname(from), named);
    if (!existsSync(target)) throw new Error(`${from} ${what} ${named}, which does not exist`);
    if (lstatSync(target).isDirectory()) walk(target, false);
    else add(target);
  };
  /** Module files a `#[path]` or a `mod name;` item brought in, with whether
   *  each owns its folder, so the `mod name;` items of those the walk did not
   *  take (outside the crate, or in a skipped folder) are followed. */
  const modules = new Map<string, boolean>();
  walk(resolve(crate), true);
  while (pending.length > 0) {
    const p = pending.pop() as string;
    if (basename(p) === "Cargo.toml") {
      for (const named of manifestPaths(readFileSync(p, "utf8"), p)) follow(p, named, "names the path");
      continue;
    }
    if (!p.endsWith(".rs")) continue;
    const text = readFileSync(p, "utf8");
    const literal = [...text.matchAll(INCLUDE)];
    // Every include macro must be one of the literal ones, matched at the same
    // place (comparing counts alone would let one miss cancel another).
    const literalAt = new Set(literal.map((m) => m.index));
    if ([...text.matchAll(ANY_INCLUDE)].some((m) => !literalAt.has(m.index))) {
      throw new Error(`${p} has an include the engine source hash cannot follow (only include_str!/include_bytes! with a plain "..." path are read); extend engineSourceHash in src/wasmhost/packageHash.ts`);
    }
    for (const m of literal) follow(p, m[1], "includes");
    for (const named of attributePaths(text, p)) {
      const target = resolve(dirname(p), named);
      if (!modules.has(target)) modules.set(target, true);
      follow(p, named, "names the module path");
    }
    const ownsDir = modules.get(p);
    if (ownsDir === undefined || walkedFiles.has(p)) continue;
    for (const [child, owns] of childModules(text, p, ownsDir)) {
      if (!modules.has(child)) modules.set(child, owns);
      add(child);
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
    const data = lineEndingsAsLF(readFileSync(p));
    const seen = view ? view(label, data) : data;
    if (seen === null) continue;
    h.update(label);
    h.update("\0");
    h.update(seen);
    h.update("\0");
  }
  return h.digest("hex");
}
