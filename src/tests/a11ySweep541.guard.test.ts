import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Static guards for the markup/CSS half of the #541 a11y/UX sweep: the toast
 * live-region politeness (AUD-020), the tower-name accessible name (PROD-001),
 * the money-value contrast (PROD-002), the coarse-pointer .btn.xs hit area
 * (AUD-025), and the mobile-web-app-capable meta (PROD-004). The behavioral
 * halves (toast role=alert, undo guard, announce re-fire, accMinutes guard) are
 * pinned by their own colocated unit tests.
 */

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => readFileSync(resolve(srcRoot, rel), "utf8");

const indexHtml = read("index.html");
const stylesCss = read("styles.css");
const tokensCss = read("styles/retro-tokens.css");
/** The shared window grammar, including the modal ✕, lives beside UI.ts. */
const uiModalTs = read("ui/uiModal.ts");
const uiPanelsTs = read("ui/uiPanels.ts");

// --- WCAG relative-luminance contrast ---------------------------------------
function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  return (
    0.2126 * srgbToLinear((n >> 16) & 255) +
    0.7152 * srgbToLinear((n >> 8) & 255) +
    0.0722 * srgbToLinear(n & 255)
  );
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe("#541 a11y sweep: markup + CSS", () => {
  it("1. the toast rail is polite, never assertive (AUD-020)", () => {
    const tag = indexHtml.match(/<div id="toast-wrap"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain('aria-live="polite"');
    expect(tag).not.toContain("assertive");
  });

  it("6. #tower-name has an accessible name (PROD-001)", () => {
    const tag = indexHtml.match(/<input id="tower-name"[^>]*>/)?.[0] ?? "";
    expect(tag).toMatch(/(aria-label|aria-labelledby|title)="[^"]+"/);
  });

  it("8. the mobile-web-app-capable meta accompanies the apple one (PROD-004)", () => {
    expect(indexHtml).toContain('name="apple-mobile-web-app-capable"');
    expect(indexHtml).toContain('name="mobile-web-app-capable"');
  });

  it("7. #stat-money meets WCAG AA on the stat chip (PROD-002)", () => {
    // The EFFECTIVE money color is `var(--money)` (uiStatus.update sets it inline
    // every frame, which beats the .value.money class rule), so the contrast that
    // actually renders is --money vs the #c0c0c0 (--r-face) chip. Assert the token,
    // not the (overridden) class rule.
    const money = tokensCss.match(/--money\s*:\s*(#[0-9a-fA-F]{6})/)?.[1];
    const face = tokensCss.match(/--r-face\s*:\s*(#[0-9a-fA-F]{6})/)?.[1];
    expect(money, "could not read --money token").toBeTruthy();
    expect(face, "could not read --r-face token").toBeTruthy();
    // 13px bold value = normal-text tier, needs >= 4.5:1 (not the 3:1 large tier).
    expect(contrast(money!, face!)).toBeGreaterThanOrEqual(4.5);
  });

  it("5. the coarse-pointer .btn.xs halo lifts the tap target to >= 24px (AUD-025)", () => {
    // The invisible ::after halo (kept so the 1994 glyph is untouched) must live
    // in the coarse-pointer block and enlarge every side by enough that the
    // smallest xs close ✕ (~18px visible per the audit) clears the 24px floor.
    const coarse = stylesCss.slice(stylesCss.indexOf("@media (pointer: coarse)"));
    const inset = coarse.match(/\.btn\.xs::after\s*\{[^}]*inset:\s*-(\d+)px/)?.[1];
    expect(inset, "no coarse-pointer .btn.xs::after halo").toBeTruthy();
    const SMALLEST_VISIBLE = 18;
    expect(SMALLEST_VISIBLE + 2 * Number(inset)).toBeGreaterThanOrEqual(24);
    // ...and both close ✕ buttons carry .btn.xs so they actually get the halo.
    expect(uiModalTs).toContain("modal-x btn xs");
    expect(uiPanelsTs).toContain("insp-close btn xs");
  });
});
