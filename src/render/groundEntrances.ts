import type { EntranceKind } from "./sprites/structure/lobby";

/**
 * Where the ground floor's front doors stand: which floor-1 lobby tiles draw
 * the grand entrance (with its doorman) and which draws the service door.
 * Pure, so the rule is testable without the render engine; the structure
 * pass (`excalibur/towerStructTiles.ts`) calls it once per full tile pass.
 *
 * One building gets one grand entrance, on the left end of its leftmost run
 * of lobby, and one service door, on the right end of its rightmost run.
 * Stamping per contiguous run (rather than at the global min and max) keeps
 * every entrance anchored to real neighboring tiles, so a gap in the middle
 * of a lobby (a mid-remodel bulldoze) cannot leave an orphan half-facade.
 *
 *  - Leftmost run of width >= 2: its first tile -> grand-left, the next -> grand-right.
 *  - Leftmost run of width 1 (a toy tower): grand-solo.
 *  - Rightmost run's rightmost tile -> service, if the grand entrance has not
 *    claimed it and there is room past it. When the rightmost run is the
 *    leftmost run, that means the run is wider than the grand entrance (a 1-
 *    or 2-tile lobby is all grand). A distinct rightmost run always has room,
 *    so it takes the service door even at width 1.
 *
 * When the catalog gives each tower its own front door (`frontDoorPerTower`,
 * Modern, where ground lobbies may stand apart), every building on the lot is
 * stamped on its own. A building is a contiguous run of ground-floor tiles,
 * lobby or room, so open ground between two lobbies parts two towers. That
 * matches the floor-1 runs that hang the entrance awnings (`facadeGeometry`)
 * except for a taller room rising onto floor 1 from a basement, which those
 * count and this does not. Without it, the whole ground floor is one
 * building, as in the 1994 game.
 */

/** Stamp the entrances into `out` (cleared first). `lobbyTiles` are the
 *  floor-1 lobby columns, sorted ascending with no repeats. `buildings` is
 *  null for one building on the lot, or the floor-1 columns every ground-floor
 *  unit covers (lobby and rooms, any order, repeats allowed) to stamp each
 *  contiguous run of them as its own building. */
export function stampGroundEntrances(
  out: Map<number, EntranceKind>,
  lobbyTiles: readonly number[],
  buildings: number[] | null,
): void {
  out.clear();
  if (lobbyTiles.length === 0) return;
  if (buildings === null) {
    stampBuilding(out, lobbyTiles, 0, lobbyTiles.length);
    return;
  }
  buildings.sort((a, b) => a - b);
  // Walk the buildings' runs and the lobby tiles together: each run claims
  // the lobby tiles inside it. Every lobby tile is a building tile, so each
  // falls inside exactly one run.
  let lo = 0;
  let i = 0;
  while (i < buildings.length && lo < lobbyTiles.length) {
    let j = i;
    while (j + 1 < buildings.length && buildings[j + 1] - buildings[j] <= 1) j++;
    const end = buildings[j]; // inclusive
    let hi = lo;
    while (hi < lobbyTiles.length && lobbyTiles[hi] <= end) hi++;
    stampBuilding(out, lobbyTiles, lo, hi);
    lo = hi;
    i = j + 1;
  }
}

/** Stamp one building whose lobby tiles are `tiles[from..to)`; nothing when
 *  it holds no lobby. */
function stampBuilding(out: Map<number, EntranceKind>, tiles: readonly number[], from: number, to: number): void {
  if (to <= from) return;
  // The leftmost run's end and the rightmost run's start, in one list.
  let firstRunEnd = from;
  while (firstRunEnd + 1 < to && tiles[firstRunEnd + 1] === tiles[firstRunEnd] + 1) firstRunEnd++;
  let lastRunStart = to - 1;
  while (lastRunStart > from && tiles[lastRunStart - 1] === tiles[lastRunStart] - 1) lastRunStart--;
  const firstStart = tiles[from];
  const firstWidth = tiles[firstRunEnd] + 1 - firstStart;
  if (firstWidth >= 2) {
    out.set(firstStart, "grand-left");
    out.set(firstStart + 1, "grand-right");
  } else {
    out.set(firstStart, "grand-solo");
  }
  const lastRightX = tiles[to - 1];
  const grandSpan = firstWidth >= 2 ? 2 : 1;
  const sameRunAsFirst = lastRunStart <= firstRunEnd;
  const roomPastGrand = sameRunAsFirst ? firstWidth > grandSpan : true;
  if (roomPastGrand && !out.has(lastRightX)) out.set(lastRightX, "service");
}
