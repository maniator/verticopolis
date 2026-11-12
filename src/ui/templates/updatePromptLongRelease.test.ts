import { describe, it, expect } from "vitest";
import { notesForVersion, recentReleaseNotes } from "../../changelog";
import { MAX_RELEASES, notesSinceRunning, parseUpdateInfo } from "../../pwaUpdateInfo";
import { updatePromptTemplate } from "./updatePrompt";
import { renderToFragment } from "../testing/litTestUtils";

/**
 * Regression for Release 3.2.0 (#2026): a release with 22 player notes, most
 * of them 300 to 700 characters, reached the update prompt as its first three
 * notes cut at 200 characters, and the release PR's guard failed on it. This
 * walks a release that size along the path a real one takes: CHANGELOG.md
 * through the build's readers (`vite.config.ts` calls `notesForVersion` and
 * `recentReleaseNotes`), `version.json` through `parseUpdateInfo` and
 * `notesSinceRunning`, and into the prompt, which must show every note whole.
 */

/** A note of `len` characters made of real words, ending with a period. */
function note(i: number, len: number): string {
  const words = `Note ${i} says what changed for the player in plain words`;
  let text = words;
  while (text.length < len - 1) text += ` ${words}`;
  return `${text.slice(0, len - 1).trimEnd()}.`;
}

const LENGTHS = [455, 380, 360, 420, 104, 190, 300, 170, 479, 190, 140, 100, 220, 110, 250, 470, 680, 330, 180, 120, 470, 101];
const LONG = LENGTHS.map((len, i) => note(i + 1, len));
const CHANGELOG = `# Changelog\n\n## 3.2.0\n\n${LONG.map((n) => `- ${n}`).join("\n")}\n\n## 3.1.0\n\n- Earlier note.\n`;

/** What the build writes into `version.json` for 3.2.0 from {@link CHANGELOG}. */
function versionJson() {
  return {
    version: "3.2.0",
    sha: "abc1234",
    notes: notesForVersion(CHANGELOG, "3.2.0"),
    releases: recentReleaseNotes(CHANGELOG, "3.2.0", MAX_RELEASES),
  };
}

const noop = { onLater: () => {}, onUpdate: () => {} };

describe("update prompt with a long release (Release 3.2.0 regression)", () => {
  it("shows every note whole to a player one version behind", () => {
    const info = parseUpdateInfo(versionJson());
    expect(info).not.toBeNull();
    const shown = notesSinceRunning(info!, "3.1.0");
    const frag = renderToFragment(updatePromptTemplate(shown, noop));
    expect(frag.querySelector(".whatsnew-ver")).toBeNull();
    expect([...frag.querySelectorAll(".whatsnew-log li")].map((li) => li.textContent)).toEqual(LONG);
  });

  it("shows every note whole to a player who skipped a version", () => {
    const info = parseUpdateInfo(versionJson());
    const shown = notesSinceRunning(info!, "3.0.0");
    const frag = renderToFragment(updatePromptTemplate(shown, noop));
    expect([...frag.querySelectorAll(".whatsnew-ver")].map((h) => h.textContent)).toEqual(["3.2.0", "3.1.0"]);
    expect([...frag.querySelectorAll(".whatsnew-log li")].map((li) => li.textContent)).toEqual([...LONG, "Earlier note."]);
  });
});
