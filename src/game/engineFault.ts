import { isEngineTrap } from "../wasmhost/hostFault";

/**
 * A trap in the running Rust engine (#874), heard where the frame loop
 * catches it. After a trap the module may be corrupt and every later call on
 * the engine throws, so the frame loop's next step would throw too: the first
 * trap is handed, once, to the handler boot installs, which stops the game
 * and reloads it from its last autosave (#1422). A throw that is not a trap
 * is a frame error like any other.
 */

let onTrap: ((error: unknown) => void) | null = null;
let trapped = false;
/** How the running tower reached the engine: the first tower, a later one (a
 *  load, a new tower, an import) or an undo or redo restore. A trap's
 *  reliability row names it as its stage. */
let towerStage: "start" | "adopt" | "undo" = "start";

/** The engine swapped in another tower (`GameApp.followSwap`). */
export function noteTowerSwap(undo: boolean): void {
  towerStage = undo ? "undo" : "adopt";
}

/** How the running tower reached the engine (see `towerStage`). */
export function runningTowerStage(): "start" | "adopt" | "undo" {
  return towerStage;
}

/** Hear the running engine's first trap (boot installs it on the Rust
 *  engine; null stops listening). */
export function watchEngineTraps(handler: ((error: unknown) => void) | null): void {
  onTrap = handler;
  trapped = false;
  towerStage = "start";
}

/** The running engine trapped, so nothing may call it again. */
export function engineTrapped(): boolean {
  return trapped;
}

/** A frame threw `error`: when it is the engine's trap, hand it on. True when
 *  it was one. */
export function noteEngineThrow(error: unknown): boolean {
  if (!onTrap || !isEngineTrap(error)) return false;
  const handler = onTrap;
  onTrap = null;
  trapped = true;
  handler(error);
  return true;
}
