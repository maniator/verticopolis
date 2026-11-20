/**
 * The star-up message box (r/SimTower feedback, 2026-11-16): every state the
 * help page shows. Classic names the rating and the rooms it opens; Modern
 * adds what the rating starts asking for (parking from three stars, with the
 * spaces the tower needs and has) and the next rating's checklist. Each shot
 * grows a frozen tower to the rating, then raises the box the frame loop
 * raises on a real climb. Its own shard, `star-up`. The set holds each
 * distinct layout the box can take (party round, 2026-11-16): Classic's short
 * box, each Modern duty set, the parking line short and met, and a phone of
 * each mode; Classic 4★ and 5★ differ from 2★ and 3★ only in their words.
 */
import type { Page } from "playwright";
import { PHONE, type Scene, type Shot } from "../screenshot-env.ts";
import { pgGrowToStar } from "../screenshot-tower-builders.ts";
import { pgStepNoDraw } from "../screenshot-page-ops.ts";

type Mode = "classic" | "modern";

/** Grow a frozen `mode` tower to `star`, then let the frame loop open the
 *  box for the climb from the rating below. */
async function starUp(page: Page, star: number, mode: Mode, parked = false): Promise<void> {
  // The last shot kept its box open; close it the way OK does.
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#modal[open] [data-act="ok"]')?.click();
  });
  const reached = await page.evaluate(pgGrowToStar, { target: star, mode });
  if (reached < star) throw new Error(`star-up ${mode} ${star}★ only reached ${reached}★`);
  if (parked) await page.evaluate(pgParkTheOffices);
  await page.evaluate((s) => {
    const g = window.game;
    g.pendingStarUp = { from: s - 1, to: s };
    // The frame loop opens the box on its next UI pass (due at once); the box
    // itself stops time, and the speed stays at pause, so the tower behind it
    // holds still.
    g.lastUiUpdate = -Infinity;
    g.engine.paused = false;
  }, star);
  await page.evaluate(pgStepNoDraw, 3);
  await page.waitForSelector("#modal[open] .star-up-rating", { timeout: 8000 });
  await page.evaluate(() => {
    window.game.engine.paused = true;
  });
  // The parked shot stands for the plain line; a short deck would bless the red one twice.
  if (parked && (await page.$("#modal .star-up-parking.short")))
    throw new Error("star-up: the parked tower is still short of parking");
}

/** Two basement decks of parking, a ramp and a row of spaces each, so the
 *  grown tower has every space its offices need and the parking line reads
 *  plain. In-page: it builds on the tooling handle. */
function pgParkTheOffices(): void {
  const g = window.game;
  const s = g.sim;
  const W = g.grid.width;
  for (const f of [0, -1]) {
    for (let x = 2; x <= W - 3; x++)
      if (!s.tower.place("floor", f, x).ok) throw new Error(`star-up: no floor at ${f}:${x}`);
    if (!s.tower.place("parkingRamp", f, 6).ok) throw new Error(`star-up: no parking ramp on floor ${f}`);
    for (let x = 22; x + 1 <= W - 3;) {
      const r = s.tower.place("parking", f, x);
      x += r.ok ? s.tower.getUnit(r.unitId)!.width : 1;
    }
  }
  g.syncSim();
  g.engine.setSim(g.renderSim);
}

/** A still of the box, cropped to it on a desktop. */
const box = (name: string, star: number, mode: Mode, { crop = true, parked = false } = {}): Shot => ({
  name,
  wait: 300,
  keepDialogs: true,
  ...(crop ? { crop: "#modal .modal-box" } : {}),
  setup: (page) => starUp(page, star, mode, parked),
});

/** In-page, before the app boots: once `window.game` is published, its
 *  star-up latch (`pendingStarUp`) holds nothing, so the box never opens. */
export function pgNoStarUpBox(): void {
  let app: object | undefined;
  Object.defineProperty(window, "game", {
    configurable: true,
    get: () => app,
    set(v: object) {
      app = v;
      Object.defineProperty(v, "pendingStarUp", { configurable: true, get: () => null, set: () => {} });
    },
  });
}

export const STAR_UP_SCENES: Scene[] = [
  {
    id: "star-up",
    outDir: "features",
    starUp: true,
    shots: [
      box("star-up-classic-2", 2, "classic"),
      box("star-up-classic-3", 3, "classic"),
      box("star-up-modern-2", 2, "modern"),
      box("star-up-modern-3", 3, "modern"),
      box("star-up-modern-3-parked", 3, "modern", { parked: true }),
      box("star-up-modern-4", 4, "modern"),
      box("star-up-modern-5", 5, "modern"),
    ],
  },
  {
    id: "star-up-mobile",
    outDir: "features",
    starUp: true,
    viewport: PHONE,
    shots: [
      box("star-up-classic-2-mobile", 2, "classic", { crop: false }),
      box("star-up-modern-3-mobile", 3, "modern", { crop: false }),
    ],
  },
];
