/**
 * Each build category in the docked Tools window folds from its header: a
 * click (or Enter, or a Space press and release) on "COMMERCIAL" hides its
 * tools and shows them again. The folded categories are stored, so the window
 * comes back as the player left it. Folding happens where the headers show,
 * on the desktop and tablet layouts; a phone shows one category at a time on its tab bar and
 * hides the headers, and its CSS never hides a folded category's tools, so a
 * fold made on a desktop never empties a phone's tab. A fold shortens the
 * list, so the caller refits the window (two columns can drop back to one).
 * Storage that is missing or throws reads as "nothing folded" and a failed
 * write is dropped.
 */

import { isSpaceKey } from "../shared/inputEvents";

export const PALETTE_FOLDED_STORAGE_KEY = "vc-tools-folded-groups";

/** The class on a folded `.pal-group` section. */
export const PALETTE_FOLDED_CLASS = "pal-folded";

type Store = Pick<Storage, "getItem" | "setItem">;

/** The categories the player folded, by title. */
export function storedFoldedGroups(storage: Pick<Storage, "getItem"> | null): Set<string> {
  try {
    const raw = storage?.getItem(PALETTE_FOLDED_STORAGE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((t): t is string => typeof t === "string") : []);
  } catch {
    return new Set();
  }
}

function storeFoldedGroups(storage: Pick<Storage, "setItem"> | null, folded: Set<string>): void {
  try {
    storage?.setItem(PALETTE_FOLDED_STORAGE_KEY, JSON.stringify([...folded].sort()));
  } catch {
    // A full quota or a blocked origin: the fold still works for this visit.
  }
}

/** A category's header: the section's own title, never the Modern sub-band. */
function headerOf(section: HTMLElement): HTMLElement | null {
  return section.querySelector<HTMLElement>(":scope > .pal-group-title[data-group]:not(.pal-sub)");
}

function setFolded(section: HTMLElement, folded: boolean): void {
  section.classList.toggle(PALETTE_FOLDED_CLASS, folded);
  headerOf(section)?.setAttribute("aria-expanded", folded ? "false" : "true");
}

/**
 * Make every category header under `root` a fold control and show the stored
 * folds. Run after each palette build (a rebuild makes new sections).
 */
export function applySectionFolds(root: HTMLElement, storage: Pick<Storage, "getItem"> | null): void {
  const folded = storedFoldedGroups(storage);
  for (const section of root.querySelectorAll<HTMLElement>(".pal-group[data-group]")) {
    const header = headerOf(section);
    if (!header) continue;
    const title = section.dataset.group ?? "";
    header.tabIndex = 0;
    header.setAttribute("role", "button");
    header.setAttribute("aria-label", `${title} tools`);
    setFolded(section, folded.has(title));
  }
}

/**
 * Fold and open categories from their headers, with one listener on `root`
 * (the palette's item container, which outlives a rebuild). `onToggle` runs
 * after each fold or open so the window can refit.
 */
export function wireSectionFolds(root: HTMLElement, storage: Store | null, onToggle: () => void): void {
  const toggle = (header: HTMLElement) => {
    const section = header.closest<HTMLElement>(".pal-group[data-group]");
    if (!section || headerOf(section) !== header) return;
    const title = section.dataset.group ?? "";
    const folded = storedFoldedGroups(storage);
    const fold = !section.classList.contains(PALETTE_FOLDED_CLASS);
    if (fold) folded.add(title);
    else folded.delete(title);
    setFolded(section, fold);
    storeFoldedGroups(storage, folded);
    onToggle();
  };
  const headerAt = (target: EventTarget | null) =>
    target instanceof HTMLElement ? target.closest<HTMLElement>(".pal-group > .pal-group-title[data-group]:not(.pal-sub)") : null;
  root.addEventListener("click", (e) => {
    const header = headerAt(e.target);
    if (header) toggle(header);
  });
  // Native button keys, as the tools have them (uiPalette's makeActivatable):
  // Enter acts on the press, Space on the release, and a held key acts once.
  // Space waits for the release because the world reads a held Space as its
  // pan key: inputKeys cancels the release of a hold that panned, so a header
  // left focused by a click does not fold or open in the middle of a pan.
  let spacePressedOn: HTMLElement | null = null;
  const chord = (e: KeyboardEvent) => e.ctrlKey || e.metaKey || e.altKey;
  root.addEventListener("keydown", (e) => {
    const header = headerAt(e.target);
    if (!header) return;
    // A chord starts a system shortcut and drops a pending press.
    if (chord(e)) spacePressedOn = null;
    if (isSpaceKey(e)) {
      if (chord(e)) return;
      e.preventDefault(); // repeats too, or a held Space scrolls the list
      if (!e.repeat) spacePressedOn = header;
      return;
    }
    if (e.key === "Enter" && !e.repeat && !chord(e)) {
      e.preventDefault();
      toggle(header);
    }
  });
  root.addEventListener("keyup", (e) => {
    if (!isSpaceKey(e)) return;
    const header = headerAt(e.target);
    const pressedHere = header !== null && header === spacePressedOn;
    spacePressedOn = null;
    if (pressedHere && !chord(e) && !e.defaultPrevented) toggle(header);
  });
  root.addEventListener("focusout", () => {
    spacePressedOn = null;
  });
}
