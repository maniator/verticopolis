import { html, type TemplateResult } from "lit-html";

/**
 * lit-html templates for the UI dialogs, the declarative replacement for the
 * retired string builders (see the plan of record,
 * `_bmad-output/planning-artifacts/design/ui-rendering-engine-2026-07-14/`).
 * Unlike the string builders, a template binds its actions inline with `@click`,
 * so the dialog controller no longer needs a separate `wireActions` pass. lit
 * auto-escapes every interpolation, so no `escapeHtml` call is needed and
 * `unsafeHTML` is never used.
 *
 * `confirmModal` is the E0 proof: the smallest dialog that still exercises inline
 * callback dispatch (the `onYes` path) and the no-close-button case.
 */

/** The two actions a confirm dialog dispatches, bound inline in the template. */
export interface ConfirmActions {
  /** The primary action (Confirm): the controller closes the modal, then runs the caller's `onYes`. */
  onYes: () => void;
  /** The secondary action (Cancel): the controller closes the modal. */
  onCancel: () => void;
}

/**
 * The generic confirm modal body, authored to match `confirmHtml` structurally
 * (proven by transitional guards, retired with the string builders): an `h2` title, a `p`
 * body, and a `.modal-actions` row with the Cancel (`data-act="no"`) and primary
 * Confirm (`data-act="yes"`) buttons, adjacent with no space between them. The
 * `title`/`body`/`yesLabel` are trusted developer copy and are auto-escaped by
 * lit. There is deliberately no `data-act="close"` button; the title-bar x closes
 * through the dialog's cancel path.
 */
export function confirmTemplate(
  title: string,
  body: string,
  yesLabel: string,
  actions: ConfirmActions,
): TemplateResult {
  return html`<h2>${title}</h2><p>${body}</p>
       <div class="modal-actions"><button class="btn" data-act="no" @click=${actions.onCancel}>Cancel</button><button class="btn primary" data-act="yes" @click=${actions.onYes}>${yesLabel}</button></div>`;
}
