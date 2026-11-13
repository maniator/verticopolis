/**
 * The speed table the frame-day and port-edit goldens were recorded under.
 * The goldens drive the engine's own stepper at these rates, and their
 * digests are shared with the Rust conformance lock, so they keep this
 * table when the player's buttons (`SPEEDS` in `game/frameLoop.ts`) change.
 * Index 1 to 3 is the speed a case names.
 */
export const GOLDEN_SPEEDS: readonly number[] = [0, 10, 30, 120];
