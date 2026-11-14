import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransportView, UnitView } from "../../simport/view";
import type { TowerEngine } from "./TowerEngine";
import { syncScene } from "./towerReconcile";
import { emptyStructPass } from "./towerStructTiles";
import { HallDoorLayer } from "./towerHallDoors";
import { NO_TALL_HALLS } from "../lobbyHalls";

// Flights beside a venue (venueFlights.ts): the reconcile gathers the venues
// on its walk of the rooms and restyles a flight the sync a venue appears or
// goes. Driven with the same hand-built engine as towerReconcileFire.test.ts.
// The reconcile is driven with a hand-built engine: no canvas bakes here. The
// region functions are stubs that keep `regionUnits` the way the real ones do
// (a settled unit has an entry, a dropped one does not), and `addRoom` (real)
// stands up a private actor on a fake `engine.add`.
// A Node test has no 2d canvas, so a private actor gets a plain stand-in for
// `ex.Canvas` and a recording `kill`; everything else of Excalibur is real.
vi.mock("excalibur", async (importOriginal) => {
  const real = await importOriginal<typeof import("excalibur")>();
  class FakeCanvas {
    constructor(readonly options: unknown) {}
  }
  class FakeActor {
    readonly graphics = { use: vi.fn() };
    readonly collider = { use: vi.fn() };
    kill = vi.fn();
  }
  return { ...real, Canvas: FakeCanvas, Actor: FakeActor };
});
vi.mock("./towerScenery", () => ({ syncScenery: vi.fn() }));
vi.mock("./roomSignature", () => ({ roomSignature: () => "sig", isDeadParking: () => false }));
vi.mock("../regionPaint", () => ({ paintAnimatedUnit: vi.fn() }));
const rules = { venueFlights: true };
vi.mock("../../catalog/towerCatalog", () => ({ towerCatalog: () => ({ rules }) }));
vi.mock("../../catalog/catalogTypes", () => ({ catalogFacility: (_: unknown, kind: string) => ({ floors: kind === "cinema" ? 2 : 1 }) }));
vi.mock("./towerCrowd", () => ({
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
}));

const cinema = { id: 7, kind: "cinema", floor: 2, x: 100, width: 31, state: "occupied", occupants: 0 } as unknown as UnitView;
const stairs = { id: 40, kind: "stairs", x: 92, width: 8, bottom: 2, top: 3, cars: 0, carPositions: [], carDir: [] } as TransportView;
const lift = { id: 41, kind: "elevatorStandard", x: 96, width: 4, bottom: 2, top: 3, cars: 1, carPositions: [2], carDir: [0] } as TransportView;

/** Just the engine surface `syncScene` reads: `units` and `transports` are
 *  live arrays, and an edit bumps the revision the way the view does. */
function fakeEngine(units: UnitView[]): TowerEngine & { sim: { tower: { units: UnitView[]; revision: number } } } {
  return {
    sim: {
      tower: {
        units,
        revision: 1,
        getUnit: (id: number) => units.find((u) => u.id === id),
        transports: [stairs, lift],
        functionalParkingSet: () => new Set<number>(),
        tallLobbies: () => NO_TALL_HALLS,
      },
      parkingUsage: () => 0,
      recyclingFill: () => 0,
    },
    engine: { add: vi.fn() },
    d: {},
    litState: false,
    floor1EntranceMap: new Map(),
    structTiles: new Set(),
    structPass: emptyStructPass(),
    animatedRooms: new Map(),
    roomSig: new Map(),
    regionUnits: new Map(),
    transportActors: new Map(),
    transportSig: new Map(),
    windingFlights: new Set(),
    hallDoors: new HallDoorLayer(),
    worldX: (x: number) => x * 16,
    worldYTop: (floor: number) => floor * 16,
  } as unknown as TowerEngine & { sim: { tower: { units: UnitView[]; revision: number } } };
}

describe("a flight beside a venue restyles with the venue", () => {
  beforeEach(() => {
    rules.venueFlights = true;
  });

  it("winds the stairway against the cinema's wall and leaves the elevator alone", () => {
    const engine = fakeEngine([cinema]);
    syncScene(engine);
    expect([...engine.windingFlights]).toEqual([40]);
    expect(engine.transportSig.get(40)).toMatch(/:winds$/);
    expect(engine.transportSig.get(41)).not.toMatch(/winds/);
  });

  it("straightens the stairway the sync the cinema is bulldozed, and winds it again on undo", () => {
    const engine = fakeEngine([cinema]);
    syncScene(engine);
    const wound = engine.transportActors.get(40)!;
    engine.sim.tower.units.splice(0, 1);
    engine.sim.tower.revision++;
    syncScene(engine);
    expect(wound.kill).toHaveBeenCalledTimes(1);
    expect(engine.transportSig.get(40)).not.toMatch(/winds/);
    const straight = engine.transportActors.get(40)!;
    expect(straight).not.toBe(wound);
    engine.sim.tower.units.push(cinema);
    engine.sim.tower.revision++;
    syncScene(engine);
    expect(straight.kill).toHaveBeenCalledTimes(1);
    expect(engine.transportSig.get(40)).toMatch(/:winds$/);
  });

  it("keeps the same actor across syncs where nothing beside it changed", () => {
    const engine = fakeEngine([cinema]);
    syncScene(engine);
    const actor = engine.transportActors.get(40);
    syncScene(engine);
    expect(engine.transportActors.get(40)).toBe(actor);
    expect(actor!.kill).not.toHaveBeenCalled();
  });

  it("draws every flight straight in a mode whose catalog says so (Classic)", () => {
    rules.venueFlights = false;
    const engine = fakeEngine([cinema]);
    syncScene(engine);
    expect(engine.windingFlights.size).toBe(0);
    expect(engine.transportSig.get(40)).not.toMatch(/winds/);
  });
});
