import { isInstalledStandalone } from "../ui/standalone";
import type { MenuEntryState } from "./menuBarHost";

/**
 * Whether Options > Full Screen is offered (owner, 2026-11-15).
 *
 * An installed app on a phone already fills the screen the way a phone app
 * should: the status bar and the system's navigation stay, and the game fits
 * between them. Full Screen there hides those too and looks worse, and on an
 * iPhone's home-screen app it cannot work at all (no page there can ask for
 * full screen, so the item only showed its "add to your home screen" note to
 * a player who already had). So a phone running the installed app is not
 * offered it. A browser tab on a phone, a tablet and a computer keep it,
 * installed or not.
 *
 * `phone` is the layout split (`app.mobileMq`, the same query the stylesheet's
 * phone block uses). `installed` is the installed-app test
 * (`isInstalledStandalone`: `display-mode: standalone`, the display the
 * manifest asks for, or iOS's `navigator.standalone`). `filling` says the page
 * fills the screen right now: the item then stays, so whatever got the page
 * there, the player can always leave from the menu.
 */
export function fullScreenOffered(state: {
  readonly phone: boolean;
  readonly installed: boolean;
  readonly filling: boolean;
}): boolean {
  if (state.filling) return true;
  return !(state.phone && state.installed);
}

/** The Full Screen item and the line above Options' display toggles. */
export const FULL_SCREEN_ITEM = "mb-fullscreen";
export const DISPLAY_SEPARATOR = "mb-display-sep";

/**
 * Whether Full Screen shows, read as the Options menu opens. On a phone the
 * line above it goes with it: Tools and Status Bar are a computer's items, so
 * Full Screen is the only thing under that line there.
 */
export function fullScreenStates(phone: boolean, doc: Document = document): Record<string, MenuEntryState> {
  const offered = fullScreenOffered({ phone, installed: isInstalledStandalone(), filling: !!doc.fullscreenElement });
  return { [FULL_SCREEN_ITEM]: { hidden: !offered }, [DISPLAY_SEPARATOR]: { hidden: phone && !offered } };
}
