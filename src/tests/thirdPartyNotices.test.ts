import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { render } from "lit-html";
import {
  INJECTED_CODE,
  collectPackageDirs,
  declaredLicense,
  isAllowedLicense,
  isLicenseFileName,
  isLicenseTextFileName,
  isNoticeFileName,
  noticeProblem,
  packageDirFromSource,
  packageNameFromDir,
  renderNotices,
  sourceToPath,
  type NoticePackage,
} from "../build/thirdPartyNotices";
import { helpAboutBody } from "../ui/templates/helpContent";

describe("third-party notices (#951)", () => {
  it("maps a bundled source to its package directory, scoped and nested included", () => {
    expect(packageDirFromSource("/repo/node_modules/excalibur/build/esm/index.js")).toBe("/repo/node_modules/excalibur");
    expect(packageDirFromSource("/repo/node_modules/@vercel/analytics/dist/index.mjs")).toBe("/repo/node_modules/@vercel/analytics");
    expect(packageDirFromSource("/repo/node_modules/tone/node_modules/tslib/tslib.es6.mjs")).toBe(
      "/repo/node_modules/tone/node_modules/tslib",
    );
    expect(packageDirFromSource("C:\\repo\\node_modules\\fflate\\esm\\browser.js")).toBe("C:/repo/node_modules/fflate");
  });

  it("ignores the game's own sources and malformed package paths", () => {
    expect(packageDirFromSource("/repo/src/main.ts")).toBeNull();
    expect(packageDirFromSource("/repo/node_modules/")).toBeNull();
    expect(packageDirFromSource("/repo/node_modules/@scope")).toBeNull();
    // A tool cache is not a package; a .pnpm chain resolves to its inner package.
    expect(packageDirFromSource("/r/node_modules/.vite/deps/chunk.js")).toBeNull();
    expect(packageDirFromSource("/r/node_modules/.pnpm/a@1.0.0/node_modules/a/x.js")).toBe("/r/node_modules/.pnpm/a@1.0.0/node_modules/a");
  });

  it("lists each package once, sorted, however many chunks cite it", () => {
    const dirs = collectPackageDirs([
      "/r/node_modules/tone/build/a.js",
      "/r/src/game.ts",
      "/r/node_modules/excalibur/x.js",
      "/r/node_modules/tone/build/b.js",
      "/r/node_modules/excalibur/y.js",
    ]);
    expect(dirs).toEqual(["/r/node_modules/excalibur", "/r/node_modules/tone"]);
  });

  it("recognizes license file names in their usual spellings", () => {
    for (const name of ["LICENSE", "LICENSE.md", "license.txt", "LICENCE", "COPYING", "LICENSE-MIT", "UNLICENSE", "MIT-LICENSE", "COPYRIGHT"]) {
      expect(isLicenseFileName(name)).toBe(true);
    }
    expect(isLicenseTextFileName("COPYRIGHT")).toBe(false);
    expect(isLicenseTextFileName("LICENSE")).toBe(true);
    for (const name of ["README.md", "package.json", "licensed.js", "CHANGELOG.md", "license.js", "copyright.ts", "LICENSE.json"]) {
      expect(isLicenseFileName(name)).toBe(false);
    }
  });

  it("refuses a package with no name, version, allowed license or license text", () => {
    expect(noticeProblem({ version: "1.0.0", license: "MIT", licenseText: "x" })).toMatch(/no name/);
    expect(noticeProblem({ name: "a", license: "MIT", licenseText: "x" })).toMatch(/no version/);
    expect(noticeProblem({ name: "a", version: "1.0.0", licenseText: "x" })).toMatch(/declares no license/);
    expect(noticeProblem({ name: "a", version: "1.0.0", license: "GPL-3.0-only", licenseText: "x" })).toMatch(/not on the allowlist/);
    expect(noticeProblem({ name: "a", version: "1.0.0", license: "MIT" })).toMatch(/no license file/);
    // A NOTICE file alone does not stand in for the license text.
    expect(noticeProblem({ name: "a", version: "1.0.0", license: "Apache-2.0", licenseText: "NOTICE text", hasLicenseFile: false })).toMatch(
      /no license file/,
    );
    expect(noticeProblem({ name: "a", version: "1.0.0", license: "MIT", licenseText: "text" })).toBeNull();
  });

  it("turns sourcemap sources into absolute paths, or null when they name no file", () => {
    expect(sourceToPath("../../node_modules/x/a.js", "/repo/dist/assets", undefined)).toBe("/repo/node_modules/x/a.js");
    expect(sourceToPath("x/a.js", "/repo/dist", "../src")).toBe("/repo/src/x/a.js");
    expect(sourceToPath("x/a.js", "/repo/dist", "/abs")).toBe("/abs/x/a.js");
    expect(sourceToPath("file:///repo/node_modules/%40scope/p%20q/a.js", "/d", undefined)).toBe("/repo/node_modules/@scope/p q/a.js");
    expect(sourceToPath("file:///C:/repo/node_modules/x/a.js", "/d", undefined)).toBe("C:/repo/node_modules/x/a.js");
    expect(sourceToPath("C:\\repo\\node_modules\\x\\a.js", "/d", undefined)).toBe("C:/repo/node_modules/x/a.js");
    expect(sourceToPath("webpack://pkg/a.js", "/d", undefined)).toBeNull();
    expect(sourceToPath("\0vite/preload-helper.js", "/d", undefined)).toBeNull();
    expect(sourceToPath(42, "/d", undefined)).toBeNull();
    expect(sourceToPath("a.js", "/repo/dist", "https://cdn.example/src")).toBeNull();
    expect(sourceToPath("a.js", "/repo/dist", "C:\\r")).toBe("C:/r/a.js");
    expect(sourceToPath("x", "/r", "C:")).toBe("C:/x");
    expect(sourceToPath("C:foo/a.js", "/r", undefined)).toBeNull();
    // A UNC share keeps its root, so a build from a network share still matches the repository path.
    expect(sourceToPath("../../node_modules/x/a.js", "//server/share/repo/dist/assets", undefined)).toBe("//server/share/repo/node_modules/x/a.js");
    expect(sourceToPath("\\\\server\\share\\repo\\a.js", "/d", undefined)).toBe("//server/share/repo/a.js");
    expect(sourceToPath("file://server/share/repo/node_modules/x/a.js", "/d", undefined)).toBe("//server/share/repo/node_modules/x/a.js");
    expect(sourceToPath("file://localhost/repo/a.js", "/d", undefined)).toBe("/repo/a.js");
    expect(sourceToPath("a.js", "/repo/dist", "file:///abs/root/")).toBe("/abs/root/a.js");
    expect(packageNameFromDir("/r/node_modules/@vercel/analytics")).toBe("@vercel/analytics");
  });

  it("reads a declared license in every package.json shape", () => {
    expect(declaredLicense({ license: "MIT" })).toBe("MIT");
    expect(declaredLicense({ license: { type: "BSD-3-Clause" } })).toBe("BSD-3-Clause");
    expect(declaredLicense({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] })).toBe("(MIT) AND (Apache-2.0)");
    // Each entry keeps its own grouping, so a GPL entry is never absorbed by another entry's OR.
    expect(isAllowedLicense(declaredLicense({ licenses: ["MIT OR GPL-3.0-only", "GPL-2.0-only"] })!)).toBe(false);
    // An entry that cannot be read, or a non-array licenses field, fails; license and licenses both hold.
    expect(declaredLicense({ licenses: ["MIT", { name: "GPL-3.0-only" }] })).toBeNull();
    expect(declaredLicense({ licenses: "MIT" })).toBeNull();
    expect(declaredLicense({ license: "MIT", licenses: ["GPL-3.0-only"] })).toBe("(MIT) AND (GPL-3.0-only)");
    expect(declaredLicense({ license: "MIT", licenses: ["MIT"] })).toBe("MIT");
    // Every entry of the legacy array must pass, so one copyleft entry fails.
    expect(isAllowedLicense(declaredLicense({ licenses: [{ type: "MIT" }, { type: "GPL-2.0" }] })!)).toBe(false);
    expect(declaredLicense({ licenses: ["ISC"] })).toBe("ISC");
    expect(declaredLicense({ license: " " })).toBeNull();
    expect(declaredLicense({})).toBeNull();
  });

  it("allows permissive SPDX expressions and refuses the rest", () => {
    expect(isAllowedLicense("MIT")).toBe(true);
    expect(isAllowedLicense("(MIT OR GPL-3.0-only)")).toBe(true);
    expect(isAllowedLicense("MIT AND Apache-2.0")).toBe(true);
    expect(isAllowedLicense("MIT AND GPL-2.0-only")).toBe(false);
    // Parentheses group and AND binds tighter than OR.
    expect(isAllowedLicense("GPL-3.0-only AND (MIT OR Apache-2.0)")).toBe(false);
    expect(isAllowedLicense("(MIT OR GPL-3.0-only) AND GPL-2.0-only")).toBe(false);
    expect(isAllowedLicense("MIT AND (ISC OR GPL-2.0-only)")).toBe(true);
    expect(isAllowedLicense("GPL-2.0-only OR MIT AND ISC")).toBe(true);
    for (const malformed of ["(MIT", "MIT)", "MIT OR", "", "AND MIT", "MIT OR WITH", "(MIT OR WITH)", "WITH OR MIT"]) expect(isAllowedLicense(malformed)).toBe(false);
    expect(isAllowedLicense("Apache-2.0 WITH LLVM-exception")).toBe(false);
    expect(isAllowedLicense("SEE LICENSE IN LICENSE.md")).toBe(false);
    expect(isAllowedLicense("UNLICENSED")).toBe(false);
    expect(isNoticeFileName("NOTICE")).toBe(true);
    expect(isNoticeFileName("NOTICE.txt")).toBe(true);
    expect(isNoticeFileName("notices.js")).toBe(false);
  });

  it("hides the About licenses link when asked (wrapped builds) and honors a custom href", () => {
    const host = document.createElement("div");
    render(helpAboutBody("1.0.0", "", false), host);
    expect(host.querySelector('a[href*="third-party-notices"]')).toBeNull();
    render(helpAboutBody("1.0.0"), host);
    expect(host.querySelector("a")?.getAttribute("href")).toBe("third-party-notices.txt");
    render(helpAboutBody("1.0.0", "", true, "/third-party-notices.txt"), host);
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/third-party-notices.txt");
  });

  it("renders a stable file: sorted, deduped by name and version, full license text kept", () => {
    const pkgs: NoticePackage[] = [
      { name: "tone", version: "15.1.22", license: "MIT", licenseText: "Tone license\r\nline two\n\n" },
      { name: "@vercel/analytics", version: "2.0.1", license: "MIT", licenseText: "Vercel license" },
      { name: "tone", version: "15.1.22", license: "MIT", licenseText: "Tone license\r\nline two\n\n" },
    ];
    const out = renderNotices(pkgs);
    expect(out).toBe(renderNotices([...pkgs].reverse()));
    expect(out).toContain("Packages: 2");
    expect(out.indexOf("@vercel/analytics@2.0.1")).toBeLessThan(out.indexOf("tone@15.1.22"));
    expect(out.match(/tone@15\.1\.22/g)).toHaveLength(1);
    expect(out).toContain("License: MIT");
    expect(out).toContain("Tone license\nline two");
    expect(out).not.toContain("\r");
  });

  it("attributes every generated source file that copies package content", () => {
    const root = join(__dirname, "..", "..");
    const files = (readdirSync(join(root, "src"), { recursive: true }) as string[])
      .filter((f) => /\.[jt]sx?$/.test(f))
      .map((f) => join(root, "src", f));
    const generated = files
      .map((f) => ({ path: `/${relative(root, f).replace(/\\/g, "/")}`, header: /AUTO-GENERATED[^\n]*\bfrom (@?[\w.-]+(?:\/[\w.-]+)?)@/.exec(readFileSync(f, "utf8").slice(0, 400)) }))
      .filter((g) => g.header !== null);
    expect(generated.length).toBeGreaterThan(0);
    for (const g of generated) {
      const pkg = g.header![1];
      expect(INJECTED_CODE.some((inj) => inj.pkg === pkg && inj.sourcePattern?.test(g.path)), `${g.path} copies ${pkg}`).toBe(true);
    }
  });

  it("keeps each version of one package as its own block, in semver order", () => {
    const out = renderNotices([
      { name: "tslib", version: "10.0.0", license: "0BSD", licenseText: "c" },
      { name: "tslib", version: "2.8.1", license: "0BSD", licenseText: "a" },
      { name: "tslib", version: "1.14.1", license: "0BSD", licenseText: "b" },
      { name: "tslib", version: "2.8.1-beta.1", license: "0BSD", licenseText: "d" },
      { name: "tslib", version: "2.8.1-beta.10", license: "0BSD", licenseText: "e" },
      { name: "tslib", version: "2.8.1-beta.2", license: "0BSD", licenseText: "f" },
    ]);
    expect(out).toContain("Packages: 6");
    expect(out.indexOf("tslib@2.8.1-beta.2\n")).toBeLessThan(out.indexOf("tslib@2.8.1-beta.10\n"));
    expect(out.indexOf("tslib@2.8.1-beta.10\n")).toBeLessThan(out.indexOf("tslib@2.8.1\n"));
    expect(out.indexOf("tslib@1.14.1")).toBeLessThan(out.indexOf("tslib@2.8.1-beta.1\n"));
    expect(out.indexOf("tslib@2.8.1-beta.1\n")).toBeLessThan(out.indexOf("tslib@2.8.1-beta.2\n"));
    expect(out.indexOf("tslib@2.8.1\n")).toBeLessThan(out.indexOf("tslib@10.0.0"));
  });
});
