/**
 * Saves written by hand for the storage tests, which check save text and never
 * load it on an engine. Each carries what the readers ask of a tower (a
 * numeric clock and a units list) and its name; none carries `appVersion`, so
 * each reads as a save from before the stamp.
 */

/** A small classic tower at its founding minute, with nothing built. */
export const SMALL_TOWER_SAVE = JSON.stringify({
  version: 7,
  seed: 1,
  money: 2_000_000,
  star: 1,
  minutes: 420,
  mode: "classic",
  units: [],
  transports: [],
  towerName: "Tower One",
  excavated: [],
});
