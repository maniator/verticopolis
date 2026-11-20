/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { expectEngineHosted } from "./helpers";

/**
 * The page half of the #541 a11y sweep and the splash's touch targets, read
 * from the rendered page: the toast rail's politeness (AUD-020), the tower
 * name's accessible name (PROD-001), the money figure's contrast on its chip
 * (PROD-002), the coarse-pointer halo on the small close buttons (AUD-025),
 * the mobile-web-app-capable meta (PROD-004), and the 44px floor on the
 * splash's mute and install buttons (SPEC-splash-mute CAP-1,
 * SPEC-pwa-install CAP-5).
 */

test.afterEach(async ({ page }) => expectEngineHosted(page));

const PHONE = { width: 390, height: 844 };

async function onGame(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, { timeout: 30_000 });
}

/** WCAG relative luminance of a computed `rgb()`/`rgba()` color. */
function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("the page's markup carries the sweep's names and live regions", async ({ page }) => {
  await onGame(page);
  // Past the title screen, which holds the page under it inert.
  await page.evaluate(() => (window as any).game.onboarding.dismissSplash());
  // The toast rail announces politely, never assertively (AUD-020).
  await expect(page.locator("#toast-wrap")).toHaveAttribute("aria-live", "polite");
  // The tower name field, in the Tower Info window, has an accessible name (PROD-001).
  await page.evaluate(() => document.getElementById("mb-win-tower")?.click());
  await expect(page.locator("#tower-name")).toBeVisible();
  await expect(page.locator("#tower-name")).toHaveAccessibleName(/\S/);
  // Android's install meta accompanies Apple's (PROD-004).
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveCount(1);
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveCount(1);
});

test("the money figure meets WCAG AA on its stat chip (PROD-002)", async ({ page }) => {
  await onGame(page);
  await page.evaluate(() => document.getElementById("splash")?.remove());
  // Let a frame run so the status bar paints the money in its live color.
  await page.waitForFunction(() => (document.getElementById("stat-money")?.textContent ?? "").includes("$"));
  const colors = await page.evaluate(() => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const money = document.getElementById("stat-money")!;
    // The chip's ground: the nearest ancestor that paints an opaque background.
    let el: HTMLElement | null = money;
    let ground = [255, 255, 255];
    while (el) {
      const bg = parse(getComputedStyle(el).backgroundColor);
      if (bg.length === 3 || (bg.length === 4 && bg[3] === 1)) {
        ground = bg.slice(0, 3);
        break;
      }
      el = el.parentElement;
    }
    return { text: parse(getComputedStyle(money).color).slice(0, 3), ground };
  });
  // A 13px bold value is normal text, so it needs 4.5:1.
  expect(contrast(colors.text, colors.ground)).toBeGreaterThanOrEqual(4.5);
});

test.describe("on a touch screen", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test("the splash's mute and install buttons are at least 44px each way", async ({ page }) => {
    await onGame(page);
    for (const name of ["mute", "install"]) {
      const box = await page.locator(`#splash [data-splash="${name}"]`).boundingBox();
      expect(box, `the splash shows its ${name} button`).not.toBeNull();
      expect(box!.width, name).toBeGreaterThanOrEqual(44);
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
    }
  });

  test("a dialog's small close button takes a tap at least 24px across (AUD-025)", async ({ page }) => {
    await onGame(page);
    await page.evaluate(() => {
      document.getElementById("splash")?.remove();
      (window as any).game.ui.showAbout();
    });
    const close = page.locator("#modal .modal-x");
    await expect(close).toBeVisible();
    // Tap 12px from the button's center in each direction: the invisible halo
    // must catch all four, so the target is at least 24px each way however
    // small the visible glyph is.
    const caught = await close.evaluate((btn) => {
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      return [
        [cx - 11.5, cy],
        [cx + 11.5, cy],
        [cx, cy - 11.5],
        [cx, cy + 11.5],
      ].map(([x, y]) => document.elementFromPoint(x, y)?.closest(".modal-x") === btn);
    });
    expect(caught).toEqual([true, true, true, true]);
  });
});
