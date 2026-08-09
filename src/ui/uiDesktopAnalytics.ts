import type { TemplateResult } from "lit-html";
import { desktopAnalyticsNoticeTemplate } from "./templates/desktopAnalytics";
import type { ModalOpts } from "./modalPrecedence";
import { startGameplaySession } from "../analytics";
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
  openModalTemplate(result: TemplateResult, opts?: ModalOpts): HTMLElement;
  closeModal(): void;
}

/**
 * Record the player's answer, and on a grant start the gameplay session that
 * boot could not.
 *
 * `bootstrap.ts` calls `startGameplaySession` once, well before the notice
 * resolves. On a first launch it meets a shut gate (consent is `pending`),
 * returns without attaching its `pagehide` and `visibilitychange` listeners, and
 * nothing ever re-runs it. The whole first session then reports no `session_end`,
 * no `session_fps`, no session-depth events, and no `session_emergencies`, and
 * the held queue cannot recover them because they were never emitted at all.
 * That is the acquisition session, which is the one this whole epic exists to
 * measure, so the grant path restarts it.
 *
 * It lives here rather than inside `setDesktopConsent` for two reasons. The
 * consent module sits BELOW analytics on purpose (it holds opaque thunks and
 * never learns the event vocabulary), and `analytics.ts` already reaches it
 * through `telemetry.ts`, so a call back the other way would close an import
 * cycle. And both consent surfaces live in this file, so one helper covers the
 * notice and the Settings switch alike: a player who declines at first run and
 * turns it on an hour later has exactly the same unarmed session.
 *
 * `startGameplaySession` is idempotent (it claims its wiring through
 * `GameplaySession.arm`), so a grant on an already-armed session is a no-op
 * rather than a second pair of listeners double-counting `session_end`. It runs
 * AFTER the answer is stored, because it re-reads the same gate the answer feeds.
 */
function recordDesktopConsent(state: DesktopConsentState): void {
  setDesktopConsent(state);
  if (state === "granted") startGameplaySession();
}

/**
 * Show the first-run notice, or do nothing.
 *
 * Nothing happens unless this is a desktop build whose consent is still
 * `pending`, so a browser session never sees it and a desktop player is asked
 * exactly once. Events emitted before the answer are not lost: they are held in
 * memory by `desktopConsent.ts` and flushed in order if the answer is yes.
 *
 * Every dismissal the PLAYER performs grants: the primary button, Esc, the
 * backdrop, and the title-bar x (which dispatches the same cancel event Esc
 * does). That is the ruling's default-on posture, and it is why "No thanks" is a
 * real button rather than a close affordance. The answer is recorded exactly
 * once through a shared `answer`, so a double dismissal cannot record twice or
 * flush twice.
 *
 * Those four are not the only ways the notice can leave the screen, and the
 * other two must not grant. A `dialog.close()` raised anywhere else in the app
 * fires `close`, NOT `cancel`, so it takes the notice away without reaching
 * `answer` at all; and a modal that displaces this one replaces the dialog's
 * contents outright. Neither is a player answering, so both leave the consent
 * `pending` and the next launch asks again, which is the direction that sends
 * nothing rather than the direction that assumes a yes.
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
    recordDesktopConsent(state);
  };
  // No `displaceable`, deliberately: this modal owns a pending decision, so it
  // takes the protective default and no arriving report may take the dialog.
  //
  // That default is a request, not a lock. `openModalTemplate` mounts whatever
  // it is handed, so an opener that never consults the precedence still lands on
  // top of the notice, and there is a live path: the emergency choice in
  // `frameLoop.ts` gates on `hasBlockingModal`, which reads two app flags and
  // not the dialog. `onDisplaced` is what makes that outcome deliberate rather
  // than silent. Latching `answered` is the load-bearing half: the notice's
  // handlers below are installed on the SHARED dialog, so without the latch a
  // player dismissing whatever took our place would record a "granted" for a
  // question they never got to read. Latched, the question simply dies with the
  // dialog and the next launch asks it again.
  const box = host.openModalTemplate(
    desktopAnalyticsNoticeTemplate({
      onAccept: () => answer("granted"),
      onDecline: () => answer("declined"),
    }),
    { onDisplaced: () => (answered = true) },
  );
  // Override the shared dialog's dismissal paths only once the notice is
  // verifiably the thing on screen. Both handlers below GRANT, so installing
  // them against a dialog the notice did not mount into would record consent for
  // a question that was never asked. `contains` is the check because it is the
  // mount itself: a refused or replaced open leaves the returned box outside the
  // dialog, since a replacement clears the dialog's children before mounting.
  if (!dialog.contains(box)) return;
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
 *
 * Turning it ON also starts the gameplay session, for the same reason the notice
 * does: a player who declined at first run has an unarmed session, and switching
 * back on mid-play would otherwise report the delta events and no summary at all
 * until the next launch. See {@link recordDesktopConsent}.
 */
export function wireDesktopAnalyticsToggle(box: HTMLElement, shown: boolean): void {
  if (!shown) return;
  const el = box.querySelector<HTMLInputElement>("#set-analytics")!;
  el.checked = desktopConsentState() === "granted";
  el.addEventListener("change", () => {
    const on = toggleDesktopAnalytics();
    el.checked = on;
    if (on) startGameplaySession();
  });
}
