import { describe, it, expect, beforeEach } from "vitest";
import {
  parseUpdateInfo,
  isDifferentBuild,
  classifyUpdate,
  withUpdateKind,
  isNewerVersion,
  notesSinceRunning,
  notesStillUnseen,
  readNotesSeen,
  rememberNotesSeen,
  NOTES_SEEN_KEY,
  MAX_NOTE_LEN,
  MAX_NOTES,
  MAX_RELEASES,
  type BuildFingerprint,
  type UpdateInfo,
} from "./pwaUpdateInfo";

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
    return { shell, engine: { crate: "0.24.0", rust: "r1", ...engine } };
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

  it("ignores a TypeScript engine hash an older build still reports", () => {
    const old = (ts: string): BuildFingerprint => ({ shell: "s1", engine: { crate: "0.24.0", rust: "r1", ts } as BuildFingerprint["engine"] });
    expect(classifyUpdate(old("t2"), old("t1"))).toBeNull();
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
    // An older build's `ts` is tolerated in the payload and dropped from the fingerprint.
    expect(ok?.fingerprint).toEqual({ shell: "abc", engine: { crate: "0.24.0", rust: "r" } });
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
    const running: BuildFingerprint = { shell: "s1", engine: { rust: "r1" } };
    const info = { version: "2.61.0", fingerprint: { shell: "s2", engine: { rust: "r1" } } };
    expect(withUpdateKind(info, running)?.kind).toBe("game");
    expect(withUpdateKind(info, undefined)).toBe(info);
    expect(withUpdateKind(undefined, running)).toBeUndefined();
  });
});

describe("notes since the player's version (#1897)", () => {
  const rel = (version: string, ...notes: string[]) => ({ version, notes: notes.length ? notes : [`${version} note.`] });
  /** What a 3.0.3 build's version.json carries: its own notes and the versions before it, newest first. */
  const incoming = (over: Partial<UpdateInfo> = {}): UpdateInfo => ({
    version: "3.0.3",
    sha: "abc1234",
    notes: ["3.0.3 note."],
    releases: [rel("3.0.3"), rel("3.0.2"), rel("3.0.1"), rel("3.0.0"), rel("2.90.0")],
    ...over,
  });
  const shownVersions = (i: UpdateInfo) => (i.releases ?? []).map((r) => r.version);

  beforeEach(() => localStorage.clear());

  it("compares plain versions numerically, and never a dev or prerelease string", () => {
    expect(isNewerVersion("3.0.10", "3.0.9")).toBe(true);
    expect(isNewerVersion("3.0.0", "2.90.0")).toBe(true);
    expect(isNewerVersion("2.90.0", "3.0.0")).toBe(false);
    expect(isNewerVersion("3.0.0", "3.0.0")).toBe(false);
    expect(isNewerVersion("dev", "1.0.0")).toBe(false);
    expect(isNewerVersion("3.0.1-rc.1", "3.0.0")).toBe(false);
    expect(isNewerVersion(undefined, "1.0.0")).toBe(false);
  });

  it("shows every version newer than the running one, newest first", () => {
    const shown = notesSinceRunning(incoming(), "3.0.0");
    expect(shownVersions(shown)).toEqual(["3.0.3", "3.0.2", "3.0.1"]);
    expect(shown.since).toBe("3.0.0");
    expect(shown.more).toBeUndefined();
  });

  it("never repeats the running version's notes: a player on 3.0.0 updating to 3.0.1 sees only 3.0.1", () => {
    const shown = notesSinceRunning(incoming({ version: "3.0.1", notes: ["3.0.1 note."], releases: [rel("3.0.1"), rel("3.0.0"), rel("2.90.0")] }), "3.0.0");
    expect(shownVersions(shown)).toEqual(["3.0.1"]);
    expect(shown.releases?.flatMap((r) => r.notes)).toEqual(["3.0.1 note."]);
  });

  it("never repeats notes an earlier prompt already showed", () => {
    // The player saw the 3.0.2 prompt, chose Later, and 3.0.3 shipped before they reopened.
    const shown = notesSinceRunning(incoming(), "3.0.0", "3.0.2");
    expect(shownVersions(shown)).toEqual(["3.0.3"]);
    expect(shown.since).toBe("3.0.2");
    // A prompt for a build whose notes were all shown already shows none.
    expect(notesSinceRunning(incoming(), "3.0.0", "3.0.3").releases).toEqual([]);
    expect(notesSinceRunning(incoming(), "3.0.0", "3.0.3").notes).toEqual([]);
    // A seen version older than the running one changes nothing.
    expect(shownVersions(notesSinceRunning(incoming(), "3.0.1", "2.90.0"))).toEqual(["3.0.3", "3.0.2"]);
  });

  it("shows nothing for a same-version rebuild", () => {
    const shown = notesSinceRunning(incoming(), "3.0.3");
    expect(shown.notes).toEqual([]);
    expect(shown.releases).toEqual([]);
  });

  it("leads with the incoming notes when the payload carries no releases (an older server)", () => {
    expect(shownVersions(notesSinceRunning(incoming({ releases: [] }), "3.0.0"))).toEqual(["3.0.3"]);
  });

  it("keeps a version newer than the incoming one out, and sorts whatever order arrives", () => {
    const shown = notesSinceRunning(incoming({ releases: [rel("3.0.1"), rel("3.0.4"), rel("3.0.3"), rel("3.0.2")] }), "3.0.0");
    expect(shownVersions(shown)).toEqual(["3.0.3", "3.0.2", "3.0.1"]);
  });

  it("says when the player skipped more versions than the payload carries", () => {
    const releases = Array.from({ length: MAX_RELEASES }, (_, i) => rel(`3.0.${MAX_RELEASES - i}`));
    const shown = notesSinceRunning(incoming({ version: `3.0.${MAX_RELEASES}`, releases }), "2.90.0");
    expect(shown.releases).toHaveLength(MAX_RELEASES);
    expect(shown.more).toBe(true);
    expect(notesSinceRunning(incoming({ version: `3.0.${MAX_RELEASES}`, releases }), "3.0.1").more).toBeUndefined();
  });

  it("shows only the incoming notes when the running build is not a plain version", () => {
    expect(shownVersions(notesSinceRunning(incoming(), "dev"))).toEqual(["3.0.3"]);
  });

  it("parses releases with the same caps as notes and drops malformed entries", () => {
    const long = "x".repeat(MAX_NOTE_LEN + 10);
    const parsed = parseUpdateInfo({
      releases: [{ version: "3.0.1", notes: [long, "b", "c", "d"] }, { version: 7, notes: ["a"] }, { version: "3.0.0", notes: [] }, null, "x"],
    });
    expect(parsed?.releases).toEqual([{ version: "3.0.1", notes: [long.slice(0, MAX_NOTE_LEN), "b", "c"] }]);
    const many = Array.from({ length: MAX_RELEASES + 5 }, (_, i) => ({ version: `1.0.${i}`, notes: ["n"] }));
    expect(parseUpdateInfo({ releases: many })?.releases).toHaveLength(MAX_RELEASES);
    expect(parseUpdateInfo({ releases: "nope" })?.releases).toEqual([]);
  });

  it("remembers the newest version whose notes were shown, and ignores an older or invalid one", () => {
    expect(readNotesSeen()).toBeUndefined();
    rememberNotesSeen("3.0.2");
    expect(readNotesSeen()).toBe("3.0.2");
    rememberNotesSeen("3.0.1");
    rememberNotesSeen("dev");
    rememberNotesSeen(undefined);
    expect(readNotesSeen()).toBe("3.0.2");
    localStorage.setItem(NOTES_SEEN_KEY, "garbage");
    expect(readNotesSeen()).toBeUndefined();
  });
});

describe("notes still unseen when the prompt opens (#1897)", () => {
  const rel = (version: string) => ({ version, notes: [`${version} note.`] });
  const detected = notesSinceRunning(
    { version: "3.0.3", notes: ["3.0.3 note."], releases: [rel("3.0.3"), rel("3.0.2"), rel("3.0.1")] },
    "3.0.0",
  );

  it("drops notes another tab showed between detection and display", () => {
    const shown = notesStillUnseen(detected, "3.0.0", "3.0.2");
    expect(shown.releases?.map((r) => r.version)).toEqual(["3.0.3"]);
    expect(shown.since).toBe("3.0.2");
    expect(notesStillUnseen(detected, "3.0.0", "3.0.3").releases).toEqual([]);
  });

  it("leaves the notes alone while the seen version has not moved", () => {
    expect(notesStillUnseen(detected, "3.0.0", undefined)).toBe(detected);
    expect(notesStillUnseen(detected, "3.0.0", "3.0.0")).toBe(detected);
  });
});
