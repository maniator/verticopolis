// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BASELINE_STAMP, TS_BASELINE, baselineErrors } from "./baseline";
import { aaBaselineLimitation, baselineLimitation, buildLimitations } from "./limitations";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A baseline dist as buildBaseline leaves it, with the named fields changed. */
function dist(over: { stamp?: object | null; version?: object | null; engine?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "vc-baseline-"));
  made.push(dir);
  if (over.stamp !== null) writeFileSync(join(dir, BASELINE_STAMP), JSON.stringify({ commit: TS_BASELINE.commit, appVersion: TS_BASELINE.appVersion, ...over.stamp }));
  if (over.version !== null) writeFileSync(join(dir, "version.json"), JSON.stringify({ version: TS_BASELINE.appVersion, sha: TS_BASELINE.commit.slice(0, 8), engineBuild: "switchable", ...over.version }));
  if (over.engine) mkdirSync(join(dir, "engine"));
  return dir;
}

describe("the pinned TypeScript baseline", () => {
  it("names a full commit", () => {
    expect(TS_BASELINE.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(TS_BASELINE.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("accepts the build the pin describes", () => {
    expect(baselineErrors(dist())).toEqual([]);
  });

  it("refuses a dist with no stamp, so a build of unknown origin is never served", () => {
    expect(baselineErrors(dist({ stamp: null }))).toEqual([expect.stringContaining("no readable")]);
  });

  it("refuses another commit, another version, a Rust-only build and a build that carries an engine package", () => {
    expect(baselineErrors(dist({ stamp: { commit: "0".repeat(40) } }))).toEqual([expect.stringContaining("was built from 000")]);
    expect(baselineErrors(dist({ version: { version: "9.9.9" } }))).toEqual([expect.stringContaining("is app 9.9.9")]);
    expect(baselineErrors(dist({ version: { sha: "deadbeef" } }))).toEqual([expect.stringContaining("names commit deadbeef")]);
    expect(baselineErrors(dist({ version: { engineBuild: "wasm-only" } }))).toEqual([expect.stringContaining("needs the switchable build")]);
    expect(baselineErrors(dist({ engine: true }))).toEqual([expect.stringContaining("overlaid by the server")]);
  });

  it("refuses a version.json sha too short to name a commit", () => {
    expect(baselineErrors(dist({ version: { sha: "" } }))).toEqual([expect.stringContaining("names commit")]);
    expect(baselineErrors(dist({ version: { sha: "f" } }))).toEqual([expect.stringContaining("names commit f")]);
  });

  it("refuses an unreadable version.json and a stamp that is not JSON", () => {
    expect(baselineErrors(dist({ version: null }))).toEqual([expect.stringContaining("cannot be read")]);
    const bad = dist();
    writeFileSync(join(bad, BASELINE_STAMP), "{not json");
    expect(baselineErrors(bad)).toEqual([expect.stringContaining("no readable")]);
  });

  it("is named in the limitations of a cross-engine folder and left out of an A/A pass of WASM", () => {
    expect(buildLimitations(null, "3.0.0", [], null, TS_BASELINE).join("\n")).toContain(baselineLimitation(TS_BASELINE));
    expect(buildLimitations("wasm", "3.0.0", [], null, null).join("\n")).not.toContain("pinned pre-cutover build");
    expect(baselineLimitation(TS_BASELINE)).toContain(TS_BASELINE.commit.slice(0, 8));
  });

  it("does not say the arms differ in an A/A pass of TypeScript, where both slots ran the pinned build", () => {
    const text = buildLimitations("ts", "3.0.0", [], null, TS_BASELINE).join("\n");
    expect(text).toContain(aaBaselineLimitation(TS_BASELINE));
    expect(text).not.toContain(baselineLimitation(TS_BASELINE));
  });
});
