import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * PARITY.md is the developer's checklist of how a Classic tower matches the
 * 1994 game; the help site's "Differences from the 1994 game" page tells
 * players the same story. Every deliberate divergence and known gap must be on
 * both, so the two lists cannot drift apart: each bullet in PARITY.md's two
 * sections links the help page's section for it, and each section under the
 * help page's matching heading is linked from PARITY.md.
 */

const ROOT = resolve(__dirname, "../..");
const PARITY = readFileSync(resolve(ROOT, "PARITY.md"), "utf8");
const HELP_PAGE = readFileSync(resolve(ROOT, "help-site/src/content/docs/differences.mdx"), "utf8");
const HELP_URL = "https://verticopolis.com/help/differences/#";

/** The lines under `heading` (an exact `## ` or `### ` line) up to the next heading of the same or a higher level. */
function sectionLines(markdown: string, heading: string): string[] | undefined {
  const lines = markdown.split("\n");
  const start = lines.indexOf(heading);
  if (start === -1) return undefined;
  const level = heading.indexOf(" ");
  const end = lines.findIndex((line, i) => i > start && /^#+ /.test(line) && line.indexOf(" ") <= level);
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** The anchor Starlight gives a plain-words heading. */
function anchorOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/ /g, "-");
}

/** The help-page anchors of the `### ` sections under a `## ` heading. */
function helpAnchors(page: string, heading: string): string[] {
  return (sectionLines(page, heading) ?? []).filter((line) => line.startsWith("### ")).map((line) => anchorOf(line.slice(4)));
}

/** Each bullet of a PARITY.md section, with the help anchors it links. */
function parityLinks(parity: string, heading: string): { bullet: string; anchors: string[] }[] {
  return (sectionLines(parity, heading) ?? [])
    .filter((line) => line.startsWith("- "))
    .map((bullet) => ({
      bullet,
      anchors: [...bullet.matchAll(/\]\(https:\/\/verticopolis\.com\/help\/differences\/#([a-z0-9-]+)\)/g)].map((m) => m[1]),
    }));
}

const PAIRS = [
  { parity: "## Deliberate divergences", help: "## Different on purpose" },
  { parity: "## Known parity gaps", help: "## Not in yet" },
];

describe("the parity guard's readers", () => {
  const doc = ["## A", "- one [Help](" + HELP_URL + "first-thing)", "- two, no link", "### Inside A", "## B", "### First thing", "### Second, thing!"].join("\n");

  it("stops a section at the next heading of its level", () => {
    expect(sectionLines(doc, "## A")).toEqual(["- one [Help](" + HELP_URL + "first-thing)", "- two, no link", "### Inside A"]);
    expect(sectionLines(doc, "## Missing")).toBeUndefined();
  });

  it("reads the help anchors and the parity links", () => {
    expect(helpAnchors(doc, "## B")).toEqual(["first-thing", "second-thing"]);
    expect(parityLinks(doc, "## A")).toEqual([
      { bullet: "- one [Help](" + HELP_URL + "first-thing)", anchors: ["first-thing"] },
      { bullet: "- two, no link", anchors: [] },
    ]);
  });
});

describe("PARITY.md and the help site's differences page", () => {
  for (const pair of PAIRS) {
    it(`list the same entries under "${pair.parity}" and "${pair.help}"`, () => {
      expect(sectionLines(PARITY, pair.parity), `PARITY.md has "${pair.parity}"`).toBeDefined();
      expect(sectionLines(HELP_PAGE, pair.help), `differences.mdx has "${pair.help}"`).toBeDefined();

      const bullets = parityLinks(PARITY, pair.parity);
      expect(bullets.length, `PARITY.md "${pair.parity}" has entries`).toBeGreaterThan(0);
      for (const { bullet, anchors } of bullets) {
        expect(anchors, `this PARITY.md bullet links exactly one help section: ${bullet}`).toHaveLength(1);
      }

      const linked = bullets.flatMap((b) => b.anchors).sort();
      const sections = helpAnchors(HELP_PAGE, pair.help).sort();
      expect(linked).toEqual(sections);
    });
  }

  it("is the page the parity report form sends players to", () => {
    const form = readFileSync(resolve(ROOT, ".github/ISSUE_TEMPLATE/parity_report.yml"), "utf8");
    expect(form).toContain("https://verticopolis.com/help/differences/");
  });
});
