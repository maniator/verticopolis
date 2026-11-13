import { describe, it, expect, vi } from "vitest";
import * as ex from "excalibur";
import { FLOOR, TILE } from "../scale";
import { syncMotion, updateMotion } from "./towerCrowd";
import { figureOf } from "./crowdLook";

/**
 * The elevator-car glide as WIRED into the renderer (GH #688, #2097): glide
 * persistence across frames, the shaft-span clamp, and the draw-state
 * carry-over across a syncMotion rebuild; and the decorative passers-by
 * (#2091). Split from towerCrowd.test.ts to respect the file-size guard; the
 * pure glide math is pinned in ../carMotion.test.ts, and the fixtures here
 * mirror the sibling's.
 */

const gfx = () => ({ width: 9, height: 25 }) as ex.Graphic;
const actor = () => new ex.Actor({ pos: ex.vec(0, 0), width: 9, height: 25 });

/** The sibling suite's fake sim, trimmed to what the motion paths read. */
function simFixture(over: Record<string, any> = {}): any {
  return {
    mode: "modern",
    population: 400,
    crowd: { people: [] },
    clock: { minutes: 0, hour: 12, minuteOfDay: 12 * 60, isMorning: () => false, isEvening: () => false, isNight: () => false },
    tower: { revision: 1, units: [] },
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
    tunnelActors: [],
    truckActors: [],
    garageCars: [],
    walkers: [],
    passersBy: true,
    reducedMotion: false,
    floorLive: new Map(),
    floorLiveHour: -1,
    floorLiveRev: -1,
    displayParkingUse: 0,
    people: { get: vi.fn((_key: number) => gfx()) },
    worldX: (tile: number) => tile * TILE,
    worldYTop: (floor: number, h = 1) => -(floor + h - 1) * FLOOR,
    sim: simFixture(),
    ...over,
  };
}

describe("car glide wiring (GH #688, #2097)", () => {
  it("glides a persisting car toward a moved sim position instead of teleporting (GH #688)", () => {
    // Same entry object across frames: the glide must move the actor
    // PART of the way per 60fps frame. Reverting to a raw carPositions draw
    // lands exactly on the target in one call and fails the between bound.
    const car = {
      actor: actor(),
      // Idle indicator state matching `shown`, so no cab graphic is rebaked
      // (the test DOM has no 2d canvas); the glide only reads positions.
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

  it("carries a car's glide state across a syncMotion rebuild (a build edit must not snap it)", () => {
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

describe("a cab's riders change with the people getting in and out (#2097)", () => {
  it("waits for the drawn car to arrive, and shows a rebuilt cab's riders at once", () => {
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      return new Proxy({ canvas: this }, { get: (t, p) => (p in t ? (t as any)[p] : () => undefined), set: () => true });
    } as any;
    try {
      const t = { id: 7, kind: "elevatorStandard", x: 12, width: 4, bottom: 1, top: 20, cars: 1, carPositions: [5], carDir: [0], carLoad: [0] };
      const e = eng({ sim: simFixture({ tower: { revision: 1, units: [], transports: [t] } }) });
      syncMotion(e);
      updateMotion(e, 1);
      const idle = e.carActors[0].shown;
      t.carLoad[0] = 6; // riders got in on this step
      e.sim.clock = { ...e.sim.clock, minutes: 1 };
      updateMotion(e, 1);
      expect(e.carActors[0].shown).toBe(idle); // the step's glide is still running
      updateMotion(e, 4000);
      expect(e.carActors[0].shown).not.toBe(idle);
      const loaded = e.carActors[0].shown;
      syncMotion(e); // a structural edit rebuilds the cab, idle
      updateMotion(e, 1);
      expect(e.carActors[0].shown).toBe(loaded);
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });
});

describe("the passer-by gate walks the rooms once per hour or layout change (#2091)", () => {
  /** A sim whose `tower.units` read is counted: each read is one occupancy walk. */
  function countedSim() {
    let walks = 0;
    const tower = { revision: 1 } as any;
    Object.defineProperty(tower, "units", {
      get: () => {
        walks++;
        return [{ floor: 7, occupants: 16 }];
      },
    });
    const sim = simFixture({ tower });
    return { sim, tower, walks: () => walks };
  }
  const walker = () => ({ actor: actor(), gfx: gfx(), x0w: 0, x1w: 50, yw: 0, speed: 8, dir: 1, phase: 0, rank: 0.5, floor: 7 });

  it("walks once over many frames, and again after the hour or the layout moves", () => {
    const { sim, tower, walks } = countedSim();
    const e = eng({ sim, walkers: [walker()] });
    for (let frame = 0; frame < 30; frame++) updateMotion(e);
    expect(walks()).toBe(1);
    sim.clock.hour = 13;
    for (let frame = 0; frame < 30; frame++) updateMotion(e);
    expect(walks()).toBe(2);
    tower.revision = 2;
    for (let frame = 0; frame < 30; frame++) updateMotion(e);
    expect(walks()).toBe(3);
  });

  it("never walks on a tower with no passers-by", () => {
    const { sim, walks } = countedSim();
    const e = eng({ sim });
    for (let frame = 0; frame < 30; frame++) updateMotion(e);
    expect(walks()).toBe(0);
  });
});

describe("decorative passers-by (#2091)", () => {
  const mkWalker = (over: Record<string, unknown> = {}) =>
    ({
      actor: actor(), look: 2, key: -1, x0w: 100, x1w: 200, yw: -100,
      speed: 8, dir: 1, phase: 0.2, rank: 0.5,
      floor: 7, ...over,
    }) as any;
  /** Floor 7 holds 16 occupants (fully lively); floor 9 holds 4 (a quarter). */
  const lively = () => simFixture({ tower: { revision: 1, units: [{ floor: 7, occupants: 16 }, { floor: 9, occupants: 4 }] } });

  it("shows a figure only while its own floor has enough live occupants", () => {
    const busy = mkWalker();
    const quiet = mkWalker({ floor: 9 }); // rank 0.5 above floor 9's 0.25
    const firstOnQuiet = mkWalker({ floor: 9, rank: 0.2 });
    const empty = mkWalker({ floor: 12, rank: 0.01 });
    const e = eng({ walkers: [busy, quiet, firstOnQuiet, empty], d: { anim: 3, stress: 0 }, sim: lively() });
    updateMotion(e);
    expect([busy, quiet, firstOnQuiet, empty].map((w) => w.actor.graphics.isVisible)).toEqual([true, false, true, false]);
    expect(e.floorLive.get(7)).toBeCloseTo(1, 6);
    expect(e.floorLive.get(9)).toBeCloseTo(0.25, 6);
  });

  it("paces back and forth inside its span, on its own floor line", () => {
    const w = mkWalker();
    const e = eng({ walkers: [w], sim: lively() });
    const xs: number[] = [];
    for (let i = 0; i < 40; i++) {
      e.d.anim = i * 0.37;
      updateMotion(e);
      xs.push(w.actor.pos.x);
      expect(w.actor.pos.y).toBe(-100);
    }
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...xs)).toBeLessThanOrEqual(200);
    expect(new Set(xs.map((x) => Math.round(x))).size).toBeGreaterThan(5);
  });

  it("hides every figure when the Settings switch is off", () => {
    const w = mkWalker();
    const e = eng({ walkers: [w], passersBy: false, sim: lively() });
    updateMotion(e);
    expect(w.actor.graphics.isVisible).toBe(false);
    e.passersBy = true;
    updateMotion(e);
    expect(w.actor.graphics.isVisible).toBe(true);
  });

  it("hides every figure under reduced motion", () => {
    const w = mkWalker();
    const e = eng({ walkers: [w], reducedMotion: true, sim: lively() });
    updateMotion(e);
    expect(w.actor.graphics.isVisible).toBe(false);
  });

  it("never turns a passer-by red, however stressed the tower is", () => {
    // A mood color tells the player a real person has waited too long; a
    // passer-by has no wait, so it keeps its own figure.
    const w = mkWalker();
    const e = eng({ walkers: [w], d: { anim: 1, stress: 1 }, sim: lively() });
    for (let i = 0; i < 20; i++) {
      e.d.anim = 1 + i * 0.13;
      updateMotion(e);
    }
    expect(w.actor.graphics.isVisible).toBe(true);
    const shown = e.people.get.mock.calls.map(([key]: [number]) => figureOf(key));
    expect(shown.length).toBeGreaterThan(0);
    for (const f of shown) expect(f).toMatchObject({ look: 2, pose: "walk", mood: "content" });
  });

  it("walks its pacing: the walk frame moves on and it faces the way it goes", () => {
    const w = mkWalker();
    const e = eng({ walkers: [w], sim: lively() });
    const seen: { frame: number; left: boolean; x: number }[] = [];
    for (let i = 0; i < 60; i++) {
      e.d.anim = i * 0.05;
      updateMotion(e);
      seen.push({ ...figureOf(w.key), x: w.actor.pos.x });
    }
    expect(new Set(seen.map((s) => s.frame)).size).toBe(4);
    // Away from the turn-arounds, a figure faces the way it moves.
    for (let i = 2; i < seen.length; i++) {
      const dx = seen[i].x - seen[i - 1].x;
      const before = seen[i - 1].x - seen[i - 2].x;
      if (Math.abs(dx) > 0.5 && Math.sign(dx) === Math.sign(before)) expect(seen[i].left).toBe(dx < 0);
    }
  });
});

describe("a bomb search clears the decorative passers-by and garage cars", () => {
  const walker = () =>
    ({ actor: actor(), look: 2, key: -1, x0w: 0, x1w: 50, yw: 0, speed: 8, dir: 1, phase: 0, rank: 0.5, floor: 7 }) as any;
  const garageCar = () => ({ actor: actor(), seed: 3, x0w: 0, x1w: 50, floor: 0 });
  const morning = (bombSearch: unknown) =>
    simFixture({
      bombSearch,
      clock: { hour: 8, minuteOfDay: 8 * 60, isMorning: () => true, isEvening: () => false, isNight: () => false },
      tower: { revision: 1, units: [{ floor: 7, occupants: 16 }] },
    });

  it("shows both on a calm morning rush", () => {
    const w = walker();
    const g = garageCar();
    updateMotion(eng({ sim: morning(null), walkers: [w], garageCars: [g], displayParkingUse: 1 }));
    expect(w.actor.graphics.isVisible).toBe(true);
    expect(g.actor.graphics.isVisible).toBe(true);
  });

  it("hides both while the search runs", () => {
    const w = walker();
    const g = garageCar();
    const search = { deadline: 13 * 60, sweeping: [], searched: [], seq: 1, lockdown: true };
    updateMotion(eng({ sim: morning(search), walkers: [w], garageCars: [g], displayParkingUse: 1 }));
    expect(w.actor.graphics.isVisible).toBe(false);
    expect(g.actor.graphics.isVisible).toBe(false);
  });

  it("keeps both for a bomb nobody searches for (no Security)", () => {
    const w = walker();
    const g = garageCar();
    const search = { deadline: 13 * 60, sweeping: [], searched: [], seq: 1, lockdown: false };
    updateMotion(eng({ sim: morning(search), walkers: [w], garageCars: [g], displayParkingUse: 1 }));
    expect(w.actor.graphics.isVisible).toBe(true);
    expect(g.actor.graphics.isVisible).toBe(true);
  });
});
