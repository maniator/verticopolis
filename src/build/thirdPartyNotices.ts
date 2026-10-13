/**
 * Third-party license notices for the shipped build (#951).
 *
 * The served bundle carries code from npm packages whose licenses (MIT, BSD,
 * Apache-2.0 and the like) require their notices to travel with every copy.
 * `scripts/gen-third-party-notices.ts` runs after each build, reads the
 * emitted sourcemaps (the bundler's own record of what each shipped file
 * contains, the service worker's workbox chunk included), adds the build-tool
 * code that sourcemaps do not list, and uses these pure helpers to turn the
 * result into `third-party-notices.txt`.
 *
 * Keep this file ERASABLE (no enums, namespaces or parameter properties) so
 * `node` can run the script that imports it directly.
 */

/** One bundled npm package, as it appears in the notices file. */
export interface NoticePackage {
  name: string;
  version: string;
  license: string;
  /** Every license and NOTICE file the package ships, in file-name order. */
  licenseText: string;
  /** Where it comes from: an npm package (the default) or a Rust crate compiled into the WASM engine. */
  kind?: "npm" | "crate";
}

/** The label a package carries in the notices, so an npm package and a crate of the same name stay apart. */
function kindLabel(p: NoticePackage): string {
  return p.kind === "crate" ? " (Rust, in the WASM engine)" : "";
}

const NODE_MODULES = "/node_modules/";

/**
 * Licenses the build may ship without a person deciding first. Anything else
 * (copyleft, unknown, "SEE LICENSE IN ...") fails the build, so a person
 * decides before a lockfile bump can ship it.
 */
export const ALLOWED_LICENSES: ReadonlySet<string> = new Set([
  "MIT",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "Zlib",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  // The Unicode data license (unicode-ident, in the WASM engine): permissive,
  // a copyright and permission notice like MIT's.
  "Unicode-3.0",
]);

/**
 * Code that build tools inject into the bundle without listing it in any
 * sourcemap, and package content that a code generator copies into a file of
 * our own (a test holds every "AUTO-GENERATED ... from <pkg>@" file to an
 * entry here). Each entry names the package and how to spot its code: a source
 * id in a sourcemap, or a string the emitted JavaScript always contains. A
 * source id matched here is the only kind allowed outside the repository.
 */
export const INJECTED_CODE: ReadonlyArray<{
  pkg: string;
  from?: string;
  sourcePattern?: RegExp;
  codeMarker?: string;
  /** Its chunk is this tool's code alone, so a sourcemap with no sources is expected. */
  wholeChunk?: boolean;
}> = [
  // vite-plugin-pwa's generated register module (virtual:pwa-register).
  { pkg: "vite-plugin-pwa", sourcePattern: /virtual:pwa-register/ },
  // Vite's dynamic-import preload helper.
  { pkg: "vite", codeMarker: "vite:preloadError" },
  // Vite's modulepreload polyfill (its chunk's sourcemap has no sources).
  { pkg: "vite", codeMarker: 'link[rel="modulepreload"]', wholeChunk: true },
  // Path data that scripts/gen-icon-paths.ts copies from pixelarticons into a
  // source file of our own, so its sourcemap entry is not under node_modules.
  { pkg: "pixelarticons", sourcePattern: /(^|\/)src\/ui\/iconPaths\.generated\.ts$/ },
  // workbox-build's service worker template (its AMD loader); the sourcemap
  // lists it as a temporary file outside node_modules.
  // `from` names the package that resolves it, so a nested copy is the one read.
  { pkg: "workbox-build", from: "vite-plugin-pwa", sourcePattern: /\/[0-9a-f]{32}\/sw\.js$/, codeMarker: "register its module" },
];

/**
 * A sourcemap `sources` entry as an absolute, `/`-separated path, or null for
 * an id that names no file (`webpack://`, `\0` virtual ids, an http URL).
 * `file:` URLs are decoded; Windows drive and UNC paths are kept.
 */
export function sourceToPath(source: unknown, mapDir: string, sourceRoot: unknown): string | null {
  if (typeof source !== "string" || source === "" || source.startsWith("\0")) return null;
  const join = (base: string, rel: string): string => {
    const full = (base === "" ? rel : `${base}/${rel}`).replace(/\\/g, "/");
    // A UNC path (//server/share/...) keeps its leading double slash.
    const unc = /^\/\/[^/]/.test(full);
    const out: string[] = [];
    for (const p of full.split("/")) {
      if (p === "..") out.pop();
      else if (p !== "." && p !== "") out.push(p);
    }
    if (unc) return `//${out.join("/")}`;
    const drive = /^[A-Za-z]:$/.test(out[0] ?? "");
    return drive ? out.join("/") : `/${out.join("/")}`;
  };
  // An absolute file location (a file: URL, a Windows drive path or a
  // leading slash) as a path, null for any other URL scheme, or "" when it is
  // relative.
  const absolute = (s: string): string | null => {
    if (/^file:/i.test(s)) {
      try {
        const url = new URL(s);
        const path = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, "$1");
        // file://server/share/... names a UNC share; its host is the server.
        return url.host && url.host !== "localhost" ? join("", `//${url.host}${path}`) : join("", path);
      } catch {
        return null;
      }
    }
    if (/^[A-Za-z]:[^\\/]/.test(s)) return null; // drive-relative (C:foo) names no fixed file
    if (/^[A-Za-z]:([\\/]|$)/.test(s) || s.startsWith("/") || s.startsWith("\\")) return join("", s);
    if (/^[A-Za-z][A-Za-z0-9+.-]+:/.test(s)) return null; // webpack://, http:, virtual schemes
    return "";
  };
  const own = absolute(source);
  if (own === null) return null;
  if (own !== "") return own;
  const rootStr = typeof sourceRoot === "string" ? sourceRoot : "";
  const root = absolute(rootStr);
  if (root === null) return null; // a remote sourceRoot names no local file
  return join(root !== "" ? root : join(mapDir, rootStr), source);
}

/**
 * The package directory a bundled source file belongs to: everything up to and
 * including the innermost `node_modules/<name>` (or `node_modules/@scope/name`).
 * Returns null for sources outside `node_modules` (the game's own code) and for
 * a path that names no package (a dot directory, a bare scope). The
 * input is an absolute, `/`-separated path.
 */
export function packageDirFromSource(absPath: string): string | null {
  const path = absPath.replace(/\\/g, "/");
  const at = path.lastIndexOf(NODE_MODULES);
  if (at < 0) return null;
  const rest = path.slice(at + NODE_MODULES.length).split("/");
  // A dot directory (`.vite`, `.cache`) is a tool's cache, never a package;
  // `.pnpm` chains end in a real `node_modules/<name>` found above.
  if (rest[0].startsWith(".")) return null;
  const scoped = rest[0].startsWith("@");
  const parts = scoped ? rest.slice(0, 2) : rest.slice(0, 1);
  if (parts.length < (scoped ? 2 : 1) || parts.some((p) => p === "")) return null;
  return path.slice(0, at + NODE_MODULES.length) + parts.join("/");
}

/** The package name at the end of a package directory (`.../node_modules/@scope/name` gives `@scope/name`). */
export function packageNameFromDir(dir: string): string {
  return dir.slice(dir.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
}

/** UTF-16 code-unit order (JavaScript's `<`), so the output never depends on the machine's locale data. */
export function byCodePoint(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Unique package directories across every source, in code-point order. */
export function collectPackageDirs(absSources: Iterable<string>): string[] {
  const dirs = new Set<string>();
  for (const s of absSources) {
    const dir = packageDirFromSource(s);
    if (dir) dirs.add(dir);
  }
  return [...dirs].sort(byCodePoint);
}

/** True when a file name looks like a package's license file (LICENSE, LICENCE, COPYING; any text extension). */
export function isLicenseFileName(name: string): boolean {
  if (/\.([mc]?[jt]sx?|json|map)$/i.test(name)) return false; // code or data, never license text
  return /^((un)?licen[cs]e|copying|copyright)([.-].*)?$/i.test(name) || /^[\w.]+-licen[cs]e(\..*)?$/i.test(name);
}

/**
 * True when a license file name carries license terms. A COPYRIGHT file holds
 * only a copyright line, so it ships with the notices but does not count.
 */
export function isLicenseTextFileName(name: string): boolean {
  return isLicenseFileName(name) && !/^copyright([.-].*)?$/i.test(name);
}

/** True for an Apache-style NOTICE file, which must travel with the license (Apache-2.0 section 4(d)). */
export function isNoticeFileName(name: string): boolean {
  return /^notice([.-].*)?$/i.test(name);
}

/**
 * The license expression a package.json declares, in any of its historical
 * shapes: `"license": "MIT"`, `"license": { "type": "MIT" }`, or a
 * `"licenses"` array. Every declared entry must hold, so several are joined
 * with AND, each in parentheses so its own OR keeps its grouping. Returns null
 * when none is declared or any entry cannot be read, which fails the build.
 */
export function declaredLicense(manifest: { license?: unknown; licenses?: unknown }): string | null {
  const one = (v: unknown): string | null => {
    if (typeof v === "string") return v.trim() || null;
    if (v && typeof v === "object" && typeof (v as { type?: unknown }).type === "string") {
      return ((v as { type: string }).type).trim() || null;
    }
    return null;
  };
  const entries: unknown[] = [];
  if (manifest.license !== undefined) entries.push(manifest.license);
  if (manifest.licenses !== undefined) {
    if (!Array.isArray(manifest.licenses)) return null;
    entries.push(...manifest.licenses);
  }
  const ids = entries.map(one);
  if (ids.length === 0 || ids.some((x) => x === null)) return null;
  const unique = [...new Set(ids as string[])];
  return unique.length === 1 ? unique[0] : unique.map((x) => `(${x})`).join(" AND ");
}

/**
 * True when an SPDX expression can be satisfied using allowlisted licenses
 * only. Parentheses group; `AND` binds tighter than `OR`; an `OR` passes when
 * one side does, an `AND` only when every side does. A `WITH` exception, an
 * unknown token or a malformed expression fails, so a person decides.
 */
export function isAllowedLicense(expression: string): boolean {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const peek = (): string | undefined => tokens[i];
  const orExpr = (): boolean | null => {
    let left = andExpr();
    while (left !== null && peek() === "OR") {
      i++;
      const right = andExpr();
      if (right === null) return null;
      left = left || right;
    }
    return left;
  };
  const andExpr = (): boolean | null => {
    let left = term();
    while (left !== null && peek() === "AND") {
      i++;
      const right = term();
      if (right === null) return null;
      left = left && right;
    }
    return left;
  };
  const term = (): boolean | null => {
    const tok = peek();
    if (tok === undefined) return null;
    i++;
    if (tok === "(") {
      const inner = orExpr();
      if (inner === null || peek() !== ")") return null;
      i++;
      return inner;
    }
    if (tok === ")" || tok === "AND" || tok === "OR" || tok === "WITH") return null;
    if (peek() === "WITH") return null;
    return ALLOWED_LICENSES.has(tok);
  };
  const result = orExpr();
  return result === true && i === tokens.length;
}

/** A problem that keeps a package out of the notices; the build fails on any of these. */
export function noticeProblem(pkg: { name?: string; version?: string; license?: string | null; licenseText?: string; hasLicenseFile?: boolean }): string | null {
  if (!pkg.name) return "a bundled package.json has no name";
  if (!pkg.version) return `${pkg.name}: package.json has no version`;
  if (!pkg.license) return `${pkg.name}@${pkg.version}: package.json declares no license`;
  if (!isAllowedLicense(pkg.license)) {
    return `${pkg.name}@${pkg.version}: license "${pkg.license}" is not on the allowlist in src/build/thirdPartyNotices.ts; a person decides before it ships`;
  }
  if (pkg.hasLicenseFile === false || !pkg.licenseText || pkg.licenseText.trim() === "") {
    return `${pkg.name}@${pkg.version}: no license file found`;
  }
  return null;
}

/**
 * Compares versions numerically where the parts are numbers. A prerelease
 * (`1.0.0-beta`) sorts before its release and prereleases compare by SemVer
 * identifier (`beta.2` before `beta.10`); build metadata (`+x`) is ignored.
 */
function byVersion(a: string, b: string): number {
  const [coreA, preA = ""] = a.split("+")[0].split(/-(.*)/s);
  const [coreB, preB = ""] = b.split("+")[0].split(/-(.*)/s);
  const pa = coreA.split(".");
  const pb = coreB.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    if (x === y) continue;
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
    return byCodePoint(x, y);
  }
  if (preA === preB) return 0;
  if (preA === "") return 1;
  if (preB === "") return -1;
  return byParts(preA.split("."), preB.split("."));
}

/** SemVer identifier order: numeric parts numerically, others by code unit, a shorter list first. */
function byParts(pa: string[], pb: string[]): number {
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    return byCodePoint(x, y);
  }
  return 0;
}

/**
 * The notices file: a short header, then one block per package. The same
 * package at two versions keeps both blocks; the same name and version from
 * two directories (a nested duplicate) is listed once. A Rust crate is
 * labeled as one, so it never merges with an npm package of the same name.
 */
export function renderNotices(packages: readonly NoticePackage[]): string {
  const seen = new Set<string>();
  const unique = [...packages]
    .sort((a, b) => byCodePoint(a.name, b.name) || byVersion(a.version, b.version) || byCodePoint(a.kind ?? "npm", b.kind ?? "npm"))
    .filter((p) => {
      const key = `${p.kind ?? "npm"}:${p.name}@${p.version}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const rule = "=".repeat(72);
  const header = [
    "Verticopolis: third-party software notices",
    "",
    "This build of Verticopolis includes the open-source packages below.",
    "Each is listed with its version, its license and the license and notice",
    "files its authors ship with it. Verticopolis's own code is under the",
    "license in the LICENSE file of https://github.com/maniator/verticopolis.",
    "",
    `Packages: ${unique.length}`,
    "",
  ].join("\n");
  const blocks = unique.map((p) =>
    [rule, `${p.name}@${p.version}${kindLabel(p)}`, `License: ${p.license}`, rule, "", p.licenseText.replace(/\r\n?/g, "\n").trimEnd(), ""].join("\n"),
  );
  return `${header}\n${blocks.join("\n")}`;
}

/** The parts of `cargo metadata --format-version 1` the crate walk reads. */
export interface CargoMetadata {
  packages: ReadonlyArray<{ id: string; name: string; version: string; license?: string | null; license_file?: string | null; manifest_path: string; targets: ReadonlyArray<{ kind: readonly string[] }> }>;
  resolve: { root: string | null; nodes: ReadonlyArray<{ id: string; deps: ReadonlyArray<{ pkg: string; dep_kinds: ReadonlyArray<{ kind: string | null }> }> }> };
}

/**
 * The crates a build compiles into the root crate's artifact, from `cargo
 * metadata` resolved for the target and features of that build: the root's
 * normal dependencies, transitively. Build and dev dependencies run only on
 * the build machine, and a proc-macro runs inside the compiler, so neither
 * they nor anything only they pull in ships. The root itself (our own code)
 * is left out. Sorted by name, then version.
 */
export function shippedCrates(meta: CargoMetadata): CargoMetadata["packages"][number][] {
  const root = meta.resolve.root;
  if (!root) throw new Error("cargo metadata has no root package; run it inside the crate");
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const isProcMacro = (id: string) => byId.get(id)?.targets.some((t) => t.kind.includes("proc-macro")) ?? false;
  const seen = new Set<string>([root]);
  const queue = [root];
  while (queue.length > 0) {
    const node = nodes.get(queue.shift()!);
    if (!node) throw new Error("cargo metadata's resolve graph names a package it does not describe");
    for (const dep of node.deps) {
      if (!dep.dep_kinds.some((k) => k.kind === null) || isProcMacro(dep.pkg) || seen.has(dep.pkg)) continue;
      seen.add(dep.pkg);
      queue.push(dep.pkg);
    }
  }
  seen.delete(root);
  return [...seen]
    .map((id) => {
      const p = byId.get(id);
      if (!p) throw new Error(`cargo metadata's resolve graph names ${id}, which it does not describe`);
      return p;
    })
    .sort((a, b) => byCodePoint(a.name, b.name) || byVersion(a.version, b.version));
}
