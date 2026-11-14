/**
 * Floor runs in a save (version 11). The engine folds a row of plain floor
 * tiles into the first tile's entry with a `run` count:
 * `{"id":43,"kind":"floor","floor":2,"x":167,"run":60}` stands for 60 tiles
 * on floor 2 at x 167 to 226, ids 43 to 102 (`engine-rs/src/save_floor_runs.rs`).
 * The engine is the only loader; this unfolds a save the tooling harness
 * reads and patches by unit id, so every tile has its own record again. The
 * engine reads the unfolded list back the same. It reads saves the engine
 * just wrote, so it does not repeat the loader's checks on a forged run.
 */

/** The key on a run's first floor tile. */
export const FLOOR_RUN_KEY = "run";

interface RunEntry {
  id: number;
  kind: string;
  x: number;
  run?: number;
}

/** The tile count a save entry stands for: its `run` when it is a floor
 *  tile with a whole run of 2 or more, otherwise 1. */
function tilesOf(unit: RunEntry): number {
  const run = unit[FLOOR_RUN_KEY];
  return unit.kind === "floor" && Number.isInteger(run) && (run as number) >= 2 ? (run as number) : 1;
}

/** `units` with each floor run unfolded in place, in list order. Returns the
 *  same array when it holds no run. */
export function unfoldFloorRuns<T extends RunEntry>(units: T[]): T[] {
  if (!units.some((u) => tilesOf(u) > 1)) return units;
  const out: T[] = [];
  for (const unit of units) {
    const tiles = tilesOf(unit);
    if (tiles === 1) {
      out.push(unit);
      continue;
    }
    const { [FLOOR_RUN_KEY]: _run, ...tile } = unit;
    for (let k = 0; k < tiles; k++) out.push({ ...tile, id: unit.id + k, x: unit.x + k } as T);
  }
  return out;
}
