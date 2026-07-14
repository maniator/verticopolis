import { html, nothing, type TemplateResult } from "lit-html";
import type { UpdateInfo } from "../../pwa";

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
 * and as stable test selectors; dispatch is via `@click`.
 */

/** The two actions the update prompt dispatches, bound inline in the template. */
export interface UpdatePromptActions {
  /** Keep playing: apply the update on the next reopen. */
  onLater: () => void;
  /** Update now: save the tower and reload onto the new build. */
  onUpdate: () => void;
}

export function updatePromptTemplate(
  info: UpdateInfo | null | undefined,
  actions: UpdatePromptActions,
): TemplateResult {
  const notes = (info?.notes ?? []).slice(0, 3);
  // Keep a real sha (it anchors a bug report to an exact build) but drop the
  // "unknown" placeholder a non-git build would stamp.
  const sha = info?.sha && info.sha !== "unknown" ? info.sha : undefined;
  const idText = [info?.version, sha].filter(Boolean).join(" · ");
  // The `.win-title.sm` strip is a GRANDCHILD of `.modal-box.win` (wrapped in
  // `.whatsnew`); a direct child would inherit the title bar's full-bleed treatment.
  const notesBlock = notes.length
    ? html`<div class="whatsnew"><h3 class="win-title sm">What's new</h3><ul>${notes.map((n) => html`<li>${n}</li>`)}</ul></div>`
    : nothing;
  const buildLine = idText ? html`<p class="build-id">Build ${idText}</p>` : nothing;
  return html`
      <h2>Update available</h2>
      <p>A newer version of Verticopolis is ready. Update now saves your tower and reloads onto it. You won't lose any progress.</p>
      <p>Or keep playing: it'll apply next time you reopen.</p>
      ${notesBlock}
      ${buildLine}
      <div class="modal-actions">
        <button class="btn" data-act="later" @click=${actions.onLater}>Later</button>
        <button class="btn primary" data-act="update" @click=${actions.onUpdate}>Update now</button>
      </div>
    `;
}
