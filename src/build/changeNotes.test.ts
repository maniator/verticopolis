import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  bumpVersion,
  changelogVersions,
  contributorLines,
  headlineFirst,
  highestLevel,
  insertSection,
  notesKeptForCredits,
  parseNote,
  isSemverIncrease,
  readNotes,
} from "./changeNotes";

const note = (front: string, body = "") => `---\n${front}\n---\n${body}`;

describe("change notes", () => {
  it("every pending note in the repo parses", () => {
    expect(() => readNotes(resolve(__dirname, "../.."))).not.toThrow();
  });

  it("reads the level and the Player lines", () => {
    const n = parseNote(note("app: minor   # what a player notices", "## Player\n- Elevators skip empty floors.\n"), "my-branch.md");
    expect(n).toEqual({ file: "my-branch.md", app: "minor", player: ["Elevators skip empty floors."], contributors: [] });
  });

  it("reads a note from before the split, whose crate: none means nothing", () => {
    expect(parseNote(note("app: patch", "## Player\n- A fix.\n"), "old.md")).toEqual({ file: "old.md", app: "patch", player: ["A fix."], contributors: [] });
  });

  it("sends an engine change to the engine's repository", () => {
    expect(() => parseNote(note("app: none\ncrate: patch"), "x.md")).toThrow(/Verticopolis\/engine/);
    expect(() => parseNote(note("app: none\nreadmes: unchanged"), "x.md")).toThrow(/Verticopolis\/engine/);
    expect(() => parseNote(note("app: none", "## Engine\n- A fix.\n"), "x.md")).toThrow(/Verticopolis\/engine/);
  });

  it("reads Contributors lines at any level, and credits each person once", () => {
    const a = parseNote(note("app: none", "## Contributors\n- trvorth extended the room-capacity sweep (#2198).\n"), "a.md");
    expect(a.contributors).toEqual(["trvorth extended the room-capacity sweep (#2198)."]);
    const b = parseNote(note("app: patch", "## Player\n- A fix.\n## Contributors\n- trvorth extended the room-capacity sweep (#2198).\n- Sam reported it (#670).\n"), "b.md");
    expect(contributorLines([a, b])).toEqual(["trvorth extended the room-capacity sweep (#2198).", "Sam reported it (#670)."]);
    expect(() => parseNote(note("app: none", "## Contributors\n- No period"), "c.md")).toThrow(/period/);
    expect(() => parseNote(note("app: none", "## Contributors\n- A.\n## Contributors\n- B.\n"), "c.md")).toThrow(/twice/);
  });

  it("keeps a credit-only note when the release does not move the app", () => {
    const credit = parseNote(note("app: none", "## Contributors\n- Sam helped (#1).\n"), "credit.md");
    const plain = parseNote(note("app: none"), "plain.md");
    expect(notesKeptForCredits([credit, plain], false).map((n) => n.file)).toEqual(["credit.md"]);
    expect(notesKeptForCredits([credit, plain], true)).toEqual([]);
  });

  it("reads a CRLF checkout and a note with no sections", () => {
    expect(parseNote("---\r\napp: none\r\n---\r\n", "x.md")).toMatchObject({ app: "none", player: [] });
  });

  it.each([
    ["Bad.md", note("app: none"), /branch slug/],
    ["x.md", "app: none\n", /first line/],
    ["x.md", "---\napp: none\n", /closing/],
    ["x.md", note("crate: none"), /no app level/],
    ["x.md", note("app: minor\napp: patch"), /twice/],
    ["x.md", note("app: huge"), /not one of/],
    ["x.md", note("app: none\ncrate: none\nother: 1"), /is not "app/],
    ["x.md", note("app: minor", "- A line.\n"), /before a "## Player"/],
    ["x.md", note("app: minor", "## Player\nA line.\n"), /bullet/],
    ["x.md", note("app: minor", "## Player\n- A line.\n  continued.\n"), /bullet/],
    ["x.md", note("app: minor", "## Player\n- No period\n"), /period/],
    ["x.md", note("app: minor", "## Player\n- One — two.\n"), /em-dash/],
    ["x.md", note("app: minor", "## Player\n- A.\n## Player\n- B.\n"), /twice/],
    ["x.md", note("app: minor", "## Notes\n- A.\n"), /before a "## Player"/],
    ["x.md", note("app: none", "## Player\n- A line.\n"), /Player lines need/],
    ["x.md", note("app: patch"), /at least one Player line/],
  ])("refuses %s with %s", (file, text, why) => {
    expect(() => parseNote(text, file)).toThrow(why);
  });

  it("puts the highest app level first and keeps file order within a level", () => {
    const notes = [
      { file: "a.md", app: "patch" },
      { file: "b.md", app: "minor" },
      { file: "c.md", app: "none" },
      { file: "d.md", app: "major" },
      { file: "e.md", app: "minor" },
    ] as const;
    expect(headlineFirst(notes).map((n) => n.file)).toEqual(["d.md", "b.md", "e.md", "a.md", "c.md"]);
    expect(notes.map((n) => n.file)).toEqual(["a.md", "b.md", "c.md", "d.md", "e.md"]);
  });

  it("orders levels and raises a version the way npm version does", () => {
    expect(highestLevel([])).toBe("none");
    expect(highestLevel(["patch", "none", "minor", "patch"])).toBe("minor");
    expect(highestLevel(["minor", "major"])).toBe("major");
    expect(bumpVersion("2.89.1", "none")).toBe("2.89.1");
    expect(bumpVersion("2.89.1", "patch")).toBe("2.89.2");
    expect(bumpVersion("2.89.1", "minor")).toBe("2.90.0");
    expect(bumpVersion("2.89.1", "major")).toBe("3.0.0");
    expect(() => bumpVersion("2.89", "patch")).toThrow(/x\.y\.z/);
  });

  describe("the changelog section", () => {
    const changelog = "# Changelog\n\nIntro with ## inside a line.\n\n## 2.89.1\n\n- Old.\n";

    it("goes above the newest section and lists the version", () => {
      const out = insertSection(changelog, "2.90.0", ["New."]);
      expect(out).toBe("# Changelog\n\nIntro with ## inside a line.\n\n## 2.90.0\n\n- New.\n\n## 2.89.1\n\n- Old.\n");
      expect(changelogVersions(out)).toEqual(["2.90.0", "2.89.1"]);
      expect(changelogVersions(insertSection(changelog, "1.23.0 (2026-11-10)", []))).toEqual(["1.23.0", "2.89.1"]);
    });

    it("keeps CRLF, and refuses a version the file already has", () => {
      const crlf = changelog.replace(/\n/g, "\r\n");
      expect(insertSection(crlf, "2.90.0", ["New."])).toContain("## 2.90.0\r\n\r\n- New.\r\n\r\n## 2.89.1");
      expect(() => insertSection(changelog, "2.89.1", [])).toThrow(/already has/);
      expect(() => insertSection(changelog, "next", [])).toThrow(/version/);
    });

    it("lists credits under a Contributors heading after the bullets", () => {
      expect(insertSection(changelog, "2.90.0", ["New."], ["Sam reported it (#670)."])).toContain(
        "## 2.90.0\n\n- New.\n\n### Contributors\n\n- Sam reported it (#670).\n\n## 2.89.1",
      );
    });

    it("appends when the file has no section yet", () => {
      expect(insertSection("# Changelog\n", "1.0.0", ["A."])).toBe("# Changelog\n\n## 1.0.0\n\n- A.\n\n");
    });
  });

  it("tells a later plain version from anything else", () => {
    expect(isSemverIncrease("2.89.1", "2.89.2")).toBe(true);
    expect(isSemverIncrease("2.89.1", "3.0.0")).toBe(true);
    expect(isSemverIncrease("2.89.1", "2.89.1")).toBe(false);
    expect(isSemverIncrease("2.89.1", "2.9.9")).toBe(false);
    expect(isSemverIncrease("2.89.1", "3.0.0-beta")).toBe(false);
  });
});
