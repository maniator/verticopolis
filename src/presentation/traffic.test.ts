import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { TRAFFIC_LABELS, TRAFFIC_LEVELS, trafficLevel, type TrafficTier } from "./traffic";

const here = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(resolve(here, "../styles.css"), "utf8");
const html = readFileSync(resolve(here, "../index.html"), "utf8");
const TIERS: readonly TrafficTier[] = [0, 1, 2, 3];
const BARS = [1, 2, 3, 4] as const;

/** Every top-level `#traffic-glyph...` rule in styles.css (outside any
 *  `@media`), as its selector and its declarations. */
function meterRules(): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < styles.length; i++) {
    const c = styles[i];
    if (c === "{") {
      if (depth === 0) {
        const selector = styles.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, "").trim();
        const end = styles.indexOf("}", i);
        if (selector.startsWith("#traffic-glyph")) rules.push({ selector, body: styles.slice(i + 1, end) });
        if (!selector.startsWith("@")) {
          i = end;
          start = end + 1;
          continue;
        }
      }
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) start = i + 1;
    }
  }
  return rules;
}

/** How many bars the stylesheet fills at a level: the base rule, then every
 *  rule whose selector names that level, each setting `--bar-n`. */
function filledBars(level: string): number {
  const on = new Map<number, boolean>();
  for (const { selector, body } of meterRules()) {
    const applies = selector === "#traffic-glyph" || selector.includes(`[data-level="${level}"]`);
    if (!applies) continue;
    for (const bar of BARS) {
      const m = new RegExp(`--bar-${bar}:\\s*var\\(--bar-(on|off)\\)`).exec(body);
      if (m) on.set(bar, m[1] === "on");
    }
  }
  return BARS.filter((bar) => on.get(bar)).length;
}

describe("traffic meter level", () => {
  it("names one level per tier, in tier order", () => {
    expect(TRAFFIC_LEVELS).toHaveLength(TRAFFIC_LABELS.length);
    expect(TIERS.map(trafficLevel)).toEqual(["smooth", "busy", "backed-up", "gridlock"]);
  });

  it("fills one bar per tier, up to the tier, in the stylesheet", () => {
    // The meter is drawn by CSS from data-level, so a renamed level or a
    // mistyped rule would draw a wrong meter and fail nothing else.
    expect(TIERS.map((tier) => filledBars(trafficLevel(tier)))).toEqual([1, 2, 3, 4]);
  });

  it("starts the page's meter at Smooth", () => {
    const tag = /<span\b[^>]*\bid="traffic-glyph"[^>]*>/.exec(html)?.[0] ?? "";
    expect(tag).toMatch(new RegExp(`\\bdata-level="${trafficLevel(0)}"`));
  });
});
