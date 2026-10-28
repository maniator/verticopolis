import { isEngineTrap } from "../wasmhost/hostFault";

/**
 * A trap in the running Rust engine (#874), heard where the frame loop
 * catches it. After a trap the module may be corrupt and every later call on
 * the engine throws, so the frame loop's next step would throw too: the first
 * trap is handed, once, to the handler boot installs, which stops the game.
 * Until PR 6 brings back the fallback to the TypeScript engine, a trap stops
 * the game on both builds. A throw that is not a trap is a frame error like
 * any other.
 */

let onTrap: ((error: unknown) => void) | null = null;
let trapped = false;

/** Hear the running engine's first trap (boot installs it on the Rust
 *  engine; null stops listening). */
export function watchEngineTraps(handler: ((error: unknown) => void) | null): void {
  onTrap = handler;
  trapped = false;
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
