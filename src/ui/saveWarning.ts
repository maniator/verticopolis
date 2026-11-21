import { html, type TemplateResult } from "lit-html";
import { renderDetached, type Detached } from "@verticopolis/components/windows/detached";
import { SAVE_WARNING_TITLE } from "../storage/saveFailureCopy";

/** The id of the notice, so a second failure rewords it instead of stacking. */
export const SAVE_WARNING_ID = "save-warning";

/** The notice up on each rail, kept to reword it. */
const shown = new WeakMap<HTMLElement, Detached>();

function noticeTemplate(text: string, onExport: () => void, onDismiss: () => void): TemplateResult {
  return html`<div id=${SAVE_WARNING_ID} class="toast bad toast--sticky save-warning" role="alert"
    ><strong class="save-warning-title">${SAVE_WARNING_TITLE}</strong><p class="save-warning-text">${text}</p
    ><div class="save-warning-actions"
      ><button type="button" class="btn" data-act="export" @click=${onExport}>Save As…</button
      ><button type="button" class="btn" data-act="dismiss" @click=${onDismiss}>Dismiss</button></div
    ></div
  >`;
}

/**
 * Put up (or reword) the notice that stays on the toast rail while saving is
 * not working. It looks like a failure toast but does not fade: it holds the
 * likely causes, a Save As… button and Dismiss. The toast cap never prunes it
 * (see `toast` in ./uiStatus). lit keeps `text` as text, so nothing in it is
 * read as markup.
 */
export function showSaveWarning(rail: HTMLElement, text: string, onExport: () => void): void {
  const template = noticeTemplate(text, onExport, () => clearSaveWarning(rail));
  const up = shown.get(rail);
  if (up && up.elements[0].parentNode === rail) {
    up.update(template);
    return;
  }
  const drawn = renderDetached(rail.ownerDocument, template);
  shown.set(rail, drawn);
  // First on the rail, so the toasts that come and go stack under it.
  rail.prepend(...drawn.elements);
}

/** Take the notice down, if it is up. */
export function clearSaveWarning(rail: HTMLElement): void {
  shown.get(rail)?.elements[0].remove();
  shown.delete(rail);
}
