import { html, nothing, type TemplateResult } from "lit-html";
import type { UpdateInfo } from "../../pwa";
import { SHORT_NOTES } from "../../pwaUpdateInfo";
import { fromGameHref } from "../fromGame";

/**
 * The "a new build is ready" prompt. Authored to match `updatePromptHtml`
 * structurally (proven by transitional guards, retired with the string builders), including
 * the optional "What's new" notes block and the build-id line, and the whitespace
 * between the two action buttons. The actions bind inline via `@click`; the
 * controller (`showUpdatePrompt`) owns the resolve-exactly-once logic, the
 * async fire-and-forget containment, and the Esc/backdrop/x "Later" paths, so this
 * template stays presentational. There is no `data-act="close"` button; the
 * title-bar x closes via the cancel path (which the controller maps to "Later").
 *
 * `notes`/`version`/`sha` come from `version.json` (see src/pwa.ts) and are
 * auto-escaped by lit; the notes list uses nested `html` sub-templates, never
 * string interpolation. The `data-act` attributes are kept for structural parity
 * and as stable test selectors; dispatch is via `@click`. Later carries
 * `autofocus` so the dialog opens on it, as it did before the scrolling notes
 * log (skipped versions, #1897, or a release with more than three notes)
 * became the first focusable element: opening the prompt never lands focus
 * inside the notes.
 */

/** The two actions the update prompt dispatches, bound inline in the template. */
export interface UpdatePromptActions {
  /** Keep playing: apply the update on the next reopen. */
  onLater: () => void;
  /** Update now: save the tower and reload onto the new build. */
  onUpdate: () => void;
}

const KIND_LABEL = { game: "Game update", engine: "Engine update", both: "Game and engine update" } as const;

/**
 * The notes of every version the player skipped (#1897), newest first, in a
 * well that scrolls on its own once it is taller than its cap, so a long log
 * never pushes the actions away. `undefined` when there is only the incoming
 * version's notes to show (see {@link incomingNotes}). Shown when
 * two or more versions are unseen, or one that is not the incoming build (an
 * incoming build with no notes of its own).
 */
function skippedLog(info: UpdateInfo | null | undefined): TemplateResult | undefined {
  const releases = info?.releases ?? [];
  const several = releases.length >= 2 || (releases.length === 1 && releases[0].version !== info?.version);
  if (!several) return undefined;
  const title = info?.since ? `What's new since ${info.since}` : "What's new";
  return html`<div class="whatsnew"><h3 class="win-title sm" id="whatsnew-title">${title}</h3><div
      class="well whatsnew-log"
      tabindex="0"
      role="region"
      aria-labelledby="whatsnew-title"
    >${releases.map((r) => html`<h4 class="whatsnew-ver">${r.version}</h4><ul>${r.notes.map((n) => html`<li>${n}</li>`)}</ul>`)}${info?.more
      ? html`<p class="whatsnew-more">Earlier updates are not listed here.</p>`
      : nothing}</div></div>`;
}

/**
 * The incoming version's own notes: a short list when there are at most
 * {@link SHORT_NOTES}, and every note, whole, in the same scrolling well as
 * {@link skippedLog} when there are more, so a long release never pushes the
 * actions away.
 */
function incomingNotes(notes: readonly string[]): TemplateResult | typeof nothing {
  if (notes.length === 0) return nothing;
  const list = html`<ul>${notes.map((n) => html`<li>${n}</li>`)}</ul>`;
  if (notes.length <= SHORT_NOTES) return html`<div class="whatsnew"><h3 class="win-title sm">What's new</h3>${list}</div>`;
  return html`<div class="whatsnew"><h3 class="win-title sm" id="whatsnew-title">What's new</h3><div
      class="well whatsnew-log"
      tabindex="0"
      role="region"
      aria-labelledby="whatsnew-title"
    >${list}</div></div>`;
}

/** Presentation choices the controller makes for the update prompt. */
export interface UpdatePromptOptions {
  /** Show the "All release notes" link under the notes. The controller turns it
   *  off in the installed app, where a new tab leaves the app for the browser. */
  releaseNotesLink?: boolean;
}

/** The release notes page, at the incoming version's section when there is
 *  one. `from=game` tells the page a running game opened it, so its "Back to
 *  game" closes the tab instead of loading a second game (src/ui/fromGame.ts). */
export function releaseNotesHref(version: string | undefined): string {
  return fromGameHref(version ? `/help/changelog#${encodeURIComponent(version)}` : "/help/changelog");
}

/** The "All release notes" link: opens the release notes page in a new tab,
 *  so the prompt (and the tower behind it) stay where they are. */
export function releaseNotesLink(version: string | undefined): TemplateResult {
  return html`<p class="whatsnew-all"><a href=${releaseNotesHref(version)} target="_blank" rel="noopener noreferrer" data-act="release-notes">All release notes<span class="visually-hidden"> (opens in a new tab)</span></a></p>`;
}

export function updatePromptTemplate(
  info: UpdateInfo | null | undefined,
  actions: UpdatePromptActions,
  options: UpdatePromptOptions = {},
): TemplateResult {
  const notes = info?.notes ?? [];
  // Keep a real sha (it anchors a bug report to an exact build) but drop the
  // "unknown" placeholder a non-git build would stamp.
  const sha = info?.sha && info.sha !== "unknown" ? info.sha : undefined;
  const idText = [info?.version, sha].filter(Boolean).join(" · ");
  // The `.win-title.sm` strip is a GRANDCHILD of `.modal-box.win` (wrapped in
  // `.whatsnew`); a direct child would inherit the title bar's full-bleed treatment.
  const notesBlock = skippedLog(info) ?? incomingNotes(notes);
  const buildLine = idText ? html`<p class="build-id">Build ${idText}</p>` : nothing;
  const kind = info?.kind ? html`<p class="update-kind"><strong>${KIND_LABEL[info.kind]}</strong></p>` : nothing;
  const engineLine = info?.engineLine ? html`<p class="build-id">${info.engineLine}</p>` : nothing;
  return html`
      <h2>Update available</h2>
      ${kind}
      <p>A newer version of Verticopolis is ready. Update now saves your tower and reloads onto it. You won't lose any progress.</p>
      <p>Or keep playing: it'll apply next time you reopen.</p>
      ${notesBlock}
      ${notesBlock !== nothing && options.releaseNotesLink ? releaseNotesLink(info?.version) : nothing}
      ${engineLine}
      ${buildLine}
      <div class="modal-actions">
        <button class="btn" data-act="later" autofocus @click=${actions.onLater}>Later</button>
        <button class="btn primary" data-act="update" @click=${actions.onUpdate}>Update now</button>
      </div>
    `;
}
