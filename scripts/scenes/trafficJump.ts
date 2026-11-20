/**
 * The Traffic readout's jump (owner's report, 2026-11-17): a tap on
 * "Backed up · <floor>" zooms in on the tower's worst waiting line, bands
 * that line's stretch of the floor red and outlines its elevator, on that
 * floor only, in yellow. One desktop and one
 * phone shot over the Monday-morning crowd tower (`buildCrowdTower`), whose
 * lobby line is long enough to read Backed up and is drawn with its people
 * and elevator (the chip shots' jammed tower draws neither at the lot's edge);
 * its own shard, `traffic-jump`, as new features get. The spotlight reads the stepped
 * clock (performance.now is shimmed onto it), so the band's strength is the
 * same every run.
 */
import type { Page } from "playwright";
import { PHONE, type Scene } from "../screenshot-env.ts";
import { buildCrowdTower, pgStep } from "../screenshot-builders.ts";
import { buildHotspotTower } from "../screenshot-scene-builders.ts";
import { stepTrafficUntil } from "./trafficChip.ts";

/** The readout the shot waits for: a red line the help can point at. Gridlock
 *  has its own chip shot (`traffic-gridlock` below), so this
 *  one pins Backed up alone. */
const LEVEL = "Backed up";

/** Step the morning rush until the readout reads Backed up, then tap it and draw
 *  one frame so the moved camera and the spotlight are on the canvas. The
 *  rush steps without drawing (pgStepNoDraw): drawing its frames in software
 *  raster made this the slowest scene in the gallery (about 134s a shot in CI). */
async function jumpToTheJam(page: Page): Promise<void> {
  await stepTrafficUntil(page, LEVEL, 60);
  // The tap's own answer: true only once the camera went to a line and its
  // spotlight went up, so a tap that did nothing fails the scene.
  const jumped = await page.evaluate(() => window.game.jumpToTraffic() as boolean);
  if (!jumped) throw new Error("traffic-jump: the tap found no line to zoom in on");
  await page.evaluate(pgStep, 4);
}

const shot = (name: string) => ({ name, wait: 0, setup: jumpToTheJam });

export const TRAFFIC_JUMP_SCENES: Scene[] = [
  {
    id: "traffic-jump",
    outDir: "features",
    build: buildCrowdTower,
    assertUnits: 40,
    shots: [shot("traffic-jump")],
  },
  {
    id: "traffic-jump-mobile",
    outDir: "features",
    viewport: PHONE,
    build: buildCrowdTower,
    assertUnits: 40,
    shots: [shot("traffic-jump-mobile")],
  },
  {
    // The meter's top level: the chip shots' tower (`buildHotspotTower`) with its weak shaft serving ten
    // full office floors, so the morning line reaches Gridlock.
    id: "traffic-gridlock",
    outDir: "features",
    viewport: { width: 1440, height: 400 },
    initScript: () => {
      (window as unknown as { __vcGridlock?: boolean }).__vcGridlock = true;
    },
    build: buildHotspotTower,
    assertUnits: 100,
    shots: [
      {
        name: "traffic-chip-gridlock",
        crop: "#topbar",
        wait: 0,
        setup: async (page) => {
          await stepTrafficUntil(page, "Gridlock", 300);
        },
      },
    ],
  },
];
