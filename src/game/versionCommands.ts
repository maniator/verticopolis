import type { GameApp } from "../main";
import { trackAppAction } from "../analytics";
import { fileSpace } from "../storage/fileSpace";
import type { TowerVersion } from "../storage/fileVersions";
import type { FileNote } from "../ui/fileDialog";
import { showVersionsDialog } from "../ui/versionsDialog";
import { failed } from "./fileKeep";

/**
 * Right-click > Previous versions… on a My Towers tower (owner, 2026-11-16;
 * save-model party verdict item 3, #2380). The window lists the versions My
 * Towers keeps (`storage/fileVersions.ts`); opening one adds its bytes as a
 * new tower file, named after the tower and the version's time, and opens
 * that file the way the Open window would. The tower's own file and its
 * versions stay as they are.
 *
 * Analytics (`docs/analytics-data-map.md`): `app_action` `file_versions`
 * with `list` (the window opened on a tower with versions), `none` (on one
 * with none yet), `open` (a version opened as a new file) or `back` (the
 * window closed without one, back to the Open or Save As window).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The new file's name: the tower's and the version's time, "Sky (Nov 17 at
 *  3.04 PM)". A dot in the time, since a file name can't hold a colon. */
export function versionName(name: string, at: number): string {
  const d = new Date(at);
  const hour = d.getHours() % 12 || 12;
  const minute = String(d.getMinutes()).padStart(2, "0");
  return `${name} (${MONTHS[d.getMonth()]} ${d.getDate()} at ${hour}.${minute} ${d.getHours() < 12 ? "AM" : "PM"})`;
}

/** Open version `v` of the tower named `name` as a new file, through `openFile`. */
export async function openVersion(
  app: Pick<GameApp, "ui">,
  name: string,
  v: TowerVersion,
  openFile: (id: string) => Promise<unknown>,
): Promise<FileNote | null> {
  try {
    const bytes = await fileSpace.readVersion(v.key);
    if (!bytes) return { text: "That version is gone. Newer versions may have replaced it.", kind: "bad" };
    const entry = await fileSpace.add(versionName(name, v.at), "tower", bytes);
    trackAppAction("file_versions", "open");
    app.ui.closeModal();
    await openFile(entry.id);
    return null;
  } catch (err) {
    return failed(err);
  }
}

/** Show My Towers file `id`'s Previous Versions window. `back` puts the
 *  window it was opened from back when it closes without opening one. */
export async function showVersions(
  app: Pick<GameApp, "ui">,
  id: string,
  openFile: (id: string) => Promise<unknown>,
  back?: () => void,
): Promise<void> {
  const f = fileSpace.get(id);
  if (!f) return;
  let versions: TowerVersion[] = [];
  try {
    versions = await fileSpace.versions(id);
  } catch {
    // A list that can't be read shows as none.
  }
  trackAppAction("file_versions", versions.length === 0 ? "none" : "list");
  showVersionsDialog(app.ui, {
    name: f.name,
    versions,
    open: (v) => openVersion(app, f.name, v, openFile),
    ...(back
      ? {
          back: () => {
            trackAppAction("file_versions", "back");
            back();
          },
        }
      : {}),
  });
}
