import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { linkFolder } from "./fixtures/links";
import { PUBLIC_FILES, isExcludedPublicPath, publicFileProblems, type PublicFile } from "../build/publicFiles";

// The list of files Vite copies from src/public into dist (#974): the pure
// check, the real folder against the list, and the real verify script run
// against fixture trees, as `verify:dist` runs it on every build.
const ROOT = resolve(__dirname, "../..");
const SCRIPT = join(ROOT, "scripts/verify-public-files.ts");
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function filesIn(dir: string): string[] {
  return (readdirSync(dir, { recursive: true, withFileTypes: true }) as { name: string; parentPath: string; isFile(): boolean }[])
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).replace(/\\/g, "/"));
}

/** A tree holding the given files, each with placeholder bytes. */
function tree(files: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "vc-public-"));
  dirs.push(dir);
  for (const f of files) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), "x");
  }
  return dir;
}

function run(publicDir: string, dist: string): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, VC_PUBLIC_SRC: publicDir, VC_PUBLIC_DIST: dist }, encoding: "utf8" });
  return { status: r.status, stderr: r.stderr };
}

const listed = PUBLIC_FILES.map((f) => f.path);
const entry = (path: string): PublicFile => ({ path, license: "CC-BY-4.0", source: "test" });

describe("public files are listed with their source and license (#974)", () => {
  it("lists exactly the files in src/public, the engine package left out", () => {
    const actual = filesIn(join(ROOT, "src/public")).filter((f) => !isExcludedPublicPath(f));
    expect([...listed].sort()).toEqual(actual.sort());
    expect(PUBLIC_FILES.every((f) => f.source.trim() !== "")).toBe(true);
  });

  it("names each disagreement between the list, the folder and the build", () => {
    const all = (): boolean => true;
    expect(publicFileProblems([entry("a.png")], ["a.png"], all)).toEqual([]);
    expect(publicFileProblems([], ["font.woff2"], all)).toEqual([expect.stringMatching(/^src\/public\/font\.woff2 ships with no entry/)]);
    expect(publicFileProblems([entry("gone.png")], [], all)).toEqual(["gone.png is listed but not in src/public"]);
    expect(publicFileProblems([entry("a.png")], ["a.png"], () => false)).toEqual(["a.png is listed but did not ship in dist"]);
    expect(publicFileProblems([entry("a.png"), entry("a.png")], ["a.png"], all)).toEqual(["a.png is listed twice"]);
    expect(publicFileProblems([entry("engine/x.wasm")], [], all)).toEqual([expect.stringMatching(/attributed elsewhere/)]);
    expect(publicFileProblems([], ["engine/verticopolis_engine.js"], all)).toEqual([]);
    expect(isExcludedPublicPath("engine")).toBe(true);
    expect(publicFileProblems([], [".DS_Store", "fonts/Thumbs.db"], all)).toEqual([
      "src/public/.DS_Store is a file the operating system wrote; delete it, or it ships in dist",
      "src/public/fonts/Thumbs.db is a file the operating system wrote; delete it, or it ships in dist",
    ]);
    expect(isExcludedPublicPath("engines.txt")).toBe(false);
  });

  it("passes the real check on a build that matches the list", () => {
    const r = run(tree([...listed, "engine/verticopolis_engine.js"]), tree([...listed, "index.html"]));
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("fails the build on an unlisted file, a listed file that is gone, or one that did not ship", () => {
    const cases: [string, string[], string[], RegExp][] = [
      ["an unlisted package font", [...listed, "fonts/inter.woff2"], [...listed, "fonts/inter.woff2"], /src\/public\/fonts\/inter\.woff2 ships with no entry/],
      ["a listed file that is gone", listed.slice(1), listed, new RegExp(`${listed[0].replace(/\./g, "\\.")} is listed but not in src/public`)],
      ["a listed file that did not ship", listed, listed.slice(0, -1), /is listed but did not ship in dist/],
    ];
    for (const [name, inPublic, inDist, message] of cases) {
      const r = run(tree(inPublic), tree(inDist));
      expect({ name, status: r.status }).toEqual({ name, status: 1 });
      expect(r.stderr, name).toMatch(/^verify-public-files: /);
      expect(r.stderr, name).toMatch(message);
      expect(r.stderr.trim().split("\n"), name).toHaveLength(1);
    }
  });

  it("walks two links to one folder", () => {
    const src = tree(listed);
    mkdirSync(join(src, "shared"));
    linkFolder(join(src, "shared"), join(src, "again"));
    const r = run(src, tree(listed));
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("fails with one line on a broken link, a link back to a folder above it, or an operating system's file", () => {
    for (const [name, link, message] of [
      ["a broken link", (src: string) => linkFolder(join(src, "missing"), join(src, "gone.png")), /gone\.png is a broken link/],
      ["a link loop", (src: string) => linkFolder(src, join(src, "loop")), /links back to a folder above it/],
      ["an operating system's file", (src: string) => writeFileSync(join(src, ".DS_Store"), ""), /\.DS_Store is a file the operating system wrote/],
    ] as const) {
      const src = tree(listed);
      link(src);
      const r = run(src, tree(listed));
      expect({ name, status: r.status }).toEqual({ name, status: 1 });
      expect(r.stderr, name).toMatch(message);
      expect(r.stderr.trim().split("\n"), name).toHaveLength(1);
    }
  });
});
