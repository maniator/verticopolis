import type { SerializedView } from "../engine/types";
import type { EnginePort, PortRecord } from "../simport/enginePort";
import { engineTrapped } from "./engineFault";

/**
 * The lifecycle members' records as the game's callers read them (contract
 * section 2: `[status, generation]`). A done swap has already replaced the
 * tower when the member answers; the caller then has the app follow it
 * (`GameApp.followSwap`).
 */

/** The refusal text when the engine gives none. */
export const SWAP_REFUSED = "That tower could not be loaded.";

/** Throw the engine's refusal when a swap member refused; a done swap
 *  returns. Call it right after the member, before the next status-producing
 *  call replaces `lastReason()`. */
export function swapDone(port: Pick<EnginePort, "lastReason">, rec: PortRecord): void {
  if (rec[0] !== 1) throw new Error(port.lastReason() ?? SWAP_REFUSED);
}

/** Why no save is written once the running engine trapped. */
export const TRAPPED_SAVE_REFUSED = "The engine stopped after an error, so the last save is kept.";

/** The live tower's save text, with the live camera stamped first so the view
 *  travels with it. A null camera (no renderer, as in headless tests) stamps
 *  nothing, so it never erases the view the tower already carries.
 *  Once the running engine trapped (#874) its state may be half-written, so
 *  this throws before asking it: every save, autosave, slot and export goes
 *  through here, and the last good save stays for the reload (#1422). */
export function saveText(port: Pick<EnginePort, "setCamera" | "serialize">, view: SerializedView | null): string {
  if (engineTrapped()) throw new Error(TRAPPED_SAVE_REFUSED);
  stampCamera(port, view);
  return port.serialize();
}

/** The `.vctower` file of the live tower, written by the engine and stamped
 *  with this build and the time (`stamp`): the file the player downloads.
 *  Throws the engine's refusal (or, once the engine trapped, the same refusal
 *  every save gives) and never writes the file itself, so a build without the
 *  engine package exports nothing rather than a file the engine did not make. */
export function exportFileText(
  port: Pick<EnginePort, "setCamera" | "exportVctower" | "lastReason">,
  view: SerializedView | null,
  stamp: { appVersion: string; savedAt: number },
): string {
  if (engineTrapped()) throw new Error(TRAPPED_SAVE_REFUSED);
  stampCamera(port, view);
  const file = port.exportVctower(stamp.appVersion, stamp.savedAt);
  if (file === undefined) throw new Error(port.lastReason() ?? "The tower could not be exported.");
  return file;
}

/** Stamp the live camera onto the tower, so a save or file written next
 *  carries it; a null camera stamps nothing. */
export function stampCamera(port: Pick<EnginePort, "setCamera">, view: SerializedView | null): void {
  if (view) port.setCamera(view.tile, view.floor, view.zoom ?? NaN);
}

/** Hand a stored save to the engine (the `stored` source, with the founder
 *  rule), for `SaveGame`'s loaders: true when the tower loaded, after
 *  `followed` (the app following the swap) ran. */
export function loadStored(port: Pick<EnginePort, "loadSave">, followed: () => void = () => {}): (text: string) => boolean {
  return (text) => {
    if (port.loadSave(text)[0] !== 1) return false;
    followed();
    return true;
  };
}
