import { test, expect } from "@playwright/test";

/**
 * Modal precedence for the fidelity reports, in a REAL browser (GH #658).
 *
 * The unit and integration tests for this run in happy-dom, where `<dialog>` is
 * emulated. Every claim this feature rests on is about the real element: that
 * `showModal()` puts a dialog in the browser's TOP LAYER, that the top layer
 * paints over the toast rail at any z-index, and that a message raised from
 * behind a dialog is therefore unreadable by construction. A DOM-shaped test
 * cannot see any of that, which is the same blind spot that let two paint
 * defects ship in the sibling dialog-footer work: the assertions were about
 * structure while the bug was about what the player could actually see.
 *
 * So these tests assert VISIBILITY, not presence. `toBeVisible()` on a Playwright
 * locator resolves against real layout and paint, so a notice rendered into a
 * covered element or an element of zero size fails here and passes in happy-dom.
 */
test.describe("fidelity report precedence (real dialog, real top layer)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game));
    await page.evaluate(() => document.getElementById("splash")?.remove());
  });

  /** A parsed import report, shaped like the real one. */
  const REPORT = {
    towerName: "GRAND",
    star: 3,
    money: 1_500_000,
    day: 3,
    floors: 5,
    basements: 1,
    unitsImported: 9,
    broughtOver: ["$1,500,000 in funds and your 3-star rating."],
    couldNotBring: ["Elevators were rebuilt from your floor layout."],
  };

  test("a report behind a blocking dialog says so where the player can see it, then opens", async ({ page }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    await page.evaluate((report) => {
      const ui = (window as any).game.ui;
      ui.showEventChoice("A fire has broken out!", "$20,000", () => {});
      ui.showImportReport(report, { onOpen: () => {} });
    }, REPORT);

    // The emergency still owns the dialog, and the waiting line is VISIBLE
    // inside it. This is the assertion happy-dom cannot make: the notice has to
    // be laid out and painted within the dialog that is in the top layer.
    const notice = page.locator("#modal .modal-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText(/will open when you finish here/);
    await expect(page.locator("#modal .modal-box")).toContainText("A fire has broken out!");

    // Resolving the emergency lets the held report through on its own.
    await page.click('#modal [data-act="decline"]');
    await expect(page.locator("#modal .modal-box")).toContainText("Open tower");
    await expect(page.locator('#modal [data-act="open"]')).toBeVisible();
  });

  test("a dropped report is readable, and a toast in its place would not have been", async ({ page }) => {
    await page.evaluate((report) => {
      const ui = (window as any).game.ui;
      ui.showEventChoice("A fire has broken out!", "$20,000", () => {});
      ui.showImportReport(report, { onOpen: () => {} });
      ui.showImportReport(report, { onOpen: () => {} }); // supersedes the first
      // Raise a toast at the same moment, as the OLD code did. It exists in the
      // DOM either way; the question this test settles is whether a player
      // could read it while a dialog is up.
      ui.toast("this is what the old code did", "bad");
    }, REPORT);

    const notice = page.locator("#modal .modal-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText(/The import was dropped/);

    // The heart of #658, measured rather than asserted from memory: the dialog
    // is painted over the toast, so a message raised there reaches nobody. The
    // toast element is present and "visible" by CSS, yet the point at its
    // center belongs to the dialog, not to the toast.
    const covered = await page.evaluate(() => {
      const toast = document.querySelector("#toast-wrap .toast") as HTMLElement | null;
      if (!toast) return { found: false, covered: false };
      const r = toast.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { found: true, covered: !toast.contains(hit) && hit !== toast };
    });
    expect(covered.found, "the toast under test must exist").toBe(true);
    expect(covered.covered, "a dialog must cover the toast rail; if not, #658's premise is wrong").toBe(true);
  });

  test("a report takes a dialog that owns nothing", async ({ page }) => {
    await page.evaluate((report) => {
      const ui = (window as any).game.ui;
      ui.showHelp();
      ui.showImportReport(report, { onOpen: () => {} });
    }, REPORT);
    await expect(page.locator('#modal [data-act="open"]')).toBeVisible();
    await expect(page.locator("#modal .modal-box")).not.toContainText("Getting Started");
  });
});
