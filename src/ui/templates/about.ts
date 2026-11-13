import { html, nothing, type TemplateResult } from "lit-html";
import type { DiagnosticsReport } from "../../wasmhost/engineDiagnostics";
import { fromGameHref } from "../fromGame";
import { diagnosticsBlock } from "./diagnostics";
import { helpAboutBody } from "./helpContent";

/**
 * About this game, the window the game panel's About… opens: the version, the
 * engine diagnostics with Copy, a link to the privacy page, and Replay Getting
 * Started. The controller (src/ui/uiHelpMenu.ts) pauses the tower while it is
 * open and wires the actions by `data-act`; this template stays
 * presentational.
 *
 * Everything else a player might look for here lives on the Help site, which
 * the game panel's Help button opens in a new tab: the release notes, Report a
 * problem and the privacy page sit in its sidebar under More.
 */

/** The Help site's privacy page, marked `?from=game` so its "Back to game"
 *  closes that tab instead of loading a second game (src/ui/fromGame.ts). */
export const PRIVACY_HREF = fromGameHref("/help/privacy/");

/** The actions About this game binds inline. */
export interface AboutActions {
  /** Replay the Getting Started onboarding (the button is disabled on the title screen). */
  onReplay: () => void;
}

/** The version, the engine diagnostics with Copy, the privacy link and
 *  Replay Getting Started. */
export function aboutTemplate(onSplash: boolean, version: string, actions: AboutActions, engine = "", diagnostics?: DiagnosticsReport): TemplateResult {
  return html`
    <h2>About this game</h2>
    ${helpAboutBody(version, engine)}
    ${diagnostics ? diagnosticsBlock(diagnostics) : nothing}
    <p class="help-privacy"><a data-act="privacy" href=${PRIVACY_HREF} target="_blank" rel="noopener noreferrer">Privacy<span class="visually-hidden"> (opens in a new tab)</span></a>: what the game counts, what it never collects, and where your saves live.</p>
    <p class="help-privacy-status" role="status"></p>
    <div class="modal-actions"><button class="btn" data-act="replay-onboard" ?disabled=${onSplash} title=${onSplash ? "Start a tower first, then you can replay the intro." : nothing} @click=${actions.onReplay}>Replay Getting Started</button><button class="btn primary" data-act="close" autofocus>Got it</button></div>
  `;
}
