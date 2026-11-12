import type { CatalogFacility } from "../catalog/catalogTypes";
import type { FacilityKind, Transport, Unit, UnitState } from "../shared/types";
import { fitAtGameScale } from "./catalogScale";
import { FLOOR, TILE } from "./scale";
import { drawCar, drawTransport, drawUnit, type DrawCtx } from "./sprites";

/**
 * One room or shaft drawn on its own, as the game draws it, for the pages that
 * show the art outside a tower: the sprite gallery (`gallery.ts`) and the Help
 * site's room pages. Both read the engine's catalog for every size and name, so
 * this module takes the catalog's facts through `facts` rather than carrying a
 * table of its own.
 */

/** A kind's catalog entry, from whichever catalog the page read. */
export type FactsOf = (kind: FacilityKind) => CatalogFacility;

/** How a room is shown: its state, its people and, for a shop or a restaurant,
 *  its canon variant. */
export interface RoomPose {
  state?: UnitState;
  /** Occupants; defaults to the kind's population when occupied, else none. */
  occupants?: number;
  subtype?: string;
  /** The floor the room stands on, which styles a lobby (1 is the ground
   *  concourse, anything else the sky-lobby look). */
  floor?: number;
}

/** A unit for the painters, standing alone at the left edge of its box. */
export function portraitUnit(facts: FactsOf, kind: FacilityKind, state: UnitState, occupants: number, id = 1, subtype?: string, floorOverride?: number): Unit {
  const f = facts(kind);
  return {
    id,
    kind,
    // Lobbies style by floor (1 = the grand ground concourse, else the sky-
    // lobby look). Default to the ground lobby, the one the starter tower
    // builds; `floorOverride` shows the sky-lobby variant too.
    floor: floorOverride ?? (kind === "lobby" ? 1 : 5),
    x: 0,
    width: f.width,
    state,
    satisfaction: 1,
    occupants,
    everOccupied: true,
    pendingIncome: 0,
    label: f.name,
    subtype,
  };
}

/**
 * Draw a room centered in the cell `cx, cy, cw, ch`, leaving `captionH` free at
 * the bottom, at up to `mag` whole multiples of the world scale.
 */
export function drawRoomPortrait(d: DrawCtx, facts: FactsOf, kind: FacilityKind, pose: RoomPose, cx: number, cy: number, cw: number, ch: number, captionH: number, mag: number): void {
  const f = facts(kind);
  const state = pose.state ?? "occupied";
  // Size the cell by the facility's own floor count so a genuinely multi-
  // floor kind (cinema, party hall, metro) shows at its true proportion
  // instead of squished into one floor. `fitAtGameScale` steps a footprint
  // that overflows the cell down to a smaller whole multiple (and below 1x
  // only when nothing else fits), so a room loses size rather than shape.
  const floors = f.floors ?? 1;
  const box = fitAtGameScale(f.width, floors, cw - 16, ch - captionH, mag);
  const w = box.w;
  const h = box.h;
  // Under 1px is as unusable as zero, and worse than nothing: drawFloor
  // clamps height up to 1, so a sub-pixel box paints a stray hairline. Both
  // are skipped, which is what "a degenerate cell draws nothing" has to mean.
  if (w < 1 || h < 1) return;
  // Whole screen pixels for the origin: centering can land on a half pixel,
  // and with the scale a whole multiple, a whole origin is what keeps every
  // magnified world pixel on whole screen pixels instead of antialiasing.
  const x = Math.round(cx + (cw - w) / 2);
  const y = Math.round(cy + (ch - captionH - h) / 2);
  // The painters are FIXED-PIXEL: they draw a 17px cubicle whatever box they
  // are handed, because the game always rasterizes a unit at exactly its
  // world size and lets the camera do the zooming. So magnify the way the
  // camera does, by transforming the context, and hand the painter its world
  // box. Inflating the box instead would grow the room while its furniture
  // stayed put, which is the same wrong-proportion defect the gallery was
  // fixed to stop, just moved from aspect to interior scale.
  const worldW = f.width * TILE;
  const worldH = floors * FLOOR;
  const ctx = d.ctx;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(x, y);
  ctx.scale(box.scale, box.scale);
  // Floor strip for context, in world units like everything else here.
  const floorU = portraitUnit(facts, "floor", "occupied", 0, 999);
  const pad = 6 / box.scale;
  // The wedding hall crowns the tower: only its ground story stands on a floor,
  // and the garden above it stands in the open sky.
  const stripH = kind === "weddingHall" ? FLOOR : worldH;
  drawUnit(d, floorU, -pad, worldH - stripH, worldW + pad * 2, stripH);
  const occupants = pose.occupants ?? (state === "occupied" ? f.population : 0);
  drawUnit(d, portraitUnit(facts, kind, state, occupants, 1, pose.subtype, pose.floor), 0, 0, worldW, worldH);
  ctx.restore();
}

/**
 * Draw a shaft of `kind` over `span` floors of travel (plus the floor it lands
 * on), centered in the cell like a room, with two cars for an elevator.
 */
export function drawTransportPortrait(d: DrawCtx, facts: FactsOf, kind: FacilityKind, span: number, cx: number, cy: number, cw: number, ch: number, captionH: number, mag: number): void {
  const f = facts(kind);
  // A shaft is drawn as its span plus the floor it lands on, so it is sized
  // as a `span + 1` floor footprint and its per-floor pitch falls out of the
  // fitted box. Same scale as the rooms, so a shaft and a room next to each
  // other are honest about their relative proportions.
  const floors = span + 1;
  const box = fitAtGameScale(f.width, floors, cw - 16, ch - captionH, mag);
  // World units, like the room path: the shaft art is fixed-pixel too, so the
  // context carries the magnification and the painter is handed its true box.
  const worldW = f.width * TILE;
  const floorH = FLOOR;
  const w = box.w;
  // Same degenerate-cell guard as the room path above: sub-pixel counts as
  // empty, because drawFloor clamps a zero height up to a visible 1px.
  if (w < 1 || box.h < 1) return;
  const cars = kind.startsWith("elevator") ? 2 : 0;
  const t: Transport = {
    id: 1,
    kind,
    x: 0,
    width: f.width,
    bottom: 1,
    top: 1 + span,
    cars,
    carPositions: cars ? [1.4, 1 + span - 0.6] : [],
    carDir: cars ? [1, -1] : [],
    load: 1,
  };
  // Whole screen pixels for the origin, as in the room path.
  const x = Math.round(cx + (cw - w) / 2);
  const topY = Math.round(cy + (ch - captionH - box.h) / 2);
  const ctx = d.ctx;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(x, topY);
  ctx.scale(box.scale, box.scale);
  // Backing floors so the shaft reads in context, in world units.
  const pad = 8 / box.scale;
  for (let i = 0; i <= span; i++) {
    drawUnit(d, portraitUnit(facts, "floor", "occupied", 0, 500 + i), -pad, i * floorH, worldW + pad * 2, floorH);
  }
  drawTransport(ctx, t, 0, 0, worldW, floorH);
  // Elevators also show their cars so the per-kind cab dressing (standard,
  // service, express) is visible.
  for (let i = 0; i < cars; i++) {
    ctx.save();
    // Whole world units so the cab's 1px dressing rows (hazard stripes,
    // livery pinstripe) sit on the world grid. With a whole origin and a
    // whole-multiple scale they land on whole screen pixels too. Only a cell
    // too narrow for 1x (a narrow phone) scales by a fraction and softens them.
    ctx.translate(0, Math.round((t.top - t.carPositions[i]) * floorH));
    drawCar(ctx, i * 7 + 1, worldW, floorH, i === 0 ? 2 : 0, i === 0 ? "up" : "down", false, kind);
    ctx.restore();
  }
  ctx.restore();
}
