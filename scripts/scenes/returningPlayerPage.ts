/**
 * Page-interaction helpers for the returning-player title-screen showcase scenes
 * (extracted from `showcase.ts` to keep that file under the line ceiling). Each
 * stages the returning state in the DOM rather than writing storage, so the
 * gallery still boots fresh.
 */
import { type Page } from "playwright";

/**
 * Re-mount the title screen in its RETURNING-player state: Continue is only
 * rendered when boot found a readable autosave, and the gallery always boots
 * fresh, so the state is staged rather than saved into. Tearing the first-run
 * splash down first keeps exactly one `#splash` in the DOM.
 */
export async function pgShowReturningSplash(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as { game?: any }).game;
    g.onboarding.dismissSplash();
    g.onboarding.showSplash({
      hasSave: true,
      onContinue: () => {},
      onLoadTower: () => {},
      onNewTower: () => {},
    });
  });
  // Fail the shot (keeping the committed image) if the returning stack never
  // mounts, rather than commit a first-run splash under a returning name.
  await page.waitForSelector('#splash [data-splash="continue"]', { timeout: 4000 });
}

/**
 * Open the load-only tower picker over the title screen with one row of every
 * variant. The slot metadata is synthetic and fixed (a pinned `savedAt`, so the
 * rendered timestamp cannot drift between runs); nothing here writes storage.
 */
export async function pgShowTowerPicker(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as { game?: any }).game;
    const AT = 1_700_000_000_000;
    g.ui.showTowerPicker({
      getSlots: () => ({
        storageBlocked: false,
        slots: [
          { slot: "auto", exists: true, present: true, towerName: "Verticopolis", star: 3, population: 1840, funds: 2_450_000, savedAt: AT, mode: "classic", day: 96 },
          { slot: 1, exists: true, present: true, towerName: "Harbour Point", star: 2, population: 620, funds: 810_000, savedAt: AT, mode: "modern", day: 41 },
          { slot: 2, exists: false, present: true },
          { slot: 3, exists: false, present: false },
        ],
      }),
      onLoad: () => true,
    });
  });
  await page.waitForSelector("#modal .slots", { timeout: 4000 });
}
