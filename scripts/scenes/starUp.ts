/**
 * The star-up message box (r/SimTower feedback, 2026-11-16): every state the
 * help page shows. Classic names the rating and the rooms it opens; Modern
 * adds what the rating starts asking for (parking from three stars, with the
 * spaces the tower needs and has) and the next rating's checklist. Each shot
 * grows a frozen tower to the rating, then raises the box the frame loop
 * raises on a real climb. Its own shard, `star-up`.
 */
import type { Page } from "playwright";
import { PHONE, type Scene, type Shot } from "../screenshot-env.ts";
import { pgGrowToStar } from "../screenshot-tower-builders.ts";

type Mode = "classic" | "modern";

/** Grow a frozen `mode` tower to `star`, then let the frame loop open the
 *  box for the climb from the rating below. */
async function starUp(page: Page, star: number, mode: Mode): Promise<void> {
  const reached = await page.evaluate(pgGrowToStar, { target: star, mode });
  if (reached < star) throw new Error(`star-up ${mode} ${star}★ only reached ${reached}★`);
  await page.evaluate((s) => {
    const g = (window as unknown as { game: any }).game;
    g.pendingStarUp = { from: s - 1, to: s };
    // The frame loop opens the box on its next UI pass; the box itself stops
    // time, and the speed stays at pause, so the tower behind it holds still.
    g.engine.paused = false;
  }, star);
  await page.waitForSelector("#modal[open] .star-up-rating", { timeout: 8000 });
}

/** A still of the box, cropped to it on a desktop. */
const box = (name: string, star: number, mode: Mode, crop = true): Shot => ({
  name,
  wait: 300,
  keepDialogs: true,
  ...(crop ? { crop: "#modal .modal-box" } : {}),
  setup: (page) => starUp(page, star, mode),
});

export const STAR_UP_SCENES: Scene[] = [
  {
    id: "star-up",
    outDir: "features",
    shots: [
      box("star-up-classic-2", 2, "classic"),
      box("star-up-classic-3", 3, "classic"),
      box("star-up-modern-2", 2, "modern"),
      box("star-up-modern-3", 3, "modern"),
      box("star-up-modern-4", 4, "modern"),
      box("star-up-modern-5", 5, "modern"),
    ],
  },
  {
    id: "star-up-mobile",
    outDir: "features",
    viewport: PHONE,
    shots: [box("star-up-modern-3-mobile", 3, "modern", false)],
  },
];
