import type { GameApp } from "../main";
import { SaveGame, type SlotInfo } from "../storage/SaveGame";
import { slotName } from "../ui/templates/saves";
import { loadFromSplash } from "./appModals";
import { isSplashUp } from "./interactionState";
import { welcomeFounder } from "./titleScreen";

/** The File > Load submenu's items: one per save (`data-load-slot`), plus the
 *  grayed line that shows when there is none. */
const LOAD_ITEMS = "#mb-load-menu [data-load-slot]";
const NO_SAVES_ID = "mb-load-none";

/** What a Load item reads: the save's name, then its tower's. */
export function loadItemText(s: SlotInfo): string {
  return `${slotName(s)}: ${s.towerName || "Tower"}`;
}

/** The slots File > Load lists, or none when storage cannot be read. A slot
 *  this version can't read is left to Saved Towers…, which explains it. */
function readableSlots(): SlotInfo[] {
  try {
    return SaveGame.listSlots().filter((s) => s.exists);
  } catch {
    return [];
  }
}

/**
 * Fill File > Load from the saves on this device, each time the File menu
 * opens (owner, 2026-11-15: "load can be a sub menu that contains the auto and
 * other saves"). There are four places at most (the Auto-save and three
 * slots), so the list never scrolls, on a phone either. `listSlots` reads a
 * remembered copy, so an open costs one pass over four rows.
 */
export function fillLoadMenu(root: ParentNode = document): void {
  const slots = readableSlots();
  let shown = 0;
  root.querySelectorAll<HTMLElement>(LOAD_ITEMS).forEach((item) => {
    const s = slots.find((row) => String(row.slot) === item.dataset.loadSlot);
    item.hidden = !s;
    if (!s) return;
    item.textContent = loadItemText(s);
    shown++;
  });
  const none = root.querySelector<HTMLElement>(`#${NO_SAVES_ID}`);
  if (none) none.hidden = shown > 0;
}

/** What the title screen says when a listed save would not load. */
export const LOAD_FAILED = "That tower couldn't be loaded. It may be damaged, or saved by a newer version of the game.";

/**
 * A Load item loads its save. In a tower it runs the same load as Saved
 * Towers…' Load button. On the title screen it runs the title screen's own
 * load, which tears the title screen down when the tower arrives and welcomes
 * a returning founder, as its tower picker does.
 */
export function wireLoadMenu(app: GameApp, root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(LOAD_ITEMS).forEach((item) =>
    item.addEventListener("click", () => {
      const v = item.dataset.loadSlot;
      const slot = v === "auto" ? "auto" : Number(v);
      if (!isSplashUp()) {
        app.ui.cb.onLoadSlot(slot);
        return;
      }
      if (loadFromSplash(app, slot)) welcomeFounder(app);
      else app.ui.sayVisibly(LOAD_FAILED);
    }),
  );
}
