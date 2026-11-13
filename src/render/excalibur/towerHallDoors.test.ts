import { describe, expect, it, vi } from "vitest";
import { Z } from "../depthPlanes";
import type { HallDoor } from "../lobbyHalls";
import { FLOOR, TILE } from "../scale";
import { DOOR_RADIUS } from "../sprites/structure/revolvingDoor";
import type { TowerEngine } from "./TowerEngine";
import { clearHallDoors, HallDoorLayer, pushThroughDoors, relightHallDoors, syncHallDoors, turnHallDoors } from "./towerHallDoors";

// A Node test has no 2d canvas: `ex.Canvas` is a stand-in that records its
// options and repaints, and `ex.Actor` records its plane, graphic and kill.
vi.mock("excalibur", async (importOriginal) => {
  const real = await importOriginal<typeof import("excalibur")>();
  class FakeCanvas {
    readonly flagDirty = vi.fn();
    constructor(readonly options: { width: number; height: number; draw: (ctx: unknown) => void }) {}
  }
  class FakeActor {
    readonly graphics = { use: vi.fn() };
    readonly z: number;
    readonly pos: { x: number; y: number };
    kill = vi.fn();
    constructor(o: { z: number; pos: { x: number; y: number } }) {
      this.z = o.z;
      this.pos = o.pos;
    }
  }
  return { ...real, Canvas: FakeCanvas, Actor: FakeActor };
});

/** The door layer's slice of the renderer: world coordinates, the lights and `engine.add`. */
function fakeEngine() {
  return {
    engine: { add: vi.fn() },
    litState: false,
    hallDoors: new HallDoorLayer(),
    worldX: (x: number) => x * TILE,
    worldYTop: (floor: number) => -floor * FLOOR,
  } as unknown as TowerEngine & { engine: { add: ReturnType<typeof vi.fn> } };
}

type Fake = { flagDirty: ReturnType<typeof vi.fn>; options: { width: number; height: number } };
const door = (over: Partial<HallDoor> = {}): HallDoor => ({ floor: 1, x: 20, tall: 3, short: 2, tallOnLeft: true, ...over });
const recOf = (e: TowerEngine) => [...e.hallDoors.byKey.values()][0];

describe("syncHallDoors", () => {
  it("puts up three actors per door around the crowd's plane, as tall as the taller hall", () => {
    const e = fakeEngine();
    syncHallDoors(e, [door()]);
    expect(e.engine.add).toHaveBeenCalledTimes(3);
    const rec = recOf(e);
    expect(rec.actors.map((a) => a.z)).toEqual([Z.hallDoorBack, Z.hallDoorMiddle, Z.hallDoorFront]);
    expect(Z.hallDoorBack < Z.crowdBehindDoor && Z.crowdBehindDoor < Z.hallDoorMiddle && Z.hallDoorMiddle < Z.crowd && Z.crowd < Z.hallDoorFront).toBe(true);
    expect((rec.canvases[0] as unknown as Fake).options.height).toBe(3 * FLOOR);
    // The wall stands on the right-hand hall's left edge; the actor's top is the taller hall's ceiling.
    expect(rec.wx).toBe(20 * TILE);
    expect(rec.actors[0].pos.y).toBe(-3 * FLOOR);
    expect(e.hallDoors.byFloor.get(1)).toEqual([rec]);
  });

  it("keeps a door that stays, with its angle, and takes down one that goes", () => {
    const e = fakeEngine();
    syncHallDoors(e, [door(), door({ floor: 15, x: 8, tall: 2, short: 1 })]);
    const kept = e.hallDoors.byKey.get("1:20:3:2:true");
    const gone = e.hallDoors.byKey.get("15:8:2:1:true");
    kept!.angle = 1.25;
    syncHallDoors(e, [door()]);
    expect(e.engine.add).toHaveBeenCalledTimes(6);
    expect(e.hallDoors.byKey.get("1:20:3:2:true")).toBe(kept);
    expect(kept!.angle).toBe(1.25);
    expect(gone!.actors.every((a) => vi.mocked(a.kill).mock.calls.length === 1)).toBe(true);
    expect([...e.hallDoors.byFloor.keys()]).toEqual([1]);
  });

  it("builds a new door when a hall's height changes, since its wall changes", () => {
    const e = fakeEngine();
    syncHallDoors(e, [door()]);
    const old = recOf(e);
    syncHallDoors(e, [door({ short: 1 })]);
    expect(recOf(e)).not.toBe(old);
    expect(old.actors.every((a) => vi.mocked(a.kill).mock.calls.length === 1)).toBe(true);
  });

  it("repaints a door when the lights change, and only then", () => {
    const e = fakeEngine();
    syncHallDoors(e, [door()]);
    const canvases = recOf(e).canvases as unknown as Fake[];
    relightHallDoors(e);
    expect(canvases.every((c) => c.flagDirty.mock.calls.length === 0)).toBe(true);
    e.litState = true;
    relightHallDoors(e);
    expect(canvases.every((c) => c.flagDirty.mock.calls.length === 1)).toBe(true);
    expect(recOf(e).lit).toBe(true);
  });

  it("clears every door on a scene swap", () => {
    const e = fakeEngine();
    syncHallDoors(e, [door()]);
    const rec = recOf(e);
    clearHallDoors(e);
    expect(e.hallDoors.byKey.size + e.hallDoors.byFloor.size).toBe(0);
    expect(rec.actors.every((a) => vi.mocked(a.kill).mock.calls.length === 1)).toBe(true);
  });
});

describe("pushThroughDoors and turnHallDoors", () => {
  it("names the way a person walks through a drum, and nothing outside it or on another floor", () => {
    const e = fakeEngine();
    syncHallDoors(e, [door()]);
    const who = {};
    const wx = 20 * TILE;
    expect(pushThroughDoors(e, who, 1, wx + DOOR_RADIUS + 1)).toBeUndefined();
    expect(pushThroughDoors(e, who, 1, wx + 4)).toBe(-1);
    expect(pushThroughDoors(e, who, 1, wx + 6)).toBe(1);
    expect(pushThroughDoors(e, {}, 2, wx)).toBeUndefined();
  });

  it("turns a door by the farthest step taken inside it, then waits for the next push", () => {
    const e = fakeEngine();
    syncHallDoors(e, [door()]);
    const rec = recOf(e);
    const canvases = rec.canvases as unknown as Fake[];
    const a = {};
    const b = {};
    const wx = 20 * TILE;
    pushThroughDoors(e, a, 1, wx - 5);
    pushThroughDoors(e, b, 1, wx + 5);
    turnHallDoors(e);
    const start = rec.angle;
    expect(canvases[0].flagDirty).not.toHaveBeenCalled();
    pushThroughDoors(e, a, 1, wx - 3);
    pushThroughDoors(e, b, 1, wx + 4);
    turnHallDoors(e);
    expect(rec.angle).toBeCloseTo(start + 2 / DOOR_RADIUS, 9);
    expect(canvases.map((c) => c.flagDirty.mock.calls.length)).toEqual([1, 1, 0]);
    turnHallDoors(e);
    expect(rec.angle).toBeCloseTo(start + 2 / DOOR_RADIUS, 9);
  });
});
