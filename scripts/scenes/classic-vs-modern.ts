/**
 * CAP-8 (classic-modern-reachability): paired Classic vs Modern stills for the
 * `/help` comparison. Part of the SCENES manifest; concatenated in order by
 * `screenshot-scenes.ts`. Each `build`/`setup` that runs in the page references
 * an injected builder by identity. Keep ERASABLE.
 *
 * The one genuinely-new divergence not already shot elsewhere: escalators may
 * serve office floors under Modern, never under Classic. Two scenes off two
 * mode-forked builders that share one tower shape and seed, so the pair is the
 * same moment in both rule-sets. The builders and these setups fail closed on
 * the placement divergence, so a matched (non-divergent) pair can never ship.
 * The other shortlisted cards (mode picker, pricing, schedule, stats) already
 * have committed pairs the `/help` page reuses; the data/math divergences stay
 * caption-only per media-plan.md.
 *
 * Split into two scenes (not two shots in one) because the runner keys
 * deviceScaleFactor on the SCENE's outDir; both are `features` so the pair mints
 * at the same 2x scale, the pricing and schedule pairs' precedent.
 */
import { type Scene } from "../screenshot-env.ts";
import { buildEscalatorOfficeModern, buildEscalatorOfficeClassic } from "../screenshot-builders.ts";

export const CLASSIC_VS_MODERN_SCENES: Scene[] = [
  {
    id: "compare-escalator-office-modern",
    outDir: "features",
    build: buildEscalatorOfficeModern,
    assertUnits: 10,
    shots: [
      {
        // Daytime so the offices and the escalator run are lit; the tower-panel
        // mode badge ("This tower: Modern") labels the frame. The builder framed
        // the run; re-assert the divergence is on screen before capture.
        name: "escalator-office-modern",
        clock: 10,
        setup: async (page) => {
          await page.evaluate(() => {
            const g = (window as unknown as { game: any }).game;
            const escs = g.sim.tower.transports.filter((t: any) => t.kind === "escalator");
            if (escs.length < 3) throw new Error("Modern escalator run did not stage all three flights");
            if (!escs.some((t: any) => t.top >= 3)) throw new Error("no escalator reaches an office floor");
          });
        },
        wait: 400,
      },
    ],
  },
  {
    id: "compare-escalator-office-classic",
    outDir: "features",
    build: buildEscalatorOfficeClassic,
    assertUnits: 10,
    shots: [
      {
        // The same tower and framing under Classic: only the lobby-to-shops
        // flight survives, so the office floors carry no escalator.
        name: "escalator-office-classic",
        clock: 10,
        setup: async (page) => {
          await page.evaluate(() => {
            const g = (window as unknown as { game: any }).game;
            const escs = g.sim.tower.transports.filter((t: any) => t.kind === "escalator");
            if (escs.some((t: any) => t.top >= 3)) throw new Error("Classic tower has an escalator on an office floor");
          });
        },
        wait: 400,
      },
    ],
  },
];
