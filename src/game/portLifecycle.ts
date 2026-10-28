import type { SerializedView } from "../engine/types";
import type { EnginePort, PortRecord } from "../simport/enginePort";

/**
 * The lifecycle members' records as the game's callers read them (contract
 * section 2: `[status, generation]`). A done swap has already replaced the
 * tower when the member answers, and the app has followed it: until the WASM
 * mirror host goes (PR 5e), `TsEngine` hands the new tower to
 * `GameApp.adoptSim` inside the call.
 */

/** The refusal text when the engine gives none. */
export const SWAP_REFUSED = "That tower could not be loaded.";

/** Throw the engine's refusal when a swap member refused; a done swap
 *  returns. Call it right after the member, before the next status-producing
 *  call replaces `lastReason()`. */
export function swapDone(port: Pick<EnginePort, "lastReason">, rec: PortRecord): void {
  if (rec[0] !== 1) throw new Error(port.lastReason() ?? SWAP_REFUSED);
}

/** The live tower's save text, with the live camera stamped first so the view
 *  travels with it. A null camera (no renderer, as in headless tests) stamps
 *  nothing, so it never erases the view the tower already carries. */
export function saveText(port: Pick<EnginePort, "setCamera" | "serialize">, view: SerializedView | null): string {
  stampCamera(port, view);
  return port.serialize();
}

/** Stamp the live camera onto the tower, so a save or file written next
 *  carries it; a null camera stamps nothing. */
export function stampCamera(port: Pick<EnginePort, "setCamera">, view: SerializedView | null): void {
  if (view) port.setCamera(view.tile, view.floor, view.zoom ?? NaN);
}

/** Hand a stored save to the engine (the `stored` source, with the founder
 *  rule), for `SaveGame`'s loaders: true when the tower loaded and the app
 *  followed it. */
export function loadStored(port: Pick<EnginePort, "loadSave">): (text: string) => boolean {
  return (text) => port.loadSave(text)[0] === 1;
}
