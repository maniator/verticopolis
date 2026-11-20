import { test, expect, type Page } from "@playwright/test";

/**
 * Previous versions… is a child of the Open or Save As window it was opened
 * from, as in Windows: closing it without opening a version (Cancel, the ✕,
 * Esc) puts that window back as the player left it, with the same row
 * picked, the same sort and the same name, instead of dropping the player
 * back into the game (Naftali, 2026-11-17).
 */
test.setTimeout(90_000);

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__vcEngine?.status.hosted && !!window.game, undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => document.getElementById("splash")?.remove());
  // Two tower files, so the row the player picked is not simply the only one.
  await page.evaluate(async () => {
    const g = window.game;
    g.setSpeed(0);
    await g.saveFile("Harbour Point");
    await g.saveFile("Sky Hotel");
  });
}

/** File > Open… (`mb-import`) or File > Save As… (`mb-export`). */
async function fileWindow(page: Page, item: "mb-import" | "mb-export"): Promise<void> {
  await page.evaluate((id) => document.getElementById(id)?.click(), item);
  await expect(page.locator("#modal .fd")).toBeVisible();
  await expect(page.locator("#modal .fd-row", { hasText: "Harbour Point" })).toBeVisible();
}

const row = (page: Page, name: string) => page.locator("#modal .fd-row", { hasText: name });

async function versionsFromMenu(page: Page): Promise<void> {
  await page.locator("#modal .fd-menu").getByRole("menuitem", { name: "Previous versions…" }).click();
  await expect(page.locator("#modal .pv-window")).toBeVisible();
  await expect(page.locator("#modal .fd")).toHaveCount(0);
}

/** The Open or Save As window is back, titled `title`, with `name` picked. */
async function expectBack(page: Page, title: string, name: string): Promise<void> {
  await expect(page.locator("#modal")).toHaveJSProperty("open", true);
  await expect(page.locator("#modal .pv-window")).toHaveCount(0);
  await expect(page.locator("#modal .win-title")).toContainText(title);
  await expect(row(page, name)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#modal #fd-name")).toHaveValue(name);
  await expect(page.locator("#modal .fd-rows"), "the list has the focus, as the row the player left").toBeFocused();
}

const CLOSES: { how: string; close: (page: Page) => Promise<void> }[] = [
  { how: "Cancel", close: (page) => page.locator("#modal .pv-buttons .btn", { hasText: "Cancel" }).click() },
  { how: "the ✕", close: (page) => page.locator("#modal .modal-x").click() },
  { how: "Esc", close: (page) => page.keyboard.press("Escape") },
];

test.describe("on a computer", () => {
  for (const { how, close } of CLOSES) {
    test(`${how} in Previous versions… goes back to the Open window as it was`, async ({ page }) => {
      await boot(page);
      await fileWindow(page, "mb-import");
      // Sort by name, so the window's own state is something to keep.
      await page.locator("#modal .fd-col", { hasText: "Name" }).click();
      const sorted = await page.locator("#modal .fd-row .fd-name-cell").allTextContents();
      await row(page, "Harbour Point").click({ button: "right" });
      await versionsFromMenu(page);
      await close(page);
      await expectBack(page, "Open", "Harbour Point");
      expect(await page.locator("#modal .fd-row .fd-name-cell").allTextContents(), "the sort the player chose").toEqual(
        sorted,
      );
      // And the window still works: a second close leaves for the game.
      await page.keyboard.press("Escape");
      await expect(page.locator("#modal")).toHaveJSProperty("open", false);
    });
  }

  test("Previous versions… from the Save As window goes back to Save As", async ({ page }) => {
    await boot(page);
    await fileWindow(page, "mb-export");
    await row(page, "Harbour Point").click({ button: "right" });
    await versionsFromMenu(page);
    await page.keyboard.press("Escape");
    await expectBack(page, "Save As", "Harbour Point");
    // And again from another row: each trip comes back.
    await row(page, "Sky Hotel").click({ button: "right" });
    await versionsFromMenu(page);
    await page.locator("#modal .pv-buttons .btn", { hasText: "Cancel" }).click();
    await expectBack(page, "Save As", "Sky Hotel");
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  /** Touch and hold a row, as a phone opens its menu. */
  async function hold(page: Page, name: string): Promise<void> {
    const box = (await row(page, name).boundingBox())!;
    const at = { x: box.x + 30, y: box.y + box.height / 2 };
    await row(page, name).evaluate((el, p) => {
      const touch = (type: string) =>
        new PointerEvent(type, {
          pointerType: "touch",
          pointerId: 7,
          isPrimary: true,
          clientX: p.x,
          clientY: p.y,
          bubbles: true,
          cancelable: true,
        });
      el.dispatchEvent(touch("pointerdown"));
      return new Promise<void>((done) =>
        setTimeout(() => {
          el.dispatchEvent(touch("pointerup"));
          done();
        }, 700),
      );
    }, at);
    await expect(page.locator("#modal .fd-menu")).toBeVisible();
    // Past the lift's own click, which the window drops.
    await page.waitForTimeout(900);
  }

  for (const item of ["mb-import", "mb-export"] as const) {
    const title = item === "mb-import" ? "Open" : "Save As";
    test(`closing Previous versions… goes back to the ${title} window`, async ({ page }) => {
      await boot(page);
      await fileWindow(page, item);
      await hold(page, "Harbour Point");
      await versionsFromMenu(page);
      await page.locator("#modal .pv-buttons .btn", { hasText: "Cancel" }).tap();
      await expectBack(page, title, "Harbour Point");
    });
  }
});
