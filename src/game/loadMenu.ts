import type { GameApp } from "../main";
import { fileSpace, type TowerFileEntry } from "../storage/fileSpace";
import { SaveGame, type SlotInfo } from "../storage/SaveGame";
import { loadFromSplash } from "./appModals";
import { isSplashUp } from "./interactionState";
import { welcomeFounder } from "./titleScreen";

/** The File > Load submenu's items: the Auto-save, the newest files in My
 *  Towers, More… for the rest, and the grayed line that shows when there is
 *  nothing to load. */
const AUTO_ID = "mb-load-auto";
const FILE_ITEMS = "#mb-load-menu [data-load-file]";
const MORE_ID = "mb-load-more";
const NONE_ID = "mb-load-none";

/** How many files File > Load lists before More…. */
export const LOAD_MENU_FILES = 5;

/** What the Auto-save item reads: its tower's name. */
export function autoItemText(s: SlotInfo): string {
  return `Auto-save: ${s.towerName || "Tower"}`;
}

/** What a file's item reads: its name, and "(1994)" for a SimTower file. */
export function fileItemText(f: TowerFileEntry): string {
  return f.kind === "tdt" ? `${f.name} (1994)` : f.name;
}

/** The Auto-save, when it holds a tower this version can read. */
function readableAuto(): SlotInfo | null {
  try {
    return SaveGame.listSlots().find((s) => s.slot === "auto" && s.exists) ?? null;
  } catch {
    return null;
  }
}

/**
 * Fill File > Load each time the File menu opens (owner, 2026-11-15): the
 * Auto-save, then the newest towers in My Towers, then More…, which opens
 * the Open window, when there are more. The list is in memory, so an open
 * costs one sort of the folder's list.
 */
export function fillLoadMenu(root: ParentNode = document): void {
  const auto = readableAuto();
  const files = fileSpace.list();
  const autoItem = root.querySelector<HTMLElement>(`#${AUTO_ID}`);
  if (autoItem) {
    autoItem.hidden = !auto;
    if (auto) autoItem.textContent = autoItemText(auto);
  }
  root.querySelectorAll<HTMLElement>(FILE_ITEMS).forEach((item, i) => {
    const f = files[i];
    item.hidden = !f;
    item.dataset.loadFile = f?.id ?? "";
    if (f) item.textContent = fileItemText(f);
  });
  const more = root.querySelector<HTMLElement>(`#${MORE_ID}`);
  if (more) more.hidden = files.length <= LOAD_MENU_FILES;
  const none = root.querySelector<HTMLElement>(`#${NONE_ID}`);
  if (none) none.hidden = !!auto || files.length > 0;
}

/** What the title screen says when a listed save would not load. */
export const LOAD_FAILED = "That tower couldn't be loaded. It may be damaged, or saved by a newer version of the game.";

/**
 * Load the Auto-save. In a tower it runs the tower's own load. On the title
 * screen it runs the title screen's load, which takes the title screen down
 * when the tower arrives and welcomes a returning founder.
 */
export function loadSave(app: GameApp, slot: "auto"): void {
  if (!isSplashUp()) {
    app.ui.cb.onLoadSlot(slot);
    return;
  }
  if (loadFromSplash(app, slot)) welcomeFounder(app);
  else app.ui.sayVisibly(LOAD_FAILED);
}

/** Wire the Load items: the Auto-save loads; a file opens as it would from
 *  the Open window; More… opens that window. */
export function wireLoadMenu(
  app: GameApp,
  commands: { openFile(id: string): void; more(): void },
  root: ParentNode = document,
): void {
  root.querySelector(`#${AUTO_ID}`)?.addEventListener("click", () => loadSave(app, "auto"));
  root.querySelectorAll<HTMLElement>(FILE_ITEMS).forEach((item) =>
    item.addEventListener("click", () => {
      if (item.dataset.loadFile) commands.openFile(item.dataset.loadFile);
    }),
  );
  root.querySelector(`#${MORE_ID}`)?.addEventListener("click", () => commands.more());
}
