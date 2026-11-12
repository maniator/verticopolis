import { html, type TemplateResult } from "lit-html";
import * as classicVsModern from "../../../help-site/src/content/docs/classic-vs-modern.md";

/**
 * The Classic vs Modern comparison body. Its copy is the Help site's Classic vs
 * Modern page (`help-site/src/content/docs/classic-vs-modern.md`), compiled at
 * build time. It is rendered by the Help dialog (inside its "Classic vs Modern"
 * section), by the in-game Compare modal, by the founding screen, and by
 * the standalone `/help` page (`helpPage.ts`), so the copy has one home and
 * cannot drift (it had drifted twice before this extraction). This exports the
 * BODY only, the intro paragraph, the divergence list, and the "pixel-faithful
 * to 1994" closer, with no `<details>`/`<summary>` or `<h2>` wrapper; each caller
 * supplies its own.
 *
 * The drift guard in `src/ui/templates/help.test.ts` (the `RULE_TO_HELP` map and
 * the copy-sync check) inspects the Help "Classic vs Modern" section, which
 * renders this template, so a new Modern divergence still has to be classified
 * there before it can ship. Keep this copy verbatim with what that guard expects.
 */
export function compareTemplate(): TemplateResult {
  return html`<div class="help-md">${classicVsModern.body()}</div>`;
}

/**
 * The in-game Compare modal body: the shared {@link compareTemplate} under an
 * `<h2>` title bar, with a plain "Got it" close. Opened by `uiDialogs.showCompare`
 * through the single `#modal`, so it inherits the standard close/Esc/backdrop
 * grammar. The controller pauses the tower on open and restores the prior speed
 * on close, so reading the reference never costs the player elevator time.
 */
export function compareModalTemplate(): TemplateResult {
  return html`
      <h2>Classic vs Modern</h2>
      ${compareTemplate()}
      <div class="modal-actions"><button class="btn primary" data-act="close" autofocus>Got it</button></div>
    `;
}
