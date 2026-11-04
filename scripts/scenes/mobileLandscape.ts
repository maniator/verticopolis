/**
 * Gallery scenes for a phone held sideways, written into docs/screenshots/.
 * Part of the SCENES manifest (screenshot-scenes.ts). The viewport is the
 * Pixel landscape report's (PHONE_LANDSCAPE), which takes the styles.css
 * landscape phone block: the tools in a column on the left, one-line stat
 * chips, and a Map card that keeps the tower's proportions.
 */
import { type Scene, PHONE_LANDSCAPE } from "../screenshot-env.ts";
import { buildCanonTower } from "../screenshot-builders.ts";

export const MOBILE_LANDSCAPE_SCENES: Scene[] = [
  {
    id: "mobile-landscape",
    outDir: "screenshots",
    viewport: PHONE_LANDSCAPE,
    build: buildCanonTower,
    assertUnits: 200,
    shots: [
      {
        // The phone's Map starts closed behind its pill; opened here, it keeps
        // the tower's proportions on the short view.
        name: "09c-mobile-landscape",
        setup: async (page) => {
          await page.evaluate(() => (window as any).game.engine.setCamera(Math.floor((window as any).game.grid.width / 2), 18, 0.32));
          await page.click("#btn-map");
          await page.waitForSelector("#overview-map:not([hidden])");
        },
        clock: 12,
        wait: 1000,
      },
      {
        // A longer category in the tools column, with the Map closed. The shot
        // closes the Map only when it is open, so it also runs on its own.
        name: "09d-mobile-landscape-palette",
        setup: async (page) => {
          if (await page.isVisible("#overview-map")) await page.click("#overview-map .overview-map-close");
          await page.waitForSelector("#overview-map", { state: "hidden" });
          await page.click('.pal-tab[data-group="Commercial"]');
          await page.waitForSelector('.pal-group.tab-active[data-group="Commercial"]');
        },
        wait: 400,
      },
    ],
  },
];
