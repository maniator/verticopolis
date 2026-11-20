import { test, expect, type Page } from "@playwright/test";
import { expectEngineHosted } from "./helpers";

// Every test must end with its tower still on the engine.
test.afterEach(async ({ page }) => expectEngineHosted(page));

/**
 * The Win95 menu bar that replaced the right sidebar, in a real browser: the
 * menus open by mouse and keyboard, Tower Info and Bulletin open from the
 * Tower menu and remember it across a reload, the status bar names the tower,
 * the phone keeps a logo on the menu bar, Full Screen (in Options) fills the
 * screen, and the title screen shows only File, Options and Help. The
 * installed app on a phone leaves Full Screen out (owner, 2026-11-15).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).game));
  await page.evaluate(() => {
    document.getElementById("splash")?.remove();
    document.getElementById("onboard")?.remove();
  });
}

test.describe("the menu bar on a desktop", () => {
  test.use({ viewport: DESKTOP });

  test("the sidebar is gone, and the menu bar and status bar frame the tower", async ({ page }) => {
    await boot(page);
    await expect(page.locator("#sidebar")).toHaveCount(0);
    await expect(page.locator("#menubar")).toBeVisible();
    await expect(page.locator("#statusbar")).toBeVisible();
    await expect(page.locator("#sb-tower")).toHaveText(/ · (Classic|Modern)$/);
    // The stage reaches the window's right edge, less the app frame.
    const stage = await page.locator("#stage").boundingBox();
    expect(stage!.x + stage!.width).toBeGreaterThan(DESKTOP.width - 24);
  });

  test("a click opens a menu, pointing switches menus, and a pick closes it", async ({ page }) => {
    await boot(page);
    await page.locator("#mb-file").click();
    await expect(page.locator("#mb-file-menu")).toBeVisible();
    await page.locator("#mb-tower").hover();
    await expect(page.locator("#mb-file-menu")).toBeHidden();
    await expect(page.locator("#mb-tower-menu")).toBeVisible();
    await page.locator("#btn-stats").click();
    await expect(page.locator("#mb-tower-menu")).toBeHidden();
    await expect(page.locator("#modal")).toBeVisible();
  });

  test("the keyboard walks the menus: Alt+letter, arrows and Escape", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("Alt+h");
    await expect(page.locator("#mb-help-menu")).toBeVisible();
    await expect(page.locator("#btn-help")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#mb-options-menu")).toBeVisible();
    await expect(page.locator("#btn-settings")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#mb-options-menu")).toBeHidden();
    await expect(page.locator("#mb-options")).toBeFocused();
  });

  test("Tower Info opens from the Tower menu, the Bulletin starts open, and both stay as left across a reload", async ({
    page,
  }) => {
    await boot(page);
    await expect(page.locator("#tower-win")).toBeHidden();
    await expect(page.locator("#bulletin-win #log")).toBeVisible();
    await page.locator("#mb-tower").click();
    await expect(page.locator("#mb-win-tower")).toHaveAttribute("aria-checked", "false");
    await page.locator("#mb-win-tower").click();
    await expect(page.locator("#tower-win")).toBeVisible();
    await expect(page.locator("#tower-stats")).toContainText("Floors");
    await page.locator("#mb-tower").click();
    await expect(page.locator("#mb-win-tower")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await page.locator("#mb-tower").click();
    await expect(page.locator("#mb-win-bulletin")).toHaveAttribute("aria-checked", "true");
    await page.locator("#mb-win-bulletin").click();
    await expect(page.locator("#bulletin-win")).toBeHidden();
    await boot(page);
    await expect(page.locator("#tower-win")).toBeVisible();
    await expect(page.locator("#bulletin-win")).toBeHidden();
    await page.locator('#tower-win [data-close="tower-win"]').click();
    await expect(page.locator("#tower-win")).toBeHidden();
  });

  test("the Bulletin opens on its newest line and keeps a scrolled reader in place", async ({ page }) => {
    await boot(page);
    // Real engine lines: a row of offices opens one by one, each saying so.
    const opened = await page.evaluate(() => {
      const g = (window as any).game;
      g.setSpeed(0);
      g.sim.money = 1e9;
      const built = [] as boolean[];
      for (let x = 100; x < 280; x++) built.push(g.sim.build("lobby", 1, x).ok);
      for (let f = 2; f <= 4; f++) for (let x = 100; x < 280; x++) built.push(g.sim.build("floor", f, x).ok);
      for (let f = 2; f <= 4; f++) for (let x = 100; x + 9 <= 280; x += 9) built.push(g.sim.build("office", f, x).ok);
      g.syncSim();
      g.sim.tick(24 * 60);
      return built.every(Boolean);
    });
    expect(opened, "the setup tower built").toBe(true);
    const log = page.locator("#bulletin-win #log");
    await expect(log.locator(".log-line").first()).toBeVisible();
    // The log overflows its window, so where it opens matters.
    const fit = await log.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(fit.scroll).toBeGreaterThan(fit.client);
    // Closed and opened again, it shows its newest line at the top.
    await page.locator('#bulletin-win [data-close="bulletin-win"]').click();
    await page.locator("#mb-tower").click();
    await page.locator("#mb-win-bulletin").click();
    await expect(page.locator("#bulletin-win")).toBeVisible();
    const top = await log.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 8)?.closest(".log-line");
      return {
        hit: hit?.textContent ?? null,
        newest: ((g) => g.enginePort.logText(g.reader.header.logSeq) ?? null)((window as any).game),
      };
    });
    expect(top.newest).not.toBeNull();
    expect(top.hit).toBe(top.newest);
    // A reader scrolled back stays on the same line while new ones arrive.
    const lineAt = () =>
      log.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 8)?.closest(".log-line");
        return hit ? Array.prototype.indexOf.call(el.children, hit) : -1;
      });
    await log.evaluate((el) => (el.scrollTop = 120));
    const before = await lineAt();
    const added = await page.evaluate(() => {
      const g = (window as any).game;
      const seq = g.reader.header.logSeq;
      for (let x = 100; x < 280; x++) g.sim.build("floor", 5, x);
      for (let x = 100; x + 9 <= 280; x += 9) g.sim.build("office", 5, x);
      g.syncSim();
      g.sim.tick(24 * 60);
      return g.reader.header.logSeq - seq;
    });
    expect(added).toBeGreaterThan(0);
    await expect.poll(lineAt).toBe(before + added);
  });

  test("with no fire or pests, the Tower menu grays both calls for help, and only Modern lists the exterminator", async ({
    page,
  }) => {
    await boot(page);
    const modern = await page.evaluate(() => (window as any).game.reader.header.mode === "modern");
    await page.locator("#mb-tower").click();
    await expect(page.locator("#mb-fire-rescue")).toHaveAttribute("aria-disabled", "true");
    if (modern) await expect(page.locator("#mb-exterminator")).toHaveAttribute("aria-disabled", "true");
    else await expect(page.locator("#mb-exterminator")).toBeHidden();
    // A grayed item does nothing: the menu stays open and no dialog opens.
    await page.locator("#mb-fire-rescue").click({ force: true });
    await expect(page.locator("#mb-tower-menu")).toBeVisible();
    await expect(page.locator("#modal")).toBeHidden();
  });

  test("Rename opens Tower Info with the name selected", async ({ page }) => {
    await boot(page);
    await page.locator("#mb-tower").click();
    await page.locator("#mb-rename").click();
    await expect(page.locator("#tower-name")).toBeFocused();
  });

  test("the status bar hides from the Options menu", async ({ page }) => {
    await boot(page);
    await page.locator("#mb-options").click();
    await page.locator("#mb-win-statusbar").click();
    await expect(page.locator("#statusbar")).toBeHidden();
  });

  test("Full Screen fills the screen and leaves it again", async ({ page }) => {
    await boot(page);
    await page.locator("#mb-options").click();
    await page.locator("#mb-fullscreen").click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await page.locator("#mb-options").click();
    await expect(page.locator("#mb-fullscreen")).toHaveAttribute("aria-checked", "true");
    await page.locator("#mb-fullscreen").click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  });

  test("File > Close saves the tower, shows the title screen, and Continue brings it back paused", async ({ page }) => {
    await boot(page);
    const name = await page.evaluate(() => (window as any).game.enginePort.towerName() as string);
    await page.locator("#mb-file").click();
    await page.locator("#mb-close").click();
    await expect(page.locator("#splash")).toBeVisible();
    await expect(page.locator('#splash [data-splash="continue"]')).toBeFocused();
    // The title screen shows only File, Options and Help, and File leaves
    // out Save, Save As and Close.
    for (const menu of ["#mb-edit", "#mb-tower"]) await expect(page.locator(menu)).toBeHidden();
    await page.locator("#mb-file").click();
    await expect(page.locator("#btn-new")).toBeVisible();
    for (const item of ["#mb-quick-save", "#mb-export", "#mb-close"]) await expect(page.locator(item)).toBeHidden();
    await page.keyboard.press("Escape");
    await page.locator('#splash [data-splash="continue"]').click();
    await expect(page.locator("#splash")).toHaveCount(0);
    for (const menu of ["#mb-edit", "#mb-tower"]) await expect(page.locator(menu)).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).game.speed)).toBe(0);
    expect(await page.evaluate(() => (window as any).game.enginePort.towerName())).toBe(name);
  });
});

test.describe("the menu bar on a phone", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test("keeps a logo, fits on one row, and drops the status bar", async ({ page }) => {
    await boot(page);
    await expect(page.locator(".menubar-brand")).toBeVisible();
    await expect(page.locator("#topbar .brand")).toBeHidden();
    await expect(page.locator("#statusbar")).toBeHidden();
    // Options leaves out Tools and Status Bar, which only a computer's layout has.
    await page.locator("#mb-options").tap();
    // A phone's browser tab keeps Full Screen; only the installed app drops it.
    await expect(page.locator("#mb-fullscreen")).toBeVisible();
    await expect(page.locator("#mb-display-sep")).toBeVisible();
    for (const item of ["#mb-win-tools", "#mb-win-statusbar"]) await expect(page.locator(item)).toBeHidden();
    await page.locator("#mb-options").tap();
    const bar = await page.locator("#menubar").boundingBox();
    const help = await page.locator("#mb-help").boundingBox();
    expect(help!.x + help!.width).toBeLessThanOrEqual(PHONE.width);
    expect(help!.y).toBeLessThan(bar!.y + bar!.height);
  });

  test("every menu opens inside the screen, on the title screen and in a tower", async ({ page }) => {
    /** Open each menu on the bar and check its box sits inside the phone's
     *  width (#2329: Help hung off the left edge of the title screen's short bar). */
    async function eachMenuFits(expected: number): Promise<void> {
      const titles = page.locator("#menubar .mb-title:visible");
      await expect(titles).toHaveCount(expected);
      for (const id of await titles.evaluateAll((els) => els.map((el) => el.id))) {
        await page.locator(`#${id}`).tap();
        const box = (await page.locator(`#${id}-menu`).boundingBox())!;
        expect(box.x, `${id} starts on screen`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${id} ends on screen`).toBeLessThanOrEqual(PHONE.width);
        await page.locator(`#${id}`).tap();
      }
    }
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as any).game));
    await expect(page.locator("#splash")).toBeVisible();
    await eachMenuFits(3);
    await page.evaluate(() => {
      document.getElementById("splash")?.remove();
      document.getElementById("onboard")?.remove();
    });
    await eachMenuFits(5);
  });

  test("Help opens on screen and Tower Info sits clear of Bulletin", async ({ page }) => {
    await boot(page);
    await page.locator("#mb-help").tap();
    const menu = await page.locator("#mb-help-menu").boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(PHONE.width);
    await page.locator("#mb-help").tap();
    for (const [menu, item] of [
      ["#mb-tower", "#mb-win-tower"],
      ["#mb-tower", "#mb-win-bulletin"],
    ]) {
      await page.locator(menu).tap();
      await page.locator(item).tap();
    }
    const tower = (await page.locator("#tower-win").boundingBox())!;
    const news = (await page.locator("#bulletin-win").boundingBox())!;
    expect(news.x + news.width).toBeLessThanOrEqual(tower.x);
  });
});

/** Run the page as the installed app: Android and the desktop browsers answer
 *  `display-mode: standalone` (the manifest's display), an iPhone's home-screen
 *  app sets `navigator.standalone`. Playwright can emulate neither, so the
 *  first answers that query as the always-true `all` and the second defines
 *  the flag, before any of the game's code runs. */
const INSTALLED = {
  android: () => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => real(q.includes("display-mode: standalone") ? "all" : q);
  },
  iphone: () => Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true }),
} as const;

test.describe("the installed app on a phone", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  for (const [device, install] of Object.entries(INSTALLED)) {
    test(`Options leaves out Full Screen and the line above it (${device})`, async ({ page }) => {
      await page.addInitScript(install);
      await boot(page);
      await page.locator("#mb-options").tap();
      await expect(page.locator("#mb-screensaver")).toBeVisible();
      await expect(page.locator("#mb-fullscreen")).toBeHidden();
      await expect(page.locator("#mb-display-sep")).toBeHidden();
    });
  }
});

test.describe("the installed app on a computer", () => {
  test.use({ viewport: DESKTOP });

  test("Options keeps Full Screen", async ({ page }) => {
    await page.addInitScript(INSTALLED.android);
    await boot(page);
    await page.locator("#mb-options").click();
    await expect(page.locator("#mb-fullscreen")).toBeVisible();
  });
});
