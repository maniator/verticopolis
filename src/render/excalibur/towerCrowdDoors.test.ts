import { describe, expect, it, vi } from "vitest";
import * as ex from "excalibur";
import { Z } from "../depthPlanes";
import { FLOOR, TILE } from "../scale";
import { DOOR_RADIUS } from "../sprites/structure/revolvingDoor";
import { figureOf, MAX_STEP_MS } from "./crowdLook";
import { reconcileCrowd, tickCrowdClock } from "./towerCrowd";
import { HallDoorLayer } from "./towerHallDoors";

/** One drawn frame of `ms`: the step clock, then the crowd pass (the order `TowerEngine.tick` runs them in). */
function frame(e: any, ms = 1000 / 60): void {
  tickCrowdClock(e, ms);
  reconcileCrowd(e);
}

/**
 * The crowd pass and the revolving doors between lobby halls (#2068): a real
 * routed person inside a drum pushes it, drawn behind the center post when
 * walking left and in front when walking right, and the door turns by how far
 * they walked. Real (drawing-free) `ex.Actor`s, fake graphics, as in
 * `towerCrowd.test.ts`.
 */

const gfx = () => ({ width: 9, height: 25 }) as ex.Graphic;

/** The fields the crowd pass reads, with a live zoom and no one on screen yet. */
function eng(): any {
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
    sim: { mode: "modern", population: 400, crowd: { people: [] }, clock: { minutes: 0 } },
  };
}

/** One engine step to `people`: the step's frame, then a frame long enough
 *  for every figure to finish its glide there. */
function step(e: any, people: unknown[]): void {
  e.sim.crowd.people = people;
  e.sim.clock = { minutes: e.sim.clock.minutes + 1 };
  frame(e, 16);
  frame(e, MAX_STEP_MS);
}

describe("reconcileCrowd walks real people through the revolving doors", () => {
  /** A door on floor 5 whose wall stands at world x 200 (column 20), with
   *  recording canvases. */
  function withDoor() {
    const e = eng();
    const canvases = [{ flagDirty: vi.fn() }, { flagDirty: vi.fn() }, { flagDirty: vi.fn() }];
    const door = { door: { floor: 5, x: 20, tall: 3, short: 2, tallOnLeft: true }, wx: 20 * TILE, angle: 0.5, lit: false, push: 0, actors: [], canvases };
    e.hallDoors.byFloor.set(5, [door]);
    e.hallDoors.byKey.set("door", door);
    return { e, door, canvases };
  }
  const walker = (id: number, x: number) => ({ id, seed: id, staff: false, state: "toDest", x, fy: 5, floor: 5, wait: 0 });

  it("draws a leftbound walker behind the center post and a rightbound one in front, each pushing", () => {
    const { e, door, canvases } = withDoor();
    e.sim.crowd.people = [walker(1, 20.6), walker(2, 19.6), walker(3, 40)];
    frame(e);
    step(e, [walker(1, 20.4), walker(2, 19.9), walker(3, 40)]);
    const left = e.crowdActors.get(1);
    const right = e.crowdActors.get(2);
    const outside = e.crowdActors.get(3);
    expect(left.actor.z).toBe(Z.crowdBehindDoor);
    expect(right.actor.z).toBe(Z.crowd);
    // Outside the drum, a walker passes behind the shafts as usual.
    expect(outside.actor.z).toBe(Z.walking);
    expect(figureOf(left.key)).toMatchObject({ pose: "push", left: true });
    expect(figureOf(right.key)).toMatchObject({ pose: "push", left: false });
    expect(figureOf(outside.key).pose).not.toBe("push");
    // The door turned by the farthest one person walked inside it (3 px),
    // over the wing's radius, and repainted only the parts that turn.
    expect(door.angle).toBeCloseTo(0.5 + (0.3 * TILE) / DOOR_RADIUS, 6);
    expect(door.push).toBe(0);
    expect(canvases[0].flagDirty).toHaveBeenCalled();
    expect(canvases[1].flagDirty).toHaveBeenCalled();
    expect(canvases[2].flagDirty).not.toHaveBeenCalled();
  });

  it("leaves the door still while the people inside stand, and drops the pose once they are out", () => {
    const { e, door } = withDoor();
    e.sim.crowd.people = [walker(1, 20.2)];
    frame(e);
    const angle = door.angle;
    frame(e);
    expect(door.angle).toBe(angle);
    // Walking out: the step's frame still draws them in the drum, so the
    // glide carries them out from there.
    e.sim.crowd.people = [walker(1, 23)];
    e.sim.clock = { minutes: 1 };
    frame(e, 16);
    const turned = door.angle;
    frame(e, MAX_STEP_MS);
    const rec = e.crowdActors.get(1);
    expect(figureOf(rec.key).pose).not.toBe("push");
    expect(rec.actor.z).toBe(Z.walking);
    // Once outside the drum, walking on no longer turns the door.
    frame(e, MAX_STEP_MS);
    expect(door.angle).toBeGreaterThanOrEqual(turned);
    const after = door.angle;
    step(e, [walker(1, 26)]);
    expect(door.angle).toBe(after);
  });

  it("never turns a door for a climber passing between floors", () => {
    const { e, door } = withDoor();
    e.sim.crowd.people = [{ ...walker(1, 20.6), state: "climbing", fy: 5.5 }];
    frame(e);
    step(e, [{ ...walker(1, 20.2), state: "climbing", fy: 5.6 }]);
    expect(door.angle).toBe(0.5);
    expect(e.crowdActors.get(1).actor.z).toBe(Z.crowd);
  });

  it("does not count a ride or a climb as a step through the door", () => {
    const { e, door } = withDoor();
    // On foot far from the door, then off out of sight in a car, then out
    // of the car standing inside the drum: no step was walked there.
    step(e, [walker(1, 2)]);
    step(e, [{ ...walker(1, 2), state: "riding" }]);
    step(e, [walker(1, 20.2)]);
    expect(door.angle, "after the ride").toBe(0.5);
    // The same for a climber who left the floor at the far end of the lot.
    step(e, [{ ...walker(2, 40), fy: 4 }]);
    step(e, [{ ...walker(2, 30), fy: 4.5 }]);
    step(e, [walker(2, 19.8)]);
    expect(door.angle, "after the climb").toBe(0.5);
    // Once on foot inside it, a step does push it.
    step(e, [walker(2, 19.9)]);
    expect(door.angle).toBeCloseTo(0.5 + (0.1 * TILE) / DOOR_RADIUS, 6);
  });
});
