import { test, expect, type Page } from "@playwright/test";
import { expectEngineHosted } from "./helpers";

/**
 * The desktop Tools window shows every tool without scrolling. A Modern tower
 * at five stars lists the most tools (39 under 11 headers), so it is the case
 * checked here, at common desktop window sizes. The window picks compact rows,
 * two columns, or both (src/ui/paletteFit.ts), and the happy-dom tests cannot
 * check that, since they lay nothing out. Phones and tablets keep their own
 * palette layouts and never carry the fit.
 */

test.afterEach(async ({ page }) => expectEngineHosted(page));

/** Boot the game and found a Modern tower at five stars, so every tool shows. */
async function fullModernPalette(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { game?: { sim?: unknown } }).game?.sim), undefined, { timeout: 30_000 });
  await page.evaluate(() => {
    document.getElementById("splash")?.remove();
    const g = (window as any).game;
    g.sim = g.sim.constructor.newGame(4400, "modern");
    g.sim.money = 500_000_000;
    g.sim.star = 5;
  });
  // Unlocked, though a phone shows one category at a time, so it may be off screen.
  await expect(page.locator('#palette .pal-item[data-kind="weddingHall"]:not(.locked)')).toBeAttached();
}

/** The Tools window's fit classes, and whether its list overflows it. */
function paletteState(page: Page) {
  return page.evaluate(() => {
    const win = document.getElementById("palette")!;
    const shown = [...win.querySelectorAll<HTMLElement>(".pal-item")].filter((el) => el.offsetParent !== null);
    const box = win.getBoundingClientRect();
    return {
      classes: [...win.classList].filter((c) => c.startsWith("pal-fit-")).sort(),
      overflows: win.scrollHeight > win.clientHeight,
      shown: shown.length,
      // Every shown tool lies inside the window's box (none cut off at the bottom).
      allInside: shown.every((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= box.top && r.bottom <= box.bottom + 0.5 && r.left >= box.left && r.right <= box.right + 0.5;
      }),
      width: Math.round(box.width),
    };
  });
}

const DESKTOPS = [
  { width: 1920, height: 1300, classes: ["pal-fit-compact"] },
  { width: 1600, height: 1150, classes: ["pal-fit-compact"] },
  { width: 1366, height: 768, classes: ["pal-fit-columns", "pal-fit-compact"] },
  { width: 1280, height: 800, classes: ["pal-fit-columns", "pal-fit-compact"] },
];

for (const vp of DESKTOPS) {
  test(`a ${vp.width}x${vp.height} desktop shows every Modern tool without scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await fullModernPalette(page);
    const state = await paletteState(page);
    expect(state.shown).toBe(39);
    expect(state.overflows).toBe(false);
    expect(state.allInside).toBe(true);
    expect(state.classes).toEqual(vp.classes);
  });
}

test.describe("a touch tablet held sideways", () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });

  test("fits every Modern tool with rows no shorter than a 24px touch target", async ({ page }) => {
    await fullModernPalette(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const state = await paletteState(page);
    expect(state.shown).toBe(39);
    expect(state.overflows).toBe(false);
    expect(state.allInside).toBe(true);
    expect(state.classes).toContain("pal-fit-compact");
    const shortest = await page.evaluate(() =>
      Math.min(
        ...[...document.querySelectorAll<HTMLElement>("#palette .pal-item")]
          .filter((el) => el.offsetParent !== null)
          .map((el) => el.getBoundingClientRect().height),
      ),
    );
    expect(shortest).toBeGreaterThanOrEqual(24);
  });
});

test("a tall desktop keeps the normal rows, and a shorter window refits as it resizes", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1440 });
  await fullModernPalette(page);
  expect((await paletteState(page)).classes).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(async () => (await paletteState(page)).overflows).toBe(false);
  const short = await paletteState(page);
  expect(short.classes).toContain("pal-fit-columns");
  expect(short.allInside).toBe(true);
  await page.setViewportSize({ width: 1920, height: 1440 });
  await expect.poll(async () => (await paletteState(page)).classes).toEqual([]);
});

test("a new Classic tower at one star keeps the normal single column", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { game?: { sim?: unknown } }).game?.sim), undefined, { timeout: 30_000 });
  await page.evaluate(() => document.getElementById("splash")?.remove());
  await expect(page.locator('#palette .pal-item[data-kind="office"]')).toBeVisible();
  const state = await paletteState(page);
  expect(state.classes).toEqual([]);
  expect(state.overflows).toBe(false);
  expect(state.width).toBe(176);
});

for (const vp of [
  { name: "a phone", width: 390, height: 844 },
  { name: "a sideways phone", width: 844, height: 390 },
  { name: "a tablet", width: 820, height: 1180 },
]) {
  test(`${vp.name} keeps its own palette layout, without the desktop fit`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await fullModernPalette(page);
    expect((await paletteState(page)).classes).toEqual([]);
  });
}

test("the fold button folds the desktop Tools window into a strip, remembers it, and opens it again", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await fullModernPalette(page);
  const button = page.locator("#btn-palette-collapse");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const stageBefore = await page.locator("#stage").evaluate((el) => el.getBoundingClientRect().width);
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('#palette .pal-item[data-kind="lobby"]')).toBeHidden();
  const folded = await paletteState(page);
  expect(folded.width).toBeLessThanOrEqual(30);
  // The tower gets the room back.
  const stageFolded = await page.locator("#stage").evaluate((el) => el.getBoundingClientRect().width);
  expect(stageFolded).toBeGreaterThan(stageBefore + 250);
  // Folded stays folded on the next visit.
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { game?: { sim?: unknown } }).game?.sim), undefined, { timeout: 30_000 });
  await page.evaluate(() => document.getElementById("splash")?.remove());
  await expect(page.locator("#btn-palette-collapse")).toHaveAttribute("aria-expanded", "false");
  await page.locator("#btn-palette-collapse").click();
  await expect(page.locator('#palette .pal-item[data-kind="lobby"]')).toBeVisible();
  const open = await paletteState(page);
  expect(open.overflows).toBe(false);
});

test("a phone has no fold button, and a stored fold leaves its tools showing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("vc-tools-collapsed-desktop", "collapsed"));
  await fullModernPalette(page);
  await expect(page.locator("#btn-palette-collapse")).toBeHidden();
  await expect(page.locator('#palette .pal-item[data-kind="inspect"], #palette .pal-item[data-tool="inspect"]').first()).toBeVisible();
});

test("folding categories from their headers shortens the list, so the window drops back to one column", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fullModernPalette(page);
  expect((await paletteState(page)).classes).toContain("pal-fit-columns");
  for (const group of ["Living", "Leisure", "Services"]) await page.locator(`.pal-group[data-group="${group}"] > .pal-group-title[role="button"]`).click();
  await expect(page.locator('.pal-group[data-group="Leisure"] > .pal-group-title[role="button"]')).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('#palette .pal-item[data-kind="cinema"]')).toBeHidden();
  const folded = await paletteState(page);
  expect(folded.classes).not.toContain("pal-fit-columns");
  expect(folded.overflows).toBe(false);
  expect(folded.width).toBe(176);
  // The folds are remembered.
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { game?: { sim?: unknown } }).game?.sim), undefined, { timeout: 30_000 });
  await page.evaluate(() => document.getElementById("splash")?.remove());
  await expect(page.locator('.pal-group[data-group="Leisure"]')).toHaveClass(/pal-folded/);
  // The keyboard opens one again.
  await page.locator('.pal-group[data-group="Leisure"] > .pal-group-title[role="button"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('.pal-group[data-group="Leisure"] > .pal-group-title[role="button"]')).toHaveAttribute("aria-expanded", "true");
});

test("a fold stored on a desktop never empties a phone's category tab", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("vc-tools-folded-groups", JSON.stringify(["Structure", "Commercial"])));
  await fullModernPalette(page);
  await page.locator('.pal-tab[data-group="Commercial"]').click();
  await expect(page.locator('#palette .pal-item[data-kind="office"]')).toBeVisible();
});
