import { describe, expect, it, vi } from "vitest";
import type * as ex from "excalibur";
import { FLOOR, TILE } from "../scale";
import { figureOf } from "./crowdLook";
import { reconcileCrowd, tickCrowdClock } from "./towerCrowd";
import { HallDoorLayer } from "./towerHallDoors";

/**
 * Getting on and off an elevator: the crowd pass shows a rider boarding or
 * leaving when the drawn car gets there, and walks a boarding rider from the
 * line into the car's door. Real (drawing-free) `ex.Actor`s, fake graphics,
 * as in `towerCrowd.test.ts`.
 */

/** One drawn frame of `ms`: the step clock, then the crowd pass. */
function frame(e: any, ms = 1000 / 60): void {
  tickCrowdClock(e, ms);
  reconcileCrowd(e);
}

const gfx = () => ({ width: 9, height: 25 }) as ex.Graphic;

/** The fields the crowd pass reads, with `people` in the crowd and
 *  `transports` in the tower. */
function eng(people: unknown[], transports: unknown[] = []): any {
  return {
    engine: { add: vi.fn() },
    d: { anim: 0, stress: 0 },
    cam: { zoom: 1 },
    crowdCulled: false,
    crowdActors: new Map(),
    hallDoors: new HallDoorLayer(),
    paused: false,
    people: { get: vi.fn((_key: number) => gfx()) },
    worldX: (tile: number) => tile * TILE,
    worldYTop: (floor: number, h = 1) => -(floor + h - 1) * FLOOR,
    sim: { mode: "modern", population: 400, crowd: { people }, clock: { minutes: 0 }, tower: { transports } },
  };
}

describe("riders getting on and off an elevator", () => {
  it("gets a rider in and out of a car when the drawn car arrives, not a step early", () => {
    const person = { id: 1, seed: 0, staff: false, state: "waiting", x: 10, fy: 5, wait: 0 };
    const e = eng([person]);
    frame(e, 16);
    frame(e, 484);
    const rec = e.crowdActors.get(1);
    // The engine puts them in the car on this step; the drawn car is still
    // gliding to the landing, so they wait there in sight.
    Object.assign(person, { state: "riding" });
    e.sim.clock = { ...e.sim.clock, minutes: 1 };
    frame(e, 16);
    frame(e, 100);
    expect(rec.actor.graphics.isVisible, "while the car is on its way").toBe(true);
    // The glide ends: they are in the car.
    frame(e, 1000);
    expect(rec.actor.graphics.isVisible, "once the car is there").toBe(false);
    // Out at floor 9: hidden until the drawn car gets there, then standing at the landing.
    Object.assign(person, { state: "toDest", fy: 9, x: 11 });
    e.sim.clock = { ...e.sim.clock, minutes: 2 };
    frame(e, 600);
    expect(rec.actor.graphics.isVisible, "while the car rides up").toBe(false);
    e.sim.clock = { ...e.sim.clock, minutes: 3 };
    frame(e, 600);
    expect(rec.actor.graphics.isVisible, "the next step").toBe(true);
    expect(rec.actor.pos.y).toBeCloseTo(-9 * FLOOR + FLOOR - 3, 6);
  });

  it("walks a rider from the line into the car's door instead of vanishing from the line", () => {
    // Waiting at the back of the line at x 6; the shaft is x 10-14, door at 12.
    const person = { id: 1, seed: 0, staff: false, state: "waiting", x: 6, floor: 5, fy: 5, wait: 0 };
    const car = { kind: "elevatorStandard", width: 4, bottom: 0, top: 20, cars: 1, carPositions: [5], carDir: [0] };
    const e = eng([person], [{ id: 9, x: 10, ...car }]);
    for (let m = 1; m <= 3; m++) {
      e.sim.clock = { ...e.sim.clock, minutes: m };
      frame(e, 500);
    }
    const rec = e.crowdActors.get(1);
    expect(rec.actor.pos.x).toBeCloseTo(6 * TILE, 6);
    // The engine puts them in the car on this step, still standing in line.
    Object.assign(person, { state: "riding" });
    e.sim.clock = { ...e.sim.clock, minutes: 4 };
    frame(e, 250);
    expect(rec.actor.graphics.isVisible, "walking to the door").toBe(true);
    expect(rec.actor.pos.x, "on the way").toBeGreaterThan(6 * TILE);
    expect(rec.actor.pos.x, "not there yet").toBeLessThan(12 * TILE);
    expect(figureOf(rec.key).pose).toBe("walk");
    frame(e, 249);
    expect(rec.actor.pos.x, "at the door").toBeCloseTo(12 * TILE, 0);
    // The step's glide ends: they are in the car.
    frame(e, 100);
    expect(rec.actor.graphics.isVisible, "in the car").toBe(false);
  });
});
