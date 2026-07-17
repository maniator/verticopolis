/**
 * Elevator Schedule dialog scenes (elevator-scheduling #305 Phase 3). Part of
 * the SCENES manifest; concatenated in order by `screenshot-scenes.ts`. Each
 * `build`/`setup` that runs in the page references an injected builder by
 * identity. Keep ERASABLE.
 *
 * Three shots off one staged tower shape: the Modern hero (presets, staging
 * list, advice, Simulate readout) for the showcase gallery, and the Classic
 * raw-grid and Modern-express variants for the features set. The hero and the
 * variants live in separate scenes because the runner keys deviceScaleFactor
 * on the SCENE's outDir (screenshots 1x, features 2x); the pricing pair set
 * the precedent.
 */
import { type Scene, PHONE } from "../screenshot-env.ts";
import { buildScheduleTowerModern, buildScheduleTowerClassic } from "../screenshot-builders.ts";

/** Select a shaft by kind and open its Schedule dialog off the editor card. */
async function openScheduleDialog(page: import("playwright").Page, kind: string): Promise<void> {
  await page.evaluate((k) => {
    const g = (window as any).game;
    const shaft = g.sim.tower.transports.find((t: any) => t.kind === k);
    if (!shaft) throw new Error(`schedule tower has no ${k} to select`);
    g.selected = { type: "transport", id: shaft.id };
    g.engine.selectedId = shaft.id;
    g.refreshEditor();
  }, kind);
  await page.waitForSelector('#editor [data-edit="schedule"]', { timeout: 4000 });
  await page.evaluate(() => (document.querySelector('#editor [data-edit="schedule"]') as HTMLElement | null)?.click());
  await page.waitForSelector("#modal .es-body", { timeout: 4000 });
}

export const SCHEDULE_SCENES: Scene[] = [
  {
    // The showcase hero: Modern, standard shaft, staging-first surface with a
    // live advice line off the seeded measured curve (spec §14).
    id: "schedule-dialog",
    outDir: "screenshots",
    build: buildScheduleTowerModern,
    assertUnits: 60,
    shots: [
      {
        name: "27-elevator-schedule",
        keepDialogs: true,
        setup: async (page) => {
          await openScheduleDialog(page, "elevatorStandard");
          // The hero's whole subject is the assisted Modern surface; fail the
          // shot if the advice line did not render rather than commit a
          // picture of the wrong thing.
          await page.evaluate(() => {
            if (!document.querySelector("#modal .es-advice")) throw new Error("the Modern advice line did not render");
          });
        },
        wait: 300,
      },
    ],
  },
  {
    // Features pair, minted at the features scale: the Modern EXPRESS variant
    // (Feeder recommended, whole-tower span) off the same Modern tower.
    id: "schedule-dialog-express",
    outDir: "features",
    build: buildScheduleTowerModern,
    assertUnits: 60,
    shots: [
      {
        name: "schedule-express",
        crop: "#modal .modal-box",
        keepDialogs: true,
        setup: async (page) => {
          await openScheduleDialog(page, "elevatorExpress");
          // The express shot's subject is the recommended Feeder preset.
          await page.evaluate(() => {
            const rec = document.querySelector("#modal .es-presets .es-rec");
            if (!rec || rec.textContent !== "Feeder") throw new Error("express dialog did not recommend Feeder");
          });
        },
        wait: 300,
      },
    ],
  },
  {
    // The Classic twin: the raw 24-hour grid as the primary surface, no
    // presets, no advice (1994 fidelity; Classic withholds advice, never
    // information).
    id: "schedule-dialog-classic",
    outDir: "features",
    build: buildScheduleTowerClassic,
    assertUnits: 60,
    shots: [
      {
        name: "schedule-classic",
        crop: "#modal .modal-box",
        keepDialogs: true,
        setup: async (page) => {
          await openScheduleDialog(page, "elevatorStandard");
          await page.evaluate(() => {
            if (!document.querySelector("#modal .es-strip")) throw new Error("the Classic raw strip did not render");
            if (document.querySelector("#modal .es-presets")) throw new Error("Classic must not show presets");
          });
        },
        wait: 300,
      },
      {
        // The mobile fit check the design party asked for: the full raw strip
        // (the dialog's widest surface) at phone width, bars intact, no
        // horizontal page scroll. drawSettle: the viewport override resizes
        // the canvas mid-shot (same coupling as the tablet shots).
        name: "schedule-classic-mobile",
        viewport: PHONE,
        drawSettle: true,
        crop: "#modal .modal-box",
        keepDialogs: true,
        setup: async (page) => {
          await openScheduleDialog(page, "elevatorStandard");
        },
        wait: 400,
      },
    ],
  },
];
