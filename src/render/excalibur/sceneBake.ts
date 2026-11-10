/** `TowerEngine.builtRev` while the scene has not baked the tower it holds: a
 *  new engine, or a `setSim` (another tower, a tooling restore, or a step that
 *  did not raise the revision, which rebuilds the scene). The next scene sync
 *  is then the initial bake, which leaves every region to the drain. */
export const NOT_BAKED = -1;

/** Whether the scene has not yet baked the tower it holds (see {@link NOT_BAKED}). */
export function awaitsInitialBake(engine: { readonly builtRev: number }): boolean {
  return engine.builtRev === NOT_BAKED;
}
