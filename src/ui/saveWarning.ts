import { SAVE_WARNING_TITLE } from "../storage/saveFailureCopy";

/** The id of the notice, so a second failure rewords it instead of stacking. */
export const SAVE_WARNING_ID = "save-warning";

/**
 * Put up (or reword) the notice that stays on the toast rail while saving is
 * not working. It looks like a failure toast but does not fade: it holds the
 * likely causes, an Export button and Dismiss. The toast cap never prunes it
 * (see `toast` in ./uiStatus). Built from text nodes, so nothing in `text`
 * is read as markup.
 */
export function showSaveWarning(rail: HTMLElement, text: string, onExport: () => void): void {
  let box = rail.querySelector<HTMLElement>(`#${SAVE_WARNING_ID}`);
  if (!box) {
    box = document.createElement("div");
    box.id = SAVE_WARNING_ID;
    box.className = "toast bad toast--sticky save-warning";
    box.setAttribute("role", "alert");
    const title = document.createElement("strong");
    title.className = "save-warning-title";
    title.textContent = SAVE_WARNING_TITLE;
    const body = document.createElement("p");
    body.className = "save-warning-text";
    const actions = document.createElement("div");
    actions.className = "save-warning-actions";
    actions.append(button("Export tower…", "export", onExport), button("Dismiss", "dismiss", () => clearSaveWarning(rail)));
    box.append(title, body, actions);
    // First on the rail, so the toasts that come and go stack under it.
    rail.prepend(box);
  }
  const body = box.querySelector<HTMLElement>(".save-warning-text");
  if (body) body.textContent = text;
}

/** Take the notice down, if it is up. */
export function clearSaveWarning(rail: HTMLElement): void {
  rail.querySelector(`#${SAVE_WARNING_ID}`)?.remove();
}

function button(label: string, act: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn";
  b.dataset.act = act;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}
