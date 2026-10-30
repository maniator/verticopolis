import { describe, it, expect } from "vitest";
import { parseUpdateInfo, isDifferentBuild, classifyUpdate, withUpdateKind, MAX_NOTE_LEN, MAX_NOTES, type BuildFingerprint } from "./pwaUpdateInfo";

/**
 * The pure sanitizer that bounds an incoming version.json payload before it
 * reaches the update modal. These are the security-relevant caps — extracted
 * from pwa.ts's fetch so they can be exercised without a network or SW.
 */
describe("parseUpdateInfo — payload sanitization", () => {
  it("returns null for anything that isn't an object", () => {
    expect(parseUpdateInfo(null)).toBeNull();
    expect(parseUpdateInfo(undefined)).toBeNull();
    expect(parseUpdateInfo("nope")).toBeNull();
    expect(parseUpdateInfo(42)).toBeNull();
  });

  it("type-guards version and sha to strings (anything else → undefined)", () => {
    expect(parseUpdateInfo({ version: "1.2.3", sha: "abc1234" })).toMatchObject({
      version: "1.2.3",
      sha: "abc1234",
    });
    const bad = parseUpdateInfo({ version: 5, sha: { nope: true } });
    expect(bad).toMatchObject({ version: undefined, sha: undefined });
  });

  it("keeps only non-empty string notes, trimmed", () => {
    const r = parseUpdateInfo({ notes: ["  hi  ", 7, "", "   ", null, "there"] });
    expect(r?.notes).toEqual(["hi", "there"]);
  });

  it("clamps each note to MAX_NOTE_LEN characters", () => {
    const long = "x".repeat(MAX_NOTE_LEN + 50);
    const r = parseUpdateInfo({ notes: [long] });
    expect(r?.notes?.[0]).toHaveLength(MAX_NOTE_LEN);
  });

  it("caps the number of notes at MAX_NOTES", () => {
    const many = Array.from({ length: MAX_NOTES + 4 }, (_, i) => `note ${i}`);
    const r = parseUpdateInfo({ notes: many });
    expect(r?.notes).toHaveLength(MAX_NOTES);
    expect(r?.notes?.[0]).toBe("note 0"); // keeps the first N, in order
  });

  it("defaults notes to [] when the field is absent or not an array", () => {
    expect(parseUpdateInfo({})?.notes).toEqual([]);
    expect(parseUpdateInfo({ notes: "not-an-array" })?.notes).toEqual([]);
  });
});

/**
 * The pure build-comparison used by the version.json poll to catch a new deploy
 * even when the service-worker update check is missed (a stale-served sw.js).
 */
describe("isDifferentBuild — running vs deployed", () => {
  const running = { version: "1.50.0", sha: "5f90fc2" };

  it("is false for a null payload (fetch failed / offline)", () => {
    expect(isDifferentBuild(null, running.version, running.sha)).toBe(false);
  });

  it("is false when sha and version both match the running build", () => {
    expect(isDifferentBuild({ version: "1.50.0", sha: "5f90fc2", notes: [] }, running.version, running.sha)).toBe(
      false,
    );
  });

  it("detects a different sha even when the version string is unchanged", () => {
    // An internal-only rebuild bumps the sha but not the version.
    expect(isDifferentBuild({ version: "1.50.0", sha: "abcdef0", notes: [] }, running.version, running.sha)).toBe(
      true,
    );
  });

  it("detects a newer version string", () => {
    expect(isDifferentBuild({ version: "1.51.0", sha: "abcdef0", notes: [] }, running.version, running.sha)).toBe(
      true,
    );
  });

  it("ignores an absent sha on the payload and falls back to the version", () => {
    expect(isDifferentBuild({ version: "1.51.0", notes: [] }, running.version, running.sha)).toBe(true);
    expect(isDifferentBuild({ version: "1.50.0", notes: [] }, running.version, running.sha)).toBe(false);
  });

  it("never fires on absent data (both fields missing or blank)", () => {
    expect(isDifferentBuild({ notes: [] }, running.version, running.sha)).toBe(false);
    expect(isDifferentBuild({ version: "", sha: "", notes: [] }, running.version, running.sha)).toBe(false);
    // A blank running sha (a non-git build) must not read every deploy as different.
    expect(isDifferentBuild({ version: "1.50.0", sha: "5f90fc2", notes: [] }, "1.50.0", "")).toBe(false);
  });

  it('treats the non-git placeholder "unknown" sha as missing on either side', () => {
    // Deployed sha is the "unknown" placeholder but the version matches: not different.
    expect(isDifferentBuild({ version: "1.50.0", sha: "unknown", notes: [] }, "1.50.0", "5f90fc2")).toBe(false);
    // Running build has no git metadata ("unknown"); deployed has a real sha but
    // the version matches: not different (do not compare "unknown" as a real sha).
    expect(isDifferentBuild({ version: "1.50.0", sha: "5f90fc2", notes: [] }, "1.50.0", "unknown")).toBe(false);
    // Both "unknown", same version: not different.
    expect(isDifferentBuild({ version: "1.50.0", sha: "unknown", notes: [] }, "1.50.0", "unknown")).toBe(false);
    // "unknown" sha but a genuinely newer version still fires via the version fallback.
    expect(isDifferentBuild({ version: "1.51.0", sha: "unknown", notes: [] }, "1.50.0", "unknown")).toBe(true);
  });
});

describe("classifyUpdate: game, engine or both", () => {
  const fp = (over: Partial<BuildFingerprint["engine"]> & { shell?: string } = {}): BuildFingerprint => {
    const { shell = "s1", ...engine } = over;
    return { shell, engine: { crate: "0.24.0", rust: "r1", ts: "t1", ...engine } };
  };

  it("says nothing without both fingerprints, or when nothing differs", () => {
    expect(classifyUpdate(undefined, fp())).toBeNull();
    expect(classifyUpdate(fp(), undefined)).toBeNull();
    expect(classifyUpdate(fp(), fp())).toBeNull();
  });

  it("calls a shell-only change a game update", () => {
    expect(classifyUpdate(fp({ shell: "s2" }), fp())).toEqual({ kind: "game" });
  });

  it("calls a crate bump an engine update and names both versions", () => {
    expect(classifyUpdate(fp({ crate: "0.25.0", rust: "r2" }), fp())).toEqual({
      kind: "engine",
      engineLine: "Rust engine 0.24.0 → 0.25.0",
    });
  });

  it("calls a Rust rebuild without a crate bump an engine update", () => {
    expect(classifyUpdate(fp({ rust: "r2" }), fp())).toEqual({ kind: "engine", engineLine: "Rust engine 0.24.0 (new build)" });
  });

  it("calls a TypeScript engine change an engine update", () => {
    expect(classifyUpdate(fp({ ts: "t2" }), fp())).toEqual({ kind: "engine", engineLine: "TypeScript engine (new build)" });
  });

  it("calls a change to both the shell and an engine both", () => {
    expect(classifyUpdate(fp({ shell: "s2", crate: "0.25.0", rust: "r2" }), fp())?.kind).toBe("both");
  });

  it("ignores an engine part either side did not report", () => {
    expect(classifyUpdate(fp({ crate: undefined, rust: undefined }), fp())).toBeNull();
  });
});

describe("withUpdateKind and the fingerprint in version.json", () => {
  it("parses a bounded fingerprint and drops a malformed one", () => {
    const ok = parseUpdateInfo({ shell: "abc", engine: { crate: "0.24.0", rust: "r", ts: "t", extra: 1 } });
    expect(ok?.fingerprint).toEqual({ shell: "abc", engine: { crate: "0.24.0", rust: "r", ts: "t" } });
    expect(parseUpdateInfo({ shell: "abc" })?.fingerprint).toBeUndefined();
    expect(parseUpdateInfo({ shell: "x".repeat(65), engine: {} })?.fingerprint).toBeUndefined();
    expect(parseUpdateInfo({ shell: "abc", engine: { crate: 5 } })?.fingerprint?.engine.crate).toBeUndefined();
  });

  it("never takes a kind or engine line from the payload", () => {
    const info = parseUpdateInfo({ kind: "game", engineLine: "<b>hi</b>" });
    expect(info?.kind).toBeUndefined();
    expect(info?.engineLine).toBeUndefined();
  });

  it("fills the kind from the running build and leaves other info alone", () => {
    const running: BuildFingerprint = { shell: "s1", engine: { ts: "t1" } };
    const info = { version: "2.61.0", fingerprint: { shell: "s2", engine: { ts: "t1" } } };
    expect(withUpdateKind(info, running)?.kind).toBe("game");
    expect(withUpdateKind(info, undefined)).toBe(info);
    expect(withUpdateKind(undefined, running)).toBeUndefined();
  });
});
