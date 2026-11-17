import type { FireResponseView } from "../../simport/view";
import { towerCatalog } from "../../catalog/towerCatalog";
import { FLOOR, TILE } from "../scale";
import { drawSearchGuard } from "../sprites/events";
import { drawHelicopter, drawWaterSpray } from "../sprites/helicopter";
import { beatFrame, strideFrame } from "./crowdLook";
import { guardPosition } from "./guardPosition";
import type { TowerEngine } from "./TowerEngine";

/** How far from its hover spot the helicopter starts and ends its flight,
 *  in tiles across and floors up. */
export const HELICOPTER_APPROACH_TILES = 60;
export const HELICOPTER_APPROACH_FLOORS = 6;
/** Floors above the burning floor the helicopter hovers while it sprays,
 *  and always at least one floor clear of the roof over the room. */
export const HELICOPTER_HOVER_FLOORS = 3;

/** Where the helicopter is at minute `now`, in tiles and floors: flying in
 *  from the right until it lands on the fire, hovering over the room it
 *  started in while it sprays, then flying off to the left. Null before it
 *  was called and once it is gone. */
export function helicopterPlace(fire: FireResponseView, now: number, roof = fire.floor): { x: number; floor: number; spraying: boolean } | null {
  const h = fire.helicopter;
  if (!h || now < h.called || now >= h.leave) return null;
  const hx = fire.x + fire.width / 2;
  const hf = Math.max(fire.floor + HELICOPTER_HOVER_FLOORS, roof + 1);
  const along = (a: number, b: number): number => (b > a ? Math.min(1, Math.max(0, (now - a) / (b - a))) : 1);
  if (now < h.arrive) {
    const p = along(h.called, h.arrive);
    return { x: hx + HELICOPTER_APPROACH_TILES * (1 - p), floor: hf + HELICOPTER_APPROACH_FLOORS * (1 - p), spraying: false };
  }
  if (now < h.sprayEnd) return { x: hx, floor: hf, spraying: true };
  const p = along(h.sprayEnd, h.leave);
  return { x: hx - HELICOPTER_APPROACH_TILES * p, floor: hf + HELICOPTER_APPROACH_FLOORS * p, spraying: false };
}

/** The roof over the room a fire started in, kept for the answer and the
 *  tower it was read from, so the scan of the rooms runs again only when the
 *  fire's answer or the building changes. */
let roofRead: { seq: number; revision: number; roof: number } | null = null;

/** The highest floor built over the middle of the fire's room. */
export function roofOverFire(engine: TowerEngine, fire: FireResponseView): number {
  const tower = engine.sim.tower;
  if (roofRead && roofRead.seq === fire.seq && roofRead.revision === tower.revision) return roofRead.roof;
  const x = fire.x + fire.width / 2;
  let roof = fire.floor;
  for (const u of tower.units) if (u.floor > roof && u.x <= x && x < u.x + u.width) roof = u.floor;
  roofRead = { seq: fire.seq, revision: tower.revision, roof };
  return roof;
}

/** The answer to a fire: Security's guards climbing the emergency stairs
 *  and fighting it from the burning room (where the engine's timing puts
 *  them), and the rescue helicopter flying in, spraying and flying off.
 *  Under reduced motion the rotor and the water hold still. */
export function renderFireResponse(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  const fire = engine.sim.fireResponse;
  if (!fire) return;
  const now = engine.sim.clock.minutes;
  const scale = engine.cam.zoom;
  const lit = towerCatalog(engine.sim).rules.shadedLook;
  const clockMs = engine.d.anim * 1000;
  fire.guards.forEach((g, i) => {
    const at = guardPosition(g, now);
    const x = engine.worldToScreenX(at.x);
    const y = engine.worldToScreenY(at.floor) + FLOOR * engine.cam.zoom;
    // At its spot a guard works the hose in place; on the way it climbs or walks.
    const fighting = now >= g.done;
    const frame = at.climbing || fighting ? beatFrame(clockMs, i) : strideFrame(lit, at.x * TILE, i);
    drawSearchGuard(ctx, x, y, scale, at.climbing, { frame, lit });
  });
  if (!fire.helicopter) return;
  const place = helicopterPlace(fire, now, roofOverFire(engine, fire));
  if (!place) return;
  const turn = engine.reducedMotion ? 0 : engine.d.anim * 4;
  const x = engine.worldToScreenX(place.x);
  const y = engine.worldToScreenY(place.floor);
  if (place.spraying) {
    const footY = engine.worldToScreenY(fire.floor) + FLOOR * engine.cam.zoom;
    drawWaterSpray(ctx, x, y + 9 * scale, footY, scale, turn % 1);
  }
  drawHelicopter(ctx, x, y, scale, turn % 1);
}
