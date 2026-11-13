import { test, expect, type Page } from "@playwright/test";
import { expectEngineHosted } from "./helpers";

/**
 * The game panel's About… and Help buttons, clicked in a real browser. The
 * happy-dom tests click them too (src/tests/integration/helpAbout.integration.test.ts),
 * and the other specs open About through the tooling handle, so this is the one
 * place a real click on each button is checked end to end: About… opens About
 * this game, and Help opens the Help site in a new tab marked `?from=game`.
 * Follow-up to the post-merge reviews of #2063 and #2069.
 */

test.afterEach(async ({ page }) => expectEngineHosted(page));

async function onGamePanel(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, { timeout: 30_000 });
  await page.evaluate(() => document.getElementById("splash")?.remove());
  await expect(page.locator("#btn-about")).toBeVisible();
}

test("About… opens About this game with its privacy link and no What's new", async ({ page }) => {
  await onGamePanel(page);
  await page.locator("#btn-about").click();

  const about = page.getByRole("dialog", { name: /About this game/ });
  await expect(about).toBeVisible();
  await expect(about.locator(".help-diagnostics")).toBeVisible();
  await expect(about.locator('a[data-act="privacy"]')).toHaveAttribute("href", "/help/privacy/?from=game");
  await expect(about.locator('a[data-act="report"]')).toHaveAttribute("href", /^https:\/\/github\.com\/maniator\/verticopolis\/issues\/new\?template=bug_report\.yml&/);
  // The old Help menu's What's new went away with #2063.
  await expect(about.locator('[data-act="whats-new"]')).toHaveCount(0);

  await about.locator('[data-act="close"]').click();
  await expect(about).toBeHidden();
});

test("Help opens the Help site in a new tab marked as coming from the game", async ({ page }) => {
  await onGamePanel(page);
  // `vite preview` has no help site: its fallback would serve the game's own
  // page and boot a second game in the tab. Answer /help/ with a stand-in page.
  await page.context().route("**/help/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>Help</title>" }));
  const popup = page.waitForEvent("popup");
  await page.locator("#btn-help").click();
  const tab = await popup;
  // The new tab starts blank (its URL can read "" or about:blank) before it navigates.
  await expect.poll(() => tab.url()).toBe(new URL("/help/?from=game", page.url()).href);
  await expect(tab).toHaveTitle("Help");
  // Help is a tab, never a dialog in the game.
  await expect(page.locator("#modal[open]")).toHaveCount(0);
  await tab.close();
});

test("offline, Help and About's privacy link say where the page is and open no tab", async ({ page, context }) => {
  await onGamePanel(page);
  const popups: string[] = [];
  page.on("popup", (p) => popups.push(p.url()));
  await context.setOffline(true);
  try {
    await page.locator("#btn-help").click();
    await expect(page.getByText("The manual needs an internet connection. It is at verticopolis.com/help.").first()).toBeVisible();

    await page.locator("#btn-about").click();
    const about = page.getByRole("dialog", { name: /About this game/ });
    await about.locator('a[data-act="privacy"]').click();
    await expect(about.locator(".help-links-status")).toHaveText(
      "The privacy page needs an internet connection. It is at verticopolis.com/help/privacy.",
    );
    await expect(about).toBeVisible();
    expect(popups).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});
