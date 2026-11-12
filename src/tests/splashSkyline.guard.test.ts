import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * The title screen's skyline is drawn twice: inline by the game's splash
 * (src/ui/splashTemplate.ts, colored from the --splash-* tokens) and as
 * src/public/splash-skyline.svg, the image the docs site's landing page tiles.
 * The two have to show the same buildings in the same colors.
 */

const src = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => readFileSync(resolve(src, rel), "utf8");

const template = read("ui/splashTemplate.ts");
const image = read("public/splash-skyline.svg");
const tokens = read("styles/retro-tokens.css");

/** The skyline's shapes, in order: every path's outline and every lit window. */
function shapes(svg: string): string[] {
  return [...svg.matchAll(/<path d="([^"]+)"|<rect ([^/>]+)/g)].map((m) => (m[1] ?? m[2]).trim());
}

/** A --splash-* token's value from retro-tokens.css. */
function token(name: string): string {
  const m = tokens.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`retro-tokens.css declares no --${name}`);
  return m[1].trim();
}

describe("the title screen's skyline", () => {
  it("has the same buildings and windows in the game and the shared image", () => {
    const skyline = template.slice(template.indexOf('<svg class="splash-skyline"'));
    const inGame = shapes(skyline.slice(0, skyline.indexOf("</svg>")));
    expect(inGame.length).toBeGreaterThan(0);
    expect(shapes(image)).toEqual(inGame);
    // The lit windows keep one color in both, a literal in each.
    const windows = (svg: string) => svg.match(/<g fill="(#[0-9a-f]{6})">/)?.[1];
    expect(windows(image)).toBe(windows(skyline));
    expect(windows(image)).toBeDefined();
  });

  it("colors the image's buildings with the splash tokens", () => {
    expect(image).toContain(`fill="${token("splash-building")}"`);
    expect(image).toContain(`stroke="${token("splash-ink")}"`);
  });
});
