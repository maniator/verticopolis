import { html, nothing, type TemplateResult } from "lit-html";
import type { ReleaseNotes } from "../../changelog";
import type { DiagnosticsReport } from "../../wasmhost/engineDiagnostics";
import { fromGameHref } from "../fromGame";
import { diagnosticsBlock } from "./diagnostics";
import { helpAboutBody, helpPrivacyBody } from "./helpContent";
import { releaseNotesLink } from "./updatePrompt";

/**
 * The in-game Help menu and the two small windows it opens (What's new,
 * About this game). The controller (src/ui/uiHelpMenu.ts) pauses the tower
 * while any of them is open and wires the actions by `data-act`; these
 * templates stay presentational.
 *
 * The game panel's About… opens this menu; its Help button opens the Help
 * site, the player's manual, in a new tab (src/ui/uiHelpMenu.ts showHelp). In
 * a browser tab Release notes opens the release notes page the same way,
 * marked `?from=game` so its "Back to game" closes that tab instead of loading
 * a second game (src/ui/fromGame.ts). In the installed app the release notes
 * are left out (What's new carries them).
 * Report a problem always links out to GitHub's issue chooser.
 */

/** The GitHub page that lets a player pick a bug report or an idea. */
export const REPORT_HREF = "https://github.com/maniator/verticopolis/issues/new/choose";

const NEW_TAB = html`<span class="visually-hidden"> (opens in a new tab)</span>`;

/** One menu row: the action and a short line saying what it opens. */
function item(action: TemplateResult, blurb: string): TemplateResult {
  return html`<li>${action}<span class="help-menu-blurb">${blurb}</span></li>`;
}

/** A row that opens a standalone page in a new tab. */
function pageLink(act: string, href: string, label: string): TemplateResult {
  return html`<a class="btn" data-act=${act} href=${href} target="_blank" rel="noopener noreferrer">${label}${NEW_TAB}</a>`;
}

/** A row that opens another in-game window. */
function windowButton(act: string, label: string): TemplateResult {
  return html`<button type="button" class="btn" data-act=${act}>${label}</button>`;
}

export function helpMenuTemplate(inBrowserTab: boolean): TemplateResult {
  return html`
    <h2>About</h2>
    <p class="help-menu-lede">The tower is paused while this is open.</p>
    <ul class="help-menu">
      ${item(windowButton("whats-new", "What's new"), "What changed in this version and the ones before it.")}
      ${inBrowserTab ? item(pageLink("release-notes", fromGameHref("/help/changelog"), "Release notes"), "Every update's changes, back to the first.") : nothing}
      ${item(
        html`<a class="btn" data-act="report" href=${REPORT_HREF} target="_blank" rel="noopener noreferrer">Report a problem<span class="visually-hidden"> (opens GitHub in a new tab)</span></a>`,
        "Report a bug or share an idea on GitHub.",
      )}
      ${item(windowButton("about", "About this game"), "The version, engine diagnostics, privacy, and Replay Getting Started.")}
    </ul>
    <div class="modal-actions"><button class="btn primary" data-act="close" autofocus>Close</button></div>
  `;
}

/**
 * This build's notes, newest first, each note whole, in the update prompt's
 * scrolling well. Baked into the build (src/whatsNewData.ts), so it works
 * offline. `showReleaseNotesLink` adds the link to every version's notes (left
 * out in the installed app, as in the update prompt).
 */
export function whatsNewTemplate(releases: readonly ReleaseNotes[], showReleaseNotesLink: boolean): TemplateResult {
  const body =
    releases.length === 0
      ? html`<p>This build has no release notes.</p>`
      : html`<div class="whatsnew"><div class="well whatsnew-log" tabindex="0" role="region" aria-label="Release notes for this version and earlier ones">${releases.map(
          (r) => html`<h4 class="whatsnew-ver">${r.version}</h4><ul>${r.notes.map((n) => html`<li>${n}</li>`)}</ul>`,
        )}</div></div>`;
  return html`
    <h2>What's new</h2>
    ${body}
    ${showReleaseNotesLink ? releaseNotesLink(releases[0]?.version) : nothing}
    <div class="modal-actions"><button class="btn primary" data-act="close" autofocus>Got it</button></div>
  `;
}

/** The actions About this game binds inline. */
export interface AboutActions {
  /** Replay the Getting Started onboarding (the button is disabled on the title screen). */
  onReplay: () => void;
}

/** The version, the engine diagnostics with Copy, the privacy promise and
 *  Replay Getting Started. */
export function aboutTemplate(onSplash: boolean, version: string, actions: AboutActions, engine = "", diagnostics?: DiagnosticsReport): TemplateResult {
  return html`
    <h2>About this game</h2>
    ${helpAboutBody(version, engine)}
    ${diagnostics ? diagnosticsBlock(diagnostics) : nothing}
    <details class="help-modes">
      <summary><span role="heading" aria-level="3">Privacy</span></summary>
      ${helpPrivacyBody()}
    </details>
    <div class="modal-actions"><button class="btn" data-act="replay-onboard" ?disabled=${onSplash} title=${onSplash ? "Start a tower first, then you can replay the intro." : nothing} @click=${actions.onReplay}>Replay Getting Started</button><button class="btn primary" data-act="close" autofocus>Got it</button></div>
  `;
}
