import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEV_SKIP_MARKER, ENGINE_BUILD_RECORD, ENGINE_DIR, ENGINE_GLUE, ENGINE_WASM } from "../wasmhost/enginePackageNames";
import { engineBuildRecord } from "../wasmhost/enginePackageRecord";
import { ENGINE_REVISION_SUFFIX, INTEGRITY_FILES, engineDistProblems, engineRevision, entryWithIntegrity, precacheIntegrityTransform, integrityOf, manifestIntegrity, manifestIntegrityProblems, manifestRevisions, readExpectedPackage, revisionsOf, shellProblems, shellRevisionProblems } from "./enginePackageBuild";

const sha = (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex");
const md5 = (d: Uint8Array | string) => createHash("md5").update(d).digest("hex");
const glue = new TextEncoder().encode("export default async function init() {}\n");
const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 2, 3]);
const record = engineBuildRecord(glue, wasm, "a".repeat(64), sha);

let dir = "";
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A directory with an engine package in it, laid out as src/public or dist. */
function pkg(over: { record?: string | null; glue?: Uint8Array; wasm?: Uint8Array } = {}): string {
  dir = mkdtempSync(join(tmpdir(), "vc-pkg-"));
  made.push(dir);
  mkdirSync(join(dir, ENGINE_DIR), { recursive: true });
  writeFileSync(join(dir, ENGINE_DIR, ENGINE_GLUE), over.glue ?? glue);
  writeFileSync(join(dir, ENGINE_DIR, ENGINE_WASM), over.wasm ?? wasm);
  if (over.record !== null) writeFileSync(join(dir, ENGINE_DIR, ENGINE_BUILD_RECORD), over.record ?? JSON.stringify(record));
  return dir;
}

describe("readExpectedPackage", () => {
  it("reads the package id and the file digests of a good record", () => {
    expect(readExpectedPackage(pkg(), "build")).toEqual({ package: record.package, files: record.files, sources: record.sources, revisions: revisionsOf(join(dir, ENGINE_DIR)) });
  });

  it("is null when there is no package folder, in a build or not", () => {
    dir = mkdtempSync(join(tmpdir(), "vc-pkg-"));
    made.push(dir);
    expect(readExpectedPackage(dir, "build")).toBeNull();
    expect(readExpectedPackage(dir, "other")).toBeNull();
  });

  it("stops a build whose package has no record", () => {
    expect(() => readExpectedPackage(pkg({ record: null }), "build")).toThrow(/BUILD\.json is missing/);
  });

  it.each([
    ["an old schema 1 record", JSON.stringify({ sources: "a".repeat(64) })],
    ["text that is not JSON", "not json"],
  ])("stops a build on %s, and a dev serve or a test never reads it", (_name, text) => {
    const d = pkg({ record: text });
    expect(() => readExpectedPackage(d, "build")).toThrow(/not a usable schema 2 record/);
    expect(readExpectedPackage(d, "other")).toBeNull();
  });

  it("treats an empty engine folder as no package, and reads a record that starts with a byte order mark", () => {
    dir = mkdtempSync(join(tmpdir(), "vc-pkg-"));
    made.push(dir);
    mkdirSync(join(dir, ENGINE_DIR));
    expect(readExpectedPackage(dir, "build")).toBeNull();
    const withBom = `\uFEFF${JSON.stringify(record)}`;
    expect(readExpectedPackage(pkg({ record: withBom }), "build")).toEqual({ package: record.package, files: record.files, sources: record.sources, revisions: revisionsOf(join(dir, ENGINE_DIR)) });
  });

  it("gives a dev serve or a test null even for a good record", () => {
    expect(readExpectedPackage(pkg(), "other")).toBeNull();
    expect(readExpectedPackage(pkg({ record: null }), "other")).toBeNull();
  });
});

describe("precacheIntegrityTransform", () => {
  const html = new TextEncoder().encode("<!doctype html><title>game</title>\n");
  const entries = () => [
    { url: `${ENGINE_DIR}${ENGINE_GLUE}`, revision: "r1", size: glue.length },
    { url: `${ENGINE_DIR}${ENGINE_WASM}`, revision: "r2", size: wasm.length },
    { url: `${ENGINE_DIR}${ENGINE_BUILD_RECORD}`, revision: "r3", size: 400 },
    { url: "index.html", revision: "r4", size: html.length },
  ];
  /** The package folder with the shell's index.html beside it. */
  const withShell = () => {
    const d = pkg();
    writeFileSync(join(d, "index.html"), html);
    return d;
  };

  it("adds the integrity of each of the three engine files", () => {
    const d = withShell();
    const { manifest, warnings } = precacheIntegrityTransform(d)(entries());
    expect(warnings).toEqual([]);
    expect(manifest[0].integrity).toBe(`sha256-${createHash("sha256").update(glue).digest("base64")}`);
    expect(manifest[1].integrity).toBe(integrityOf(wasm));
    expect(manifest[2].integrity).toBeDefined();
  });

  it("gives a shell entry the integrity of its file and keeps its revision, so a miss on it refills the precache (#1345)", () => {
    const d = withShell();
    const { manifest } = precacheIntegrityTransform(d)(entries());
    expect(manifest[3]).toEqual({ url: "index.html", revision: "r4", size: html.length, integrity: integrityOf(html) });
  });

  it("covers an entry with no revision, a hashed asset, the same way", () => {
    const d = withShell();
    mkdirSync(join(d, "assets"));
    writeFileSync(join(d, "assets", "main-abc123.js"), "export {};\n");
    const { manifest } = precacheIntegrityTransform(d)([{ url: "assets/main-abc123.js", revision: null, size: 11 }]);
    expect(manifest[0]).toEqual({ url: "assets/main-abc123.js", revision: null, size: 11, integrity: integrityOf(new TextEncoder().encode("export {};\n")) });
  });

  it("gives each engine entry a revision no worker before the integrity attribute used, and leaves the rest alone", () => {
    const d = withShell();
    const { manifest } = precacheIntegrityTransform(d)(entries());
    expect(manifest.slice(0, 3).map((e) => e.revision)).toEqual([engineRevision(glue), engineRevision(wasm), engineRevision(new TextEncoder().encode(JSON.stringify(record)))]);
    for (const e of manifest.slice(0, 3)) {
      expect(e.revision, "not the plain MD5 an earlier worker keyed the file by").toMatch(new RegExp(`^[0-9a-f]{32}${ENGINE_REVISION_SUFFIX}$`));
      expect(e.revision).not.toMatch(/^[0-9a-f]{32}$/);
    }
    expect(engineRevision(glue)).toBe(`${md5(glue)}${ENGINE_REVISION_SUFFIX}`);
    expect(manifest[3].revision).toBe("r4");
  });

  it("matches an entry whatever its prefix or query string", () => {
    const d = pkg();
    const { manifest } = precacheIntegrityTransform(d)([{ url: `./${ENGINE_DIR}${ENGINE_GLUE}?v=1`, revision: null, size: 1 }]);
    expect(manifest[0].integrity).toBe(integrityOf(glue));
    expect(manifest[0].revision, "an entry that arrived with no revision gets the rotated one").toBe(engineRevision(glue));
  });

  it("asks for the output folder when it is given a function, so a changed outDir is followed", () => {
    const d = withShell();
    let asked = 0;
    const { manifest } = precacheIntegrityTransform(() => (asked++, d))(entries());
    expect(asked).toBe(4);
    expect(manifest[0].integrity).toBe(integrityOf(glue));
  });

  it("stops the build when an entry has no file to hash, engine or shell", () => {
    const d = withShell();
    rmSync(join(d, ENGINE_DIR, ENGINE_WASM));
    expect(() => precacheIntegrityTransform(d)(entries())).toThrow(/cannot carry integrity/);
    const e = withShell();
    rmSync(join(e, "index.html"));
    expect(() => precacheIntegrityTransform(e)(entries())).toThrow(/precache entry index\.html has no file/);
  });

  it("refuses an entry that climbs out of the output folder", () => {
    expect(() => precacheIntegrityTransform(withShell())([{ url: "../secret.txt", revision: null, size: 1 }])).toThrow(/climbs out of dist/);
  });

  it("covers exactly the glue, the binary and BUILD.json with a rotated revision", () => {
    expect([...INTEGRITY_FILES].sort()).toEqual([ENGINE_BUILD_RECORD, ENGINE_GLUE, ENGINE_WASM].map((f) => ENGINE_DIR + f).sort());
  });
});

describe("entryWithIntegrity", () => {
  it("adds integrity to an entry the transforms never see, as the plugin's web manifest is", () => {
    const d = pkg();
    const text = '{"name":"Verticopolis"}\n';
    writeFileSync(join(d, "manifest.webmanifest"), text);
    expect(entryWithIntegrity({ url: "manifest.webmanifest", revision: "m1" }, d)).toEqual({ url: "manifest.webmanifest", revision: "m1", integrity: integrityOf(new TextEncoder().encode(text)) });
  });
});

describe("manifestIntegrityProblems", () => {
  const files = { "index.html": "<html></html>\n", "assets/main-1.js": "export {};\n" } as const;
  function dist(): string {
    const d = pkg();
    mkdirSync(join(d, "assets"));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text);
    return d;
  }
  const entry = (url: keyof typeof files, integrity: string | null = integrityOf(new TextEncoder().encode(files[url]))) =>
    `{url:"${url}",revision:null${integrity === null ? "" : `,integrity:"${integrity}"`}}`;

  it("is empty when every entry carries the digest of its file", () => {
    expect(manifestIntegrityProblems(dist(), `[${entry("index.html")},${entry("assets/main-1.js")}]`)).toEqual([]);
  });

  it("names an entry with no integrity, so a miss would not refill the precache", () => {
    expect(manifestIntegrityProblems(dist(), `[${entry("index.html", null)}]`).join("\n")).toMatch(/index\.html carries no integrity/);
  });

  it("names an entry whose integrity is not its file's digest, such as a file changed after the worker was built", () => {
    expect(manifestIntegrityProblems(dist(), `[${entry("assets/main-1.js", integrityOf(new TextEncoder().encode("other")))}]`).join("\n")).toMatch(/main-1\.js carries an integrity that is not the digest/);
  });

  it("names an entry whose file is gone", () => {
    const d = dist();
    rmSync(join(d, "index.html"));
    expect(manifestIntegrityProblems(d, `[${entry("index.html")}]`).join("\n")).toMatch(/index\.html has no file in dist/);
  });
});

describe("manifestIntegrity", () => {
  it("reads integrity from minified entries in any key order and with ./ prefixes", () => {
    const m = `[{url:"a.js",revision:"1"},{revision:"2",integrity:"sha256-x",url:"./engine/b.wasm"},{"url":"c.png","revision":null,"integrity":'sha256-y'}]`;
    const got = manifestIntegrity(m);
    expect(got.get("a.js")).toBeUndefined();
    expect(got.has("a.js")).toBe(true);
    expect(got.get("engine/b.wasm")).toBe("sha256-x");
    expect(got.get("c.png")).toBe("sha256-y");
  });

  it("reads a key only as a whole word, so baseurl or xintegrity do not count", () => {
    const got = manifestIntegrity(`[{baseurl:"no.js",revision:"1"},{url:"a.js",revision:"2",xintegrity:"sha256-bad"}]`);
    expect(got.has("no.js")).toBe(false);
    expect(got.get("a.js")).toBeUndefined();
  });
});

describe("engineDistProblems", () => {
  /** A manifest with the three engine entries carrying the right integrity. */
  function manifestFor(_d: string, over: Record<string, string | null> = {}, revisionOver: Record<string, string> = {}): string {
    const entry = (name: string, bytes: Uint8Array) => {
      const url = ENGINE_DIR + name;
      const integrity = url in over ? over[url] : integrityOf(bytes);
      const revision = url in revisionOver ? revisionOver[url] : engineRevision(bytes);
      return `{url:"${url}",revision:"${revision}"${integrity === null ? "" : `,integrity:"${integrity}"`}}`;
    };
    return `[${entry(ENGINE_GLUE, glue)},${entry(ENGINE_WASM, wasm)},${entry(ENGINE_BUILD_RECORD, new TextEncoder().encode(JSON.stringify(record)))}]`;
  }

  it("finds nothing wrong with a consistent package", () => {
    const d = pkg();
    expect(engineDistProblems(d, manifestFor(d))).toEqual([]);
  });

  it("reports a binary that is not the one BUILD.json describes", () => {
    const d = pkg({ wasm: new Uint8Array([9, 9, 9]) });
    const problems = engineDistProblems(d, manifestFor(d));
    expect(problems.join("\n")).toContain("BUILD.json says");
    expect(problems.join("\n")).toContain("does not match the digest");
  });

  it("reports a glue with the right size and other bytes", () => {
    const other = new Uint8Array(glue);
    other[0] ^= 1;
    const d = pkg({ glue: other });
    expect(engineDistProblems(d, manifestFor(d)).join("\n")).toContain(`${ENGINE_GLUE} does not match the digest in BUILD.json`);
  });

  it("reports a package id that is not the hash of its files block", () => {
    const d = pkg({ record: JSON.stringify({ ...record, package: "e".repeat(64) }) });
    expect(engineDistProblems(d, manifestFor(d)).join("\n")).toContain("package id is not the hash");
  });

  it("reports a missing or unusable record", () => {
    expect(engineDistProblems(pkg({ record: null }), "[]")[0]).toContain("is missing");
    expect(engineDistProblems(pkg({ record: "{}" }), "[]")[0]).toContain("not a usable schema 2 record");
  });

  it("reports an engine entry that is not in the manifest at all", () => {
    const d = pkg();
    const only = manifestFor(d).replace(/\{url:"engine\/BUILD\.json"[^}]*\}/, "");
    expect(engineDistProblems(d, only).join("\n")).toContain(`precache entry ${ENGINE_DIR}${ENGINE_BUILD_RECORD} is missing from the manifest`);
    expect(engineDistProblems(d, "[]")).toHaveLength(3);
  });

  it("reports an engine entry whose revision is not the one of its file, which would send Repair to another cache key", () => {
    const d = pkg();
    const bad = manifestFor(d, {}, { [`${ENGINE_DIR}${ENGINE_WASM}`]: "0".repeat(32) });
    expect(engineDistProblems(d, bad).join("\n")).toContain(`precache entry ${ENGINE_DIR}${ENGINE_WASM} has revision ${"0".repeat(32)}; the file in dist/ has ${engineRevision(wasm)}`);
    expect(manifestRevisions(manifestFor(d)).get(`${ENGINE_DIR}${ENGINE_GLUE}`)).toBe(engineRevision(glue));
  });

  it("reports a binary that is missing from dist", () => {
    const d = pkg();
    rmSync(join(d, ENGINE_DIR, ENGINE_WASM));
    expect(engineDistProblems(d, manifestFor(d)).join("\n")).toContain(`dist/${ENGINE_DIR}${ENGINE_WASM} is missing`);
  });

  it("reports an engine entry with no integrity, and one with the wrong integrity", () => {
    const d = pkg();
    expect(engineDistProblems(d, manifestFor(d, { [`${ENGINE_DIR}${ENGINE_WASM}`]: null })).join("\n")).toContain("carries no integrity");
    expect(engineDistProblems(d, manifestFor(d, { [`${ENGINE_DIR}${ENGINE_GLUE}`]: "sha256-AAAA" })).join("\n")).toContain("not the digest of the file in dist/");
  });
});

describe("shellProblems", () => {
  const OTHER = "c".repeat(64);
  /** A dist with the engine package and some emitted scripts. */
  function distWith(scripts: Record<string, string>, over: Parameters<typeof pkg>[0] = {}): string {
    const d = pkg(over);
    mkdirSync(join(d, "assets"), { recursive: true });
    for (const [name, text] of Object.entries(scripts)) writeFileSync(join(d, name), text);
    return d;
  }
  /** A chunk shaped as the define leaves it: the expected record inlined. */
  const chunkWith = (id: string) => `const e={package:"${id}",files:{"${ENGINE_GLUE}":{sha256:"${"d".repeat(64)}",bytes:3}}};export{e};`;

  it("finds nothing wrong when a chunk carries the engine's id and none carries another", () => {
    const d = distWith({ "assets/index-1.js": chunkWith(record.package), "assets/engineWorker-2.js": chunkWith(record.package), "assets/other-3.js": "export const x=1;" });
    expect(shellProblems(d, true)).toEqual([]);
  });

  it("reads a quoted key, as a minifier or a JSON define can leave it", () => {
    const d = distWith({ "assets/index-1.js": `x={"package":"${record.package}"}` });
    expect(shellProblems(d, true)).toEqual([]);
  });

  it.each([
    ["a backtick-quoted member", (id: string) => `x={\`package\`:\`${id}\`}`],
    ["a JSON string with escaped quotes", (id: string) => `x=JSON.parse("{\\"package\\":\\"${id}\\"}")`],
  ])("reads %s", (_name, make) => {
    expect(shellProblems(distWith({ "assets/index-1.js": make(record.package) }), true)).toEqual([]);
    expect(shellProblems(distWith({ "assets/index-1.js": make(OTHER) }), true).join("\n")).toContain(`carries engine package id ${OTHER.slice(0, 12)}`);
  });

  it("reports a shell built for another package, and names both ids", () => {
    const d = distWith({ "assets/index-1.js": chunkWith(OTHER) });
    const problems = shellProblems(d, true).join("\n");
    expect(problems).toContain("no script in dist/ carries the engine package id");
    expect(problems).toContain(`dist/assets/index-1.js carries engine package id ${OTHER.slice(0, 12)}`);
  });

  it("reports a second chunk left on another id", () => {
    const d = distWith({ "assets/index-1.js": chunkWith(record.package), "assets/engineWorker-2.js": chunkWith(OTHER) });
    const problems = shellProblems(d, true);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("engineWorker-2.js");
  });

  it("reports a shell that carries no id at all", () => {
    expect(shellProblems(distWith({ "assets/index-1.js": "export{};" }), true).join("\n")).toContain("carries the engine package id");
  });

  it("reports a missing or unusable record rather than guessing", () => {
    expect(shellProblems(distWith({ "assets/index-1.js": chunkWith(record.package) }, { record: null }), true).join("\n")).toContain("missing or unusable");
    expect(shellProblems(distWith({ "assets/index-1.js": chunkWith(record.package) }, { record: "{}" }), true).join("\n")).toContain("missing or unusable");
  });

  it("fails a bundle that still holds the development-only skip, in any script", () => {
    const skip = `console.info("[wasm] ${DEV_SKIP_MARKER}")`;
    const d = distWith({ "assets/index-1.js": `${chunkWith(record.package)};${skip}` });
    expect(shellProblems(d, true).join("\n")).toContain("development-only skip");
    // Also when the build ships no engine, and in a nested chunk.
    const none = distWith({ "assets/lazy-9.js": skip });
    expect(shellProblems(none, false).join("\n")).toContain("dist/assets/lazy-9.js still carries");
  });

  it("asks nothing of the ids in a build that ships no engine", () => {
    expect(shellProblems(distWith({ "assets/index-1.js": "export{};" }), false)).toEqual([]);
  });
});

describe("the other readers of BUILD.json", () => {
  // Schema 2 keeps `sources` as it was, so these readers need no change. A
  // reader that starts depending on another field should be added to the
  // design's list (section 8) and to this one.
  const root = join(import.meta.dirname, "../..");
  it.each([
    "scripts/gen-third-party-notices.ts",
    "src/build/rustNotices.ts",
    "src/tests/perfCompare/env.ts",
    ".github/actions/engine-wasm/action.yml",
    ".github/actions/engine-wasm-download/action.yml",
  ])("%s reads only `sources`", (file) => {
    const text = readFileSync(join(root, file), "utf8");
    expect(text).toContain("BUILD.json");
    expect(text).toContain("sources");
  });

  it("a schema 2 record still carries the sources hash they read", () => {
    expect(record.sources).toBe("a".repeat(64));
  });
});

describe("shellRevisionProblems", () => {
  it("passes when a script carries the revision of each engine file, and names the one that is missing", () => {
    const d = pkg();
    mkdirSync(join(d, "assets"), { recursive: true });
    const all = JSON.stringify(revisionsOf(join(d, ENGINE_DIR)));
    writeFileSync(join(d, "assets/index-1.js"), `x={revisions:${all}}`);
    expect(shellRevisionProblems(d)).toEqual([]);
    writeFileSync(join(d, "assets/index-1.js"), `x={revisions:${all.replace(engineRevision(wasm), "0".repeat(32))}}`);
    expect(shellRevisionProblems(d).join("\n")).toContain(`precache revision of ${ENGINE_DIR}${ENGINE_WASM}`);
  });

  it("does not count the worker's own manifest as the shell carrying the revisions", () => {
    const d = pkg();
    mkdirSync(join(d, "assets"), { recursive: true });
    const manifest = Object.values(revisionsOf(join(d, ENGINE_DIR))).map((revision) => `{url:"x",revision:"${revision}"}`);
    writeFileSync(join(d, "sw.js"), `precacheAndRoute([${manifest.join(",")}])`);
    writeFileSync(join(d, "workbox-abc123.js"), manifest.join(","));
    writeFileSync(join(d, "assets/index-1.js"), "x={}");
    expect(shellRevisionProblems(d)).toHaveLength(3);
  });
});
