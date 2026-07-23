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

/** Which honest "add to your device" how-to a session gets when no native
 *  install sheet is available: the iOS Safari Share-sheet steps, or the generic
 *  browser-menu steps a not-standalone desktop/Android session sees before (or
 *  without) a captured `beforeinstallprompt`. The `browser` copy is deliberately
 *  browser-agnostic: the splash front door shows for any not-standalone session,
 *  so this variant is reached by browsers that install differently (Chrome/Edge
 *  menu) or may not install at all (Firefox, desktop Safari), and it must not
 *  promise a control a given browser lacks. */
export type InstallHelpVariant = "ios" | "browser";

/**
 * The "add Verticopolis to your device" how-to (SPEC-pwa-install CAP-3 / CAP-5).
 * Opened only when the player deliberately taps an install affordance and no
 * native install sheet is available, never auto-shown. The `ios` variant covers
 * iOS Safari (no beforeinstallprompt, no programmatic install); the `browser`
 * variant covers any other not-standalone session that reaches the splash install
 * button without a captured install event. Copy leads with the outcome, not the
 * mechanism; the word "PWA" never appears.
 */
export function installHelpTemplate(onClose: () => void, variant: InstallHelpVariant = "ios"): TemplateResult {
  const steps =
    variant === "ios"
      ? html`<p>In Safari, tap the <b>Share</b> button (the square with an arrow pointing up), then choose <b>Add to Home Screen</b>.</p>`
      : html`<p>Look for an <b>Install</b> or <b>Add to Home screen</b> option in your browser, usually in its main menu or the address bar. Not every browser offers it; if you don't see it yet, keep playing for a moment and try again.</p>`;
  return html`<h2>Add Verticopolis to your Home Screen</h2>
       <p>Play offline and fullscreen, and open it straight from your home screen with no browser bar.</p>
       ${steps}
       <div class="modal-actions"><button class="btn primary" data-act="close" @click=${onClose}>Got it</button></div>`;
}
