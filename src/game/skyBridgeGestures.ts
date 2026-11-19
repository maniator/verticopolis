import type { GameApp } from "../main";
import { updateBuildPreview } from "./buildPreview";
import { BRIDGE_LOOK_STEP, quoteSkyBridge, quotedTiles, SKY_BRIDGE_STEP, tapLays, type ArmedSkyBridge, type SkyBridgeClick } from "./skyBridgeTool";
import { finishedSkyBridgeAt } from "@verticopolis/components/port/skyBridgeView";
import { groupDigits } from "@verticopolis/components/windows/format";

/**
 * The Sky Bridge tool's gestures (Modern): a mouse click, a phone's two taps
 * and the keyboard cursor's Enter each lay the whole bridge through
 * `BuildActions.buildSkyBridge`, as one undo step named "Build Sky Bridge". On
 * a finished bridge each gesture changes its look instead ("Change Bridge
 * Look"), at once: a look costs nothing, so a tap needs no second tap.
 */

/** The bridge each app's first phone tap showed, which a second tap lays. */
const armed = new WeakMap<GameApp, ArmedSkyBridge>();

/** Lay the bridge a click or a keyboard Enter at a cell names, as one undo
 *  step. The caller commits the step when its gesture ends. */
export function placeSkyBridge(app: GameApp, tile: number, floor: number): SkyBridgeClick {
  armed.delete(app);
  return app.build.buildSkyBridge(tile, floor);
}

/** Whether the cell holds a finished bridge, which a click dresses in the
 *  picked look. */
export function onSkyBridge(app: GameApp, tile: number, floor: number): boolean {
  return finishedSkyBridgeAt(app.reader.tower, floor, tile) !== undefined;
}

/** The undo step a gesture at the cell opens. */
export function skyBridgeStep(app: GameApp, tile: number, floor: number): string {
  return onSkyBridge(app, tile, floor) ? BRIDGE_LOOK_STEP : SKY_BRIDGE_STEP;
}

/** A phone tap with the tool armed. A first tap on a gap draws the ghost and
 *  says the price; a second tap on the same bridge lays it. A tap the engine
 *  would refuse draws the red ghost and says why. Opens and closes its own
 *  undo step when it lays the bridge. */
export function tapSkyBridge(app: GameApp, tile: number, floor: number): void {
  if (onSkyBridge(app, tile, floor)) {
    app.captureUndo(BRIDGE_LOOK_STEP);
    placeSkyBridge(app, tile, floor);
    app.commitUndo();
    return;
  }
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
