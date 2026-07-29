/**
 * Who gets the shared `<dialog>`, and what happens to whoever is waiting.
 *
 * One dialog element serves the whole app, so a surface that opens
 * asynchronously (a fidelity report, which lands whenever `FileReader`
 * finishes) can arrive to find the dialog already taken. The old rule was "is a
 * modal open", which conflated two different questions and refused perfectly
 * safe openings, then reported the refusal with a toast: a `<dialog>` renders in
 * the browser's top layer and paints over the toast rail at any z-index, so that
 * message could only ever fire when something was guaranteed to be covering it
 * (GH #658). Its whole content was what-to-do-next, delivered where nobody
 * could read it, and the cost was a discarded tower.
 *
 * The split this module owns:
 *
 *   - **Displaceable.** The dialog owns no pending decision and no unsaved
 *     work, so an arriving report may simply take the dialog.
 *   - **Protected.** Everything else. Classification FAILS SAFE: protected
 *     unless an opener says otherwise, so a dialog added later defaults to
 *     protected and the cost of forgetting is an unnecessary wait rather than
 *     lost player work.
 *
 * A report that finds a protected dialog waits on a leash tied to THAT dialog
 * resolving, never open ended: it closes over a fully parsed tower, and a wait
 * held across a tower swap or a second import would eventually adopt the wrong
 * tower or ambush a player who has moved on. When the leash breaks, the parsed
 * tower is dropped and the player is told so somewhere they can actually see.
 */

/** Per-open modal declarations. `displaceable` is the only one, and only as an
 *  opt-in, so omitting it is the protective choice. */
export interface ModalOpts {
  /** This dialog owns no pending decision and no unsaved work, so a report
   *  arriving behind it may replace it outright. Informational dialogs only. */
  displaceable?: boolean;
}

/** A wait for one specific dialog to resolve. */
/** Why a wait ended without the dialog it was tied to resolving. */
export type BrokenReason = "displaced" | "superseded";

interface Leash {
  onResolve: () => void;
  onBroken: (reason: BrokenReason) => void;
}

export class ModalPrecedence {
  /** Whether the dialog on screen declared itself displaceable. Reset on every
   *  open and every close, so it can never outlive the dialog that set it. */
  private displaceable = false;
  /** The single pending wait. One at a time: a second waiter breaks the first
   *  rather than queueing, since two parsed towers racing for one dialog is the
   *  ambush this design exists to prevent. */
  private leash: Leash | null = null;
  /** A line to mount into the next dialog, set when something must be said
   *  while the shared dialog is mid-replace and has no body to write into. */
  private pendingNotice: string | null = null;

  /** A dialog is mounting. `displacing` is whether one was already on screen. */
  opening(displacing: boolean, opts: ModalOpts): void {
    if (displacing) this.breakLeash("displaced");
    this.displaceable = opts.displaceable === true;
  }

  /** A dialog closed. `wasOpen` is whether one actually was: `closeModal()` is
   *  idempotent and several handlers call it defensively, and a stray call with
   *  nothing on screen must not fire a waiting report at an arbitrary moment.
   *
   *  The leash is taken BEFORE its callback runs, because that callback
   *  typically opens the report, and a leash still in place would then read as
   *  broken by its own waiter. A held notice is dropped here too: it was meant
   *  for a dialog that no longer exists, and carrying it forward would stamp it
   *  into an unrelated window opened later. */
  closed(wasOpen: boolean): void {
    this.displaceable = false;
    this.pendingNotice = null;
    if (!wasOpen) return;
    const leash = this.leash;
    this.leash = null;
    leash?.onResolve();
  }

  /** True when the dialog on screen owns something worth protecting. */
  ownsPendingWork(isOpen: boolean): boolean {
    return isOpen && !this.displaceable;
  }

  /** Wait for the current dialog to resolve; `onBroken` runs if it never does,
   *  and is told WHY so the player is not given a reason that did not happen. */
  wait(onResolve: () => void, onBroken: (reason: BrokenReason) => void): void {
    this.breakLeash("superseded");
    this.leash = { onResolve, onBroken };
  }

  /** Hold a line for the next dialog to mount. */
  deferNotice(text: string): void {
    this.pendingNotice = text;
  }

  /** Mount any held line into a dialog body that has just been built. */
  drainNotice(box: HTMLElement): void {
    const notice = this.pendingNotice;
    this.pendingNotice = null;
    if (notice) mountNotice(box, notice);
  }

  private breakLeash(reason: BrokenReason): void {
    const leash = this.leash;
    this.leash = null;
    leash?.onBroken(reason);
  }
}

/** Route a line to wherever the player can actually read it right now.
 *
 *  A toast cannot carry a message raised while a dialog is up: the `<dialog>`
 *  top layer paints over the rail at any z-index, which is the defect itself.
 *  So it goes into the live dialog body, or is held for the next one to mount
 *  when the shared dialog is mid-replace and has no body, and only falls back
 *  to the caller's toast when nothing is on screen and a toast is visible. */
export function routeNotice(
  dialog: HTMLDialogElement,
  precedence: ModalPrecedence,
  text: string,
  toast: (text: string) => void,
): void {
  if (!dialog.open) {
    toast(text);
    return;
  }
  const box = dialog.querySelector(".modal-box");
  if (box) mountNotice(box as HTMLElement, text);
  else precedence.deferNotice(text);
}

/** Put a notice at the top of a dialog body, under the title bar where the eye
 *  lands first. `role="alert"` so it is announced as well as shown. */
export function mountNotice(box: HTMLElement, text: string): void {
  // One notice per body: a second would stack under the first and the two can
  // disagree, which is worse than either alone.
  box.querySelector(":scope > .modal-notice")?.remove();
  const p = document.createElement("p");
  p.className = "modal-notice";
  p.setAttribute("role", "alert");
  p.textContent = text;
  const title = box.querySelector(":scope > h2");
  if (title) title.after(p);
  else box.prepend(p);
}
