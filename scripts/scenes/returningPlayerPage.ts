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
 * Two towers in My Towers, then File > Open… (Ctrl+O) over whatever is on
 * screen, so the Open window shows rows rather than its empty line. The files
 * hold the scene's own boot tower under two fixed names, and their Modified
 * time is the pinned clock (`screenshot-page-ops.ts`), so the pixels hold
 * still between runs. The scene's browser profile is its own, so nothing
 * carries into another scene.
 */
export async function pgShowOpenWindow(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const g = (window as unknown as { game?: any }).game;
    await g.saveFile("Harbour Point");
    await g.saveFile("Sky Hotel");
  });
  await page.keyboard.press("Control+o");
  await page.waitForSelector("#modal .fd", { timeout: 4000 });
}
