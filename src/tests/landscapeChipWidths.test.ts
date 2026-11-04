import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * The sideways phone layout gives each changing stat chip a fixed width
 * (src/styles.css), sized so its longest value fits in DejaVu Sans, the
 * widest common UI font. The e2e chip test checks that in a browser, but the
 * pinned CI image has no DejaVu Sans, so CI skips that pass. These are the
 * widths it measured instead (Chrome, DejaVu Sans 2.37, the chips' own weight
 * and size), and the test fails if a chip is narrowed below them.
 */
const VALUE_PX = 12; // `.stat .value` font size in the landscape block
const MEASURED_PX = {
  trafficLabel: 70.06, // "Backed up", bold
  trafficFloor: 33.8, // " · 100F", the floor suffix's smaller medium face
  time: 73.92, // "WD2 00:00"
  date: 156.28, // "2nd WD/4Q/122nd Year"
  money: 97.59, // "$-999,999,999"
  pop: 46.31, // "99,999"
};
const GLYPH_PX = 18; // the traffic meter
const GLYPH_GAP_EM = 0.3; // the meter's margin before the tier word

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the sideways block, up to its own closing brace. */
function landscapeBlock(): string {
  const head = "@media (max-width: 1023px) and (max-height: 599px) and (orientation: landscape) {";
  const start = css.indexOf(head);
  if (start < 0) throw new Error("the sideways block is missing");
  let depth = 0;
  for (let i = start + head.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start + head.length, i);
  }
  throw new Error("the sideways block is not closed");
}
const landscape = landscapeBlock();

const widthEm = (id: string): number => {
  const all = [...landscape.matchAll(new RegExp(`#${id} \\{ width: ([\\d.]+)em; \\}`, "g"))];
  if (all.length !== 1) throw new Error(`expected one fixed width for #${id}, found ${all.length}`);
  return Number(all[0][1]);
};

describe("sideways stat chip widths", () => {
  it("rest on the sizes this test assumes", () => {
    expect(landscape).toMatch(/\.stat \.value \{\s*font-size: 12px;\s*\}/);
    expect(landscape).toMatch(/#traffic-glyph \{\s*margin-inline-end: 0\.3em;\s*\}/);
    // The meter's width and the floor's smaller face come from the base
    // rules, and the sideways block changes neither.
    expect(css).toMatch(/^#traffic-glyph \{[^}]*\bwidth: 18px;/m);
    expect(css).toMatch(/^#traffic-floor \{ font-size: 0\.82em; font-weight: 500; \}/m);
    // The walk below reads one level of rules, so the block must hold no
    // nested at-rule that could hide an override inside it.
    expect(landscape).not.toMatch(/@[a-z-]+[^;{]*\{/);
    for (const [, selector, body] of landscape.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (selector.includes("#traffic-glyph")) expect(body, selector).not.toMatch(/\bwidth\s*:/);
      if (selector.includes("#traffic-floor")) expect(body, selector).not.toMatch(/\bfont(-size|-weight)?\s*:/);
    }
  });

  it("fit each chip's longest value in DejaVu Sans", () => {
    const px = (id: string) => widthEm(id) * VALUE_PX;
    const traffic = GLYPH_PX + GLYPH_GAP_EM * VALUE_PX + MEASURED_PX.trafficLabel + MEASURED_PX.trafficFloor;
    expect(px("traffic")).toBeGreaterThanOrEqual(traffic);
    expect(px("stat-time")).toBeGreaterThanOrEqual(MEASURED_PX.time);
    expect(px("stat-date")).toBeGreaterThanOrEqual(MEASURED_PX.date);
    expect(px("stat-money")).toBeGreaterThanOrEqual(MEASURED_PX.money);
    expect(px("stat-pop")).toBeGreaterThanOrEqual(MEASURED_PX.pop);
  });
});
