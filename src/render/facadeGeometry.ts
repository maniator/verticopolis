import { catalogFacility, type Catalog } from "../catalog/catalogTypes";
import type { UnitView } from "../simport/view";
import { NO_TALL_HALLS, type LobbyHalls } from "./lobbyHalls";

/** Left/right built extent of one above-ground floor row, in tile columns
 *  (`min` = leftmost tile, `max` = exclusive right edge). */
export interface FloorEdge {
  min: number;
  max: number;
}

/**
 * The tower's exterior silhouette, derived from its units in a SINGLE pass —
 * consumed by the escape stairs (per-floor edges) and the rooftop crane
 * (top-floor tiles). Pure and free of any Excalibur/canvas dependency (it reads
 * only unit data + the catalog's unit heights) so it is unit-testable without standing up
 * the render engine, and computed once so a structural change doesn't scan the
 * (potentially thousands of) units more than necessary.
 *
 * Every story of a multi-floor room counts on each row it occupies, so a
 * two-story cinema at the edge still dresses its upper row. A lobby tile in a
 * hall taller than one story (#308, #2068) counts on every story the hall
 * rises through, so the escape stairs climb past its raised stories the way
 * they climb past a normal floor's. Basement rows are
 * excluded (edges clamp to floor ≥ 1), matching the above-ground facade. The one
 * exception is the wedding hall's garden: its upper stories stand in the open
 * sky above the last floor, so they get no escape stairs and no crane perch.
 */
export interface FacadeGeometry {
  /** Leftmost/rightmost built tile per above-ground floor row. */
  edges: Map<number, FloorEdge>;
  /** Each above-ground floor row's runs of built tiles, left to right: one
   *  per tower on a lot whose towers stand apart, so each tower hangs its own
   *  escape stairs on both of its sides. */
  runs: Map<number, FloorEdge[]>;
  /** The highest row that holds structure: `highestFloor`, or the top story
   *  of a taller room or lobby hall that rises past it. The crane stands on
   *  this row's roof. */
  topFloor: number;
  /** Built tile columns on `topFloor`, where the crane perches. Empty
   *  when the top floor carries no above-ground structure (basement-only or
   *  empty lot), which is exactly when no crane should be shown. */
  topTiles: Set<number>;
}

/** Whether story `floor` of `u` is part of the wedding hall's garden crown (every
 *  story above the hall's ground story), which is not a building row. */
function isGardenCrownStory(u: UnitView, floor: number): boolean {
  return u.kind === "weddingHall" && floor > u.floor;
}

/**
 * Build {@link FacadeGeometry} for `units`. `highestFloor` is the tower's
 * top occupied floor (the lowest row the crane may stand on; a story rising
 * past it moves the crane up to that story's roof). `halls` holds the
 * lobby halls taller than one story; a lobby unit's height comes from it,
 * since the catalog gives every lobby one story.
 */
export function facadeGeometry(
  units: readonly UnitView[],
  highestFloor: number,
  catalog: Catalog,
  halls: LobbyHalls = NO_TALL_HALLS,
): FacadeGeometry {
  const edges = new Map<number, FloorEdge>();
  const spans = new Map<number, FloorEdge[]>();
  const topTiles = new Set<number>();
  // The engine's highest floor counts each unit's base floor, so a tall hall
  // or a two-story room on the top floor rises past it; the crane follows
  // the highest row actually seen.
  let topFloor = highestFloor;
  for (const u of units) {
    const right = u.x + u.width;
    const stories = u.kind === "lobby" ? halls.heightAt(u.floor, u.x) : catalogFacility(catalog, u.kind).floors;
    const top = u.floor + stories;
    for (let f = Math.max(1, u.floor); f < top; f++) {
      if (isGardenCrownStory(u, f)) continue;
      const e = edges.get(f);
      if (!e) edges.set(f, { min: u.x, max: right });
      else {
        if (u.x < e.min) e.min = u.x;
        if (right > e.max) e.max = right;
      }
      const row = spans.get(f);
      if (row) row.push({ min: u.x, max: right });
      else spans.set(f, [{ min: u.x, max: right }]);
      // Same scan feeds the crane: remember the top row's built columns so
      // syncCrane needn't re-traverse every unit to find them. A higher row
      // replaces the columns kept so far.
      if (f > topFloor) {
        topFloor = f;
        topTiles.clear();
      }
      if (f === topFloor) for (let x = u.x; x < right; x++) topTiles.add(x);
    }
  }
  return { edges, runs: joinRuns(spans), topFloor, topTiles };
}

/** Each row's spans joined into runs: spans that touch or overlap are one
 *  run. One sort per row, made only when the layout changes. */
function joinRuns(spans: Map<number, FloorEdge[]>): Map<number, FloorEdge[]> {
  const runs = new Map<number, FloorEdge[]>();
  for (const [floor, row] of spans) {
    row.sort((a, b) => a.min - b.min);
    const joined: FloorEdge[] = [];
    for (const s of row) {
      const last = joined[joined.length - 1];
      if (last && s.min <= last.max) last.max = Math.max(last.max, s.max);
      else joined.push({ ...s });
    }
    runs.set(floor, joined);
  }
  return runs;
}
