import type { GameApp } from "../main";
import { shouldWelcomeFounder } from "../founder";
import { activateInstall, splashInstallOffered } from "./installAffordance";
import { showTowerPicker } from "./appModals";
import { isEngineStopped, isSplashUp } from "./interactionState";

/**
 * The title screen, raised at boot and again by File > Close.
 *
 * File > Close (party 2026-11-15,
 * `_bmad-output/party-mode/screensaver-file-close-party-findings-2026-11-15.md`)
 * puts the player back at the program's opening screen the way a 1995
 * application closes a document: it saves the tower first, the same
 * synchronous write the tab-hide save makes, and only then shows the title
 * screen with Continue. The tower stays loaded behind it, frozen as the boot
 * splash freezes it, so Continue brings it back at once. A save that fails
 * leaves the player in the tower with the save error on screen: the title
 * screen never offers Continue over a tower that did not save.
 */

/** What the player reads on the title screen after a Close. */
export const CLOSED_NOTICE = "Your tower is saved. Press Continue to go back to it.";

/** What the player reads in the tower when Close could not save it. */
export const CLOSE_FAILED_NOTICE = "Couldn't save your tower, so it is still open. Free some browser storage or export it to a file, then try again.";

/** The one-time thank-you to a player whose tower predates 2.0, when that
 *  tower lands back on screen. */
export function welcomeFounder(app: GameApp): void {
  if (app.enginePort.founder() && shouldWelcomeFounder()) {
    app.ui.toast("Welcome back. You got in on the ground floor, before 2.0. Thanks for building with us.", "good");
  }
}

/** Raise the title screen over the live tower. `hasSave` says a readable save
 *  sits behind it, so it offers Continue. */
export function showTitleScreen(app: GameApp, hasSave: boolean): void {
  // With no save the boot tower is only the title screen's backdrop, and the
  // player's own tower comes from New Tower: the backdrop's events (its
  // founding first) are left behind when that tower takes over.
  if (!hasSave) app.events.setBackdrop(true);
  const founderWelcome = () => welcomeFounder(app);
  app.onboarding.showSplash({
    hasSave,
    // The splash mute is a second view of the ONE persisted master mute
    // (SPEC-splash-mute CAP-2): it drives the same toggleMute the topbar
    // button does, which also keeps the topbar glyph in sync for when the
    // splash dismisses into the game.
    muted: () => app.audio.muted,
    onToggleMute: () => app.toggleMute(),
    // The persistent splash install button (SPEC-pwa-install CAP-5): offered to
    // a not-standalone browser session, routed through the SAME activation the
    // in-game surfaces use (native prompt where captured, else an honest
    // how-to).
    installOffered: () => splashInstallOffered(),
    onInstall: () => void activateInstall(app, "splash").catch(() => {}),
    // The 2.0 "Ground floor" badge (party 2026-07-23): a small, quiet mark by the
    // version, shown only when the loaded tower predates 2.0 (`founder()`).
    founder: () => app.enginePort.founder(),
    onContinue: () => {
      // Only rendered when `hasSave`. teardownSplash() resumes the engine to
      // play speed, so re-pause: a returning player lands back in their tower
      // paused, the ▶ Play control being the single resume (as in the reload
      // path).
      app.setSpeed(0);
      app.ui.toast("Welcome back. Press Play to resume.", "info");
      founderWelcome(); // one-time thank-you once they land in the tower
    },
    // The load-only tower picker (SPEC-splash-load-tower). Offered on every
    // boot, not just when `hasSave`: the manual slots are invisible to
    // `hasSave` (it reads the autosave keys alone), and the picker's file row
    // is the only way a fresh install or a new device gets its towers back.
    onLoadTower: () => showTowerPicker(app, founderWelcome),
    onNewTower: (dismiss) => {
      // The rule-set picker (Classic vs Modern) warns that New Tower abandons
      // the current tower only when one is continuable (`hasSave`); on a
      // corrupt / first-run boot there's nothing to lose, so it shows no
      // warning.
      app.ui.newTowerModal({
        hasSave,
        onFound: (mode, modernCalendar, startUnbridged) => {
          dismiss();
          app.saveLoad.newGame(mode, modernCalendar, startUnbridged);
        },
      });
    },
  });
}

/** File > Close: save the tower, then show the title screen. Does nothing on
 *  the title screen or once the game stopped on its engine (no tower to
 *  close, and a stopped engine's tower must not be written). Returns whether
 *  the tower closed. */
export function closeTower(app: GameApp): boolean {
  if (isSplashUp() || isEngineStopped()) return false;
  try {
    // Silent: the save throws on failure instead of toasting its own words,
    // so Close can say what happened to the tower.
    app.saveLoad.save(true);
  } catch {
    app.ui.toast(CLOSE_FAILED_NOTICE, "bad");
    return false;
  }
  app.hadReadableSave = true;
  showTitleScreen(app, true);
  // The tower's own news from its last few seconds would otherwise stay on the
  // rail over the title screen.
  app.ui.clearToasts();
  app.ui.toast(CLOSED_NOTICE, "good");
  return true;
}
