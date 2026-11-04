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

const css = styles.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule in styles.css whose selector names `#traffic-glyph`, at any
 *  depth, with its declarations and whether an at-rule (such as `@media`)
 *  wraps it. Comments are stripped first, so a brace inside one cannot end a
 *  rule early. */
function meterRules(): { selector: string; body: string; nested: boolean }[] {
  const rules: { selector: string; body: string; nested: boolean }[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "{") {
      const selector = css.slice(start, i).trim();
      if (!selector.startsWith("@")) {
        const end = css.indexOf("}", i);
        if (end < 0) throw new Error(`unclosed rule after ${selector}`);
        if (selector.includes("#traffic-glyph")) rules.push({ selector, body: css.slice(i + 1, end), nested: depth > 0 });
        i = end;
        start = end + 1;
        continue;
      }
      depth++;
      start = i + 1;
    } else if (c === "}") {
      depth = Math.max(0, depth - 1);
      start = i + 1;
    } else if (c === ";") {
      // A statement at-rule (`@import ...;`, `@layer x;`) ends here, so the
      // next rule's selector starts after it.
      start = i + 1;
    }
  }
  return rules;
}

const BAR_SETTER = /--bar-[1-4]\s*:/;
const LEVEL_SELECTOR = /\[data-level(?:="[a-z-]+")?\]|\[data-level[^\]]*\]/g;
/** The base rule, one level, or an :is() list of levels, and nothing else. */
const BAR_SETTER_SELECTOR = /^#traffic-glyph(?:\[data-level="[a-z-]+"\]|:is\(\[data-level="[a-z-]+"\](?:, \[data-level="[a-z-]+"\])*\))?$/;

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

  it("sets the bars only in top-level rules, keyed by plain level selectors", () => {
    // filledBars counts every rule as if it always applied and only knows the
    // plain level selectors, so a bar override inside an at-rule (the
    // landscape block, forced colors) or keyed some other way (a :not(), a
    // pseudo-class) would change the drawn meter without it noticing.
    const rules = meterRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const { selector, body, nested } of rules) {
      if (nested) expect(body, selector).not.toMatch(BAR_SETTER);
      for (const [match] of selector.matchAll(LEVEL_SELECTOR)) {
        expect(match, selector).toMatch(/^\[data-level="[a-z-]+"\]$/);
      }
      if (BAR_SETTER.test(body)) expect(selector, selector).toMatch(BAR_SETTER_SELECTOR);
    }
  });

  it("starts the page's meter at Smooth", () => {
    const tag = /<span\b[^>]*\bid="traffic-glyph"[^>]*>/.exec(html)?.[0] ?? "";
    expect(tag).toMatch(new RegExp(`\\bdata-level="${trafficLevel(0)}"`));
  });
});
