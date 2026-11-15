import type { GameApp } from "../main";
import { loadFromSplash } from "./appModals";
import { isSplashUp } from "./interactionState";
import { welcomeFounder } from "./titleScreen";

/** What the title screen says when the Auto-save would not load. */
export const LOAD_FAILED = "That tower couldn't be loaded. It may be damaged, or saved by a newer version of the game.";

/**
 * Load the Auto-save (its row in the Open window). In a tower it runs the
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
