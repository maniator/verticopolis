import { html, type TemplateResult } from "lit-html";
import { iconTemplate, messageWithIcons } from "../icons";

/**
 * The emergency event-choice dialog (a fire, a bomb threat, etc.): a message, the
 * cost to accept, and Accept / Decline. Authored to match `eventChoiceHtml`
 * structurally (proven by transitional guards, retired with the string builders), including
 * the whitespace between the two action buttons. The actions are bound inline via
 * `@click`; the controller (`showEventChoice`) owns the resolve-exactly-once
 * logic and the Esc/backdrop/x decline paths, so this template stays presentational.
 * There is no `data-act="close"` button; the title-bar x closes via the cancel path.
 *
 * `message`/`costLabel` are TRUSTED PLAIN TEXT (developer copy from the event
 * system, e.g. "A fire has broken out!" / "$50,000") and are auto-escaped by lit,
 * so passing pre-escaped or HTML-marked-up copy would now render literally. The
 * `data-act` attributes are retained only for structural parity with the legacy
 * string and as stable test selectors; dispatch is via `@click`, not a
 * `wireActions`/`[data-act]` pass.
 */

/** The two actions the emergency dialog dispatches, bound inline in the template. */
export interface EventChoiceActions {
  /** The primary action (pay the cost): resolves the choice as "accept". */
  onAccept: () => void;
  /** The secondary action (decline): resolves the choice as "decline". */
  onDecline: () => void;
}

export function eventChoiceTemplate(
  message: string,
  costLabel: string,
  actions: EventChoiceActions,
): TemplateResult {
  return html`
      <h2>${iconTemplate("warning", { size: 16 })}Emergency</h2>
      <p>${messageWithIcons(message)}</p>
      <div class="modal-actions">
        <button class="btn primary" data-act="accept" @click=${actions.onAccept}>Pay ${costLabel}</button>
        <button class="btn" data-act="decline" @click=${actions.onDecline}>Decline</button>
      </div>
    `;
}
