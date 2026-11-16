import type { GameApp } from "../main";
import { updateBuildPreview } from "./buildPreview";
import { quoteSkyBridge, quotedTiles, SKY_BRIDGE_STEP, tapLays, type ArmedSkyBridge } from "./skyBridgeTool";
import { groupDigits } from "../ui/format";

/**
 * The Sky Bridge tool's gestures (Modern): a mouse click, a phone's two taps
 * and the keyboard cursor's Enter each lay the whole bridge through
 * `BuildActions.buildSkyBridge`, as one undo step named "Build Sky Bridge".
 */

/** The bridge each app's first phone tap showed, which a second tap lays. */
const armed = new WeakMap<GameApp, ArmedSkyBridge>();

/** Lay the bridge a click or a keyboard Enter at a cell names, as one undo
 *  step. The caller commits the step when its gesture ends. */
export function placeSkyBridge(app: GameApp, tile: number, floor: number): { ok: boolean; reason?: string; tiles: number } {
  armed.delete(app);
  return app.build.buildSkyBridge(tile, floor);
}

/** A phone tap with the tool armed. A first tap on a gap draws the ghost and
 *  says the price; a second tap on the same bridge lays it. A tap the engine
 *  would refuse draws the red ghost and says why. Opens and closes its own
 *  undo step when it lays the bridge. */
export function tapSkyBridge(app: GameApp, tile: number, floor: number): void {
  const q = quoteSkyBridge(app.enginePort, app.portCodes, floor, tile);
  if (tapLays(armed.get(app) ?? null, floor, q)) {
    app.captureUndo(SKY_BRIDGE_STEP);
    placeSkyBridge(app, tile, floor);
    app.commitUndo();
    app.engine.preview = null;
    return;
  }
  updateBuildPreview(app, tile, floor, false);
  if (q.ok) {
    armed.set(app, { floor, from: q.from, to: q.to });
    const tiles = quotedTiles(q);
    app.ui.toast(`Sky bridge: ${tiles} ${tiles === 1 ? "tile" : "tiles"}, $${groupDigits(q.cost)}. Tap it again to build.`, "info");
  } else {
    armed.delete(app);
    if (q.reason) app.ui.toast(q.reason, "bad");
  }
}

/** Forget a first tap when the tool changes. */
export function disarmSkyBridge(app: GameApp): void {
  armed.delete(app);
}
