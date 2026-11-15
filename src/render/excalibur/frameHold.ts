/**
 * Stop the tower's frame clock while something covers the whole screen (the
 * screen saver), so the hidden tower is not drawn every display frame, and
 * start it again after. The context-loss handler in `TowerEngine.ts` stops
 * the same clock. A frame that arrives after a long hold is clamped by the
 * frame loop, so nothing jumps.
 */

/** The part of the renderer this needs: its Excalibur engine's clock. */
export interface FrameClockOwner {
  readonly engine: { readonly clock: { readonly isRunning: boolean; start(): void; stop(): void } };
}

/** Hold the frames of the renderer `live()` returns now. Returns the
 *  release, which runs once. A clock that was not running (a lost GL
 *  context) is left stopped, and so is one whose renderer was replaced
 *  during the hold (a context-loss rebuild disposed it; the new one runs on
 *  its own). */
export function holdTowerFrames(live: () => FrameClockOwner): () => void {
  const tower = live();
  const clock = tower.engine.clock;
  const wasRunning = clock.isRunning;
  if (wasRunning) clock.stop();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (wasRunning && live() === tower && !clock.isRunning) clock.start();
  };
}
