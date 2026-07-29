import { describe, it, expect, vi } from "vitest";
import * as ex from "excalibur";
import { FLOOR, TILE } from "../scale";
import { syncMotion, updateMotion } from "./towerCrowd";

/**
 * The eased elevator-car draw motion as WIRED into the renderer (GH #688,
 * spec-elevator-car-motion): glide persistence across frames, the shaft-span
 * clamp, and the draw-state carry-over across a syncMotion rebuild. Split from
 * towerCrowd.test.ts to respect the file-size guard; the pure pursuit math is
 * pinned in ../carMotion.test.ts, and the fixtures here mirror the sibling's.
 */

const gfx = () => ({ width: 9, height: 25 }) as ex.Graphic;
const actor = () => new ex.Actor({ pos: ex.vec(0, 0), width: 9, height: 25 });

/** The sibling suite's fake sim, trimmed to what the motion paths read. */
function simFixture(over: Record<string, any> = {}): any {
  return {
    population: 400,
    crowd: { people: [] },
    clock: { hour: 12, minuteOfDay: 12 * 60, isMorning: () => false, isEvening: () => false, isNight: () => false },
    tower: { revision: 1, units: [] },
    positionReachable: () => true,
    ...over,
  };
}

/** The sibling suite's fake engine, trimmed to what the motion paths read. */
function eng(over: Record<string, any> = {}): any {
  return {
    engine: { add: vi.fn() },
    d: { anim: 0, stress: 0 },
    cam: { zoom: 1 },
    crowdCulled: false,
    crowdActors: new Map(),
    carActors: [],
    trainActors: [],
    truckActors: [],
    garageCars: [],
    walkers: [],
    floorLive: new Map(),
    floorLiveHour: -1,
    floorLiveRev: -1,
    displayParkingUse: 0,
    personGfx: [gfx(), gfx(), gfx()],
    personGfxStaff: gfx(),
    personGfxRed: gfx(),
    worldX: (tile: number) => tile * TILE,
    worldYTop: (floor: number, h = 1) => -(floor + h - 1) * FLOOR,
    sim: simFixture(),
    ...over,
  };
}

describe("eased car motion wiring (GH #688)", () => {
  it("glides a persisting car toward a moved sim position instead of teleporting (GH #688)", () => {
    // Same entry object across frames: the eased pursuit must move the actor
    // PART of the way per 60fps frame. Reverting to a raw carPositions draw
    // lands exactly on the target in one call and fails the between bound.
    const car = {
      actor: actor(),
      // Idle indicator state matching `shown`, so no cab graphic is rebaked
      // (the test DOM has no 2d canvas); the pursuit only reads positions.
      t: { x: 12, kind: "elevatorStandard", carPositions: [8], carLoad: [0], carDir: [0] },
      i: 0, seed: 0, w: 4 * TILE, kind: "elevatorStandard",
      gfx: new Map<string, ex.Graphic>(), shown: "0:x:e",
    };
    const e = eng({ carActors: [car] });
    updateMotion(e); // frame 1 lazily seeds AT the sim position (the rebuild snap)
    expect(car.actor.pos.y).toBeCloseTo(-8 * FLOOR, 6);
    car.t.carPositions[0] = 9; // one sim tick later the car is a floor higher
    updateMotion(e);
    const afterOne = -car.actor.pos.y / FLOOR;
    expect(afterOne).toBeGreaterThan(8); // moving...
    expect(afterOne).toBeLessThan(9); // ...but NOT teleported to the target
    updateMotion(e);
    expect(-car.actor.pos.y / FLOOR).toBeGreaterThan(afterOne); // still converging
  });

  it("keeps the drawn position inside the shaft span", () => {
    const car = {
      actor: actor(),
      t: { x: 12, kind: "elevatorStandard", carPositions: [10], bottom: 1, top: 10, carLoad: [0], carDir: [0] },
      i: 0, seed: 0, w: 4 * TILE, kind: "elevatorStandard",
      gfx: new Map<string, ex.Graphic>(), shown: "0:x:e",
    };
    const e = eng({ carActors: [car] });
    updateMotion(e); // seeds at 10 (the top)
    // A reversal at the terminal: momentum could carry the drawn car past the
    // shaft end; the span clamp must hold it at the top floor.
    car.t.carPositions[0] = 12; // hostile or stale sim value beyond the span
    updateMotion(e);
    expect(-car.actor.pos.y / FLOOR).toBeLessThanOrEqual(10 + 1e-9);
  });

  it("carries a car's eased draw state across a syncMotion rebuild (a build edit must not snap it)", () => {
    // syncMotion bakes real cab canvases; the test DOM has no 2d context, so
    // stub getContext with a method-proxying no-op for this test only.
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      return new Proxy({ canvas: this }, { get: (t, p) => (p in t ? (t as any)[p] : () => undefined), set: () => true });
    } as any;
    try {
      const t = { id: 7, kind: "elevatorStandard", x: 12, width: 4, bottom: 1, top: 20, cars: 1, carPositions: [5], carDir: [0], carLoad: [0] };
      const e = eng({ sim: simFixture({ tower: { revision: 1, units: [], transports: [t] } }) });
      syncMotion(e);
      expect(e.carActors.length).toBe(1);
      updateMotion(e); // seed at 5
      t.carPositions[0] = 6;
      updateMotion(e); // start the glide: drawn strictly between 5 and 6
      const midGlide = -e.carActors[0].actor.pos.y / FLOOR;
      expect(midGlide).toBeGreaterThan(5);
      expect(midGlide).toBeLessThan(6);
      syncMotion(e); // a structural edit rebuilds every entry
      updateMotion(e);
      const afterRebuild = -e.carActors[0].actor.pos.y / FLOOR;
      // Carried, not reseeded: the drawn position resumes near the mid-glide
      // point instead of snapping to the sim position.
      expect(afterRebuild).toBeGreaterThan(midGlide - 1e-9);
      expect(afterRebuild).toBeLessThan(6);
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });

});
