import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
import { engineRecordPackages, portVersionProblems } from "../build/rustNotices";
import { helpAboutBody } from "../ui/templates/helpContent";

/** The header a generated file opens with: the script that wrote it and the package it copies. */
const GENERATED_HEADER = /AUTO-GENERATED(?: by (scripts\/[\w.-]+))?[^\n]*\bfrom (@?[\w.-]+(?:\/[\w.-]+)?)@/;

/**
 * What each `scripts/gen-*` file says it copies, from its `copies-package:`
 * lines: `none`, or `<package> -> <repo-relative output>` once per copy. A
 * generator with no declaration, or one that mixes `none` with a copy, fails
 * here, so a generator that copies package content cannot skip the header
 * check by leaving the line out.
 */
function generatorDeclarations(root: string): Map<string, { pkg: string; out: string }[]> {
  const out = new Map<string, { pkg: string; out: string }[]>();
  for (const name of readdirSync(join(root, "scripts"))
    .filter((n) => n.startsWith("gen-"))
    .sort()) {
    const script = `scripts/${name}`;
    const lines = [
      ...readFileSync(join(root, script), "utf8").matchAll(/^\s*(?:\/\/|#|\*)\s*copies-package:(.*)$/gm),
    ].map((m) => m[1].trim());
    expect(lines.length, `${script} declares what it copies with a "copies-package:" line`).toBeGreaterThan(0);
    if (lines.includes("none")) {
      expect(lines, `${script} declares "none" alone`).toEqual(["none"]);
      out.set(script, []);
      continue;
    }
    out.set(
      script,
      lines.map((line) => {
        const m = /^(@?[\w.-]+(?:\/[\w.-]+)?) -> (\S+)$/.exec(line);
        expect(m, `${script}: "copies-package: ${line}" reads "<package> -> <output path>"`).not.toBeNull();
        // Only module-graph code reaches a sourcemap, which is how the notices find a copy.
        expect(
          /\.[mc]?[jt]sx?$/.test(m![2]),
          `${script}: ${m![2]} is not JavaScript or TypeScript, so no sourcemap would attribute its copy of ${m![1]}`,
        ).toBe(true);
        return { pkg: m![1], out: m![2] };
      }),
    );
  }
  return out;
}

describe("third-party notices (#951)", () => {
  it("maps a bundled source to its package directory, scoped and nested included", () => {
    expect(packageDirFromSource("/repo/node_modules/excalibur/build/esm/index.js")).toBe(
      "/repo/node_modules/excalibur",
    );
    expect(packageDirFromSource("/repo/node_modules/@vercel/analytics/dist/index.mjs")).toBe(
      "/repo/node_modules/@vercel/analytics",
    );
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
    expect(packageDirFromSource("/r/node_modules/.pnpm/a@1.0.0/node_modules/a/x.js")).toBe(
      "/r/node_modules/.pnpm/a@1.0.0/node_modules/a",
    );
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
    for (const name of [
      "LICENSE",
      "LICENSE.md",
      "license.txt",
      "LICENCE",
      "COPYING",
      "LICENSE-MIT",
      "UNLICENSE",
      "MIT-LICENSE",
      "COPYRIGHT",
    ]) {
      expect(isLicenseFileName(name)).toBe(true);
    }
    expect(isLicenseTextFileName("COPYRIGHT")).toBe(false);
    expect(isLicenseTextFileName("LICENSE")).toBe(true);
    for (const name of [
      "README.md",
      "package.json",
      "licensed.js",
      "CHANGELOG.md",
      "license.js",
      "copyright.ts",
      "LICENSE.json",
    ]) {
      expect(isLicenseFileName(name)).toBe(false);
    }
  });

  it("refuses a package with no name, version, allowed license or license text", () => {
    expect(noticeProblem({ version: "1.0.0", license: "MIT", licenseText: "x" })).toMatch(/no name/);
    expect(noticeProblem({ name: "a", license: "MIT", licenseText: "x" })).toMatch(/no version/);
    expect(noticeProblem({ name: "a", version: "1.0.0", licenseText: "x" })).toMatch(/declares no license/);
    expect(noticeProblem({ name: "a", version: "1.0.0", license: "GPL-3.0-only", licenseText: "x" })).toMatch(
      /not on the allowlist/,
    );
    expect(noticeProblem({ name: "a", version: "1.0.0", license: "MIT" })).toMatch(/no license file/);
    // A NOTICE file alone does not stand in for the license text.
    expect(
      noticeProblem({
        name: "a",
        version: "1.0.0",
        license: "Apache-2.0",
        licenseText: "NOTICE text",
        hasLicenseFile: false,
      }),
    ).toMatch(/no license file/);
    expect(noticeProblem({ name: "a", version: "1.0.0", license: "MIT", licenseText: "text" })).toBeNull();
  });

  it("turns sourcemap sources into absolute paths, or null when they name no file", () => {
    expect(sourceToPath("../../node_modules/x/a.js", "/repo/dist/assets", undefined)).toBe("/repo/node_modules/x/a.js");
    expect(sourceToPath("x/a.js", "/repo/dist", "../src")).toBe("/repo/src/x/a.js");
    expect(sourceToPath("x/a.js", "/repo/dist", "/abs")).toBe("/abs/x/a.js");
    expect(sourceToPath("file:///repo/node_modules/%40scope/p%20q/a.js", "/d", undefined)).toBe(
      "/repo/node_modules/@scope/p q/a.js",
    );
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
    expect(sourceToPath("../../node_modules/x/a.js", "//server/share/repo/dist/assets", undefined)).toBe(
      "//server/share/repo/node_modules/x/a.js",
    );
    expect(sourceToPath("\\\\server\\share\\repo\\a.js", "/d", undefined)).toBe("//server/share/repo/a.js");
    expect(sourceToPath("file://server/share/repo/node_modules/x/a.js", "/d", undefined)).toBe(
      "//server/share/repo/node_modules/x/a.js",
    );
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
    for (const malformed of ["(MIT", "MIT)", "MIT OR", "", "AND MIT", "MIT OR WITH", "(MIT OR WITH)", "WITH OR MIT"])
      expect(isAllowedLicense(malformed)).toBe(false);
    expect(isAllowedLicense("Apache-2.0 WITH LLVM-exception")).toBe(false);
    expect(isAllowedLicense("SEE LICENSE IN LICENSE.md")).toBe(false);
    expect(isAllowedLicense("UNLICENSED")).toBe(false);
    expect(isNoticeFileName("NOTICE")).toBe(true);
    expect(isNoticeFileName("NOTICE.txt")).toBe(true);
    expect(isNoticeFileName("notices.js")).toBe(false);
  });

  it("always shows the About licenses link and honors a custom href", () => {
    const host = document.createElement("div");
    render(helpAboutBody("1.0.0"), host);
    expect(host.querySelector("a")?.getAttribute("href")).toBe("third-party-notices.txt");
    render(helpAboutBody("1.0.0", "", "/third-party-notices.txt"), host);
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

  it("attributes the generated icon module the components package ships", () => {
    // The icon paths moved to @verticopolis/components with its generator;
    // the module still carries pixelarticons path data into the bundle.
    const root = join(__dirname, "..", "..");
    const rel = "node_modules/@verticopolis/components/lib/ui/iconPaths.generated.js";
    const header = GENERATED_HEADER.exec(readFileSync(join(root, rel), "utf8").slice(0, 400));
    expect(header?.[2]).toBe("pixelarticons");
    expect(INJECTED_CODE.some((inj) => inj.pkg === "pixelarticons" && inj.sourcePattern?.test(`../${rel}`))).toBe(true);
    expect(
      INJECTED_CODE.some(
        (inj) => inj.pkg === "pixelarticons" && inj.sourcePattern?.test("../src/ui/iconPaths.generated.ts"),
      ),
    ).toBe(false);
  });

  it("holds every scripts/gen-* generator to its copies-package declaration (#974)", () => {
    const root = join(__dirname, "..", "..");
    const declared = generatorDeclarations(root);
    expect(declared.size).toBeGreaterThan(0);
    for (const [script, copies] of declared) {
      for (const { pkg, out } of copies) {
        expect(
          INJECTED_CODE.some((inj) => inj.pkg === pkg && inj.sourcePattern?.test(`/${out}`)),
          `${script} copies ${pkg} into ${out}, which INJECTED_CODE must attribute`,
        ).toBe(true);
        let head = "";
        try {
          head = readFileSync(join(root, out), "utf8").slice(0, 400);
        } catch {
          // Missing: the expectation below names it.
        }
        const header = GENERATED_HEADER.exec(head);
        expect(
          header && header[1] === script && header[2] === pkg,
          `${out} carries the AUTO-GENERATED header naming ${script} and ${pkg}@`,
        ).toBe(true);
      }
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

  it("labels Rust crates and keeps them apart from npm packages of the same name", () => {
    const out = renderNotices([
      { name: "base64", version: "0.22.1", license: "MIT OR Apache-2.0", licenseText: "a", kind: "crate" },
      { name: "base64", version: "0.22.1", license: "MIT", licenseText: "b" },
    ]);
    expect(out).toContain("Packages: 2");
    expect(out).toContain("base64@0.22.1 (Rust engine crate)");
    expect(out).toMatch(/^base64@0\.22\.1$/m);
    // unicode-ident's license, compiled into the engine.
    expect(isAllowedLicense("(MIT OR Apache-2.0) AND Unicode-3.0")).toBe(true);
  });

  it("trusts the engine's record only when it matches the package and every crate checks out", () => {
    const good = {
      name: "serde",
      version: "1.0.229",
      license: "MIT OR Apache-2.0",
      licenseText: "MIT text",
      hasLicenseFile: true,
      kind: "crate",
    };
    const std = {
      name: "Rust standard library",
      version: "1.97.0",
      license: "(MIT OR Apache-2.0) AND Unicode-3.0 AND Zlib",
      licenseText: "std text",
      hasLicenseFile: true,
      kind: "crate",
    };
    const shipped = { sources: "abc", wasm: "w" };
    // A record for another .wasm, or a package that ships none.
    expect(
      engineRecordPackages({ sources: "abc", wasm: "other", crates: [good, std] }, shipped).problems.join(),
    ).toMatch(/SHA-256 differs/);
    expect(
      engineRecordPackages(
        { sources: "abc", wasm: "w", crates: [good, std] },
        { sources: "abc", wasm: null },
      ).problems.join(),
    ).toMatch(/ships no verticopolis_engine_bg\.wasm/);
    const ok = engineRecordPackages({ sources: "abc", wasm: "w", crates: [good, std] }, shipped);
    expect(ok.problems).toEqual([]);
    expect(ok.packages[0]).toEqual({
      name: "serde",
      version: "1.0.229",
      license: "MIT OR Apache-2.0",
      licenseText: "MIT text",
      kind: "crate",
    });
    // The standard library is always linked, so a record without it is refused.
    expect(engineRecordPackages({ sources: "abc", wasm: "w", crates: [good] }, shipped).problems.join()).toMatch(
      /Rust standard library/,
    );
    // Nor is one with only the standard library: the engine always compiles in crates.
    expect(engineRecordPackages({ sources: "abc", wasm: "w", crates: [std] }, shipped).problems.join()).toMatch(
      /no crate besides/,
    );
    // A record from another build of the engine.
    expect(engineRecordPackages({ sources: "old", wasm: "w", crates: [good, std] }, shipped).problems.join()).toMatch(
      /source hash differs/,
    );
    expect(
      engineRecordPackages({ wasm: "w", crates: [good, std] }, { sources: undefined, wasm: "w" }).problems.join(),
    ).toMatch(/source hash differs/);
    // Missing, empty or malformed records.
    for (const bad of [null, [], { sources: "abc" }, { sources: "abc", crates: [] }]) {
      expect(engineRecordPackages(bad, shipped).problems.length).toBeGreaterThan(0);
    }
    // Each crate is held to the same checks as an npm package.
    const check = (entry: object) =>
      engineRecordPackages(
        { sources: "abc", wasm: "w", crates: [{ ...good, ...entry }, std] },
        shipped,
      ).problems.join();
    expect(check({ license: "GPL-3.0-only" })).toMatch(/not on the allowlist/);
    expect(check({ hasLicenseFile: false })).toMatch(/no license file/);
    expect(check({ licenseText: " " })).toMatch(/no license file/);
    expect(check({ version: undefined })).toMatch(/no version/);
    expect(check({ kind: "npm" })).toMatch(/not marked as a crate or a port/);
  });

  it("requires a notice for each npm package the engine ports, and labels it (#1356)", () => {
    const good = {
      name: "serde",
      version: "1.0.229",
      license: "MIT OR Apache-2.0",
      licenseText: "MIT text",
      hasLicenseFile: true,
      kind: "crate",
    };
    const std = {
      name: "Rust standard library",
      version: "1.97.0",
      license: "(MIT OR Apache-2.0) AND Unicode-3.0 AND Zlib",
      licenseText: "std text",
      hasLicenseFile: true,
      kind: "crate",
    };
    const port = {
      name: "fflate",
      version: "0.8.3",
      license: "MIT",
      licenseText: "fflate MIT text",
      hasLicenseFile: true,
      kind: "port",
    };
    const shipped = { sources: "abc", wasm: "w", ports: ["fflate"] };
    const ok = engineRecordPackages({ sources: "abc", wasm: "w", crates: [good, std, port] }, shipped);
    expect(ok.problems).toEqual([]);
    expect(ok.packages[2]).toEqual({
      name: "fflate",
      version: "0.8.3",
      license: "MIT",
      licenseText: "fflate MIT text",
      kind: "port",
    });
    expect(engineRecordPackages({ sources: "abc", wasm: "w", crates: [good, std] }, shipped).problems).toEqual([
      "the record does not list fflate, whose code the engine ports",
    ]);
    // An fflate entry marked as a crate is not the port's notice, and a port alone is not a crate.
    expect(
      engineRecordPackages(
        { sources: "abc", wasm: "w", crates: [good, std, { ...port, kind: "crate" }] },
        shipped,
      ).problems.join(),
    ).toMatch(/does not list fflate/);
    expect(engineRecordPackages({ sources: "abc", wasm: "w", crates: [std, port] }, shipped).problems.join()).toMatch(
      /no crate besides/,
    );
    // The port is held to the same notice checks.
    expect(
      engineRecordPackages(
        { sources: "abc", wasm: "w", crates: [good, std, { ...port, license: "GPL-3.0-only" }] },
        shipped,
      ).problems.join(),
    ).toMatch(/not on the allowlist/);
    const out = renderNotices([
      { name: "fflate", version: "0.8.3", license: "MIT", licenseText: "a", kind: "port" },
      { name: "fflate", version: "0.8.3", license: "MIT", licenseText: "a" },
    ]);
    expect(out).toContain("fflate@0.8.3 (ported into the Rust engine)");
    expect(out).toMatch(/^fflate@0\.8\.3$/m);
  });

  it("refuses an installed copy of a ported package at another version (#1356)", () => {
    const ports = [{ name: "fflate", version: "0.8.3", license: "MIT", source: "src/fflate.rs", notice: "src/fflate" }];
    expect(portVersionProblems(ports, () => "0.8.3")).toEqual([]);
    expect(portVersionProblems(ports, () => "0.8.4")).toEqual([
      "the engine ports fflate 0.8.3, and npm installs 0.8.4: port that version or update ENGINE_PORTS",
    ]);
    expect(portVersionProblems(ports, () => null)[0]).toMatch(/npm installs no copy/);
  });
});
