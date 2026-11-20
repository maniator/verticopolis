import type { GameApp } from "../main";
import { trackAppAction } from "../analytics";
import { MovableWindow, type Spot } from "@verticopolis/components/windows/movableWindow";

/**
 * The facility card and the dialogs move by their title bars
 * (`ui/movableWindow.ts`; the Map's own wiring is in `overviewMapWiring.ts`).
 *
 * The facility card follows its room until the player drags it; from then on
 * it stays where they put it, for every room they pick, until the card closes
 * (`panelAnchoring.ts` asks {@link editorPlacedByPlayer} each frame). On a
 * phone the card opens docked under the tools and moves the same way; a
 * switch between the phone and desktop layouts gives it back to its layout.
 * A dialog that was moved opens centered again next time.
 *
 * The first drag of each in a page life sends `window_move` (`card`,
 * `dialog`), as Tower Info's, the Bulletin's and the Map's do off the 1994
 * desk (on it the desk counts their moves as `desk_window <window>_move`).
 */

/** The `window_move` names of the windows that report their first drag. */
export type WindowMoveName = "tower" | "bulletin" | "map" | "dialog" | "card";

/** The `window_close` names: the windows whose own ✕ is counted. */
export type WindowCloseName = "tower" | "bulletin" | "map";

/** A window's own ✕ was clicked: send `window_close` with `name` when the
 *  player pressed it. The desk's window menu presses the same ✕ from a script
 *  and counts as its own pick (`desk_win_menu <window>_close`), so a script's
 *  click sends nothing here. */
export function reportWindowClose(e: Pick<Event, "isTrusted">, name: WindowCloseName): void {
  if (e.isTrusted) trackAppAction("window_close", name);
}

/** A mover's `placed` hook that sends `window_move` with `name` the first
 *  time the player drags the window in this page life, while `counts` says
 *  yes. A double-click that puts it home (`null`) is not a drag. One boolean
 *  read per finished drag; nothing per frame. */
export function firstDragReporter(
  name: WindowMoveName,
  counts: () => boolean = () => true,
): (spot: Spot | null) => void {
  let sent = false;
  return (spot) => {
    if (sent || !spot || !counts()) return;
    sent = true;
    trackAppAction("window_move", name);
  };
}

/** Each app's facility-card mover, read per frame by the panel anchoring. */
const editorMovers = new WeakMap<GameApp, MovableWindow>();

/** The title bars that move their windows. */
export const MOVABLE_TITLE = {
  map: ".overview-map > .win-title",
  editor: "#editor > .win-title",
  dialog: "#modal > .modal-box > .win-title",
} as const;

/** Wire the facility card and the dialog, once (a second call does nothing,
 *  and so does a page without the tower view, as the Map's wiring does). */
export function wireMovableWindows(app: GameApp): void {
  if (editorMovers.has(app) || !document.getElementById("stage")) return;
  const { editor, modal } = app.ui.el;
  const card = new MovableWindow({
    win: editor,
    title: MOVABLE_TITLE.editor,
    within: editor.parentElement,
    placed: firstDragReporter("card"),
  });
  editorMovers.set(app, card);
  app.mobileMq.addEventListener("change", () => card.reset());
  const dialog = new MovableWindow({
    win: modal,
    title: MOVABLE_TITLE.dialog,
    within: null,
    placed: firstDragReporter("dialog"),
  });
  modal.addEventListener("close", () => dialog.reset());
}

/** Whether the player dragged the facility card away from its room, or is
 *  pressing its title bar to drag it. One map lookup and two field reads, so
 *  the per-frame anchoring can ask it. */
export function editorPlacedByPlayer(app: GameApp): boolean {
  return editorMovers.get(app)?.isHeld() ?? false;
}

/** The card closed, docked or lost its room: it follows its room again next
 *  time. Free when the card was not moved, so it can run every frame. */
export function forgetEditorPlacement(app: GameApp): void {
  editorMovers.get(app)?.reset();
}

/** The Map window's analytics: a player's press on its own ✕ sends
 *  `window_close map`, and the returned hook, for its mover's `placed`, sends
 *  `window_move map` on its first drag while `onDesk` says no (the 1994 desk
 *  counts the Map's move itself). Esc closes the Map too and is not counted. */
export function wireMapWindowAnalytics(root: HTMLElement, onDesk: () => boolean): (spot: Spot | null) => void {
  root.querySelector(".overview-map-close")?.addEventListener("click", (e) => reportWindowClose(e, "map"));
  return firstDragReporter("map", () => !onDesk());
}
