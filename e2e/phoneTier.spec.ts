import { test, expect } from "@playwright/test";
import { expectEngineHosted } from "./helpers";
import { isPhoneViewport } from "../src/tests/phoneTier.ts";

/**
 * The phone tier's bounds, checked in a real browser. The screenshot gallery
 * decides which scenes present as a touch device from `isPhoneViewport`
 * (src/tests/phoneTier.ts), so at each viewport it must agree with the page:
 * the game's own phone query (`mobileMq`) and the stylesheet's phone block,
 * read here from one of its effects (the top bar's wordmark moves into the
 * menu bar, so `#topbar .brand` is hidden).
 */

test.afterEach(async ({ page }) => expectEngineHosted(page));

const VIEWPORTS = [
  // The gallery's portrait phone, a larger phone and the Pixel held sideways.
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 852, height: 352 },
  // A portrait tablet and the gallery's desktop.
  { width: 834, height: 1112 },
  { width: 1280, height: 800 },
  // Each bound, and one pixel past it.
  { width: 767, height: 1100 },
  { width: 768, height: 1100 },
  { width: 1023, height: 599 },
  { width: 1024, height: 599 },
  { width: 1023, height: 600 },
];

test("the gallery's phone tier matches the page's phone query and phone layout", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, {
    timeout: 30_000,
  });
  const seen: Record<string, { tier: boolean; query: boolean; layout: boolean }> = {};
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    const page_ = await page.evaluate(() => ({
      query: (window as any).game.mobileMq.matches as boolean,
      layout: getComputedStyle(document.querySelector("#topbar .brand")!).display === "none",
    }));
    seen[`${vp.width}x${vp.height}`] = { tier: isPhoneViewport(vp), ...page_ };
  }
  for (const [vp, s] of Object.entries(seen)) {
    expect({ query: s.query, layout: s.layout }, vp).toEqual({ query: s.tier, layout: s.tier });
  }
});
