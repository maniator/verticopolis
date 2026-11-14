import { describe, expect, it, vi } from "vitest";
import type { UnitView } from "../../simport/view";
import type { TowerEngine } from "./TowerEngine";
import { syncScene } from "./towerReconcile";
import { markRegionUnit } from "./towerRegions";
import { disposeScene } from "./towerScene";
import { emptyStructPass } from "./towerStructTiles";
import { HallDoorLayer, relightHallDoors, syncHallDoors } from "./towerHallDoors";
import { lobbyHalls, NO_TALL_HALLS, type LobbyHalls } from "../lobbyHalls";
import { bindViewWorld, viewWorld } from "../../presentation/viewWorld";

// The door actors need a 2d canvas a Node test lacks; `towerHallDoors.test.ts`
// covers them. Here the structure pass is checked for the doors it hands over.
vi.mock("./towerHallDoors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./towerHallDoors")>()),
  syncHallDoors: vi.fn(),
  relightHallDoors: vi.fn(),
}));

// The scene sync's tile pass (floor and lobby cells of the structure TileMap)
// draws from the layout, the lobby lighting and the sim alone. These tests pin
// that an hour-only sync leaves the cells alone while the room pass still runs,
// and that each real input (a layout change, the lights, a swapped or disposed
// scene) walks the tiles again. Hand-built engine, as in towerReconcileFire.
vi.mock("./towerScenery", () => ({ syncScenery: vi.fn() }));
vi.mock("./roomSignature", () => ({
  roomSignature: (_u: UnitView, d: { hour: number }) => `hour ${d.hour}`,
  isDeadParking: () => false,
}));
vi.mock("../regionPaint", () => ({ paintAnimatedUnit: vi.fn() }));
vi.mock("../../catalog/towerCatalog", () => ({ towerCatalog: () => ({ rules: {} }) }));
vi.mock("../../catalog/catalogTypes", () => ({ catalogFacility: () => ({ floors: 1 }) }));
vi.mock("./towerCrowd", () => ({
  clearMotion: vi.fn(),
  reap: <K, V>(map: Map<K, V>, seen: ReadonlySet<K>, dispose: (v: V, k: K) => void): void => {
    for (const [k, v] of map) {
      if (seen.has(k)) continue;
      dispose(v, k);
      map.delete(k);
    }
  },
}));
vi.mock("./towerRegions", () => ({
  markRegionUnit: vi.fn((engine: TowerEngine, u: UnitView) => void engine.regionUnits.set(u.id, [1])),
  dropRegionUnit: vi.fn((engine: TowerEngine, id: number) => void engine.regionUnits.delete(id)),
  disposeRegions: vi.fn(),
}));

/** A TileMap cell that records its graphic. */
class Cell {
  gfx: unknown[] = [];
  getGraphics(): unknown[] {
    return this.gfx;
  }
  clearGraphics(): void {
    this.gfx = [];
  }
  addGraphic(g: unknown): void {
    this.gfx.push(g);
  }
}

const tile = (kind: "floor" | "lobby", floor: number, x: number): UnitView => ({ id: NaN, kind, floor, x, width: 1, state: "empty", occupants: 0 }) as unknown as UnitView;
const office: UnitView = { id: 7, kind: "office", floor: 2, x: 10, width: 6, state: "occupied", occupants: 0 } as unknown as UnitView;

/** Lobby graphics named by lighting, so a test can read which one a cell got. */
const lobbyGfx = (lit: number): string[][] => [Array.from({ length: 16 }, (_, v) => `upper ${lit}:${v}`), Array.from({ length: 16 }, (_, v) => `ground ${lit}:${v}`)];

function fakeEngine(state: { units: UnitView[]; revision: number; tall?: LobbyHalls }) {
  const cells = new Map<string, Cell>();
  const getTile = vi.fn((x: number, y: number) => {
    const key = `${x},${y}`;
    if (!cells.has(key)) cells.set(key, new Cell());
    return cells.get(key);
  });
  const sim = {
    tower: {
      get units() {
        return state.units;
      },
      get revision() {
        return state.revision;
      },
      transports: [],
      functionalParkingSet: () => new Set<number>(),
      tallLobbies: vi.fn(() => state.tall ?? NO_TALL_HALLS),
    },
    parkingUsage: () => 0,
    recyclingFill: () => 0,
  };
  const engine = {
    sim,
    engine: { add: vi.fn() },
    d: { hour: 9 },
    litState: false,
    structTileMap: { getTile },
    // The map's row 0 is floor 20.
    structTopFloor: 20,
    hallDoors: new HallDoorLayer(),
    floorGfx: "floor",
    lobbyGfx: [lobbyGfx(0), lobbyGfx(1)],
    entranceGrandLeftGfx: ["grand-left 0", "grand-left 1"],
    entranceGrandRightGfx: ["grand-right 0", "grand-right 1"],
    entranceGrandSoloGfx: ["grand-solo 0", "grand-solo 1"],
    entranceServiceGfx: ["service 0", "service 1"],
    tallLobbyGfx: vi.fn((lit: boolean, ground: boolean, height: number, story: number, slot: number | string) => `tall ${lit ? 1 : 0}:${ground ? "ground" : "sky"}:${height}:${story}:${slot}`),
    floor1EntranceMap: new Map(),
    structTiles: new Set(),
    structPass: emptyStructPass(),
    animatedRooms: new Map(),
    roomSig: new Map(),
    regionUnits: new Map(),
    transportActors: new Map(),
    transportSig: new Map(),
    windingFlights: new Set(),
    escapeActors: new Map(),
    craneActor: null,
  } as unknown as TowerEngine;
  return { engine, getTile, cell: (x: number, floor: number) => cells.get(`${x},${20 - floor}`) };
}

function tower(): { units: UnitView[]; revision: number } {
  const units = [{ ...office }];
  for (let x = 4; x < 8; x++) units.push(tile("lobby", 1, x));
  for (let x = 4; x < 8; x++) units.push(tile("floor", 2, x));
  return { units, revision: 5 };
}

/** Put a counting stand-in for the unit list in place before the first sync,
 *  so the list keeps one identity, and return a reader of how many entries
 *  have been read since the last reset. It counts every indexed read, so a
 *  `for...of`, a `some`, a `filter` or an index loop over the list all show. */
function countReads(state: { units: UnitView[] }): { reads: () => number; reset: () => void } {
  let reads = 0;
  state.units = new Proxy(state.units, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  return { reads: () => reads, reset: () => void (reads = 0) };
}

describe("the scene sync walks the structure tiles only when what they draw from moved", () => {
  it("bakes every tile on the first sync", () => {
    const { engine, getTile, cell } = fakeEngine(tower());
    syncScene(engine);
    expect(getTile).toHaveBeenCalledTimes(8);
    expect(cell(4, 1)?.gfx).toEqual(["grand-left 0"]);
    expect(cell(6, 2)?.gfx).toEqual(["floor"]);
    expect(engine.structTiles.size).toBe(8);
  });

  it("maps floors to rows by the map's own top floor, whatever world is bound (#1985)", () => {
    // A taller tower's catalog can be bound before the swap that resizes the
    // map; the pass must keep indexing the map it has.
    const world = viewWorld();
    bindViewWorld({ ...world, maxFloor: world.maxFloor + 20 });
    try {
      const { engine, getTile } = fakeEngine(tower());
      syncScene(engine);
      expect(getTile).toHaveBeenCalledWith(4, 20 - 1);
      expect(getTile).toHaveBeenCalledWith(6, 20 - 2);
    } finally {
      bindViewWorld(world);
    }
  });

  it("skips the tiles on an hour-only sync, and still repaints a room whose look changed", () => {
    const state = tower();
    const walked = countReads(state);
    const { engine, getTile, cell } = fakeEngine(state);
    syncScene(engine);
    getTile.mockClear();
    vi.mocked(markRegionUnit).mockClear();
    walked.reset();
    engine.d.hour = 10;
    syncScene(engine);
    expect(walked.reads()).toBe(0);
    expect(getTile).not.toHaveBeenCalled();
    expect(markRegionUnit).toHaveBeenCalledTimes(1);
    expect(engine.roomSig.get(office.id)).toBe("hour 10");
    // The skipped pass reaps nothing: the cells keep their graphics.
    expect(engine.structTiles.size).toBe(8);
    expect(cell(5, 1)?.gfx).toEqual(["grand-right 0"]);
  });

  it("repaints only the kept lobby cells when the lobby lights change", () => {
    const state = tower();
    const walked = countReads(state);
    const { engine, getTile, cell } = fakeEngine(state);
    syncScene(engine);
    getTile.mockClear();
    walked.reset();
    engine.litState = true;
    syncScene(engine);
    expect(walked.reads()).toBe(0);
    expect(getTile).not.toHaveBeenCalled();
    expect(cell(4, 1)?.gfx).toEqual(["grand-left 1"]);
    expect(cell(5, 1)?.gfx).toEqual(["grand-right 1"]);
    expect(String(cell(6, 1)?.gfx[0])).toMatch(/^ground 1:/);
    expect(cell(7, 1)?.gfx).toEqual(["service 1"]);
    expect(cell(6, 2)?.gfx).toEqual(["floor"]);
    // The lights going off again repaints the same cells back.
    engine.litState = false;
    syncScene(engine);
    expect(cell(4, 1)?.gfx).toEqual(["grand-left 0"]);
    expect(engine.structTiles.size).toBe(8);
  });

  it("paints a tall lobby's cells on every story it rises through, and relights them (#308)", () => {
    const units = [{ ...office }];
    for (let x = 4; x < 8; x++) units.push(tile("lobby", 1, x));
    for (let x = 4; x < 6; x++) units.push(tile("lobby", 15, x));
    const state = { units, revision: 5, tall: lobbyHalls([1, 4, 7, 2, 15, 4, 5, 3]) };
    const { engine, cell } = fakeEngine(state);
    syncScene(engine);
    // The entrance is a slice of the open hall on every story, its doors
    // included, so no one-story cornice cuts across the hall over them.
    expect(cell(4, 1)?.gfx).toEqual(["tall 0:ground:2:0:grand-left"]);
    expect(cell(7, 1)?.gfx).toEqual(["tall 0:ground:2:0:service"]);
    expect(cell(4, 2)?.gfx).toEqual(["tall 0:ground:2:1:grand-left"]);
    expect(cell(6, 1)?.gfx).toEqual([`tall 0:ground:2:0:${6 % 4}`]);
    expect(cell(6, 2)?.gfx).toEqual([`tall 0:ground:2:1:${6 % 4}`]);
    expect(cell(7, 2)?.gfx).toEqual(["tall 0:ground:2:1:service"]);
    expect(cell(4, 3)).toBeUndefined();
    // A three-story sky lobby covers floors 15 to 17.
    expect(cell(5, 15)?.gfx).toEqual([`tall 0:sky:3:0:${5 % 4}`]);
    expect(cell(5, 17)?.gfx).toEqual([`tall 0:sky:3:2:${5 % 4}`]);
    expect(engine.structTiles.size).toBe(4 * 2 + 2 * 3);
    engine.litState = true;
    syncScene(engine);
    expect(cell(4, 2)?.gfx).toEqual(["tall 1:ground:2:1:grand-left"]);
    expect(cell(5, 16)?.gfx).toEqual([`tall 1:sky:3:1:${5 % 4}`]);
    // The heights are read once per full pass, never on a lighting-only sync.
    expect(engine.sim.tower.tallLobbies).toHaveBeenCalledOnce();
  });

  it("rises each hall to its own height and puts a revolving door where two heights meet (#2068)", () => {
    const units = [{ ...office }];
    for (let x = 4; x < 12; x++) units.push(tile("lobby", 1, x));
    // A three-story hall over 4..7 beside a two-story hall over 8..11.
    const state = { units, revision: 5, tall: lobbyHalls([1, 4, 7, 3, 1, 8, 11, 2]) };
    const { engine, cell } = fakeEngine(state);
    syncScene(engine);
    expect(cell(7, 3)?.gfx).toHaveLength(1);
    expect(cell(8, 2)?.gfx).toHaveLength(1);
    expect(cell(8, 3)).toBeUndefined();
    // The structure pass hands the door layer the one wall between the halls.
    expect(vi.mocked(syncHallDoors)).toHaveBeenLastCalledWith(engine, [{ floor: 1, x: 8, tall: 3, short: 2, tallOnLeft: true }]);
    // The halls level out: the next full pass hands over no door.
    state.tall = lobbyHalls([1, 4, 11, 3]);
    state.revision = 6;
    syncScene(engine);
    expect(vi.mocked(syncHallDoors)).toHaveBeenLastCalledWith(engine, []);
    // A lighting-only sync repaints the doors without looking for new ones.
    const passes = vi.mocked(syncHallDoors).mock.calls.length;
    engine.litState = true;
    syncScene(engine);
    expect(vi.mocked(syncHallDoors).mock.calls.length).toBe(passes);
    expect(vi.mocked(relightHallDoors)).toHaveBeenCalledWith(engine);
  });

  it("clears a tall lobby's upper cells when its lobby goes", () => {
    const units = [{ ...office }];
    for (let x = 4; x < 8; x++) units.push(tile("lobby", 1, x));
    const state = { units, revision: 5, tall: lobbyHalls([1, 4, 7, 3]) };
    const { engine, cell } = fakeEngine(state);
    syncScene(engine);
    expect(engine.structTiles.size).toBe(12);
    state.units = [{ ...office }];
    state.tall = NO_TALL_HALLS;
    state.revision = 6;
    syncScene(engine);
    expect(engine.structTiles.size).toBe(0);
    expect(cell(5, 3)?.gfx).toEqual([]);
  });

  it("walks only the kept rooms on a sync that skips the tiles, and reads their entries as patched in place", () => {
    const state = tower();
    const room = state.units[0] as { state: string };
    const walked = countReads(state);
    const { engine } = fakeEngine(state);
    syncScene(engine);
    expect(engine.d.staffed).toBe(true);
    walked.reset();
    // The view patches a room's state in place without a revision move.
    room.state = "empty";
    engine.d.hour = 10;
    syncScene(engine);
    // No read of the unit list at all, so the staffed flag came from the kept rooms.
    expect(walked.reads()).toBe(0);
    expect(engine.d.staffed).toBe(false);
    expect(engine.roomSig.get(office.id)).toBe("hour 10");
  });

  it("walks the tiles again when the layout moves, and clears a removed tile", () => {
    const state = tower();
    const { engine, getTile, cell } = fakeEngine(state);
    syncScene(engine);
    getTile.mockClear();
    state.units = state.units.filter((u) => !(u.kind === "floor" && u.x === 7));
    state.revision = 6;
    syncScene(engine);
    expect(getTile).toHaveBeenCalledTimes(7);
    expect(cell(7, 2)?.gfx).toEqual([]);
    expect(engine.structTiles.size).toBe(7);
  });

  it("walks the tiles again for another sim, even at the same revision", () => {
    const { engine, getTile } = fakeEngine(tower());
    syncScene(engine);
    getTile.mockClear();
    engine.sim = { ...engine.sim } as TowerEngine["sim"];
    syncScene(engine);
    expect(getTile).toHaveBeenCalledTimes(8);
  });

  it("walks the tiles again for a fresh unit list, even at the same revision", () => {
    const state = tower();
    const { engine, getTile } = fakeEngine(state);
    syncScene(engine);
    getTile.mockClear();
    state.units = [...state.units];
    syncScene(engine);
    expect(getTile).toHaveBeenCalledTimes(8);
  });

  it("repaints every tile after the scene is disposed, with the same sim and revision", () => {
    const { engine, getTile, cell } = fakeEngine(tower());
    syncScene(engine);
    disposeScene(engine);
    // The whole record resets, so the old view's unit list is not kept alive.
    expect(engine.structPass).toEqual(emptyStructPass());
    expect(cell(4, 1)?.gfx).toEqual([]);
    expect(engine.structTiles.size).toBe(0);
    getTile.mockClear();
    syncScene(engine);
    expect(getTile).toHaveBeenCalledTimes(8);
    expect(cell(4, 1)?.gfx).toEqual(["grand-left 0"]);
    expect(cell(6, 2)?.gfx).toEqual(["floor"]);
    expect(engine.structTiles.size).toBe(8);
  });

  it("records what it drew, so the next unchanged sync skips again", () => {
    const state = tower();
    const { engine, getTile } = fakeEngine(state);
    syncScene(engine);
    engine.litState = true;
    syncScene(engine);
    // A revision move on its own (the same unit list) walks the tiles too.
    getTile.mockClear();
    state.revision = 6;
    syncScene(engine);
    expect(getTile).toHaveBeenCalledTimes(8);
    getTile.mockClear();
    engine.d.hour = 11;
    syncScene(engine);
    expect(getTile).not.toHaveBeenCalled();
  });

  it("moves the floor-1 entrances when the lobby layout changes", () => {
    const state = tower();
    const { engine, cell } = fakeEngine(state);
    syncScene(engine);
    // Lobby x4..7: grand entrance on 4 and 5, service door on 7.
    expect(cell(4, 1)?.gfx).toEqual(["grand-left 0"]);
    expect(cell(5, 1)?.gfx).toEqual(["grand-right 0"]);
    expect(cell(7, 1)?.gfx).toEqual(["service 0"]);
    // Bulldoze the leftmost lobby tile and extend the lobby to the right.
    state.units = [...state.units.filter((u) => !(u.kind === "lobby" && u.x === 4)), tile("lobby", 1, 8)];
    state.revision = 6;
    syncScene(engine);
    expect(cell(4, 1)?.gfx).toEqual([]);
    expect(cell(5, 1)?.gfx).toEqual(["grand-left 0"]);
    expect(cell(6, 1)?.gfx).toEqual(["grand-right 0"]);
    // The old service tile is now a plain ground-floor lobby tile.
    expect(String(cell(7, 1)?.gfx[0])).toMatch(/^ground 0:/);
    expect(cell(8, 1)?.gfx).toEqual(["service 0"]);
  });
});
