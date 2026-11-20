import type { GameApp } from "../main";
import { trackAppAction } from "../analytics";
import { fileSpace } from "../storage/fileSpace";
import { canLinkFolder, linkedFolder } from "../storage/linkedFolder";
import { dropRecentTower, keepRecentTowers, recentTowers, RECENT_MAX, type RecentTower } from "../storage/recentTowers";
import { openTowersFile } from "./fileSpaceCommands";
import { openLinkedRow } from "./linkedFolderCommands";

/**
 * File > Open Recent (owner, 2026-11-16): the last towers opened or saved,
 * newest first, numbered 1 to 5 the way a 1995 program lists its recent
 * files, each number underlined as the key that picks it. The list itself is
 * `storage/recentTowers.ts`; the files open through the Open window's own
 * paths (`openTowersFile`, `openLinkedRow`), so a pick here opens a tower
 * exactly as its row in the Open window would, and keeps it as the live
 * tower's file for File > Save.
 *
 * A file that is gone is handled, never fatal. One deleted from My Towers
 * drops off the list as the File menu opens; one that can't be checked
 * before a pick (a file on the player's computer, which the game may not read
 * until the browser says OK) says so when picked and drops off then. A file
 * from a folder that is no longer linked drops off too, unless another tab
 * linked that folder since this page opened: its lines are hidden here and
 * kept for that tab. Nothing here ever
 * writes, renames or deletes a tower file.
 *
 * Analytics (`docs/analytics-data-map.md`): a pick is a `menu_pick` in the
 * File menu (`recent_1` to `recent_5`), then `app_action` `files_open`
 * `recent`, then the open's own event (`file_open`, `folder_open`). A file
 * found gone at its pick sends `recent_missing` (`towers` or `folder`). Codes
 * only: a tower's name stays on the device.
 */

/** The submenu's title, its five lines and the grayed line for an empty list. */
export const RECENT_TITLE_ID = "mb-recent";
export const RECENT_ITEM_ID = (n: number) => `mb-recent-${n}`;
export const RECENT_NONE_ID = "mb-recent-none";

/** The towers the lines show now, by line (index 0 is line 1). */
let shown: RecentTower[] = [];

/** What a line reads after its number: a My Towers file's own name (its
 *  current one, after a rename), "(1994)" after a SimTower file, and a linked
 *  folder's file by its name on disk. */
export function recentLabel(t: RecentTower): string {
  if (t.place === "folder") return t.id;
  const name = fileSpace.get(t.id)?.name ?? t.name;
  return t.kind === "tdt" ? `${name} (1994)` : name;
}

/** Whether a line can still be offered, and whether it is gone for good. */
function standing(t: RecentTower): "show" | "hide" | "gone" {
  if (t.place === "towers") {
    // Until My Towers has opened, the stored name stands in.
    return !fileSpace.isOpen() || fileSpace.get(t.id) ? "show" : "gone";
  }
  // A browser that can't link a folder keeps the line for one that can.
  if (!canLinkFolder()) return "hide";
  if (linkedFolder.linkId() === t.link) return "show";
  // Another tab's newer link: its lines stay on the list for that tab and
  // for this page's next visit, which takes that link.
  return linkedFolder.keptLinkId() === t.link ? "hide" : "gone";
}

/**
 * Fill File > Open Recent as the File menu opens: one localStorage read, then
 * for each of at most {@link RECENT_MAX} lines one check of where it stands
 * and one for its label (a find in the My Towers list already in memory, or
 * a read of the kept link id). Lines whose files are gone come off the list
 * for good; a line from another tab's newer link is hidden, never dropped.
 */
export function fillRecentMenu(root: ParentNode = document): void {
  const list = recentTowers();
  const standings = list.map(standing);
  const kept = list.filter((_, i) => standings[i] !== "gone");
  if (kept.length !== list.length) keepRecentTowers(kept);
  shown = list.filter((_, i) => standings[i] === "show");
  const doc = root instanceof Document ? root : (root as Node).ownerDocument;
  for (let n = 1; n <= RECENT_MAX; n++) {
    const item = root.querySelector<HTMLElement>(`#${RECENT_ITEM_ID(n)}`);
    if (!item) continue;
    const t = shown[n - 1];
    item.hidden = !t;
    item.replaceChildren();
    if (!t || !doc) continue;
    const num = doc.createElement("u");
    num.textContent = String(n);
    const name = doc.createElement("span");
    name.className = "mb-recent-name";
    name.textContent = recentLabel(t);
    item.append(num, name);
    item.title = t.place === "folder" ? `In the linked folder "${linkedFolder.state()?.name ?? ""}"` : "In My Towers";
  }
  const none = root.querySelector<HTMLElement>(`#${RECENT_NONE_ID}`);
  if (none) none.hidden = shown.length > 0;
}

/** A file found gone at its pick: off the list, counted. */
function gone(t: RecentTower): void {
  dropRecentTower(t);
  trackAppAction("recent_missing", t.place);
}

/** Open a linked folder's file, asking the browser's OK first when it wants
 *  one (the pick is a click, so it may ask). */
async function openFolderTower(app: GameApp, t: RecentTower): Promise<void> {
  const folder = linkedFolder.state()?.name ?? "the linked folder";
  if (linkedFolder.linkId() !== t.link) {
    gone(t);
    app.ui.sayVisibly(
      `"${t.id}" was in a folder that isn't linked any more. Link it again in File > Open… to open its towers.`,
    );
    return;
  }
  if (linkedFolder.state()?.access !== "granted") {
    let access: string;
    try {
      access = await linkedFolder.allow();
    } catch {
      access = "denied";
    }
    trackAppAction("folder_allow", access === "granted" ? "granted" : "denied");
    if (access !== "granted") {
      // A folder whose handle the browser dropped is unlinked by now.
      if (linkedFolder.linkId() !== t.link) gone(t);
      app.ui.sayVisibly(`Your browser didn't allow the game to open "${folder}", so "${t.id}" stays closed.`);
      return;
    }
  }
  if (!(await openLinkedRow(app, { id: t.id, name: t.id, type: t.kind }))) gone(t);
}

/** Open a recent tower, as its row in the Open window would. */
export async function openRecent(app: GameApp, t: RecentTower): Promise<void> {
  trackAppAction("files_open", "recent");
  if (t.place === "folder") {
    await openFolderTower(app, t);
    return;
  }
  const opened = await openTowersFile(app, t.id);
  if (opened === "gone") {
    gone(t);
    app.ui.sayVisibly(
      `"${t.name}" isn't in My Towers any more. It may have been deleted, so it's off the Open Recent list.`,
    );
  } else if (opened === "closed") {
    app.ui.sayVisibly(
      "My Towers can't be opened in this window, so its towers can't open from here. File > Open… can open a tower file from your computer.",
    );
  }
}

/** Wire the five lines; each opens the tower it showed when the menu opened. */
export function wireRecentMenu(app: GameApp, root: ParentNode = document): void {
  for (let n = 1; n <= RECENT_MAX; n++) {
    root.querySelector(`#${RECENT_ITEM_ID(n)}`)?.addEventListener("click", () => {
      const t = shown[n - 1];
      if (t) void openRecent(app, t);
    });
  }
}
