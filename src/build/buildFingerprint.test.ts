import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFingerprint } from "./buildFingerprint";
import type { ExpectedEnginePackage } from "../wasmhost/enginePackageRecord";

/** A `src` folder holding `files`. */
function srcDir(files: Record<string, string>): string {
  const src = mkdtempSync(join(tmpdir(), "build-fp-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(src, name, ".."), { recursive: true });
    writeFileSync(join(src, name), text);
  }
  return src;
}

const base = {
  "ui/panel.ts": "panel",
  "styles.css": "body {}",
  "public/engine/BUILD.json": "{}",
  "ui/panel.test.ts": "t",
};
const pkg = (version: string, sources: string): ExpectedEnginePackage => ({ package: "p", files: {}, crate: { name: "vc", version }, sources });

describe("the build fingerprint", () => {
  it("changes the shell part with shell sources and not with engine, package or test files", () => {
    const shell = buildFingerprint(srcDir(base), null).shell;
    expect(buildFingerprint(srcDir({ ...base, "ui/panel.ts": "x" }), null).shell).not.toBe(shell);
    expect(buildFingerprint(srcDir({ ...base, "styles.css": "x" }), null).shell).not.toBe(shell);
    expect(buildFingerprint(srcDir({ ...base, "public/engine/BUILD.json": "x" }), null).shell).toBe(shell);
    expect(buildFingerprint(srcDir({ ...base, "ui/panel.test.ts": "x" }), null).shell).toBe(shell);
  });

  it("changes the engine part with the Rust package", () => {
    const fp = buildFingerprint(srcDir(base), pkg("0.24.0", "aaa"));
    expect(fp.engine).toMatchObject({ crate: "0.24.0", rust: "aaa" });
    expect(buildFingerprint(srcDir(base), pkg("0.25.0", "bbb")).engine).toMatchObject({ crate: "0.25.0", rust: "bbb" });
  });

  it("leaves the Rust part out when the build has no package", () => {
    const fp = buildFingerprint(srcDir(base), null);
    expect(fp.engine.crate).toBeUndefined();
    expect(fp.engine.rust).toBeUndefined();
  });

  it("hashes the real source tree", () => {
    const fp = buildFingerprint(join(__dirname, ".."), null);
    expect(fp.shell).toMatch(/^[0-9a-f]{64}$/);
  });
});
