/**
 * The gallery runner's overview Map check (scripts/screenshots.ts, #343).
 * Lives under src/tests (not scripts/) so the unit tier can pin it without
 * importing across the tsconfig rootDir, the same arrangement as
 * screenshotOnlyFilter.ts. Kept ERASABLE (type annotations only, see
 * scripts/screenshot-env.ts) so node runs it directly via native
 * type-stripping.
 */
import type { Page } from "playwright";

/** Every scene shows the overview Map (#343) as a player first meets it: open
 *  on a desktop, closed behind the pill on a phone. A shot cropped to anything
 *  but the Map or its pill (a dialog, a card, the top bar) is about that
 *  element, so the Map and its pill are taken off the page for that capture
 *  and the crop's edge pixels match a page without them. A crop is the Map's
 *  when the element it selects is the Map or the pill or inside one of them,
 *  and such a crop must be showing. Any other open Map must have drawn its
 *  tower: the window sets `data-map-drawn` only once it has painted the
 *  tower's marks, and clears it whenever it closes, while no tower is bound,
 *  while a canvas's context is lost, and when its canvases are cleared for a
 *  repaint, so a capture never commits an empty Map. An empty crop is a
 *  full-page shot, as the runner reads it, and a crop must be a CSS selector. */
export async function mapForShot(page: Page, where: string, crop: string | undefined): Promise<void> {
  const state = await page.evaluate((selector) => {
    const map = document.getElementById("overview-map");
    const pill = document.getElementById("btn-map");
    const win = (window as unknown as { overviewMap?: { isOpen(): boolean; setOpen(open: boolean, remember: boolean): void } }).overviewMap;
    let target: Element | null = null;
    try {
      target = selector === null ? null : document.querySelector(selector);
    } catch {
      // Playwright-only syntax (`>> nth=0`, `text=`) is no CSS selector.
      return "bad crop";
    }
    const mapCrop = target !== null && (!!map?.contains(target) || !!pill?.contains(target));
    if (mapCrop && target?.closest("[hidden]")) return "hidden crop";
    if (selector !== null && !mapCrop && map && pill && win) {
      // A second call before the restore keeps the scene's first state.
      map.dataset.shotReopen ??= String(win.isOpen());
      map.dataset.shotPill ??= String(pill.hidden);
      win.setOpen(false, false);
      pill.hidden = true;
      return "closed";
    }
    return map === null || map.hidden ? "closed" : (map.dataset.mapDrawn ?? "");
  }, crop || null);
  if (state === "bad crop") throw new Error(`${where}: the crop is not a CSS selector`);
  if (state === "hidden crop") throw new Error(`${where}: the Map crop is hidden`);
  if (state === "") throw new Error(`${where}: the Map is open but has not drawn the tower yet`);
}

/** Put back a Map that `mapForShot` took off the page, as the scene had it. */
export async function restoreMapAfterShot(page: Page): Promise<void> {
  await page.evaluate(() => {
    const map = document.getElementById("overview-map");
    const win = (window as unknown as { overviewMap?: { isOpen(): boolean; setOpen(open: boolean, remember: boolean): void } }).overviewMap;
    const reopen = map?.dataset.shotReopen;
    const pillWas = map?.dataset.shotPill;
    if (!map || !win || reopen === undefined) return;
    delete map.dataset.shotReopen;
    delete map.dataset.shotPill;
    win.setOpen(reopen === "true", false);
    // `setOpen` shows the pill only when the Map's state changes, so the
    // pill goes back to the scene's own value.
    const pill = document.getElementById("btn-map");
    if (pill) pill.hidden = pillWas === undefined ? win.isOpen() : pillWas === "true";
  });
}
