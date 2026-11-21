import type { DeskWindowId } from "@verticopolis/components/windows/desk/deskGeometry";
import type { DeskWindow } from "@verticopolis/components/windows/desk/deskWindow";
import { PALETTE_COLLAPSED_CLASS } from "../paletteCollapse";

/**
 * The desk hearing the game open and close its windows, rename the tower and
 * switch the sound (split out of deskController.ts), so the taskbar keeps in
 * step.
 *
 * Cost: one pass over the batch of changed attributes per mutation callback,
 * a find over the eight desk windows for each.
 */

/** What the desk does when the watched windows change. */
export interface DeskWatchHooks {
  /** A window the game just opened: bring it up in front. */
  readonly opened: (id: DeskWindowId) => void;
  /** A window just closed; the desk moves the focus on if it had it. */
  readonly closed: (win: DeskWindow) => void;
  /** Redraw the taskbar and the tower's title. */
  readonly refresh: () => void;
}

/** Watch `els` (the desk's windows), the tower's name and the sound switch. */
export function watchDeskWindows(
  doc: Document,
  els: ReadonlyArray<HTMLElement | null>,
  wins: ReadonlyMap<DeskWindowId, DeskWindow>,
  hooks: DeskWatchHooks,
): MutationObserver {
  const watcher = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type !== "attributes") continue;
      const target = r.target as HTMLElement;
      const id = [...wins].find(([, w]) => w.spec.el === target)?.[0];
      const w = id ? wins.get(id) : undefined;
      if (!id || !w) continue;
      // A window the game just opened comes up in front, unminimized.
      const justOpened =
        r.oldValue?.includes(PALETTE_COLLAPSED_CLASS) || (r.attributeName === "hidden" && r.oldValue !== null);
      if (w.spec.isOpen() && justOpened) hooks.opened(id);
      else if (!w.spec.isOpen()) hooks.closed(w);
    }
    hooks.refresh();
  });
  for (const el of els)
    if (el) watcher.observe(el, { attributes: true, attributeFilter: ["hidden", "class"], attributeOldValue: true });
  const name = doc.getElementById("sb-tower");
  if (name) watcher.observe(name, { childList: true, characterData: true, subtree: true });
  const sound = doc.getElementById("mb-sound");
  if (sound) watcher.observe(sound, { attributes: true, attributeFilter: ["aria-checked"] });
  return watcher;
}
