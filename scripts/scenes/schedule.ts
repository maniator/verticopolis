/**
 * Elevator Schedule dialog scenes (elevator-scheduling #305 Phase 3). Part of
 * the SCENES manifest; concatenated in order by `screenshot-scenes.ts`. Each
 * `build`/`setup` that runs in the page references an injected builder by
 * identity. Keep ERASABLE.
 *
 * Six shots off one staged tower shape: the Modern hero (presets, staging
 * list, advice, Simulate readout) for the showcase gallery, and the Classic
 * raw-grid and Modern-express variants for the features set. The hero and the
 * variants live in separate scenes because the runner keys deviceScaleFactor
 * on the SCENE's outDir (screenshots 1x, features 2x); the pricing pair set
 * the precedent.
 */
import { type Scene, PHONE } from "../screenshot-env.ts";
import { buildScheduleTowerModern, buildScheduleTowerClassic } from "../screenshot-builders.ts";

/** Select a shaft by kind and open its Schedule dialog off the editor card.
 *
 *  With `stageUnsaved`, the same task also edits the working copy, presses
 *  Esc, and scrolls the dialog to its middle, so the dialog's first frame is
 *  already the armed, unsaved-changes state 27c captures. That has to be ONE
 *  task (one `page.evaluate`, no awaits between the steps): the edit shrinks
 *  the dialog from 560px to 548.34px wide, moving it from x=360 to x=365.83,
 *  and its composited sticky layers (title bar, grid head) keep the subpixel
 *  phase of their first raster. With the steps split across round trips,
 *  whether a frame rendered between the open and the edit was a race under
 *  CI load, and the sticky text came out at either phase: the intermittent
 *  27c determinism failure (#762, #843). Measured in the pinned image, 24
 *  renders each, counting renders whose sticky text differs from the
 *  committed PNG: split, 8; with a frame forced between the steps, 24; in one
 *  task, 0 (every render matched the committed bytes). Rendering only happens
 *  between tasks, so in one task the dialog's first frame is its final
 *  geometry. The scroll joins the task for the same reason: it pins the grid
 *  head, and a head first rendered unpinned at another phase is the same
 *  hazard. The shot sets `phaseWatch`, so a run where any of this stops
 *  being true fails with the cause named. */
async function openScheduleDialog(page: import("playwright").Page, kind: string, stageUnsaved = false): Promise<void> {
  await page.evaluate(
    ({ k, stage }) => {
      const g = (window as any).game;
      const shaft = g.sim.tower.transports.find((t: any) => t.kind === k);
      if (!shaft) throw new Error(`schedule tower has no ${k} to select`);
      g.selected = { type: "transport", id: shaft.id };
      g.engine.selectedId = shaft.id;
      g.refreshEditor();
      if (!stage) return;
      // The staged path checks each step right away, with no waits: one task
      // is the whole point, so it relies on the editor, the dialog and the
      // guard all mounting synchronously (lit renders do). If one ever
      // defers, this throws on every run and names the step.
      const open = document.querySelector('#editor [data-edit="schedule"]') as HTMLElement | null;
      if (!open) throw new Error("the editor rendered no Schedule button");
      // A dialog an earlier shot left open (keepDialogs) still holds a box, so
      // the mount check below must see a NEW one, or a dead button would pass.
      const before = document.querySelector("#modal .modal-box");
      open.click();
      const box = document.querySelector("#modal .modal-box") as HTMLElement | null;
      if (!box || box === before || !box.querySelector(".es-body")) throw new Error("the schedule dialog did not mount");
      // Dirty the working copy through a real control: a preset click routes
      // through onPreset, which lands in after() and sets the dirty flag
      // exactly as a player's edit would.
      const preset = box.querySelector(".es-presets .btn") as HTMLElement | null;
      if (!preset) throw new Error("the schedule dialog rendered no preset control to edit");
      preset.click();
      // Esc routes to the same handler every dismissal does; it arms the guard
      // and holds the dialog open.
      document.getElementById("modal")?.dispatchEvent(new Event("cancel", { cancelable: true }));
      const warn = box.querySelector(".modal-warn") as HTMLElement | null;
      const strip = box.querySelector(":scope > .modal-actions") as HTMLElement | null;
      if (!warn || !strip) throw new Error("the unsaved-changes warning did not mount");
      // The warning shows whenever the copy is dirty; the Esc is what this
      // shot is about, so check the guard actually armed: the warning turns
      // into an alert and Cancel asks to discard.
      const close = strip.querySelector('[data-act="close"]');
      if (warn.getAttribute("role") !== "alert" || close?.textContent?.trim() !== "Discard changes?") {
        throw new Error("the Esc did not arm the discard guard");
      }
      // Mid-scroll, with the same below-the-fold floor as the 27b shot.
      box.scrollTop = Math.floor((box.scrollHeight - box.clientHeight) / 2);
      const left = box.scrollHeight - box.clientHeight - box.scrollTop;
      if (left <= strip.offsetHeight) throw new Error("too little of the dialog is below the fold for the pin to be doing anything");
      // The whole point is that the warning is ON SCREEN while the player is
      // somewhere in the middle of a long dialog.
      const r = warn.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      if (r.bottom > b.bottom + 1 || r.top < b.top) throw new Error("the unsaved-changes warning is not visible in the scrollport");
    },
    { k: kind, stage: stageUnsaved },
  );
  if (stageUnsaved) return;
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
      {
        // The PINNED action strip. `.modal-box` scrolls at 82vh, so this shot
        // has to be taken SCROLLED to prove anything: at the top of the dialog
        // a pinned footer and an unpinned one look identical. Scrolled to the
        // end is where the old build had nothing at all.
        name: "27b-elevator-schedule-actions",
        crop: "#modal .modal-box",
        keepDialogs: true,
        setup: async (page) => {
          await openScheduleDialog(page, "elevatorStandard");
          await page.evaluate(() => {
            const box = document.querySelector("#modal .modal-box") as HTMLElement | null;
            const strip = document.querySelector("#modal .modal-actions") as HTMLElement | null;
            if (!box || !strip) throw new Error("the schedule dialog did not mount");
            // MID-scroll, not the end. At maximum scroll the strip's natural
            // position is already on screen, so sticky resolves to no offset
            // and a pinned strip is pixel-identical to an unpinned one. Half
            // way down is where the two differ: pinned keeps it visible,
            // unpinned has it below the fold.
            box.scrollTop = Math.floor((box.scrollHeight - box.clientHeight) / 2);
            // Prove sticky is ACTIVE, which needs more than "it scrolled at
            // all": enough content must remain below the fold that the strip's
            // own natural position is past it. A 1px overflow would satisfy a
            // bare `scrollTop > 0` while pinned and unpinned render identically.
            const left = box.scrollHeight - box.clientHeight - box.scrollTop;
            if (left <= strip.offsetHeight) throw new Error("too little of the dialog is below the fold for the pin to be doing anything");
            const boxBottom = box.getBoundingClientRect().bottom;
            const stripBottom = strip.getBoundingClientRect().bottom;
            if (stripBottom > boxBottom + 1) throw new Error("the action strip is not pinned; this shot would prove nothing");
          });
        },
        wait: 300,
      },
      {
        // The unsaved-changes warning, staged as the REAL failure: edit, then
        // dismiss with Esc. The dialog stays open, and the pinned strip is what
        // says why. Before this fix the only feedback was the Cancel button
        // renaming, off-screen, and a second Esc discarded the edits.
        name: "27c-elevator-schedule-unsaved",
        crop: "#modal .modal-box",
        keepDialogs: true,
        // The edit resizes this dialog while it is staged; the runner fails
        // the shot unless it rendered at one subpixel phase throughout.
        phaseWatch: true,
        setup: async (page) => {
          // Open, edit, arm and scroll in one task (see openScheduleDialog).
          await openScheduleDialog(page, "elevatorStandard", true);
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
  {
    // The phone footer shot lives in its own scene because the runner derives
    // `isMobile`/`hasTouch` from the SCENE viewport, not from a per-shot
    // override. A phone-width shot inside a desktop scene renders at 390px
    // WITHOUT `@media (pointer: coarse)`, so it is not the dialog any phone
    // actually shows: the coarse-pointer block sets the schedule dialog's
    // touch spacing, and without it the layout is compact enough that nothing
    // reaches the band this shot is about. That is exactly what failed in CI.
    id: "schedule-dialog-classic-phone",
    outDir: "features",
    viewport: PHONE,
    build: buildScheduleTowerClassic,
    assertUnits: 60,
    shots: [
      {
        // The band BELOW the pinned strip, which is where the first cut of this
        // fix leaked. A sticky `bottom: 0` stops at the scroll container's
        // bottom padding rather than its visible edge, so 18px of dialog sits
        // under the buttons and shows whatever has not scrolled past yet. The
        // owner caught it on a Pixel 8a: two lines of the Simulate readout,
        // sliced through the middle, under OK and Cancel. Phone width is not
        // incidental here; that readout only wraps to two lines when it is
        // narrow enough to reach into the band.
        name: "schedule-classic-mobile-footer",
        crop: "#modal .modal-box",
        keepDialogs: true,
        setup: async (page) => {
          await openScheduleDialog(page, "elevatorStandard");
          await page.evaluate(() => {
            const box = document.querySelector("#modal .modal-box") as HTMLElement | null;
            const strip = document.querySelector("#modal .modal-box > .modal-actions") as HTMLElement | null;
            if (!box || !strip) throw new Error("the schedule dialog did not mount");
            // Text-bearing leaves only. Containers span the whole dialog and
            // would report an intrusion at every offset, which would make the
            // search below meaningless.
            const leaves = [...box.querySelectorAll<HTMLElement>("*")].filter(
              (el) => !el.closest(".modal-actions") && el.children.length === 0 && (el.textContent || "").trim(),
            );
            // Find an offset where real content sits in the band under the
            // strip. Keyed on ANY body content rather than on the Simulate
            // readout: that readout is only populated once the sim has measured
            // traffic, so tying the shot to it made the capture fail outright on
            // the Classic tower. What the shot is about is the band, not which
            // element happens to be crossing it.
            const max = box.scrollHeight - box.clientHeight;
            const inBand = (): boolean => {
              const s = strip.getBoundingClientRect().bottom;
              const b = box.getBoundingClientRect().bottom;
              // Real overlap with the band, not a one-pixel clip, so the shot
              // frames the defect rather than a sliver of it. Overlap rather
              // than "starts inside": a line that begins above the strip and
              // runs down through the band is the sliced case exactly.
              return leaves.some((el) => {
                const r = el.getBoundingClientRect();
                return r.height > 0 && Math.min(r.bottom, b) - Math.max(r.top, s) >= 4;
              });
            };
            // Mid-scroll first, to frame the same place the sibling shots do
            // and to stay distinct from `schedule-classic-mobile`, which is
            // this dialog at the top. The scan is a fallback so a future
            // content change cannot leave the shot framing an empty band.
            box.scrollTop = Math.floor(max / 2);
            let found = inBand();
            for (let t = 0; t <= max && !found; t += 2) {
              box.scrollTop = t;
              found = inBand();
            }
            if (!found) throw new Error("no scroll offset puts a line of body text in the band below the strip, so this shot would prove nothing");
          });
        },
        wait: 400,
      },
    ],
  },
];
