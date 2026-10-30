/**
 * Milestone scenes (1-5 star growth + the TOWER-rank capstone). Part of the
 * SCENES manifest; concatenated in order by `screenshot-scenes.ts`. `growToStar`
 * is a Node-side driver that hard-asserts the tower reached each rank. Keep
 * ERASABLE.
 */
import { type Scene, assertReady } from "../screenshot-env.ts";
import { buildCanonTower, topOutTowerWithHall } from "../screenshot-builders.ts";
import { growToStar } from "../screenshot-scenes-drivers.ts";

export const MILESTONE_SCENES: Scene[] = [
  // ======================= MILESTONES =======================
  {
    id: "milestones",
    outDir: "milestones",
    shots: [
      { name: "1-star", setup: (page) => growToStar(page, 1), wait: 700 },
      { name: "2-star", setup: (page) => growToStar(page, 2), wait: 700 },
      { name: "3-star", setup: (page) => growToStar(page, 3), wait: 700 },
      { name: "4-star", setup: (page) => growToStar(page, 4), wait: 700 },
      { name: "5-star", setup: (page) => growToStar(page, 5), wait: 700 },
      {
        name: "tower",
        // The TOWER-rank capstone: build the hero tower, top it out to floor 100
        // with the wedding hall and scroll to it, then surface the real
        // "🏆 TOWER achieved!" modal and KEEP it (the transient sweep would
        // otherwise close it, leaving a bare tower with no milestone).
        keepDialogs: true,
        setup: async (page) => {
          await page.evaluate(buildCanonTower);
          await assertReady(page, 200);
          await page.evaluate(topOutTowerWithHall);
          await assertReady(page, 200);
          await page.evaluate(() => (window as any).game.ui.congratsTower());
          await page.waitForSelector("#modal[open], dialog[open]", { timeout: 4000 });
        },
        clock: 11,
        // Floor 94 puts the crown (floors 100-104) in the upper half of the
        // canvas, above the centered modal, so the hall reads behind it.
        frame: { floor: 94, zoom: 0.5 },
        wait: 1200,
      },
    ],
  },
];
