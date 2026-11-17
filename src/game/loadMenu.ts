import type { GameApp } from "../main";
import { loadFromSplash } from "./appModals";
import { isSplashUp } from "./interactionState";
import { welcomeFounder } from "./titleScreen";
import { trackAppAction } from "../analytics";

/** What the title screen says when the Auto-save would not load. */
export const LOAD_FAILED = "That tower couldn't be loaded. It may be damaged, or saved by a newer version of the game.";

/**
 * Load the Auto-save, the crash copy (Continue, or the live tower's own file
 * picked on the title screen). In a tower it runs the
 * tower's own load. On the title screen it runs the title screen's load,
 * which takes the title screen down when the tower arrives and welcomes a
 * returning founder.
 */
export function loadSave(app: GameApp, slot: "auto"): void {
  if (!isSplashUp()) {
    app.ui.cb.onLoadSlot(slot);
    return;
  }
  if (loadFromSplash(app, slot)) welcomeFounder(app);
  else app.ui.sayVisibly(LOAD_FAILED);
}

/** The live tower's own file was picked (in My Towers or the linked folder,
 *  #2380): on the title screen it is the tower Continue brings back, so it
 *  comes back the same way; in a tower it is already open, and stays as it
 *  is. */
export function openLive(app: GameApp, name: string): void {
  trackAppAction("file_open", "live");
  if (isSplashUp()) loadSave(app, "auto");
  else app.ui.toast(`"${name}" is the tower you're in.`, "info");
}
