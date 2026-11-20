/**
 * Sky bridge looks (Modern; owner, 2026-11-16: "let the users choose"): the
 * stills the Help site's "Bridge looks" section shows
 * (help-site/src/content/docs/building/floors-and-lobbies.mdx). Four bridges,
 * one in each drawn look, laid through the look strip's own buttons and
 * `BuildActions.buildSkyBridge`, by day with the strip showing and at night,
 * and the ghost over a finished bridge that a click would restyle. A static
 * tower at a fixed hour, so the drift check's two legs agree. Keep ERASABLE.
 */
import { type Page } from "@playwright/test";
import { type Scene } from "../screenshot-env.ts";
import { buildSkyBridgeLooksTower } from "../screenshot-sky-bridge-builders.ts";

type Looks = { cx: number; sky: number; gaps: number[] };

/** Pick the look strip's button `look`, as a player does. */
async function pickLook(page: Page, look: number): Promise<void> {
  await page.locator(`#sky-bridge-look-strip button[data-look="${look}"]`).click();
  await page
    .locator(`#sky-bridge-look-strip button[data-look="${look}"][aria-pressed="true"]`)
    .waitFor({ timeout: 4000 });
}

/** Arm the tool and lay one bridge per gap, in looks 1 to 4. */
async function layLookBridges(page: Page): Promise<void> {
  await page.locator('.pal-item[data-tool="skyBridge"]').first().click();
  await page.locator("#sky-bridge-look-strip:not([hidden])").waitFor({ timeout: 4000 });
  const gaps = await page.evaluate(
    () => (window as Window & { __vcShotSkyBridgeLooks?: Looks }).__vcShotSkyBridgeLooks!.gaps,
  );
  for (let i = 0; i < gaps.length; i++) {
    await pickLook(page, i + 1);
    await page.evaluate((x) => {
      const w = window as Window & { __vcShotSkyBridgeLooks?: Looks };
      const laid = w.game.build.buildSkyBridge(x, w.__vcShotSkyBridgeLooks!.sky);
      if (!laid.ok) throw new Error(`the bridge at ${x} was refused: ${laid.reason}`);
    }, gaps[i]);
  }
  await page.evaluate(() => {
    const w = window as Window & { __vcShotSkyBridgeLooks?: Looks };
    const at = w.__vcShotSkyBridgeLooks!;
    w.game.engine.preview = null;
    w.game.engine.setCamera(at.cx + 10, at.sky, 1.1);
    w.game.reader.update();
  });
}

export const SKY_BRIDGE_LOOK_SCENES: Scene[] = [
  {
    id: "sky-bridge-looks",
    outDir: "features",
    build: buildSkyBridgeLooksTower,
    shots: [
      {
        // Glass Skywalk, Steel Truss, Deco Arcade and Garden Walk by day, with
        // the look strip over the tower.
        name: "sky-bridge-looks-day",
        clock: 10,
        setup: layLookBridges,
        wait: 500,
      },
      {
        // The strip alone: every look, the last one picked pressed.
        name: "sky-bridge-look-strip",
        crop: "#sky-bridge-look-strip",
        wait: 300,
      },
      {
        // The ghost over a finished bridge a click would dress in the picked
        // look: the whole bridge, its new look's name and "free".
        name: "sky-bridge-look-restyle",
        clock: 10,
        setup: async (page) => {
          await pickLook(page, 3);
          await page.evaluate(() => {
            const w = window as Window & { __vcShotSkyBridgeLooks?: Looks };
            const at = w.__vcShotSkyBridgeLooks!;
            w.game.updateBuildPreview(at.gaps[0], at.sky);
            if (!w.game.engine.preview?.valid) throw new Error("the restyle ghost did not show");
          });
        },
        wait: 400,
      },
      {
        // The same bridges at night, lit from inside.
        name: "sky-bridge-looks-night",
        clock: 21,
        setup: (page) =>
          page.evaluate(() => {
            const w = window;
            w.game.ui.selectTool({ type: "inspect" });
            w.game.engine.preview = null;
          }),
        wait: 500,
      },
    ],
  },
];
