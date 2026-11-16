import type * as ex from "excalibur";
import type { RenderSim } from "../renderSim";
import type { UnitView } from "../../simport/view";
import { lobbyVariant } from "../sprites";
import type { TowerEngine } from "./TowerEngine";
import { hallDoors } from "../lobbyHalls";
import { relightHallDoors, syncHallDoors } from "./towerHallDoors";
import { stampGroundEntrances } from "../groundEntrances";
import { towerCatalog } from "../../catalog/towerCatalog";

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
  lobbies: readonly LobbyCell[];
}

/** A lobby cell: the tile, its lobby unit, which story of the lobby it shows
 *  (0 is the lobby's own floor) and the lobby's height in stories (#308). */
export type LobbyCell = readonly [ex.Tile, UnitView, number, number];

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
      for (const [cell, u, story, height] of pass.lobbies) paintCell(cell, lobbyTileGfx(engine, u, story, height));
      relightHallDoors(engine);
      pass.lit = engine.litState;
    }
    return pass.rooms;
  }
  const topFloor = engine.structTopFloor;
  const rooms: UnitView[] = [];
  const lobbies: LobbyCell[] = [];
  // Read once per full pass (#308): a tall lobby's cells cover the stories
  // above its floor too.
  const tall = tower.tallLobbies();
  // The lobby columns of each floor that holds a tall hall, for the walls
  // between halls of different heights (#2068).
  const hallFloors = new Map<number, Set<number>>();
  for (const r of tall.runs) hallFloors.set(r.floor, new Set());
  // The floor-1 lobby columns, and, when each tower on the lot has its own
  // front door, every column a ground-floor unit covers (the towers' extents).
  const groundLobby: number[] = [];
  const buildings: number[] | null = towerCatalog(engine.sim).rules.frontDoorPerTower ? [] : null;
  const seenS = new Set<ex.Tile>();
  for (const u of units) {
    if (u.kind !== "floor" && u.kind !== "lobby") {
      rooms.push(u);
      if (buildings && u.floor === 1) for (let dx = 0; dx < u.width; dx++) buildings.push(u.x + dx);
      continue;
    }
    if (u.floor === 1) {
      // Tiles are one wide in the sim; reading the width costs nothing.
      for (let dx = 0; dx < u.width; dx++) {
        if (u.kind === "lobby") groundLobby.push(u.x + dx);
        buildings?.push(u.x + dx);
      }
    }
    if (u.kind === "lobby") hallFloors.get(u.floor)?.add(u.x);
    // Floor/lobby units are one tile wide, so a unit maps to one cell.
    const cell = engine.structTileMap.getTile(u.x, topFloor - u.floor);
    if (!cell) continue; // outside the grid; the engine never places there
    seenS.add(cell);
    engine.structTiles.add(cell);
    if (u.kind !== "lobby") {
      paintCell(cell, engine.floorGfx);
      continue;
    }
    const height = tall.heightAt(u.floor, u.x);
    lobbies.push([cell, u, 0, height]);
    for (let story = 1; story < height; story++) {
      const up = engine.structTileMap.getTile(u.x, topFloor - u.floor - story);
      if (!up) continue;
      seenS.add(up);
      engine.structTiles.add(up);
      lobbies.push([up, u, story, height]);
    }
  }
  // The floor-1 entrance map comes from this pass's own lobby list, and the
  // lobby cells are painted after it, so a newly placed leftmost tile takes
  // the grand entrance graphic on the same sync it is added.
  groundLobby.sort((a, b) => a - b);
  stampGroundEntrances(engine.floor1EntranceMap, groundLobby, buildings);
  syncHallDoors(engine, hallDoors(tall, (floor, x) => hallFloors.get(floor)?.has(x) ?? false));
  for (const [cell, u, story, height] of lobbies) paintCell(cell, lobbyTileGfx(engine, u, story, height));
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
function lobbyTileGfx(engine: TowerEngine, u: UnitView, story = 0, height = 1): ex.Canvas {
  const lit = engine.litState ? 1 : 0;
  if (height > 1) {
    // A tall lobby (#308): one slice of the whole open hall per story. The
    // entrance's storefront (and its doorman) stands on the bottom story,
    // with the hall's wall carried up over it in place of its own cornice.
    const kind = u.floor === 1 ? floor1EntranceKind(engine, u.x) : "none";
    return engine.tallLobbyGfx(lit === 1, u.floor === 1, height, story, kind === "none" ? lobbyVariant(u.x) : kind);
  }
  if (u.floor === 1) {
    const kind = floor1EntranceKind(engine, u.x);
    if (kind !== "none") return entranceGfx(engine, kind, lit);
    return engine.lobbyGfx[lit][1][lobbyVariant(u.x)];
  }
  return engine.lobbyGfx[lit][0][lobbyVariant(u.x)];
}

/** The one-story entrance graphic of `kind` for this lighting. */
function entranceGfx(engine: TowerEngine, kind: "grand-left" | "grand-right" | "grand-solo" | "service", lit: number): ex.Canvas {
  switch (kind) {
    case "grand-left": return engine.entranceGrandLeftGfx[lit];
    case "grand-right": return engine.entranceGrandRightGfx[lit];
    case "grand-solo": return engine.entranceGrandSoloGfx[lit];
    case "service": return engine.entranceServiceGfx[lit];
  }
}

/** Which entrance (if any) the floor-1 lobby tile at grid `x` should render
 *  as. A plain lookup in the per-tile map computed by
 *  `stampGroundEntrances` (`../groundEntrances`) on each full tile pass of syncScene,
 *  and read by that pass and by a lighting-only lobby repaint (the only
 *  syncs that read it). */
function floor1EntranceKind(engine: TowerEngine, x: number): "grand-left" | "grand-right" | "grand-solo" | "service" | "none" {
  return engine.floor1EntranceMap.get(x) ?? "none";
}
