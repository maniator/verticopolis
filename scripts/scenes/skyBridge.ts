/**
 * The Sky Bridge tool (Modern, 3 stars): the stills the Help site's "Sky
 * bridges" section shows (help-site/src/content/docs/building/floors-and-lobbies.mdx).
 * The ghost over the whole gap with its price tag, the red ghost and its
 * reason off a sky lobby floor, the tool's button in Structure's Modern band,
 * and the bridge one click laid. Every shot works on the tower
 * `buildSkyBridgeTower` founds, through the same calls a pointer makes: the
 * palette's own button, the hover preview, and `BuildActions.buildSkyBridge`.
 * A static tower at a fixed hour, so the drift check's two legs agree. Keep
 * ERASABLE.
 */
import { type Page } from "@playwright/test";
import { type Scene } from "../screenshot-env.ts";
import { buildSkyBridgeTower } from "../screenshot-sky-bridge-builders.ts";

/** Pick the Sky Bridge tool from its palette button, the way a player does. */
async function armSkyBridge(page: Page): Promise<void> {
  await page.locator('.pal-item[data-tool="skyBridge"]').first().click();
  await page.locator('.pal-item[data-tool="skyBridge"].active').first().waitFor({ timeout: 4000 });
}

/** Hover the tool `dFloor` floors from the sky lobby floor, in the middle of
 *  the gap: the preview the pointer draws there. */
async function hoverGap(page: Page, dFloor: number): Promise<void> {
  await page.evaluate((dFloor) => {
    const w = window as unknown as { game: any; __vcShotSkyBridge?: { cx: number; sky: number } };
    const at = w.__vcShotSkyBridge;
    if (!at) throw new Error("the sky bridge towers were not built");
    w.game.engine.setCamera(at.cx, at.sky, 1.6);
    w.game.updateBuildPreview(at.cx, at.sky + dFloor);
    if (!w.game.engine.preview) throw new Error("the Sky Bridge tool drew no ghost");
  }, dFloor);
}

/** Lay the bridge a click in the gap lays, and drop the ghost. */
async function layBridge(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { game: any; __vcShotSkyBridge?: { cx: number; sky: number } };
    const at = w.__vcShotSkyBridge!;
    const laid = w.game.build.buildSkyBridge(at.cx, at.sky);
    if (!laid.ok) throw new Error(`the bridge was refused: ${laid.reason}`);
    w.game.ui.selectTool({ type: "inspect" });
    w.game.engine.preview = null;
    w.game.engine.setCamera(at.cx, at.sky, 1.6);
    w.game.reader.update();
  });
}

export const SKY_BRIDGE_SCENES: Scene[] = [
  {
    id: "sky-bridge",
    outDir: "features",
    build: buildSkyBridgeTower,
    shots: [
      {
        // The whole bridge one click lays, with its price and length.
        name: "sky-bridge-ghost",
        clock: 10,
        setup: async (page) => {
          await armSkyBridge(page);
          await hoverGap(page, 0);
        },
        wait: 400,
      },
      {
        // The button in Structure's Modern band, active.
        name: "sky-bridge-button",
        crop: '.pal-group[data-group="Structure"]',
        wait: 300,
      },
      {
        // Off a sky lobby floor the ghost is red and says why.
        name: "sky-bridge-refused",
        clock: 10,
        setup: (page) => hoverGap(page, -1),
        wait: 400,
      },
      {
        // The bridge the click laid, from one sky lobby to the other.
        name: "sky-bridge-built",
        clock: 10,
        setup: layBridge,
        wait: 400,
      },
    ],
  },
];
