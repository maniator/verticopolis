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

/** The readouts the shot waits for: a red line the help can point at. */
const RED = ["Backed up", "Gridlock"];

/** Step the morning rush until the readout turns red, then tap it and draw
 *  one frame so the moved camera and the spotlight are on the canvas. */
async function jumpToTheJam(page: Page): Promise<void> {
  let label = "";
  for (let i = 0; i < 60 && !RED.includes(label); i++) {
    const stepped = await page.evaluate(pgStep, 10);
    if (!stepped) throw new Error("traffic-jump needs the stepped clock");
    label = await page.evaluate(async () => {
      const g = (window as any).game;
      await g?.refreshTraffic();
      return document.getElementById("traffic-label")?.textContent ?? "";
    });
  }
  if (!RED.includes(label)) throw new Error(`traffic-jump: the rush never backed up (last read "${label}")`);
  // The tap's own answer: true only once the camera went to a line and its
  // spotlight went up, so a tap that did nothing fails the scene.
  const jumped = await page.evaluate(() => (window as any).game.jumpToTraffic() as boolean);
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
];
