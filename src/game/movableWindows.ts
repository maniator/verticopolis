import type { GameApp } from "../main";
import { MovableWindow } from "../ui/movableWindow";

/**
 * The facility card and the dialogs move by their title bars
 * (`ui/movableWindow.ts`; the Map's own wiring is in `overviewMapWiring.ts`).
 *
 * The facility card follows its room until the player drags it; from then on
 * it stays where they put it, for every room they pick, until the card closes
 * (`panelAnchoring.ts` asks {@link editorPlacedByPlayer} each frame). On a
 * phone the card is docked under the tools and does not move. A dialog that
 * was moved opens centered again next time.
 */

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
  editorMovers.set(
    app,
    new MovableWindow({ win: editor, title: MOVABLE_TITLE.editor, within: editor.parentElement, enabled: () => !app.mobileMq.matches }),
  );
  const dialog = new MovableWindow({ win: modal, title: MOVABLE_TITLE.dialog, within: null });
  modal.addEventListener("close", () => dialog.reset());
}

/** Whether the player dragged the facility card away from its room. One map
 *  lookup and one field read, so the per-frame anchoring can ask it. */
export function editorPlacedByPlayer(app: GameApp): boolean {
  return editorMovers.get(app)?.isPlaced() ?? false;
}

/** The card closed, docked or lost its room: it follows its room again next
 *  time. Free when the card was not moved, so it can run every frame. */
export function forgetEditorPlacement(app: GameApp): void {
  editorMovers.get(app)?.reset();
}
