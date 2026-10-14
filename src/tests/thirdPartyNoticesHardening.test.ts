import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INJECTED_CODE,
  PACKAGE_STYLESHEET,
  WHOLE_CHUNK_MAX_BYTES,
  isKnownOutsideRepoSource,
  isPackagePath,
  isWholeInjectedChunk,
  linkedDependencyProblems,
  lockfileLinkProblems,
} from "../build/thirdPartyNotices";

// The roads #974 closes in the notices generator, as pure helpers.

/** Vite 7's modulepreload polyfill chunk as the production build emits it. */
const POLYFILL = `(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const e of document.querySelectorAll('link[rel="modulepreload"]'))i(e);new MutationObserver(e=>{for(const r of e)if(r.type==="childList")for(const o of r.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&i(o)}).observe(document,{childList:!0,subtree:!0});function s(e){const r={};return e.integrity&&(r.integrity=e.integrity),e.referrerPolicy&&(r.referrerPolicy=e.referrerPolicy),e.crossOrigin==="use-credentials"?r.credentials="include":e.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function i(e){if(e.ep)return;e.ep=!0;const r=s(e);fetch(e.href,r)}})();\n//# sourceMappingURL=modulepreload-polyfill-B5Qt9EMX.js.map\n`;
const MARKER = 'link[rel="modulepreload"]';

describe("third-party notices hardening (#974)", () => {
  it("excuses an outside-repo source only through an entry marked outsideRepo", () => {
    expect(isKnownOutsideRepoSource("../../../tmp/ee960543882c65087dd93d10ef853802/sw.js")).toBe(true);
    expect(isKnownOutsideRepoSource("../../../../../@vite-plugin-pwa/virtual:pwa-register")).toBe(true);
    // The generated icon file is our own source: a copy outside the repository is not excused.
    expect(isKnownOutsideRepoSource("/elsewhere/src/ui/iconPaths.generated.ts")).toBe(false);
    expect(isKnownOutsideRepoSource("/elsewhere/node_modules/left-pad/index.js")).toBe(false);
    // The patterns are anchored to the exact ids those two tools emit.
    // The bare virtual id, as another Vite version may write it, is the same module.
    expect(isKnownOutsideRepoSource("virtual:pwa-register")).toBe(true);
    expect(isKnownOutsideRepoSource("/elsewhere/node_modules/x/virtual:pwa-register-shim.js")).toBe(false);
    expect(isKnownOutsideRepoSource("/elsewhere/xee960543882c65087dd93d10ef853802/sw.js")).toBe(false);
    // A matching pattern without the flag excuses nothing.
    expect(isKnownOutsideRepoSource("/tmp/a.js", [{ pkg: "x", sourcePattern: /a\.js$/ }])).toBe(false);
    expect(isKnownOutsideRepoSource("/tmp/a.js", [{ pkg: "x", sourcePattern: /a\.js$/, outsideRepo: true }])).toBe(true);
    expect(INJECTED_CODE.filter((inj) => inj.outsideRepo).map((inj) => inj.pkg)).toEqual(["vite-plugin-pwa", "workbox-build"]);
  });

  it("accepts a sourceless chunk only when it is the modulepreload polyfill alone", () => {
    expect(isWholeInjectedChunk(POLYFILL, MARKER)).toBe(true);
    expect(isWholeInjectedChunk(POLYFILL.replace(/\n/g, "\r\n"), MARKER)).toBe(true);
    expect(isWholeInjectedChunk(POLYFILL.replace("(function(){", "(()=>{"), MARKER)).toBe(true);
    // Other code before, after or beside the polyfill.
    expect(isWholeInjectedChunk(`var leftPad=1;${POLYFILL}`, MARKER)).toBe(false);
    expect(isWholeInjectedChunk(POLYFILL.replace("})();", "})();(function(){leftPad()})();"), MARKER)).toBe(false);
    expect(isWholeInjectedChunk(POLYFILL.replace("})();", "})();export const x=1;"), MARKER)).toBe(false);
    // A big chunk that merely contains the marker.
    const padded = POLYFILL.replace("(function(){", `(function(){${"var a=1;".repeat(WHOLE_CHUNK_MAX_BYTES / 8)}`);
    expect(isWholeInjectedChunk(padded, MARKER)).toBe(false);
    // No marker, or the marker without the function around it.
    expect(isWholeInjectedChunk(POLYFILL.replace(MARKER, "link"), MARKER)).toBe(false);
    expect(isWholeInjectedChunk(`document.querySelectorAll('${MARKER}');`, MARKER)).toBe(false);
  });

  it("recognizes package paths with either separator and ignores a query", () => {
    expect(isPackagePath("/repo/node_modules/excalibur/build/esm/index.js")).toBe(true);
    expect(isPackagePath("node_modules/x/a.css")).toBe(true);
    expect(isPackagePath("C:\\repo\\node_modules\\fflate\\esm\\browser.js")).toBe(true);
    expect(isPackagePath("\0/repo/node_modules/p/x.js?commonjs-proxy")).toBe(true);
    expect(isPackagePath("/repo/src/main.ts")).toBe(false);
    expect(isPackagePath("/repo/src/my_node_modules/x.js")).toBe(false);
    expect(isPackagePath("/repo/src/style.css?from=/node_modules/x/a.css")).toBe(false);
    const stylesheet = /\.(css|scss)$/;
    expect(isPackagePath("/repo/node_modules/x/a.css?inline", stylesheet)).toBe(true);
    expect(isPackagePath("C:\\repo\\node_modules\\x\\a.scss?used", stylesheet)).toBe(true);
    expect(isPackagePath("/repo/node_modules/x/a.js?x.css", stylesheet)).toBe(false);
    expect(isPackagePath("/repo/src/a.css", stylesheet)).toBe(false);
  });

  it("finds a package stylesheet's extension at the end of the path or of any query part", () => {
    // The plugin's test: the path's extension, or the whole id's.
    const refused = (id: string): boolean => isPackagePath(id, PACKAGE_STYLESHEET) || (isPackagePath(id) && PACKAGE_STYLESHEET.test(id));
    for (const id of ["/r/node_modules/x/a.css", "/r/node_modules/x/a.scss?inline", "/r/node_modules/x/A.vue?vue&type=style&lang.css", "/r/node_modules/x/A.vue?vue&type=style&lang.css&inline", "/r/node_modules/x/A.vue?lang.less#x"]) {
      expect(refused(id), id).toBe(true);
    }
    for (const id of ["/r/node_modules/x/a.js", "/r/node_modules/x/a.cssx.js", "/r/node_modules/x/a.js?lang.cssx", "/r/src/a.css?lang.css"]) expect(refused(id), id).toBe(false);
  });

  it("refuses a lockfile that installs any package as a link", () => {
    expect(lockfileLinkProblems({ packages: { "": { name: "x" }, "node_modules/a": { version: "1.0.0" } } })).toEqual([]);
    expect(lockfileLinkProblems({ packages: { "node_modules/a": { resolved: "../a", link: true }, "node_modules/b/node_modules/c": { link: true } } })).toEqual([
      "package-lock.json installs node_modules/a as a link",
      "package-lock.json installs node_modules/b/node_modules/c as a link",
    ]);
    expect(lockfileLinkProblems({ packages: { "node_modules/a": { link: true } } }, "node_modules/.package-lock.json")).toEqual(["node_modules/.package-lock.json installs node_modules/a as a link"]);
    expect(lockfileLinkProblems(null)).toEqual([]);
    // The real lockfile links nothing.
    expect(lockfileLinkProblems(JSON.parse(readFileSync(join(__dirname, "..", "..", "package-lock.json"), "utf8")))).toEqual([]);
  });

  it("refuses a package.json that links a local package", () => {
    expect(linkedDependencyProblems({ dependencies: { tone: "^15.1.22", alias: "npm:lit-html@3" } })).toEqual([]);
    expect(linkedDependencyProblems({})).toEqual([]);
    const linked = linkedDependencyProblems({
      dependencies: { a: "file:../a", b: "link:./b" },
      devDependencies: { c: "workspace:*", d: "../d" },
      optionalDependencies: { e: "./e", f: "~/f" },
      peerDependencies: { g: "/abs/g", h: "portal:h" },
    });
    expect(linked).toHaveLength(8);
    expect(linked[0]).toBe("package.json dependencies links a (file:../a)");
    expect(linkedDependencyProblems({ workspaces: ["packages/*"] })).toEqual(["package.json declares workspaces"]);
    expect(linkedDependencyProblems({ dependencies: ["file:x"] })).toEqual(["package.json dependencies is not an object"]);
    // A drive path, and the same specs in overrides and resolutions at any depth.
    expect(linkedDependencyProblems({ dependencies: { w: "C:/pkg/w" } })).toEqual(["package.json dependencies links w (C:/pkg/w)"]);
    // A local tarball is unpacked into node_modules as a copy, so it is not a link.
    expect(linkedDependencyProblems({ dependencies: { t: "./vendor/t-1.0.0.tgz", u: "file:u.tar.gz" } })).toEqual([]);
    expect(linkedDependencyProblems({ overrides: { foo: { bar: "file:../bar" }, ok: "^1.0.0" } })).toEqual(["package.json overrides links foo > bar (file:../bar)"]);
    expect(linkedDependencyProblems({ resolutions: { baz: "link:./baz" }, pnpm: { overrides: { qux: "./qux" } } })).toEqual([
      "package.json resolutions links baz (link:./baz)",
      "package.json pnpm.overrides links qux (./qux)",
    ]);
  });
});
