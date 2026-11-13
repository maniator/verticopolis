/**
 * The desktop Tools window can fold into a thin strip and open again, from a
 * button on its title bar, to give the tower more room. The choice is stored,
 * so a player who folds it finds it folded next time. Only an explicit choice
 * is stored; the default is open. Phones, sideways phones and tablets lay the
 * palette out their own way, so the button and the folded look exist only on
 * the desktop layout (the rules in tools-stage.css sit under the same query as
 * the fit, `PALETTE_FIT_MQ`), and a stored fold never hides a phone's tools.
 * Storage that is missing or throws reads as "nothing stored" and a failed
 * write is dropped, so the page never breaks over a preference.
 */

import { PALETTE_FIT_MQ } from "./paletteFit";

export const PALETTE_COLLAPSED_STORAGE_KEY = "vc-tools-collapsed-desktop";

/** The stored values: an explicit fold and an explicit open. */
export const PALETTE_COLLAPSED_VALUE = { collapsed: "collapsed", open: "open" } as const;

/** The class on `#palette` while it is folded. */
export const PALETTE_COLLAPSED_CLASS = "pal-collapsed";

/** The fold button's id (Getting Started clicks it to open a folded window). */
export const PALETTE_COLLAPSE_BUTTON_ID = "btn-palette-collapse";

type Store = Pick<Storage, "getItem" | "setItem">;

/** Whether the player last folded the Tools window. */
export function storedPaletteCollapsed(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(PALETTE_COLLAPSED_STORAGE_KEY) === PALETTE_COLLAPSED_VALUE.collapsed;
  } catch {
    return false;
  }
}

function storePaletteCollapsed(storage: Pick<Storage, "setItem"> | null, collapsed: boolean): void {
  try {
    storage?.setItem(PALETTE_COLLAPSED_STORAGE_KEY, collapsed ? PALETTE_COLLAPSED_VALUE.collapsed : PALETTE_COLLAPSED_VALUE.open);
  } catch {
    // A full quota or a blocked origin: the fold still works for this visit.
  }
}

/** Show the Tools window folded or open, and label its button to match. */
export function setPaletteCollapsed(win: HTMLElement, button: HTMLButtonElement, collapsed: boolean): void {
  win.classList.toggle(PALETTE_COLLAPSED_CLASS, collapsed);
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  const label = collapsed ? "Show the Tools" : "Hide the Tools";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = collapsed ? "▸" : "◂"; // ▸ opens, ◂ folds
}

/**
 * Add the fold button to the Tools window's title bar and start the window as
 * the player last left it. `onToggle` runs after each fold or open, so the fit
 * can measure what the window now shows. Returns the button.
 */
export function wirePaletteCollapse(win: HTMLElement, storage: Store | null, onToggle: () => void): HTMLButtonElement | null {
  const bar = win.querySelector<HTMLElement>(":scope > .win-title");
  if (!bar) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn xs pal-collapse";
  button.id = PALETTE_COLLAPSE_BUTTON_ID;
  const list = win.querySelector<HTMLElement>(".palette-scroll");
  if (list?.id) button.setAttribute("aria-controls", list.id);
  bar.appendChild(button);
  setPaletteCollapsed(win, button, storedPaletteCollapsed(storage));
  button.addEventListener("click", () => {
    const collapsed = !win.classList.contains(PALETTE_COLLAPSED_CLASS);
    setPaletteCollapsed(win, button, collapsed);
    storePaletteCollapsed(storage, collapsed);
    onToggle();
  });
  return button;
}

/**
 * Open the Tools window when `tool` sits in it while it is folded, with the
 * window's own button (so the choice is stored and the list refits), so a
 * Getting Started pointer at the tool is in view. Only on the desktop layout,
 * the one the fold shows on. A folded category keeps a pointed-at tool
 * visible on its own, in CSS.
 */
export function openFoldedPaletteAround(tool: Element): void {
  if (!tool.closest(`#palette.${PALETTE_COLLAPSED_CLASS}`)) return;
  // The fold shows only on the desktop layout. On a tablet the window is open
  // whatever is stored, so a click here would only rewrite the desktop choice.
  if (typeof window.matchMedia !== "function" || !window.matchMedia(PALETTE_FIT_MQ).matches) return;
  document.getElementById(PALETTE_COLLAPSE_BUTTON_ID)?.click();
}
