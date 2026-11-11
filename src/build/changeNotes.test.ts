import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  bumpVersion,
  changelogVersions,
  highestLevel,
  insertSection,
  parseNote,
  readNotes,
  setCargoVersion,
  setLockVersion,
} from "./changeNotes";

const note = (front: string, body = "") => `---\n${front}\n---\n${body}`;

describe("change notes", () => {
  it("every pending note in the repo parses", () => {
    expect(() => readNotes(resolve(__dirname, "../.."))).not.toThrow();
  });

  it("reads the levels and both sections", () => {
    const n = parseNote(
      note("app: minor   # what a player notices\ncrate: patch", "## Player\n- Elevators skip empty floors.\n\n## Engine\n- `frame()` adds a count.\n"),
      "my-branch.md",
    );
    expect(n).toEqual({ file: "my-branch.md", app: "minor", crate: "patch", player: ["Elevators skip empty floors."], engine: ["`frame()` adds a count."] });
  });

  it("reads the optional readmes line, and only as unchanged", () => {
    expect(parseNote(note("app: none\ncrate: none\nreadmes: unchanged   # checked both"), "x.md").readmesUnchanged).toBe(true);
    expect(parseNote(note("app: none\ncrate: none"), "x.md")).not.toHaveProperty("readmesUnchanged");
    expect(() => parseNote(note("app: none\ncrate: none\nreadmes: updated"), "x.md")).toThrow(/not "unchanged"/);
    expect(() => parseNote(note("app: none\ncrate: none\nreadmes: unchanged\nreadmes: unchanged"), "x.md")).toThrow(/readmes is set twice/);
  });

  it("reads a CRLF checkout and a note with no sections", () => {
    expect(parseNote("---\r\napp: none\r\ncrate: none\r\n---\r\n", "x.md")).toMatchObject({ app: "none", crate: "none", player: [], engine: [] });
  });

  it.each([
    ["Bad.md", note("app: none\ncrate: none"), /branch slug/],
    ["x.md", "app: none\n", /first line/],
    ["x.md", "---\napp: none\n", /closing/],
    ["x.md", note("app: minor"), /no crate level/],
    ["x.md", note("crate: none"), /no app level/],
    ["x.md", note("app: minor\napp: patch\ncrate: none"), /twice/],
    ["x.md", note("app: huge\ncrate: none"), /not one of/],
    ["x.md", note("app: none\ncrate: none\nother: 1"), /is not "app/],
    ["x.md", note("app: minor\ncrate: none", "- A line.\n"), /before a "## Player"/],
    ["x.md", note("app: minor\ncrate: none", "## Player\nA line.\n"), /bullet/],
    ["x.md", note("app: minor\ncrate: none", "## Player\n- A line.\n  continued.\n"), /bullet/],
    ["x.md", note("app: minor\ncrate: none", "## Player\n- No period\n"), /period/],
    ["x.md", note("app: minor\ncrate: none", "## Player\n- One — two.\n"), /em-dash/],
    ["x.md", note("app: minor\ncrate: none", "## Player\n- A.\n## Player\n- B.\n"), /twice/],
    ["x.md", note("app: minor\ncrate: none", "## Notes\n- A.\n"), /before a "## Player"/],
    ["x.md", note("app: none\ncrate: none", "## Player\n- A line.\n"), /Player lines need/],
    ["x.md", note("app: none\ncrate: none", "## Engine\n- A line.\n"), /Engine lines need/],
    ["x.md", note("app: none\ncrate: minor"), /at least one Engine line/],
    ["x.md", note("app: patch\ncrate: none"), /at least one Player line/],
  ])("refuses %s with %s", (file, text, why) => {
    expect(() => parseNote(text, file)).toThrow(why);
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

    it("appends when the file has no section yet", () => {
      expect(insertSection("# Changelog\n", "1.0.0", ["A."])).toBe("# Changelog\n\n## 1.0.0\n\n- A.\n\n");
    });
  });

  it("raises the crate's own version and nothing else", () => {
    const toml = '[package]\nname = "verticopolis-engine"\nversion = "1.22.0"\n\n[dependencies]\nserde = { version = "1" }\nversion = "x"\n';
    expect(setCargoVersion(toml, "1.23.0")).toBe(toml.replace('version = "1.22.0"', 'version = "1.23.0"'));
    expect(() => setCargoVersion('[dependencies]\nversion = "1"\n', "2.0.0")).toThrow(/\[package\]/);
    const lock = '[[package]]\nname = "serde"\nversion = "1.22.0"\n\n[[package]]\nname = "verticopolis-engine"\nversion = "1.22.0"\n';
    expect(setLockVersion(lock, "verticopolis-engine", "1.23.0")).toBe(lock.replace(/("verticopolis-engine"\nversion = )"1\.22\.0"/, '$1"1.23.0"'));
    expect(() => setLockVersion(lock, "other", "1.0.0")).toThrow(/no other entry/);
  });
});
