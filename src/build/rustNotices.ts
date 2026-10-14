/**
 * The WASM engine's half of the third-party notices (#955): the crate walk
 * over `cargo metadata` and `cargo tree`, the check of the record a WASM
 * build writes beside the package, and the reading of the Rust toolchain's
 * copyright page for the standard library entry. `scripts/engine-third-party.ts`
 * runs the cargo side; `scripts/gen-third-party-notices.ts` checks the record.
 *
 * Keep this file ERASABLE (no enums, namespaces or parameter properties) so
 * `node` can run the scripts that import it directly.
 */
import { byCodePoint, byVersion, noticeProblem, type NoticePackage } from "./thirdPartyNotices.ts";

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
export function shippedCrates(meta: CargoMetadata, linked?: ReadonlySet<string>): CargoMetadata["packages"][number][] {
  const root = meta.resolve.root;
  if (!root) throw new Error("cargo metadata has no root package; run it inside the crate");
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const isProcMacro = (id: string) => byId.get(id)?.targets.some((t) => t.kind.includes("proc-macro")) ?? false;
  const rootPkg = byId.get(root);
  // A `cargo tree` listing without the root itself was not parsed right (or
  // came from another crate), and would silently filter every crate out.
  if (linked && (!rootPkg || !linked.has(`${rootPkg.name} v${rootPkg.version}`))) {
    throw new Error("the cargo tree listing does not name the root crate; it cannot narrow the walk");
  }
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
    // `cargo metadata` unifies features across every build of the workspace
    // (tests included), so it can name an optional dependency this build
    // never compiles; `linked` (from `cargo tree` for the same target and
    // features, as "name vX.Y.Z") narrows the walk to what is compiled.
    .filter((p) => !linked || linked.has(`${p.name} v${p.version}`))
    .sort((a, b) => byCodePoint(a.name, b.name) || byVersion(a.version, b.version));
}

/**
 * The packages a `cargo tree --prefix none --format {p}` listing names, as
 * "name vX.Y.Z" (#955): the source cargo appends ("(/path)", "(registry ...)",
 * "(proc-macro)") and its repeat mark "(*)" are dropped.
 */
export function cargoTreePackages(listing: string): Set<string> {
  return new Set(
    listing
      .split("\n")
      .map((line) => line.replace(/ \(.*$/, "").trim())
      .filter(Boolean),
  );
}

/**
 * The packages in the engine's third-party record (`THIRD-PARTY.json`, which
 * `npm run wasm:build` writes beside the WASM package, #955), checked the way
 * npm packages are, plus every reason the record cannot be trusted. The
 * record must name the same source hash as the package's own `BUILD.json`,
 * so a record left over from another build of the engine is refused.
 */
export function engineRecordPackages(record: unknown, buildSources: unknown): { packages: NoticePackage[]; problems: string[] } {
  const problems: string[] = [];
  const packages: NoticePackage[] = [];
  const r = (typeof record === "object" && record !== null ? record : {}) as { sources?: unknown; crates?: unknown };
  if (typeof r.sources !== "string" || r.sources === "" || r.sources !== buildSources) {
    problems.push("the record was not written by the build of the engine that ships (its source hash differs from BUILD.json)");
  }
  if (!Array.isArray(r.crates) || r.crates.length === 0) return { packages, problems: [...problems, "the record lists no crates"] };
  for (const entry of r.crates as unknown[]) {
    const e = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const crate = { name: str(e.name), version: str(e.version), license: str(e.license) ?? null, licenseText: str(e.licenseText) };
    const problem =
      noticeProblem({ ...crate, hasLicenseFile: e.hasLicenseFile === true }) ??
      (e.kind === "crate" ? null : `${crate.name}@${crate.version} is not marked as a crate`);
    if (problem) problems.push(problem);
    else packages.push({ name: crate.name!, version: crate.version!, license: crate.license!, licenseText: crate.licenseText!, kind: "crate" });
  }
  if (!packages.some((p) => p.name === "Rust standard library")) problems.push("the record does not list the Rust standard library");
  if (!packages.some((p) => p.name !== "Rust standard library")) problems.push("the record lists no crate besides the Rust standard library");
  return { packages, problems };
}

/** The named entities the toolchain's copyright page uses (#955). */
const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * The text of an HTML page, for the Rust toolchain's copyright notice (#955).
 * Entities are decoded in one pass, so an encoded "&amp;lt;" stays the
 * literal text "&lt;". Throws on an entity it does not decode or a numeric
 * reference that is not a character, so a changed page cannot leak raw
 * markup or control bytes into the notices.
 */
export function htmlText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|h[1-6]|li|div|tr|pre|ul|ol|table)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  // The page escapes every <, > and & in its text, so one left over is markup
  // the strip above misread (a ">" in an attribute, an unclosed script) or an
  // entity written without its semicolon.
  // A control byte written directly (tab and newline aside) counts too.
  const isControl = (n: number) => (n < 0x20 && n !== 0x09 && n !== 0x0a) || (n >= 0x7f && n <= 0x9f);
  let at = /[<>]|&(?!(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);)/i.exec(stripped)?.index;
  for (let i = 0; at === undefined && i < stripped.length; i++) if (isControl(stripped.charCodeAt(i))) at = i;
  if (at !== undefined) throw new Error(`the toolchain's copyright page has markup htmlText cannot read near: ${JSON.stringify(stripped.slice(Math.max(0, at - 20), at + 20))}`);
  return stripped
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (ref: string, body: string) => {
      if (body[0] !== "#") {
        const named = HTML_ENTITIES[body.toLowerCase()];
        if (named === undefined) throw new Error(`the toolchain's copyright page has an entity htmlText does not decode: ${ref}`);
        return named;
      }
      const cp = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      // Printable characters only: no C0 or C1 control (tab and newline aside), no DEL, no lone surrogate.
      const ok = (cp >= 0x20 || cp === 0x09 || cp === 0x0a) && !(cp >= 0x7f && cp <= 0x9f) && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);
      if (!ok) throw new Error(`the toolchain's copyright page has a numeric reference that is not a character: ${ref}`);
      return String.fromCodePoint(cp);
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The parts of the Rust standard library whose license is not simply MIT or
 * Apache-2.0 (or a choice that includes one of them), as the toolchain's
 * copyright page lists them, each reviewed for the wasm32 build (#955, #974):
 * `wasm32` parts are in the engine and their license is in the standard
 * library entry; `other-target` parts build only for the target named.
 */
export const STD_REVIEWED_PARTS: Record<string, { license: string; wasm32: boolean; why: string }> = {
  "library/core/src/unicode/unicode_data.rs": { license: "Unicode-3.0", wasm32: true, why: "core's Unicode tables" },
  foldhash: { license: "Zlib", wasm32: true, why: "std's HashMap hasher" },
  "fortanix-sgx-abi": { license: "MPL-2.0", wasm32: false, why: "x86_64-fortanix-unknown-sgx only" },
  "library/std/src/sys/sync/mutex/fuchsia.rs": { license: "BSD-2-Clause AND (Apache-2.0 OR MIT)", wasm32: false, why: "Fuchsia only" },
};

/**
 * Every reason the standard library entry's license (`stdLicense`) might not
 * cover what the toolchain's copyright page lists (#974): a part whose
 * license offers neither MIT nor Apache-2.0 and is not in
 * `STD_REVIEWED_PARTS` with that same license, or a reviewed wasm32 part whose
 * license `stdLicense` leaves out. A toolchain bump that adds or relicenses a
 * part therefore fails until someone reviews it.
 */
export function stdLicenseProblems(copyrightHtml: string, stdLicense: string): string[] {
  const parts: { name: string; license: string }[] = [];
  const re = /<b>File\/Directory:<\/b>\s*<code>([^<]*)<\/code>|<h3>\s*(?:\u{1F4E6}\s*)?([^<]*?)\s*<\/h3>|<b>License:<\/b>\s*([^<]*)/gu;
  let name: string | null = null;
  for (const m of copyrightHtml.matchAll(re)) {
    if (m[1] !== undefined) name = m[1].trim();
    else if (m[2] !== undefined) name = m[2].replace(/-\d[^-]*(?:\+.*)?$/, "").trim();
    else if (name !== null) {
      parts.push({ name, license: m[3].trim() });
      name = null;
    }
  }
  if (parts.length === 0) return ["the toolchain's copyright page lists no parts with a license; its layout may have changed"];
  const problems: string[] = [];
  const offersMitOrApache = (license: string) =>
    license
      .replace(/\//g, " OR ")
      .split(/\s+OR\s+/)
      .some((alt) => alt === "MIT" || alt === "Apache-2.0");
  for (const p of parts) {
    const reviewed = STD_REVIEWED_PARTS[p.name];
    if (reviewed) {
      if (reviewed.license !== p.license) problems.push(`${p.name} is now ${p.license} (reviewed as ${reviewed.license})`);
      else if (reviewed.wasm32 && !stdLicense.includes(reviewed.license)) problems.push(`${p.name} (${p.license}) reaches wasm32 but the entry's license leaves it out`);
    } else if (/\bAND\b/.test(p.license) || !offersMitOrApache(p.license)) {
      problems.push(`${p.name} is ${p.license}, which is not reviewed; decide whether it reaches wasm32 and add it to STD_REVIEWED_PARTS`);
    }
  }
  return problems;
}
