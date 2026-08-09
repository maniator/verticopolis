import type { TemplateResult } from "lit-html";
import { desktopAnalyticsNoticeTemplate } from "./templates/desktopAnalytics";
import {
  desktopConsentState,
  setDesktopConsent,
  toggleDesktopAnalytics,
  type DesktopConsentState,
} from "../desktopConsent";

/**
 * The two desktop consent surfaces: the first-run notice and the Settings
 * switch (issue #781).
 *
 * They live together because they answer the same question and write the same
 * value, and they live OUTSIDE `uiDialogs.ts` because that file sits at the
 * readable-size ceiling; `uiSettings.ts` calls the toggle wiring and the boot
 * flow calls the notice.
 *
 * Neither surface reports anything about itself. There is deliberately no
 * `app_action` for answering the notice or flipping the switch: an event
 * recording that a player turned analytics off is the one event that must not be
 * sent, and an event recording that they left it on would be a count of the
 * consent decision rather than of the game.
 */

/**
 * The slice of `UI` these surfaces touch, expressed structurally so this module
 * imports no UI value and stays trivially testable: a fake with three members
 * drives the whole notice. `UI` satisfies it as written.
 */
export interface DesktopConsentHost {
  /** The shared `<dialog id="modal">`, needed to override its dismissal paths. */
  el: { modal: HTMLElement };
  openModalTemplate(result: TemplateResult): HTMLElement;
  closeModal(): void;
}

/**
 * Show the first-run notice, or do nothing.
 *
 * Nothing happens unless this is a desktop build whose consent is still
 * `pending`, so a browser session never sees it and a desktop player is asked
 * exactly once. Events emitted before the answer are not lost: they are held in
 * memory by `desktopConsent.ts` and flushed in order if the answer is yes.
 *
 * Every dismissal path GRANTS: the primary button, Esc, the backdrop, and the
 * title-bar x (which dispatches the same cancel event Esc does). That is the
 * ruling's default-on posture, and it is why "No thanks" is a real button rather
 * than a close affordance. The answer is recorded exactly once through a shared
 * `answer`, so a double dismissal cannot record twice or flush twice.
 *
 * `mode` is a parameter with the live build mode as its default, for the same
 * reason the rest of this epic takes one: under vitest `import.meta.env.MODE` is
 * always `"test"`, so a live-read-only version could never be shown to open at
 * all.
 */
export function showDesktopAnalyticsNotice(host: DesktopConsentHost, mode: string = import.meta.env.MODE): void {
  if (mode !== "desktop") return;
  if (desktopConsentState() !== "pending") return;
  const dialog = host.el.modal as HTMLDialogElement;
  let answered = false;
  const answer = (state: DesktopConsentState): void => {
    if (answered) return;
    answered = true;
    // Close first, then record: settling the consent flushes the held events,
    // and there is no reason for that work to run behind an open dialog.
    host.closeModal();
    setDesktopConsent(state);
  };
  // No `displaceable`, deliberately. This modal owns a pending decision, so it
  // takes the protective default: another dialog must not shove it aside with
  // the question unanswered.
  host.openModalTemplate(
    desktopAnalyticsNoticeTemplate({
      onAccept: () => answer("granted"),
      onDecline: () => answer("declined"),
    }),
  );
  dialog.onclick = (e) => {
    if (e.target === dialog) answer("granted");
  };
  dialog.oncancel = () => answer("granted"); // Esc and the title-bar x
}

/**
 * Wire the Settings privacy switch, on the builds that render it.
 *
 * The same shape as the presentation toggles beside it: show the LIVE state on
 * open, and after every flip re-read what the toggle callback RETURNED rather
 * than trusting the checkbox's own DOM state, so a refused write can never leave
 * the switch describing something that is not true.
 *
 * `shown` is the same flag the template was built with, so the lookup below can
 * stay loud (a template typo throws at open) while a build that renders no row
 * looks for nothing, matching the Modern-only bridging toggle.
 */
export function wireDesktopAnalyticsToggle(box: HTMLElement, shown: boolean): void {
  if (!shown) return;
  const el = box.querySelector<HTMLInputElement>("#set-analytics")!;
  el.checked = desktopConsentState() === "granted";
  el.addEventListener("change", () => (el.checked = toggleDesktopAnalytics()));
}
