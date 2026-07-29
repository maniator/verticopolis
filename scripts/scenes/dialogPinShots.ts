/**
 * The pinned-dialog-footer shots, spread into the showcase `first-run` scene.
 *
 * They live here rather than inline so `scenes/showcase.ts` stays under the
 * file-size guard. Keep ERASABLE (type annotations / `as` only) like the rest
 * of the screenshot tooling, and import siblings with an explicit `.ts`.
 *
 * The elevator-schedule shots (27b/27c) prove the pin on the dialog the bug was
 * reported against. These two prove the same rule on ORDINARY dialogs, because
 * it applies to every dialog in the app:
 *
 *   - Help is the long one a player is most likely to be scrolling.
 *   - Settings is the one the rule is easiest to get wrong: it renders its
 *     build-id line AFTER the action row, so the footer is not the box's last
 *     child and a `:last-child`-only selector skips it in silence.
 *
 * Both are shot on a deliberately SHORT viewport. `.modal-box` caps at 82vh, so
 * a small window (or a phone held sideways) is exactly where the footer used to
 * fall below the fold. Both assert, before the shutter, that enough content is
 * still below the fold for the pin to be doing work and that the footer really
 * is inside the scrollport, so neither can quietly become a picture that proves
 * nothing.
 */
import { type Shot } from "../screenshot-env.ts";

/**
 * Short enough that both dialogs overflow their 82vh cap with room to spare.
 * Settings is what sets this number: it is the shorter of the two, and at 480px
 * tall it overflowed by 7px, which the assertions below correctly rejected as
 * proving nothing. At 360 the box is 295px and Settings overflows by ~106px, so
 * mid-scroll leaves ~53px below the fold against a 28px strip. Help has ~284px
 * of slack at the same size. Lower this further if a Settings row is ever
 * REMOVED; the assertions will say so rather than quietly shoot a flat dialog.
 */
const SHORT = { width: 720, height: 360 };

export const DIALOG_PIN_SHOTS: Shot[] = [
  {
    name: "02d-help-pinned",
    crop: "#modal .modal-box",
    keepDialogs: true,
    viewport: SHORT,
    // A per-shot viewport resize is draw-coupled; draw every settle frame.
    drawSettle: true,
    setup: async (page) => {
      await page.evaluate(() => document.getElementById("btn-help")?.click());
      await page.waitForSelector("#modal .help-modes", { timeout: 4000 });
      await page.evaluate(() => {
        const box = document.querySelector("#modal .modal-box") as HTMLElement | null;
        const strip = document.querySelector("#modal .modal-box > .modal-actions") as HTMLElement | null;
        if (!box || !strip) throw new Error("the Help dialog did not mount");
        box.scrollTop = Math.floor((box.scrollHeight - box.clientHeight) / 2);
        // Same floor as the schedule shots: enough content must remain below
        // the fold that an unpinned footer would be off screen here.
        const left = box.scrollHeight - box.clientHeight - box.scrollTop;
        if (left <= strip.offsetHeight) throw new Error("Help did not overflow enough for the pin to be doing anything");
        if (strip.getBoundingClientRect().bottom > box.getBoundingClientRect().bottom + 1) throw new Error("the Help footer is not pinned; this shot would prove nothing");
      });
    },
    wait: 300,
  },
  {
    name: "02e-settings-pinned",
    crop: "#modal .modal-box",
    keepDialogs: true,
    viewport: SHORT,
    drawSettle: true,
    setup: async (page) => {
      await page.evaluate(() => document.getElementById("btn-settings")?.click());
      await page.waitForSelector("#modal #vol-music", { timeout: 4000 });
      await page.evaluate(() => {
        const box = document.querySelector("#modal .modal-box") as HTMLElement | null;
        const strip = document.querySelector("#modal .modal-box > .modal-actions") as HTMLElement | null;
        if (!box || !strip) throw new Error("the Settings dialog did not mount");
        // The premise of the selector's second arm: something really does
        // follow the action row here.
        if (strip.nextElementSibling === null) throw new Error("Settings no longer renders anything after its action row; the shot has lost its subject");
        box.scrollTop = Math.floor((box.scrollHeight - box.clientHeight) / 2);
        const left = box.scrollHeight - box.clientHeight - box.scrollTop;
        if (left <= strip.offsetHeight) throw new Error("Settings did not overflow enough for the pin to be doing anything");
        if (strip.getBoundingClientRect().bottom > box.getBoundingClientRect().bottom + 1) throw new Error("the Settings footer is not pinned; this shot would prove nothing");
      });
    },
    wait: 300,
  },
  {
    // The dropped-report notice, which is the whole point of the modal
    // precedence work: a message raised while a dialog is up has exactly one
    // honest home, and it is inside the dialog the player is looking at. A
    // toast cannot carry it, because the `<dialog>` top layer paints over the
    // rail at any z-index, and this path is only ever reachable while a dialog
    // is on screen.
    //
    // Staged through the real seam rather than by poking the notice into the
    // DOM, so the shot fails if the routing stops working. The leash is broken
    // by a SECOND import arriving, which is the in-scope way to break it: the
    // alternative (another dialog displacing the blocked one) would have the
    // shot depict an emergency whose resolve is stranded, which is a separate
    // pre-existing wart and not something the gallery should bless.
    name: "02f-dropped-report-notice",
    crop: "#modal .modal-box",
    keepDialogs: true,
    setup: async (page) => {
      await page.evaluate(() => {
        const ui = (window as any).game.ui;
        const report = (towerName: string) => ({
          towerName,
          star: 3,
          money: 1_500_000,
          day: 3,
          floors: 5,
          basements: 1,
          unitsImported: 9,
          broughtOver: ["$1,500,000 in funds and your 3-star rating."],
          couldNotBring: ["Elevators were rebuilt from your floor layout."],
        });
        ui.showEventChoice("A fire has broken out!", "$20,000", () => {});
        ui.showImportReport(report("FIRST"), { onOpen: () => {} });
        ui.showImportReport(report("SECOND"), { onOpen: () => {} });
      });
      await page.waitForSelector("#modal .modal-notice", { timeout: 4000 });
      // Exactly one notice, carrying the RIGHT words. A bare selector wait
      // would rebaseline a duplicated or mis-worded notice without complaint.
      await page.evaluate(() => {
        const found = document.querySelectorAll("#modal .modal-notice");
        if (found.length !== 1) throw new Error(`expected one notice, found ${found.length}`);
        const text = found[0].textContent || "";
        if (!text.includes("dropped") || !text.includes("Try again")) throw new Error(`the notice lost its message: ${text}`);
      });
    },
    wait: 300,
  },
];
