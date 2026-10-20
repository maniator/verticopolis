import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { marked } from "marked";
import { escapeMarkdown, notesForVersion, releaseNoteLines } from "./changelog";
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

  it("flattens inline markdown to plain text (emphasis markers dropped)", () => {
    expect(notesForVersion("## 1.0.0\n- **Weekends** change who _shops_.\n", "1.0.0")).toEqual([
      "Weekends change who shops.",
    ]);
  });

  it("keeps a link's label and drops its URL (no href reaches the prompt)", () => {
    expect(notesForVersion("## 1.0.0\n- See the [new overlay](https://example.com/x).\n", "1.0.0")).toEqual([
      "See the new overlay.",
    ]);
  });

  it("keeps apostrophes and ampersands literal (no HTML-entity escaping)", () => {
    // Guards against a markdown library whose token text is HTML-escaped: the
    // note must read "Don't" and "shops & food", not "Don&#39;t" / "shops &amp; food".
    expect(notesForVersion("## 1.0.0\n- Don't crowd shops & food on reload.\n", "1.0.0")).toEqual([
      "Don't crowd shops & food on reload.",
    ]);
  });

  it("drops raw inline HTML rather than passing it through as literal text", () => {
    expect(notesForVersion("## 1.0.0\n- Faster <span>reopen</span> loads.\n", "1.0.0")).toEqual([
      "Faster reopen loads.",
    ]);
  });

  it("lifts the prompt's caps when the release workflow asks for every bullet whole", () => {
    const long = "x".repeat(300);
    const cl = `## 1.0.0\n- One.\n- Two.\n- Three.\n- Four.\n- ${long}\n`;
    expect(notesForVersion(cl, "1.0.0")).toHaveLength(3);
    expect(notesForVersion(cl, "1.0.0", { maxNotes: Infinity, maxLen: Infinity })).toEqual([
      "One.",
      "Two.",
      "Three.",
      "Four.",
      long,
    ]);
  });

  it("turns a hard line break inside a bullet into a space", () => {
    expect(notesForVersion("## 1.0.0\n- line one  \n  line two\n", "1.0.0")).toEqual(["line one line two"]);
  });

  // The update prompt cuts a longer note mid-sentence, so this build's own
  // notes have to fit the caps whole.
  it("reads this build's notes whole, within the caps", () => {
    const changelog = readFileSync(resolve(__dirname, "../CHANGELOG.md"), "utf8");
    const { version } = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { version: string };
    const whole = notesForVersion(changelog, version, { maxNotes: Infinity, maxLen: Infinity });
    expect(notesForVersion(changelog, version)).toEqual(whole);
  });
});

/** What a Markdown renderer makes of one release-note bullet, as HTML, with
 *  the invisible word joiners the escape adds taken out. `marked` follows
 *  CommonMark and GitHub's Markdown extensions (strikethrough, tables, bare
 *  `www.` links); the links GitHub adds to plain text afterwards (mentions,
 *  references, emoji) are checked by the joiners' placement below. */
function rendered(line: string): string {
  return marked.parse(line, { async: false }).replace(/\u2060/g, "");
}

/** The HTML a bullet holding exactly `text` renders to: one list item with the
 *  text escaped for HTML and no other markup. */
function literalBullet(text: string): string {
  const html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  return `<ul>\n<li>${html}</li>\n</ul>\n`;
}

describe("releaseNoteLines", () => {
  const TRICKY = [
    "## 2.0.0",
    "",
    "- An escaped \\*star\\* and \\_under\\_ stay literal.",
    "- A code span `<Tower />` and another `_x_` and `**y**`.",
    "- Ampersands &amp; entities like &copy; stay as typed, and a `|` pipe | too.",
    "- Dollars $5 and $6, `~~not struck~~`, `[a link](u)` and `# not a heading`.",
    "- `1. not a list` and `- not a list` or `+ either`.",
    "- `\\` a backslash.",
    "",
  ].join("\n");

  it("prints one bullet per note, escaped so the page shows the plain text", () => {
    const notes = notesForVersion(TRICKY, "2.0.0", { maxNotes: Infinity, maxLen: Infinity });
    const lines = releaseNoteLines(TRICKY, "2.0.0");
    expect(notes[0]).toBe("An escaped *star* and _under_ stay literal.");
    expect(notes[1]).toBe("A code span <Tower /> and another _x_ and **y**.");
    expect(lines).toHaveLength(6);
    lines.forEach((line, i) => expect(rendered(line), line).toBe(literalBullet(notes[i])));
  });

  it("escapes a note that starts like a list, a rule, a heading or a quote", () => {
    for (const text of ["- dash", "+ plus", "1. one", "12) twelve", "---", "***", "___", "# hash", "> quote", "1.5x faster"]) {
      expect(rendered(`- ${escapeMarkdown(text)}`), text).toBe(literalBullet(text));
    }
  });

  it("collapses a note's whitespace to one line", () => {
    expect(releaseNoteLines("## 3.0.0\n\n- First line  \n  second line\n", "3.0.0")).toEqual(["- First line second line"]);
  });

  it("is empty for a version with no player notes", () => {
    expect(releaseNoteLines(CHANGELOG, "9.9.9")).toEqual([]);
  });

  it("splits the plain text GitHub would link with an invisible joiner", () => {
    const J = "\u2060";
    expect(escapeMarkdown("Thanks @maniator for #12 :tada:")).toBe(`Thanks @${J}maniator for \\#${J}12 :${J}tada:`);
    expect(escapeMarkdown("See www.example.com or https://example.com")).toBe(`See www${J}.example.com or https:${J}//example.com`);
    expect(escapeMarkdown("Built from 1a2b3c4d5e")).toBe(`Built from 1a2b${J}3c4d5e`);
    expect(escapeMarkdown("Thumbs :+1: and :100: for GH-12")).toBe(`Thumbs :${J}+1: and :${J}100: for GH-${J}12`);
    expect(escapeMarkdown("Opens at 3:00 and 10:30")).toBe("Opens at 3:00 and 10:30");
    expect(escapeMarkdown("Won :1st_place_medal:")).toBe(`Won :${J}1st\\_place\\_medal:`);
    for (const text of ["Thanks @maniator for #12 :tada:", "See www.example.com or https://example.com", "mail me@example.com"]) {
      expect(rendered(`- ${escapeMarkdown(text)}`), text).toBe(literalBullet(text));
    }
    // Words that only look like hex, and short hex, stay whole.
    expect(escapeMarkdown("A decade of cafe 1a2b")).toBe("A decade of cafe 1a2b");
  });

  it("leaves plain prose as it reads", () => {
    const prose = "Elevators pick up riders faster, at 3:00 p.m. (mostly).";
    expect(escapeMarkdown(prose)).toBe(prose);
  });
});
