import { describe, it, expect } from "vitest";
import { notesForVersion } from "./changelog";
import { MAX_NOTES, MAX_NOTE_LEN } from "./pwaUpdateInfo";

/**
 * The build-time reader that turns the committed CHANGELOG.md into the update
 * prompt's "What's new" notes. Exercised without a build so the section matching
 * and caps are pinned.
 */
const CHANGELOG = `# Changelog

Some intro prose that must be ignored.

## 1.50.2

- Verticopolis loads faster when you reopen it.
- Elevators pick up waiting riders more reliably.

## 1.50.1

- The game now keeps itself up to date.

## 1.50.10

- A later release that must not match 1.50.1.
`;

describe("notesForVersion", () => {
  it("returns the bullets under the matching version heading", () => {
    expect(notesForVersion(CHANGELOG, "1.50.2")).toEqual([
      "Verticopolis loads faster when you reopen it.",
      "Elevators pick up waiting riders more reliably.",
    ]);
  });

  it("stops at the next version heading", () => {
    expect(notesForVersion(CHANGELOG, "1.50.1")).toEqual(["The game now keeps itself up to date."]);
  });

  it("does not match a superstring version (1.50.1 vs 1.50.10)", () => {
    expect(notesForVersion(CHANGELOG, "1.50.10")).toEqual(["A later release that must not match 1.50.1."]);
  });

  it("returns [] when the version has no section (an internal build)", () => {
    expect(notesForVersion(CHANGELOG, "9.9.9")).toEqual([]);
  });

  it("tolerates a leading v and a trailing date in the heading", () => {
    expect(notesForVersion("## v2.0.0 - 2026-07-16\n\n- New thing.\n", "2.0.0")).toEqual(["New thing."]);
  });

  it("accepts *, +, and - bullets", () => {
    expect(notesForVersion("## 1.0.0\n* Star bullet.\n", "1.0.0")).toEqual(["Star bullet."]);
    expect(notesForVersion("## 1.0.0\n+ Plus bullet.\n", "1.0.0")).toEqual(["Plus bullet."]);
  });

  it("ignores indented sub-bullets so they cannot crowd out later notes", () => {
    const cl = "## 1.0.0\n- First.\n  - detail a\n  - detail b\n- Second.\n";
    expect(notesForVersion(cl, "1.0.0")).toEqual(["First.", "Second."]);
  });

  it("matches a bracketed Keep-a-Changelog heading", () => {
    expect(notesForVersion("## [1.2.3] - 2026-07-16\n- Bracketed.\n", "1.2.3")).toEqual(["Bracketed."]);
  });

  it("caps the number of notes at MAX_NOTES", () => {
    const many = "## 1.0.0\n" + Array.from({ length: MAX_NOTES + 3 }, (_, i) => `- note ${i}`).join("\n") + "\n";
    const r = notesForVersion(many, "1.0.0");
    expect(r).toHaveLength(MAX_NOTES);
    expect(r[0]).toBe("note 0"); // keeps the first N, in order
  });

  it("caps each note to MAX_NOTE_LEN characters", () => {
    const long = "x".repeat(MAX_NOTE_LEN + 50);
    expect(notesForVersion(`## 1.0.0\n- ${long}\n`, "1.0.0")[0]).toHaveLength(MAX_NOTE_LEN);
  });
});
