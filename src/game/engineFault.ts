import { isEngineTrap } from "../wasmhost/hostFault";
import type { FallbackReason } from "../wasmhost/engineBoot";

/**
 * A trap in the running Rust engine (#874), heard where the frame loop
 * catches it. After a trap the module may be corrupt and every later call on
 * the engine throws, so the frame loop's next step would throw too: the first
 * trap is handed, once, to the handler boot installs, which stops the game
 * and reloads it from its last autosave (#1422). A throw that is not a trap
 * is a frame error like any other.
 */

/** Where the trap happened: a frame's step, the engine's save writer (#1205), or the slot population
 *  reader that loads a save into a short-lived engine in the same module (#1612). */
export type TrapDuring = "tick" | "save" | "census";

/** The reliability code for a trap in each place (`fallback_reason`), so a
 *  trap in the save writer or the census is not counted as a tick's. */
export const TRAP_REASON = { tick: "trap-tick", save: "trap-save", census: "trap-census" } as const satisfies Record<TrapDuring, FallbackReason>;

let onTrap: ((error: unknown, during: TrapDuring) => void) | null = null;
let trapped = false;
/** How the running tower reached the engine: the first tower, a later one (a
 *  load, a new tower, an import) or an undo or redo step (a tooling restore
 *  counts as one). A trap's reliability row names it as its stage. */
let towerStage: "start" | "adopt" | "undo" = "start";

/** The app followed the engine to another tower, or through an undo or redo
 *  step (`GameApp.followSwap`). */
export function noteTowerSwap(undo: boolean): void {
  towerStage = undo ? "undo" : "adopt";
}

/** How the running tower reached the engine (see `towerStage`). */
export function runningTowerStage(): "start" | "adopt" | "undo" {
  return towerStage;
}

/** Hear the running engine's first trap (boot installs it on the Rust
 *  engine; null stops listening). */
export function watchEngineTraps(handler: ((error: unknown, during: TrapDuring) => void) | null): void {
  onTrap = handler;
  trapped = false;
  towerStage = "start";
}

/** The running engine trapped, so nothing may call it again. */
export function engineTrapped(): boolean {
  return trapped;
}

/** The engine threw `error` in a frame, its save writer or the slot population reader: when it is the
 *  engine's trap, hand it on. True when it was one. */
export function noteEngineThrow(error: unknown, during: TrapDuring = "tick"): boolean {
  if (!onTrap || !isEngineTrap(error)) return false;
  const handler = onTrap;
  onTrap = null;
  trapped = true;
  handler(error, during);
  return true;
}
