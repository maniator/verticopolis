import * as ex from "excalibur";
import { Z } from "../depthPlanes";
import type { HallDoor } from "../lobbyHalls";
import { SHIRTS } from "../pixelSprites/common";
import { FLOOR } from "../scale";
import {
  DOOR_RADIUS,
  drawPushingWalker,
  drawRevolvingDoorBack,
  drawRevolvingDoorFront,
  drawRevolvingDoorMiddle,
  QUARTER_TURN,
  turnDoor,
} from "../sprites/structure/revolvingDoor";
import type { TowerEngine } from "./TowerEngine";

/**
 * The revolving doors between lobby halls of different heights (#2068). The
 * structure pass hands over the doors it finds (`syncHallDoors`), each drawn
 * as three actors around the crowd's plane: the wall and the back of the
 * drum, the post and near wings, then the drum's front. The crowd pass turns
 * each door by how far the people inside it walked since the last pass
 * (`pushThroughDoors`, then `turnHallDoors`), so a door turns only while a
 * real person walks through it, at their pace, and stands still otherwise.
 */

/** How wide each door actor is: the drum and its posts, with room to spare. */
const DOOR_W = 2 * DOOR_RADIUS + 7;

interface DoorRec {
  door: HallDoor;
  /** The wall's world x: the left edge of the right-hand hall's first tile. */
  wx: number;
  angle: number;
  lit: boolean;
  /** The farthest one person inside walked since the door last turned. */
  push: number;
  actors: [ex.Actor, ex.Actor, ex.Actor];
  canvases: [ex.Canvas, ex.Canvas, ex.Canvas];
}

/** The doors on screen, by floor for the crowd pass and by key for the
 *  structure pass. */
export class HallDoorLayer {
  readonly byFloor = new Map<number, DoorRec[]>();
  readonly byKey = new Map<string, DoorRec>();
  /** The pushing pose, baked on first use by shirt color and direction. */
  readonly pushGfx = new Map<string, ex.Canvas>();
}

/** The housekeepers' work uniform, as `towerScene` bakes it. */
const STAFF_UNIFORM = "#E8E4DA";
/** The pushing figure's canvas: the walker's 9 px plus room for an arm on
 *  either side, so the body stays centered over the same anchor. */
const PUSH_W = 13;
const PERSON_H = 25;

const keyOf = (d: HallDoor) => `${d.floor}:${d.x}:${d.tall}:${d.short}:${d.tallOnLeft}`;

function makeDoor(engine: TowerEngine, door: HallDoor): DoorRec {
  const h = door.tall * FLOOR;
  const cx = Math.floor(DOOR_W / 2);
  const foot = h - 3;
  const wx = engine.worldX(door.x);
  const rec = { door, wx, angle: QUARTER_TURN / 2, lit: engine.litState, push: 0 } as DoorRec;
  const step = { y: (door.tall - door.short) * FLOOR, side: door.tallOnLeft ? -1 : 1 } as const;
  const canvas = (draw: (ctx: CanvasRenderingContext2D) => void) => new ex.Canvas({ width: DOOR_W, height: h, cache: true, draw });
  rec.canvases = [
    canvas((ctx) => drawRevolvingDoorBack(ctx, cx, foot, 0, rec.angle, rec.lit, step)),
    canvas((ctx) => drawRevolvingDoorMiddle(ctx, cx, foot, rec.angle, rec.lit)),
    canvas((ctx) => drawRevolvingDoorFront(ctx, cx, foot, rec.lit)),
  ];
  const pos = ex.vec(wx - cx, engine.worldYTop(door.floor + door.tall - 1));
  const planes = [Z.hallDoorBack, Z.hallDoorMiddle, Z.hallDoorFront];
  rec.actors = rec.canvases.map((c, i) => {
    const a = new ex.Actor({ pos, anchor: ex.vec(0, 0), width: DOOR_W, height: h, z: planes[i] });
    a.graphics.use(c);
    engine.engine.add(a);
    return a;
  }) as DoorRec["actors"];
  return rec;
}

/** Puts up the doors the structure pass found and takes down the ones it no
 *  longer does; a door that stays keeps its actors and its angle. */
export function syncHallDoors(engine: TowerEngine, doors: readonly HallDoor[]): void {
  const layer = engine.hallDoors;
  const keep = new Set<string>();
  for (const d of doors) {
    const key = keyOf(d);
    keep.add(key);
    if (!layer.byKey.has(key)) layer.byKey.set(key, makeDoor(engine, d));
  }
  for (const [key, rec] of layer.byKey) {
    if (keep.has(key)) continue;
    for (const a of rec.actors) a.kill();
    layer.byKey.delete(key);
  }
  layer.byFloor.clear();
  for (const rec of layer.byKey.values()) {
    const list = layer.byFloor.get(rec.door.floor);
    if (list) list.push(rec);
    else layer.byFloor.set(rec.door.floor, [rec]);
  }
  relightHallDoors(engine);
}

/** Repaints every door whose lighting no longer matches the tower's. */
export function relightHallDoors(engine: TowerEngine): void {
  for (const rec of engine.hallDoors.byKey.values()) {
    if (rec.lit === engine.litState) continue;
    rec.lit = engine.litState;
    for (const c of rec.canvases) c.flagDirty();
  }
}

/** Takes every door down, as a scene swap does. */
export function clearHallDoors(engine: TowerEngine): void {
  for (const rec of engine.hallDoors.byKey.values()) for (const a of rec.actors) a.kill();
  engine.hallDoors.byKey.clear();
  engine.hallDoors.byFloor.clear();
}

/** What the crowd pass keeps per person to push a door. */
export interface Pusher {
  lastX?: number;
  /** -1 walking left, 1 walking right, 0 not yet seen moving. */
  dir?: number;
  /** The pose the actor shows, when it is not its own baked figure. */
  shown?: ex.Canvas;
}

/** A routed person's figure pushing a door wing, walking `dir`, in their
 *  shirt (or the staff uniform), baked once per color and direction. */
export function pushingGfx(engine: TowerEngine, p: { staff?: boolean; seed: number }, dir: -1 | 1): ex.Canvas {
  const fill = p.staff ? STAFF_UNIFORM : SHIRTS[Math.abs(p.seed) % SHIRTS.length];
  const key = `${fill}:${dir}`;
  let gfx = engine.hallDoors.pushGfx.get(key);
  if (!gfx) {
    gfx = new ex.Canvas({ width: PUSH_W, height: PERSON_H, cache: true, draw: (ctx) => drawPushingWalker(ctx, 3, PERSON_H - 1, fill, dir) });
    engine.hallDoors.pushGfx.set(key, gfx);
  }
  return gfx;
}

/** Where a person standing on `floor` at world x `wx` is against the doors
 *  there: `undefined` outside every drum, else the way they walk through it
 *  (-1 left, 1 right). Notes how far they walked for the door to turn by.
 *  A floor with no door costs one map lookup. */
export function pushThroughDoors(engine: TowerEngine, who: Pusher, floor: number, wx: number): -1 | 1 | undefined {
  const step = who.lastX === undefined ? 0 : wx - who.lastX;
  who.lastX = wx;
  if (step !== 0) who.dir = Math.sign(step);
  const doors = engine.hallDoors.byFloor.get(floor);
  if (!doors) return undefined;
  for (const rec of doors) {
    if (Math.abs(wx - rec.wx) > DOOR_RADIUS) continue;
    rec.push = Math.max(rec.push, Math.abs(step));
    return (who.dir ?? 1) < 0 ? -1 : 1;
  }
  return undefined;
}

/** Turns each door by the walk noted since the last pass, always the same
 *  way, and repaints the parts that turn. A door nobody pushed stays put. */
export function turnHallDoors(engine: TowerEngine): void {
  for (const rec of engine.hallDoors.byKey.values()) {
    if (rec.push === 0) continue;
    rec.angle = turnDoor(rec.angle, true, rec.push, 1);
    rec.push = 0;
    rec.canvases[0].flagDirty();
    rec.canvases[1].flagDirty();
  }
}
