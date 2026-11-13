import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnitView } from "../../simport/view";
import type { TowerEngine } from "./TowerEngine";
import { syncScene } from "./towerReconcile";
import { markRegionUnit } from "./towerRegions";
import { paintAnimatedUnit } from "../regionPaint";
import { emptyStructPass } from "./towerStructTiles";
import { NOT_BAKED } from "./sceneBake";

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

/** Just the engine surface `syncScene` reads for a tower of one office. The
 *  unit list and revision hold still, and a fire or a finished build patches
 *  the room in place, as the view does with a frame (no revision move). So
 *  every sync after the first takes the kept-rooms path, the one a running
 *  tower takes. */
function fakeEngine(unit: UnitView): TowerEngine {
  const add = vi.fn();
  const units = [unit];
  return {
    sim: {
      tower: {
        units,
        revision: 1,
        getUnit(id: number): UnitView | undefined {
          return this.units.find((u) => u.id === id);
        },
        transports: [],
        functionalParkingSet: () => new Set<number>(),
        tallLobbies: () => new Map<number, number>(),
      },
      parkingUsage: () => 0,
      recyclingFill: () => 0,
    },
    engine: { add },
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
    worldX: (x: number) => x * 16,
    worldYTop: (floor: number) => floor * 16,
  } as unknown as TowerEngine;
}

describe("a burning room leaves its region for a private actor and returns when the fire is out", () => {
  it("moves a settled room to a private animated actor when it ignites", () => {
    const unit = office("occupied");
    const engine = fakeEngine(unit);
    syncScene(engine);
    expect(engine.regionUnits.has(7)).toBe(true);
    expect(engine.animatedRooms.has(7)).toBe(false);
    const pass = engine.structPass;

    (unit as { state: UnitView["state"] }).state = "fire";
    syncScene(engine);
    // A full pass writes a new record; the kept-rooms path leaves this one.
    expect(engine.structPass).toBe(pass);
    expect(engine.regionUnits.has(7)).toBe(false); // nothing stays baked under the flames
    expect(engine.animatedRooms.has(7)).toBe(true);
    expect(engine.engine.add).toHaveBeenCalledTimes(1);
  });

  it("keeps one private actor while the fire burns, and none in the region", () => {
    const unit = office("fire");
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
    const unit = office("fire");
    const engine = fakeEngine(unit);
    syncScene(engine);
    const actor = engine.animatedRooms.get(7);
    const kill = actor!.kill as unknown as ReturnType<typeof vi.fn>;

    (unit as { state: UnitView["state"] }).state = "occupied";
    syncScene(engine);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(engine.animatedRooms.has(7)).toBe(false);
    expect(engine.regionUnits.has(7)).toBe(true); // always in exactly one layer
  });

  it("treats a room under construction the same way", () => {
    const unit = office("construction");
    const engine = fakeEngine(unit);
    syncScene(engine);
    expect(engine.animatedRooms.has(7)).toBe(true);
    expect(engine.regionUnits.has(7)).toBe(false);
  });
});

describe("an animated room through an undo or redo step", () => {
  it("draws the room the view holds now, so a build that finishes after the step shows at once", () => {
    const before = office("construction");
    const engine = fakeEngine(before);
    syncScene(engine);
    const actor = engine.animatedRooms.get(7) as unknown as { graphics: { use: ReturnType<typeof vi.fn> } };
    const canvas = actor.graphics.use.mock.calls[0][0] as { options: { draw(ctx: unknown): void } };
    // A step moves the port generation, and the view hands every room over as
    // a new object; the scene keeps this actor, still under construction.
    const after = { ...before };
    Object.assign(engine.sim.tower, { units: [after], revision: 2 });
    syncScene(engine);
    expect(engine.animatedRooms.get(7), "the same actor").toBe(actor);
    (after as { state: UnitView["state"] }).state = "occupied"; // the build finishes between syncs
    canvas.options.draw({});
    const paints = vi.mocked(paintAnimatedUnit).mock.calls;
    expect(paints[paints.length - 1]?.[1], "the live room").toBe(after);
  });
});

describe("a settled room that comes back after the initial bake", () => {
  beforeEach(() => {
    vi.mocked(markRegionUnit).mockClear();
  });

  /** Whether each `markRegionUnit` call of one sync asked for this frame. */
  const sameFrameMarks = (): boolean[] => {
    const marks = vi.mocked(markRegionUnit).mock.calls.map((call) => call[2] === true);
    vi.mocked(markRegionUnit).mockClear();
    return marks;
  };
  /** A new unit list and revision, as the view hands over after an edit or a step. */
  const layout = (engine: TowerEngine, units: UnitView[], revision: number): void => {
    Object.assign(engine.sim.tower, { units, revision });
  };

  it("bakes into its region this frame when an undo or redo puts it back", () => {
    const unit = office("occupied");
    const engine = fakeEngine(unit);
    Object.assign(engine, { builtRev: 1 });
    syncScene(engine);
    sameFrameMarks();
    layout(engine, [], 2); // the bulldoze
    syncScene(engine);
    expect(engine.regionUnits.has(7)).toBe(false);
    layout(engine, [unit], 3); // its undo
    syncScene(engine);
    expect(sameFrameMarks(), "not left to the budgeted drain").toEqual([true]);
    expect(engine.regionUnits.has(7)).toBe(true);
  });

  it("leaves the initial bake to the drain that follows it", () => {
    const engine = fakeEngine(office("occupied"));
    Object.assign(engine, { builtRev: NOT_BAKED });
    syncScene(engine);
    expect(sameFrameMarks()).toEqual([false]);
  });
});
