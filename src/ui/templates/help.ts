import { html, nothing, type TemplateResult } from "lit-html";
import { HELP_SECTIONS, helpLede, helpAboutBody, helpPrivacyBody, helpReportBlock } from "./helpContent";

/**
 * The How-to-play / Help dialog. Organized so it opens SHORT: a lead and the
 * mouse-controls line stay visible, then the body is a stack of collapsible
 * `<details class="help-modes">` sections following one rule (essentials open,
 * reference-or-optional collapsed). "The basics" is the only section `open` on
 * first paint; "Going further", "Keyboard play", "Classic vs Modern", and
 * "About" are collapsed.
 *
 * The section bodies come from the shared `./helpContent` module (`HELP_SECTIONS`,
 * `helpLede`, `helpAboutBody`, `helpReportBlock`), the single source this dialog
 * and the standalone `/help` page both render, so the guide copy cannot drift
 * between them. This dialog wraps each section in a `<details>`; the page renders
 * the same sections expanded. Only the Classic vs Modern section additionally
 * gets the "Open full help page" link here (it deep-links to
 * `/help#classic-vs-modern`); the page itself is that destination. The external report link (with `rel="noopener
 * noreferrer"` and its visually-hidden "opens GitHub in a new tab" span, routed
 * through the platform wrapper by the controller) stays out in the open as a
 * call to action, between the collapsible sections and the About section. Each
 * summary carries a `role="heading"` span so screen-reader heading navigation
 * still reaches every section. The Replay button is
 * disabled (and gains an explaining `title`) while the title screen is up; the
 * primary "Got it" carries `autofocus` so focus lands on it rather than the
 * report link.
 *
 * Only the app `version` is interpolated (auto-escaped by lit); the body is
 * trusted static copy. The Replay action binds inline via `@click`; it is bound
 * unconditionally because the two real backstops make a splash-time trigger a
 * no-op regardless: a real browser suppresses click events on a `disabled`
 * button, and `onReplayOnboarding` itself no-ops while the splash is up. (A
 * synthetic `click()` in a test harness can still reach the handler, so the
 * guarantee is behavioral, not structural.) The controller (`showHelp`) wires
 * the plain Close and routes the report link.
 */
export interface HelpActions {
  /** Replay the Getting Started onboarding (no-op behind the splash, and the button is disabled there). */
  onReplay: () => void;
}

export function helpTemplate(onSplash: boolean, version: string, actions: HelpActions): TemplateResult {
  return html`
      <h2>How to play</h2>
      ${helpLede()}
      ${HELP_SECTIONS.map(
        (s, i) => html`
      <details class="help-modes" ?open=${i === 0}>
        <summary><span role="heading" aria-level="3">${s.title}</span></summary>
        ${s.body()}
        ${s.id === "classic-vs-modern"
          ? html`<p class="help-fullpage"><a class="btn" href="/help#classic-vs-modern" target="_blank" rel="noopener noreferrer" data-act="open-help">Open the full help page<span class="visually-hidden"> (opens in a new tab)</span></a></p>`
          : nothing}
      </details>`,
      )}
      ${helpReportBlock()}
      <details class="help-modes">
        <summary><span role="heading" aria-level="3">About</span></summary>
        ${helpAboutBody(version)}
      </details>
      <details class="help-modes">
        <summary><span role="heading" aria-level="3">Privacy</span></summary>
        ${helpPrivacyBody()}
      </details>
      <div class="modal-actions"><button class="btn" data-act="replay-onboard" ?disabled=${onSplash} title=${onSplash ? "Start a tower first, then you can replay the intro." : nothing} @click=${actions.onReplay}>Replay Getting Started</button><button class="btn primary" data-act="close" autofocus>Got it</button></div>
    `;
}
