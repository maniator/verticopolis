import * as ex from "excalibur";
import type { PersonView } from "../../simport/view";
import { FLOOR, TILE } from "../scale";
import { FIGURE_ANCHOR, FIGURE_H, FIGURE_W } from "./peopleGfx";
import type { TowerEngine } from "./TowerEngine";

/**
 * The person the player picked (#2092): picking a walking figure, the ring
 * drawn around them, and the camera that follows them while the player asks.
 * The state lives here, keyed by engine, so `TowerEngine` stays a thin shell.
 *
 * Every read walks only the drawn people (the camera's people window, #2149),
 * never the whole crowd, and only while a person is picked.
 */

interface Focus {
  id: number;
  follow: boolean;
  /** Where the engine last placed them (tile, floor), for when the view does
   *  not carry them: the camera is far off and their figure is not drawn. */
  at: { x: number; floor: number } | null;
  /** Where the follow last left the camera, so a move by anything else (a
   *  drag, the keyboard, the Map) hands it back to the player. */
  cam: { x: number; y: number; zoom: number } | null;
}

const focus = new WeakMap<TowerEngine, Focus>();

/** Extra reach around a figure, in screen pixels, so a tap on a two-pixel
 *  arm still lands. */
const PICK_SLOP_PX = 6;
/** How fast the camera closes on a followed person: the share of the gap
 *  left after one second. Small enough to glide, large enough to keep up
 *  with a rider in an express car. */
const FOLLOW_LEFT_AFTER_SECOND = 0.02;
/** A pan, or any other camera move, of more than this (screen pixels) takes
 *  the camera back. */
const FOLLOW_PAN_SLOP_PX = 14;
/** A camera move the follow did not make, past this (screen pixels), hands
 *  the camera back: small enough to catch a keyboard nudge of one tile at
 *  any zoom, large enough to ignore rounding. */
const FOLLOW_MOVED_PX = 2;

/** The figure the world point lands on, nearest first, or null. A rider
 *  inside a car is hidden in the cab and picks the car instead. */
export function pickPersonAt(engine: TowerEngine, world: ex.Vector): number | null {
  const slop = PICK_SLOP_PX / Math.max(engine.cam.zoom, 0.01);
  const left = FIGURE_ANCHOR.x * FIGURE_W + slop;
  const right = (1 - FIGURE_ANCHOR.x) * FIGURE_W + slop;
  const above = FIGURE_ANCHOR.y * FIGURE_H + slop;
  const below = (1 - FIGURE_ANCHOR.y) * FIGURE_H + slop;
  let best: number | null = null;
  let bestD = Infinity;
  for (const [id, rec] of engine.crowdActors) {
    const a = rec.actor;
    if (!a.graphics.isVisible || a.isKilled) continue;
    const dx = world.x - a.pos.x;
    const dy = world.y - a.pos.y;
    if (dx < -left || dx > right || dy < -above || dy > below) continue;
    // Measured to the body's middle, so of two overlapping figures the one
    // under the pointer wins.
    const d = Math.abs(dx) + Math.abs(dy + above / 2);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

export function focusPerson(engine: TowerEngine, id: number): void {
  focus.set(engine, { id, follow: false, at: null, cam: null });
}

/** The engine's own word on where the picked person is, from their card. */
export function notePersonPlace(engine: TowerEngine, x: number, floor: number): void {
  const f = focus.get(engine);
  if (f) f.at = { x, floor };
}

export function clearPersonFocus(engine: TowerEngine): void {
  focus.delete(engine);
}

export function focusedPerson(engine: TowerEngine): { id: number; follow: boolean } | undefined {
  return focus.get(engine);
}

export function setFollow(engine: TowerEngine, on: boolean): void {
  const f = focus.get(engine);
  if (f) {
    f.follow = on;
    f.cam = null;
  }
}

/** The picked person's drawn spot in world pixels (their feet): their figure,
 *  else the view's record, else the engine's last word from the card; null
 *  before any. A rider hidden in a car still has a spot: their glide follows
 *  the engine. */
export function focusSpot(engine: TowerEngine): ex.Vector | null {
  const f = focus.get(engine);
  if (!f) return null;
  const rec = engine.crowdActors.get(f.id);
  if (rec) return ex.vec(engine.worldX(rec.glide.x), engine.worldYTop(rec.glide.fy) + FLOOR - 3);
  const p = viewPerson(engine, f.id);
  if (p) return ex.vec(engine.worldX(p.x), engine.worldYTop(p.fy) + FLOOR - 3);
  // Off the drawn window: the card's last answer brings the camera back to
  // them, and the view takes over once they are drawn again.
  return f.at ? ex.vec(engine.worldX(f.at.x), engine.worldYTop(f.at.floor) + FLOOR - 3) : null;
}

function viewPerson(engine: TowerEngine, id: number): PersonView | undefined {
  for (const p of engine.sim.crowd.people) if (p.id === id) return p;
  return undefined;
}

/** True when something other than the follow moved the camera since its
 *  last frame. A zoom alone keeps the follow: it re-centers on the person. */
function movedByPlayer(engine: TowerEngine, f: Focus): boolean {
  const c = f.cam;
  if (!c || c.zoom !== engine.cam.zoom) return false;
  const pos = engine.cam.pos;
  return Math.hypot(pos.x - c.x, pos.y - c.y) * engine.cam.zoom > FOLLOW_MOVED_PX;
}

/** One frame of the follow: a pan, or any other move of the camera, hands it
 *  back to the player; otherwise the camera glides toward the person. */
export function stepFollow(engine: TowerEngine, elapsedMs: number): void {
  const f = focus.get(engine);
  if (!f?.follow) return;
  if ((engine.gesture === "pan" && engine.moved > FOLLOW_PAN_SLOP_PX) || movedByPlayer(engine, f)) {
    f.follow = false;
    f.cam = null;
    return;
  }
  const spot = focusSpot(engine);
  if (!spot) return;
  const keep = Math.pow(FOLLOW_LEFT_AFTER_SECOND, Math.max(0, elapsedMs) / 1000);
  const target = ex.vec(spot.x, spot.y - FIGURE_H / 2);
  const pos = engine.cam.pos;
  const x = target.x + (pos.x - target.x) * keep;
  const y = target.y + (pos.y - target.y) * keep;
  // Through applyView, so the camera stays inside the lot like any move.
  engine.applyView({ tile: x / TILE, floor: -y / FLOOR, zoom: engine.cam.zoom });
  f.cam = { x: engine.cam.pos.x, y: engine.cam.pos.y, zoom: engine.cam.zoom };
}

/** The ring around the picked person, on the overlay canvas. */
export function drawPersonRing(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  const spot = focusSpot(engine);
  if (!spot) return;
  const s = engine.engine.worldToScreenCoordinates(spot);
  const z = engine.cam.zoom;
  const r = Math.max(6, (FIGURE_H / 2) * z);
  ctx.save();
  ctx.strokeStyle = "#ffd24a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(s.x, s.y - r * 0.9, r * 0.75, r * 1.05, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** The picked person's on-screen box (top edge), for the card to anchor
 *  beside. */
export function focusScreenRect(engine: TowerEngine): { x: number; y: number; w: number } | null {
  const spot = focusSpot(engine);
  if (!spot) return null;
  const z = engine.cam.zoom;
  const s = engine.engine.worldToScreenCoordinates(spot);
  const w = FIGURE_W * z * 0.5;
  return { x: s.x - w / 2, y: s.y - FIGURE_H * z, w };
}
