import { describe, expect, it, vi } from "vitest";
import type { UnitView } from "../../simport/view";
import type { TowerEngine } from "./TowerEngine";
import { syncScene } from "./towerReconcile";

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
    readonly collider = { set: vi.fn() };
    kill = vi.fn();
  }
  return { ...real, Canvas: FakeCanvas, Actor: FakeActor };
});
vi.mock("./towerScenery", () => ({ syncScenery: vi.fn() }));
vi.mock("./roomSignature", () => ({ roomSignature: () => "sig", isDeadParking: () => false }));
vi.mock("../regionPaint", () => ({ paintAnimatedUnit: vi.fn() }));
vi.mock("../../catalog/towerCatalog", () => ({ towerCatalog: () => ({}) }));
vi.mock("../../catalog/catalogTypes", () => ({ catalogFacility: () => ({ floors: 1 }) }));
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

function office(state: UnitView["state"]): UnitView {
  return { id: 7, kind: "office", floor: 3, x: 4, width: 6, state, occupants: 0 } as unknown as UnitView;
}

/** Just the engine surface `syncScene` reads for a tower of one office. */
function fakeEngine(unit: { current: UnitView }): TowerEngine {
  const add = vi.fn();
  return {
    sim: {
      tower: {
        get units() {
          return [unit.current];
        },
        transports: [],
        functionalParkingSet: () => new Set<number>(),
      },
      parkingUsage: () => 0,
      recyclingFill: () => 0,
    },
    engine: { add },
    d: {},
    litState: false,
    floor1EntranceMap: new Map(),
    structTiles: new Set(),
    animatedRooms: new Map(),
    roomSig: new Map(),
    regionUnits: new Map(),
    transportActors: new Map(),
    transportSig: new Map(),
    worldX: (x: number) => x * 16,
    worldYTop: (floor: number) => floor * 16,
  } as unknown as TowerEngine;
}

describe("a burning room leaves its region for a private actor and returns when the fire is out", () => {
  it("moves a settled room to a private animated actor when it ignites", () => {
    const unit = { current: office("occupied") };
    const engine = fakeEngine(unit);
    syncScene(engine);
    expect(engine.regionUnits.has(7)).toBe(true);
    expect(engine.animatedRooms.has(7)).toBe(false);

    unit.current = office("fire");
    syncScene(engine);
    expect(engine.regionUnits.has(7)).toBe(false); // nothing stays baked under the flames
    expect(engine.animatedRooms.has(7)).toBe(true);
    expect(engine.engine.add).toHaveBeenCalledTimes(1);
  });

  it("keeps one private actor while the fire burns, and none in the region", () => {
    const unit = { current: office("fire") };
    const engine = fakeEngine(unit);
    syncScene(engine);
    const actor = engine.animatedRooms.get(7);
    syncScene(engine);
    syncScene(engine);
    expect(engine.animatedRooms.get(7)).toBe(actor);
    expect(engine.engine.add).toHaveBeenCalledTimes(1);
    expect(engine.regionUnits.has(7)).toBe(false);
  });

  it("retires the actor and bakes the room into its region again once the fire is out", () => {
    const unit = { current: office("fire") };
    const engine = fakeEngine(unit);
    syncScene(engine);
    const actor = engine.animatedRooms.get(7);
    const kill = actor!.kill as unknown as ReturnType<typeof vi.fn>;

    unit.current = office("occupied");
    syncScene(engine);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(engine.animatedRooms.has(7)).toBe(false);
    expect(engine.regionUnits.has(7)).toBe(true); // always in exactly one layer
  });

  it("treats a room under construction the same way", () => {
    const unit = { current: office("construction") };
    const engine = fakeEngine(unit);
    syncScene(engine);
    expect(engine.animatedRooms.has(7)).toBe(true);
    expect(engine.regionUnits.has(7)).toBe(false);
  });
});
