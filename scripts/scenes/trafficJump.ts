/**
 * The Traffic readout's jump (owner's report, 2026-11-17): a tap on
 * "Backed up · <floor>" moves the view to that floor, bands it red and
 * outlines the transports behind the reading in yellow. One desktop and one
 * phone shot over the same jammed tower the `traffic` chip shots use; its own
 * shard, `traffic-jump`, as new features get. The spotlight reads the stepped
 * clock (performance.now is shimmed onto it), so the band's strength is the
 * same every run.
 */
import type { Page } from "playwright";
import { PHONE, type Scene } from "../screenshot-env.ts";
import { buildHotspotTower, pgStep } from "../screenshot-builders.ts";

/** Step the jammed tower until the readout leaves "Smooth", then tap it and
 *  draw one frame so the moved camera and the spotlight are on the canvas. */
async function jumpToTheJam(page: Page): Promise<void> {
  let label = "";
  for (let i = 0; i < 40 && (!label || label === "Smooth"); i++) {
    const stepped = await page.evaluate(pgStep, 10);
    if (!stepped) throw new Error("traffic-jump needs the stepped clock");
    label = await page.evaluate(async () => {
      const g = (window as any).game;
      await g?.refreshTraffic();
      return document.getElementById("traffic-label")?.textContent ?? "";
    });
  }
  if (!label || label === "Smooth")
    throw new Error("traffic-jump: the tower never backed up");
  await page.evaluate(() => document.getElementById("traffic")?.click());
  await page.evaluate(pgStep, 1);
  const outlined = await page.evaluate(
    () =>
      (window as any).game.enginePort.congestionCause(
        (window as any).game.portCodes.slot(
          (window as any).game.enginePort.hotspot(),
          "hotspot",
          "floor",
        ),
      ).length,
  );
  if (outlined === 0)
    throw new Error("traffic-jump: no transport behind the reading to outline");
}

const shot = (name: string) => ({ name, wait: 0, setup: jumpToTheJam });

export const TRAFFIC_JUMP_SCENES: Scene[] = [
  {
    id: "traffic-jump",
    outDir: "features",
    build: buildHotspotTower,
    assertUnits: 100,
    shots: [shot("traffic-jump")],
  },
  {
    id: "traffic-jump-mobile",
    outDir: "features",
    viewport: PHONE,
    build: buildHotspotTower,
    assertUnits: 100,
    shots: [shot("traffic-jump-mobile")],
  },
];
