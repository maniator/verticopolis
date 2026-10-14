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

/** The record's file name inside the engine package. */
export const ENGINE_THIRD_PARTY = "THIRD-PARTY.json";

/** The standard library entry's name and license for wasm32 (see `STD_REVIEWED_PARTS`). */
export const STD_NAME = "Rust standard library";
export const STD_LICENSE = "(MIT OR Apache-2.0) AND Unicode-3.0 AND Zlib";

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
 * every engine build writes beside the WASM package, #955), checked the way
 * npm packages are, plus every reason the record cannot be trusted. The
 * record must name the package's own `BUILD.json` source hash and the SHA-256
 * of the `.wasm` that ships beside it, so a record left over from another
 * build, or a `.wasm` copied in from one, is refused.
 */
export function engineRecordPackages(record: unknown, shipped: { sources: unknown; wasm: string | null }): { packages: NoticePackage[]; problems: string[] } {
  const problems: string[] = [];
  const packages: NoticePackage[] = [];
  const r = (typeof record === "object" && record !== null ? record : {}) as { sources?: unknown; wasm?: unknown; crates?: unknown };
  if (typeof r.sources !== "string" || r.sources === "" || r.sources !== shipped.sources) {
    problems.push("the record was not written by the build of the engine that ships (its source hash differs from BUILD.json)");
  }
  if (shipped.wasm === null) problems.push("the engine package ships no verticopolis_engine_bg.wasm");
  else if (r.wasm !== shipped.wasm) problems.push("the record was not written for the .wasm that ships (its SHA-256 differs)");

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
  const std = packages.filter((p) => p.name === STD_NAME);
  if (std.length === 0) problems.push("the record does not list the Rust standard library");
  else if (std.length > 1) problems.push("the record lists the Rust standard library more than once");
  else if (std[0].license !== STD_LICENSE) problems.push(`the record's Rust standard library declares ${std[0].license}, not ${STD_LICENSE}`);
  if (!packages.some((p) => p.name !== STD_NAME)) problems.push("the record lists no crate besides the Rust standard library");
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
    .replace(/\r\n?/g, "\n")
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
        const named = HTML_ENTITIES[body];
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
  const parts: { name: string; licenses: string[] }[] = [];
  const problems: string[] = [];
  // A file entry may list several paths after one label; each is a part.
  const re = /<b>File\/Directory:<\/b>((?:\s*,?\s*<code>[^<]*<\/code>)+)|<h3\b[^>]*>([\s\S]*?)<\/h3>|<b>License:<\/b>\s*([^<]*)/giu;
  let dirs = 0;
  let group: { name: string; licenses: string[] }[] = [];
  let h3s = 0;
  let licenses = 0;
  // Commented-out markup is not on the page.
  const html = copyrightHtml.replace(/<!--[\s\S]*?-->/g, "");
  for (const m of html.matchAll(re)) {
    if (m[1] !== undefined) {
      dirs++;
      group = [...m[1].matchAll(/<code>([^<]*)<\/code>/g)].map((c) => ({ name: c[1].trim(), licenses: [] as string[] }));
      parts.push(...group);
    }
    else if (m[2] !== undefined) {
      h3s++;
      group = [];
      const heading = m[2].replace(/<[^>]*>/g, "").replace(/\u{1F4E6}/gu, "").trim();
      // "name-1.2.3", "name-1.2.3-rc.1", "name-1.2.3+build"
      parts.push({ name: heading.replace(/-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+.*)?$/, ""), licenses: [] });
    } else {
      licenses++;
      // A grouped file entry's license covers every path in the group.
      const owners = group.length > 0 ? group : parts.slice(-1);
      if (owners.length > 0) for (const part of owners) part.licenses.push(m[3].trim());
      else problems.push(`the toolchain's copyright page has a license (${m[3].trim()}) before any part`);
      group = [];
    }
  }
  if (parts.length === 0) return ["the toolchain's copyright page lists no parts with a license; its layout may have changed"];
  // Every part heading and license label on the page must be one this parse
  // read, and each part has exactly one license line, so a restyled or
  // relabeled part fails instead of lending its license to its neighbor.
  const rawH3s = (html.match(/<h3\b/gi) ?? []).length;
  const rawDirs = (html.match(/File\s*\/\s*Directory/gi) ?? []).length;
  const rawLicenses = (html.match(/<(?:b|strong)>\s*License\b/gi) ?? []).length;
  if (rawH3s !== h3s || rawDirs !== dirs || rawLicenses !== licenses || licenses !== h3s + dirs || parts.some((p) => p.licenses.length !== 1)) {
    problems.push(
      `the toolchain's copyright page has ${rawH3s + rawDirs} parts and ${rawLicenses} license lines, of which ${h3s + dirs} and ${licenses} were read; its layout may have changed`,
    );
  }
  // A part reviewed as reaching wasm32 must still be listed, or the review no
  // longer describes this toolchain.
  for (const [name, reviewed] of Object.entries(STD_REVIEWED_PARTS)) {
    if (reviewed.wasm32 && !parts.some((p) => p.name === name)) problems.push(`${name} (${reviewed.why}) is no longer listed; review the standard library's parts again`);
  }
  const spdxIds = (expression: string) => expression.split(/[\s()]+/).filter((t) => t !== "" && !/^(AND|OR|WITH)$/.test(t));
  const tokens = new Set(spdxIds(stdLicense));
  const offersMitOrApache = (license: string) =>
    license
      .replace(/^\((.*)\)$/, "$1")
      .replace(/\//g, " OR ")
      .split(/\s+OR\s+/)
      .some((alt) => alt === "MIT" || alt === "Apache-2.0");
  for (const p of parts) {
    if (p.licenses.length === 0) problems.push(`${p.name} has no license line the parse could read`);
    for (const license of p.licenses) {
      // Only SPDX ids, uppercase AND/OR/WITH, parentheses and the old "/" choice;
      // anything else (a lowercase "and", "&", prose) is not read as a license.
      const words = license.split(/[\s()/]+/).filter(Boolean);
      if (!/^[A-Za-z0-9.+\-()/ ]+$/.test(license) || words.some((w) => /^(and|or|with)$/i.test(w) && !/^(AND|OR|WITH)$/.test(w))) {
        problems.push(`${p.name} has a license the parse cannot read as SPDX: ${license}`);
        continue;
      }
      const reviewed = Object.prototype.hasOwnProperty.call(STD_REVIEWED_PARTS, p.name) ? STD_REVIEWED_PARTS[p.name] : undefined;
      if (reviewed) {
        if (reviewed.license !== license) problems.push(`${p.name} is now ${license} (reviewed as ${reviewed.license})`);
        else if (reviewed.wasm32 && !spdxIds(reviewed.license).every((id) => tokens.has(id))) problems.push(`${p.name} (${license}) reaches wasm32 but the entry's license leaves it out`);
      } else if (/\bAND\b/.test(license) || !offersMitOrApache(license)) {
        problems.push(`${p.name} is ${license}, which is not reviewed; decide whether it reaches wasm32 and add it to STD_REVIEWED_PARTS`);
      }
    }
  }
  return problems;
}
