/**
 * The shared window grammar every modal is finished with: title-bar skinning,
 * the accessible-name wiring, the ✕, and the dismissal handlers. Extracted from
 * `UI` so that class stays under the file-size ceiling and so the grammar reads
 * as one thing rather than as a private method halfway down a 500-line class.
 */

/** Id stamped on the shared modal's title-TEXT span so `#modal` can point
 *  `aria-labelledby` at it. It lives on a span wrapping only the title text,
 *  never on the h2 itself: the h2 also holds the ✕ as a sibling, and labeling
 *  the h2 would fold the ✕'s accessible name ("Close") into the dialog's. The
 *  dialog's DOM is fully replaced on every open and only one modal is ever
 *  live, so this constant can never collide with itself. */
export const MODAL_TITLE_ID = "verticopolis-modal-title";

/** What the grammar needs from `UI`, passed in rather than reached for. */
export interface ModalDeps {
  titleBarClose(className: string, onClick: () => void): HTMLButtonElement;
  closeModal(): void;
  drainNotice(box: HTMLElement): void;
}

/** The grammar `UI.openModalTemplate` finishes every modal with: skin the
 *  top-level h2 as the title bar (`:scope > h2` so a nested h2 is never
 *  skinned), wrap its title text alone in a span carrying the shared
 *  {@link MODAL_TITLE_ID} and point the dialog's `aria-labelledby` at that SPAN
 *  (never at the h2 itself, since the h2 also ends up holding the ✕ below;
 *  labeling the h2 would fold the ✕'s own accessible name, "Close", into the
 *  announced title), show the dialog, then append the win-style ✕ into the h2
 *  as a sibling of the span so it stays excluded from the accessible name.
 *  Cleared when a modal renders no top-level h2, so the reference is never
 *  left dangling. The ✕ routes through the dialog's cancel path (same as Esc)
 *  rather than closeModal() directly, so modals that override oncancel to
 *  resolve a pending choice still resolve. It is appended AFTER showModal() so
 *  it is not the first focusable element (keyboard users land on the primary
 *  action, not the ✕). Backdrop click and Esc/cancel close. */
export function finishModal(dialog: HTMLDialogElement, box: HTMLElement, deps: ModalDeps): HTMLElement {
  const h2 = box.querySelector(":scope > h2");
  h2?.classList.add("win-title");
  if (h2) {
    // Move the title CONTENTS into their own span and label the dialog at
    // THAT span, not the h2 (see MODAL_TITLE_ID); a caller-supplied h2.id is
    // never touched. Idempotent: reuse an existing span rather than nesting
    // a new one, and never sweep the ✕ (.modal-x) into it, so a repeat call
    // can't nest spans or fold "Close" into the accessible name.
    let titleSpan = h2.querySelector<HTMLSpanElement>(`#${MODAL_TITLE_ID}`);
    if (!titleSpan) {
      titleSpan = document.createElement("span");
      titleSpan.id = MODAL_TITLE_ID;
      const close = h2.querySelector(".modal-x");
      while (h2.firstChild && h2.firstChild !== close) titleSpan.appendChild(h2.firstChild);
      h2.appendChild(titleSpan);
    }
    dialog.setAttribute("aria-labelledby", titleSpan.id);
  } else {
    dialog.removeAttribute("aria-labelledby");
  }
  if (!dialog.open) dialog.showModal();
  if (h2 && !h2.querySelector(".modal-x")) {
    h2.appendChild(
      deps.titleBarClose("modal-x btn xs", () => dialog.dispatchEvent(new Event("cancel", { cancelable: true }))),
    );
  }
  dialog.onclick = (e) => {
    if (e.target === dialog) deps.closeModal();
  };
  dialog.oncancel = () => deps.closeModal(); // Esc key
  deps.drainNotice(box); // a notice raised mid-build lands here
  return box;
}
