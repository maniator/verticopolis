import { describe, expect, it, vi } from "vitest";
import * as ex from "excalibur";
import { Z } from "../depthPlanes";
import { SHIRTS } from "../pixelSprites/common";
import { FLOOR, TILE } from "../scale";
import { DOOR_RADIUS } from "../sprites/structure/revolvingDoor";
import { reconcileCrowd } from "./towerCrowd";
import { HallDoorLayer } from "./towerHallDoors";

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
    personGfx: [gfx(), gfx(), gfx()],
    personGfxStaff: gfx(),
    personGfxRed: gfx(),
    worldX: (tile: number) => tile * TILE,
    worldYTop: (floor: number, h = 1) => -(floor + h - 1) * FLOOR,
    sim: { population: 400, crowd: { people: [] } },
  };
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
    // The pushing poses, baked ahead so the test needs no 2d canvas.
    const poses = new Map<string, ex.Graphic>();
    for (const fill of SHIRTS) for (const dir of [-1, 1]) {
      const g = gfx();
      poses.set(`${fill}:${dir}`, g);
      e.hallDoors.pushGfx.set(`${fill}:${dir}`, g);
    }
    return { e, door, canvases, poses };
  }
  const walker = (id: number, x: number) => ({ id, seed: id, staff: false, state: "walking", x, fy: 5, floor: 5, wait: 0 });

  it("draws a leftbound walker behind the center post and a rightbound one in front, each pushing", () => {
    const { e, door, canvases, poses } = withDoor();
    e.sim.crowd.people = [walker(1, 20.6), walker(2, 19.6), walker(3, 40)];
    reconcileCrowd(e);
    e.sim.crowd.people = [walker(1, 20.4), walker(2, 19.9), walker(3, 40)];
    reconcileCrowd(e);
    const left = e.crowdActors.get(1);
    const right = e.crowdActors.get(2);
    const outside = e.crowdActors.get(3);
    expect(left.actor.z).toBe(Z.crowdBehindDoor);
    expect(right.actor.z).toBe(Z.crowd);
    expect(outside.actor.z).toBe(Z.crowd);
    expect(left.shown).toBe(poses.get(`${SHIRTS[1]}:-1`));
    expect(right.shown).toBe(poses.get(`${SHIRTS[2]}:1`));
    expect(outside.shown ?? outside.gfx).toBe(outside.gfx);
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
    reconcileCrowd(e);
    const angle = door.angle;
    reconcileCrowd(e);
    expect(door.angle).toBe(angle);
    e.sim.crowd.people = [walker(1, 23)];
    reconcileCrowd(e);
    const rec = e.crowdActors.get(1);
    expect(rec.shown).toBe(rec.gfx);
    expect(rec.actor.z).toBe(Z.crowd);
    // Walking out moved them, but outside the drum: the door does not turn.
    expect(door.angle).toBe(angle);
  });

  it("never turns a door for a climber passing between floors", () => {
    const { e, door } = withDoor();
    e.sim.crowd.people = [{ ...walker(1, 20.6), fy: 5.5 }];
    reconcileCrowd(e);
    e.sim.crowd.people = [{ ...walker(1, 20.2), fy: 5.6 }];
    reconcileCrowd(e);
    expect(door.angle).toBe(0.5);
    expect(e.crowdActors.get(1).actor.z).toBe(Z.crowd);
  });
});
