import type { GameApp } from "../main";
import { clearBuildRefusal } from "./buildPreview";
import { dropRoomRow } from "./roomRowGestures";

/** Drop the app's half of a gesture its pointer can no longer finish: a lost
 *  canvas took the release with it, or the tower changed under the press (a
 *  swap, or an undo or redo step), which resets the engine's input, so the
 *  release never reaches `onActionUp`. A stale `transportStart` suppresses the
 *  update prompt session-long, and a stale paint or build anchor would place
 *  on a later tap or extend the next touch drag across the gap. The refusal
 *  card a refused drag raised goes too, latch first: hiding the shared card
 *  leaves `buildRefusalShowing` set, and a leaked latch offsets the next
 *  card's anchor a floor down (panelAnchoring reads it). */
export function dropSeveredGesture(app: GameApp): void {
  dropRoomRow(app);
  app.paintAnchor = null;
  app.buildAnchor = null;
  app.transportStart = null;
  app.build.clearPaint();
  clearBuildRefusal(app);
}
