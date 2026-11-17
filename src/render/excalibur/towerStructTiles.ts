import type * as ex from "excalibur";
import type { RenderSim } from "../renderSim";
import type { UnitView } from "../../simport/view";
import { lobbyVariant } from "../sprites";
import type { TowerEngine } from "./TowerEngine";
import type { EntranceKind } from "../sprites/structure/lobby";
import { hallDoors } from "../lobbyHalls";
import { relightHallDoors, syncHallDoors } from "./towerHallDoors";
import { stampGroundEntrances, towerOfSpan } from "../groundEntrances";
import { towerCatalog } from "../../catalog/towerCatalog";

/** The slices of a grand entrance, which carry its staff. */
type GrandKind = Exclude<EntranceKind, "service">;

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
  /** The lobby cells that show a grand entrance, whose doorman and attendant
   *  come and go with their tower's tenants ({@link repaintEntrances}). */
  entrances: readonly LobbyCell[];
}

/** A lobby cell: the tile, its lobby unit, which story of the lobby it shows
 *  (0 is the lobby's own floor) and the lobby's height in stories (#308). */
export type LobbyCell = readonly [ex.Tile, UnitView, number, number];

/** A record that matches no sim, so the next sync walks every unit. */
export function emptyStructPass(): StructPass {
  return { sim: null, units: null, revision: -1, lit: false, rooms: [], lobbies: [], entrances: [] };
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
  stampGroundEntrances(engine.floor1EntranceMap, groundLobby, buildings, engine.groundTowers);
  const entrances: LobbyCell[] = [];
  syncHallDoors(engine, hallDoors(tall, (floor, x) => hallFloors.get(floor)?.has(x) ?? false));
  for (const lc of lobbies) {
    const [cell, u, story, height] = lc;
    paintCell(cell, lobbyTileGfx(engine, u, story, height));
    if (u.floor === 1 && isGrand(floor1EntranceKind(engine, u.x))) entrances.push(lc);
  }
  for (const cell of engine.structTiles) {
    if (seenS.has(cell)) continue;
    cell.clearGraphics();
    engine.structTiles.delete(cell);
  }
  // Written only once every cell is painted, so a pass that throws walks again.
  engine.structPass = { sim: engine.sim, units, revision: tower.revision, lit: engine.litState, rooms, lobbies, entrances };
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
    const slot = kind === "none" ? lobbyVariant(u.x) : kind;
    // Only a grand entrance has staff to send home; every other slice is
    // drawn the same whoever is in.
    const staffed = !isGrand(kind) || entranceStaffed(engine, u.x);
    return engine.tallLobbyGfx(lit === 1, u.floor === 1, height, story, slot, staffed);
  }
  if (u.floor === 1) {
    const kind = floor1EntranceKind(engine, u.x);
    if (kind === "service") return engine.entranceServiceGfx[lit];
    if (kind !== "none") return entranceStaffed(engine, u.x) ? grandGfx(engine, kind, lit) : engine.entranceEmptyGfx[kind][lit];
    return engine.lobbyGfx[lit][1][lobbyVariant(u.x)];
  }
  return engine.lobbyGfx[lit][0][lobbyVariant(u.x)];
}

/** The staffed one-story grand entrance graphic of `kind` for this lighting. */
function grandGfx(engine: TowerEngine, kind: GrandKind, lit: number): ex.Canvas {
  switch (kind) {
    case "grand-left": return engine.entranceGrandLeftGfx[lit];
    case "grand-right": return engine.entranceGrandRightGfx[lit];
    case "grand-solo": return engine.entranceGrandSoloGfx[lit];
  }
}

/** Whether `kind` is a slice of a grand entrance, which carries the doorman
 *  or the reception attendant. */
function isGrand(kind: EntranceKind | "none"): kind is GrandKind {
  return kind === "grand-left" || kind === "grand-right" || kind === "grand-solo";
}

/** Whether the tower whose ground floor holds column `x` has anyone in it
 *  right now, so its entrance shows its staff (#552, per tower since #2384).
 *  Unknown until the scene sync's room walk answers it, which repaints the
 *  entrances in the same sync ({@link repaintEntrances}). */
function entranceStaffed(engine: TowerEngine, x: number): boolean {
  return engine.towerStaffed[towerOfSpan(engine.groundTowers, x, 1)] === true;
}

/** Repaint the grand entrance cells for each tower's current staffing
 *  (`engine.towerStaffed`). The scene sync calls it after its room walk; a
 *  cell already showing the right graphic is left alone. A handful of cells. */
export function repaintEntrances(engine: TowerEngine): void {
  for (const [cell, u, story, height] of engine.structPass.entrances) paintCell(cell, lobbyTileGfx(engine, u, story, height));
}

/** Which entrance (if any) the floor-1 lobby tile at grid `x` should render
 *  as. A plain lookup in the per-tile map computed by
 *  `stampGroundEntrances` (`../groundEntrances`) on each full tile pass of syncScene,
 *  and read by that pass and by a lighting-only lobby repaint (the only
 *  syncs that read it). */
function floor1EntranceKind(engine: TowerEngine, x: number): "grand-left" | "grand-right" | "grand-solo" | "service" | "none" {
  return engine.floor1EntranceMap.get(x) ?? "none";
}
