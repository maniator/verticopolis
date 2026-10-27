import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installedLinkProblems } from "../build/installedLinks";
import { linkFolder } from "./fixtures/links";

// The installed tree's view of the linked-package road (#974).
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A `node_modules` folder holding the given package folders. */
function tree(packages: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "vc-installed-"));
  dirs.push(root);
  const nm = join(root, "node_modules");
  for (const p of packages) mkdirSync(join(nm, p), { recursive: true });
  mkdirSync(nm, { recursive: true });
  return nm;
}

describe("installedLinkProblems", () => {
  it("passes a tree of real folders, at any depth, and skips dot entries", () => {
    const nm = tree(["a", "@s/b", "a/node_modules/c", "a/node_modules/@t/d", ".bin"]);
    linkFolder(join(nm, "a"), join(nm, ".bin", "a"));
    expect(installedLinkProblems(nm)).toEqual([]);
  });

  it("names a linked package, a linked scope folder, and a link nested below a package", () => {
    const nm = tree(["a/node_modules", "@s/b", "b", "elsewhere/x", "elsewhere/y", "elsewhere/z", "elsewhere/nm"]);
    const out = join(nm, "elsewhere");
    linkFolder(join(out, "x"), join(nm, "linked"));
    linkFolder(join(out, "y"), join(nm, "@scope"));
    linkFolder(join(out, "z"), join(nm, "@s", "c"));
    linkFolder(join(out, "z"), join(nm, "a", "node_modules", "d"));
    linkFolder(join(out, "nm"), join(nm, "b", "node_modules"));
    expect(installedLinkProblems(nm).sort()).toEqual(
      [
        "node_modules/@s/c is a link",
        "node_modules/@scope is a link",
        "node_modules/a/node_modules/d is a link",
        "node_modules/b/node_modules is a link",
        "node_modules/linked is a link",
      ].sort(),
    );
  });

  it("refuses a tree that is itself a link", () => {
    const nm = tree(["a"]);
    const link = join(nm, "..", "linked_modules");
    linkFolder(nm, link);
    expect(installedLinkProblems(link)).toEqual(["node_modules is a link"]);
    // A dangling link is still a link.
    linkFolder(join(nm, "..", "gone"), join(nm, "..", "dangling"));
    expect(installedLinkProblems(join(nm, "..", "dangling"))).toEqual(["node_modules is a link"]);
  });

  it("passes a missing tree, fails closed on one it cannot read, and finds no link in the real one", () => {
    expect(installedLinkProblems(join(tmpdir(), "vc-no-such-folder-974"))).toEqual([]);
    const file = join(tree([]), "..", "a-file");
    writeFileSync(file, "");
    expect(installedLinkProblems(file)).toEqual(["node_modules cannot be read, so it cannot be checked for linked packages"]);
    expect(installedLinkProblems(resolve(__dirname, "../../node_modules"))).toEqual([]);
  });
});
