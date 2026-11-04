import type * as ex from "excalibur";
import { viewWorld } from "../../presentation/viewWorld";
import type { RenderSim } from "../renderSim";
import type { UnitView } from "../../simport/view";
import { lobbyVariant } from "../sprites";
import type { TowerEngine } from "./TowerEngine";

/**
 * The scene sync's structure pass: the floor and lobby cells of the structure
 * TileMap, and the floor-1 entrance map the lobby cells read. Split out of
 * `towerReconcile.ts`, which calls {@link syncStructureTiles} once per sync.
 */

/** What the tile pass last drew from, and what it kept for the syncs that
 *  skip the tiles: the rooms (every unit but the tiles, in `tower.units`
 *  order) and the lobby cells with their units. */
export interface StructPass {
  sim: RenderSim | null;
  units: readonly UnitView[] | null;
  revision: number;
  lit: boolean;
  rooms: readonly UnitView[];
  lobbies: readonly (readonly [ex.Tile, UnitView])[];
}

/** A record that matches no sim, so the next sync walks every unit. */
export function emptyStructPass(): StructPass {
  return { sim: null, units: null, revision: -1, lit: false, rooms: [], lobbies: [] };
}

/** Bring the floor and lobby cells of the structure TileMap up to date and
 *  return the tower's rooms (every unit but the tiles, in `tower.units`
 *  order). A layout, unit list or sim change walks every unit once: it paints
 *  each tile, keeps the rooms and the lobby cells, and clears the cells no
 *  tile holds any more. A lighting-only change repaints the kept lobby cells.
 *  Any other sync touches no cell and hands back the kept rooms, whose entries
 *  stay current because the view patches them in place until it rebuilds the
 *  unit list. */
export function syncStructureTiles(engine: TowerEngine): readonly UnitView[] {
  const tower = engine.sim.tower;
  const pass = engine.structPass;
  const units = tower.units;
  const layoutStale = pass.sim !== engine.sim || pass.units !== units || pass.revision !== tower.revision;
  if (!layoutStale) {
    if (pass.lit !== engine.litState) {
      // The entrance map still matches this layout: it was built by the full
      // pass that kept these lobby cells.
      for (const [cell, u] of pass.lobbies) paintCell(cell, lobbyTileGfx(engine, u));
      pass.lit = engine.litState;
    }
    return pass.rooms;
  }
  const maxFloor = viewWorld().maxFloor;
  const rooms: UnitView[] = [];
  const lobbies: [ex.Tile, UnitView][] = [];
  const floor1Lobbies: UnitView[] = [];
  const seenS = new Set<ex.Tile>();
  for (const u of units) {
    if (u.kind !== "floor" && u.kind !== "lobby") {
      rooms.push(u);
      continue;
    }
    if (u.kind === "lobby" && u.floor === 1) floor1Lobbies.push(u);
    // Floor/lobby units are one tile wide, so a unit maps to one cell.
    const cell = engine.structTileMap.getTile(u.x, maxFloor - u.floor);
    if (!cell) continue; // outside the grid; the engine never places there
    seenS.add(cell);
    engine.structTiles.add(cell);
    if (u.kind === "lobby") lobbies.push([cell, u]);
    else paintCell(cell, engine.floorGfx);
  }
  // The floor-1 entrance map comes from this pass's own lobby list, and the
  // lobby cells are painted after it, so a newly placed leftmost tile takes
  // the grand entrance graphic on the same sync it is added.
  refreshFloor1EntranceMap(engine, floor1Lobbies);
  for (const [cell, u] of lobbies) paintCell(cell, lobbyTileGfx(engine, u));
  for (const cell of engine.structTiles) {
    if (seenS.has(cell)) continue;
    cell.clearGraphics();
    engine.structTiles.delete(cell);
  }
  // Written only once every cell is painted, so a pass that throws walks again.
  engine.structPass = { sim: engine.sim, units, revision: tower.revision, lit: engine.litState, rooms, lobbies };
  return rooms;
}

/** Show `gfx` on a structure cell. Lobby tiles swap their shared graphic when
 *  the evening lights come on (chandeliers/sconces glow), and a lobby built
 *  over bare floor takes the cell over. Guarded: clearing and re-adding a cell
 *  graphic dirties the TileMap's cached geometry, so a cell that already shows
 *  the right canvas is left alone. */
function paintCell(cell: ex.Tile, gfx: ex.Graphic): void {
  if (cell.getGraphics()[0] === gfx) return;
  cell.clearGraphics();
  cell.addGraphic(gfx);
}

/** The shared lobby tile graphic for this unit's lighting, style and slot.
 *  For floor-1 lobby tiles the frontage-edge predicate can override the
 *  variant to a wide-storefront grand slice, a compact grand fallback, or
 *  a service entrance; see {@link floor1EntranceKind}. */
function lobbyTileGfx(engine: TowerEngine, u: UnitView): ex.Canvas {
  const lit = engine.litState ? 1 : 0;
  if (u.floor === 1) {
    const kind = floor1EntranceKind(engine, u.x);
    switch (kind) {
      case "grand-left": return engine.entranceGrandLeftGfx[lit];
      case "grand-right": return engine.entranceGrandRightGfx[lit];
      case "grand-solo": return engine.entranceGrandSoloGfx[lit];
      case "service": return engine.entranceServiceGfx[lit];
    }
    return engine.lobbyGfx[lit][1][lobbyVariant(u.x)];
  }
  return engine.lobbyGfx[lit][0][lobbyVariant(u.x)];
}

/** Which entrance (if any) the floor-1 lobby tile at grid `x` should render
 *  as. A plain lookup in the per-tile map computed by
 *  {@link refreshFloor1EntranceMap} on each full tile pass of syncScene,
 *  and read by that pass and by a lighting-only lobby repaint (the only
 *  syncs that read it). */
function floor1EntranceKind(engine: TowerEngine, x: number): "grand-left" | "grand-right" | "grand-solo" | "service" | "none" {
  return engine.floor1EntranceMap.get(x) ?? "none";
}

/** Walk the tower's floor-1 lobby tiles, group them into contiguous runs,
 *  and stamp the grand entrance onto the LEFTMOST run and the service door
 *  onto the RIGHTMOST run. Populating a per-tile map (rather than checking
 *  global min/max) keeps every entrance sprite anchored to real neighboring
 *  tiles, so a gap in the middle of the lobby (mid-remodel bulldoze) cannot
 *  produce an orphan grand-left half-facade with nothing next to it.
 *
 *  Rules:
 *    - Leftmost run of width ≥ 2: `runStart` -> grand-left, `runStart+1` -> grand-right.
 *    - Leftmost run of width 1 (toy tower): `runStart` -> grand-solo.
 *    - Rightmost run's rightmost tile -> service, IFF that tile is not
 *      already claimed by the grand entrance AND there is room past the
 *      grand span. When the rightmost run is the SAME as the leftmost run,
 *      "room past the grand span" means the run has more tiles than the
 *      grand takes (so 1/2-tile lobbies are all grand, no service). When
 *      the rightmost run is DIFFERENT from the leftmost run, it always has
 *      room by construction, so any distinct rightmost run gets service on
 *      its rightmost tile (even width 1). */
function refreshFloor1EntranceMap(engine: TowerEngine, floor1Lobbies: readonly UnitView[]): void {
  engine.floor1EntranceMap.clear();
  // Every floor-1 lobby tile position (lobby units are always width 1 in the
  // sim, but reading u.width for defense costs nothing).
  const tiles: number[] = [];
  for (const u of floor1Lobbies) {
    for (let dx = 0; dx < u.width; dx++) tiles.push(u.x + dx);
  }
  if (tiles.length === 0) return;
  tiles.sort((a, b) => a - b);
  // Find the leftmost and rightmost contiguous runs. Both come from the same
  // sorted list; a single pass locates the first run's end and the last
  // run's start.
  let firstRunEnd = 0;
  while (firstRunEnd + 1 < tiles.length && tiles[firstRunEnd + 1] === tiles[firstRunEnd] + 1) {
    firstRunEnd++;
  }
  let lastRunStart = tiles.length - 1;
  while (lastRunStart > 0 && tiles[lastRunStart - 1] === tiles[lastRunStart] - 1) {
    lastRunStart--;
  }
  const firstStart = tiles[0];
  const firstEnd = tiles[firstRunEnd] + 1; // exclusive
  const firstWidth = firstEnd - firstStart;
  // Grand entrance on the leftmost run.
  if (firstWidth >= 2) {
    engine.floor1EntranceMap.set(firstStart, "grand-left");
    engine.floor1EntranceMap.set(firstStart + 1, "grand-right");
  } else {
    engine.floor1EntranceMap.set(firstStart, "grand-solo");
  }
  // Service door on the rightmost run's rightmost tile, but only if that
  // tile isn't already claimed by the grand entrance.
  const lastRightX = tiles[tiles.length - 1];
  const grandSpan = firstWidth >= 2 ? 2 : 1;
  const sameRunAsFirst = lastRunStart <= firstRunEnd;
  const roomPastGrand = sameRunAsFirst ? firstWidth > grandSpan : true;
  if (roomPastGrand && !engine.floor1EntranceMap.has(lastRightX)) {
    engine.floor1EntranceMap.set(lastRightX, "service");
  }
}
