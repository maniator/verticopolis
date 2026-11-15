import * as ex from "excalibur";
import type { FacilityKind } from "../../shared/types";
import type { TransportView } from "../../simport/view";
import { cabRiderFoot, cabRiderX } from "../sprites/transport";
import { cabFit, carIndicator, NO_FIGURES, type CarIndicator } from "../carIndicator";
import { loadFigures, type CabLoad } from "./cabRiders";
import { FLOOR } from "../scale";
import { cabParts, RIDER_FOOT, RIDER_X, type CabParts } from "./cabParts";

/**
 * The cab graphics of one elevator car: one canvas per state the cab shows
 * (who is aboard, the lantern, FULL), made when the state first shows and
 * kept for the next time it does. A cab's riders are real people now, so its
 * states no longer repeat the way a bare head count did; past
 * `CAB_GFX_KEEP` states the one shown longest ago is redrawn as the new one,
 * so a busy car never piles up canvases or makes a new one per stop.
 */

/** The empty, idle cab state used to seed a fresh car's graphic. */
export const IDLE_CAR: CarIndicator = { riders: 0, figures: NO_FIGURES, cast: "", arrow: null, full: false };

/** The most cab states one car keeps drawn: the empty cab each way and idle,
 *  plus the loads it shows most recently. */
export const CAB_GFX_KEEP = 8;

/** What a car's graphic cache reads of the car. */
export interface CabGfxEntry {
  readonly w: number;
  /** Elevator kind, so each cab wears its type's look (`cabParts.ts`). */
  readonly kind: FacilityKind;
  /** The cab's canvases by state (`carKey`), least recently shown first. */
  readonly gfx: Map<string, ex.Graphic>;
  /** The state the car's inputs last asked for (`cabWant`). */
  want?: CabWant;
}

/** One drawn elevator car: car `i` of shaft `t`, moved along it each frame
 *  and wearing the graphic of the state it shows (`shown`, a `carKey`). */
export interface CabActor extends CabGfxEntry {
  readonly actor: ex.Actor;
  readonly t: TransportView;
  readonly i: number;
  shown: string;
}

/** The cab state a car's inputs ask for, kept with the inputs it came from. */
export interface CabWant {
  dir: number;
  load: number;
  cap: number;
  cast: string;
  ind: CarIndicator;
  key: string;
}

/**
 * The cab state for this frame's lantern direction, load, capacity and
 * riders. Every frame asks, for every car, but the answer only changes when a
 * step moves one of them, so it is worked out again only then: the frames in
 * between compare four values and allocate nothing.
 */
export function cabWant(entry: CabGfxEntry, dir: number, load: number, cap: number, riders: CabLoad): CabWant {
  const w = entry.want;
  if (w && w.dir === dir && w.load === load && w.cap === cap && w.cast === riders.cast) return w;
  // The figures are copied: the crowd's count refills its arrays each step.
  const figures = riders.count > 0 ? loadFigures(riders) : NO_FIGURES;
  const ind = carIndicator(dir, load, cap, cabFit(entry.w), figures.length, figures, riders.cast);
  const next: CabWant = { dir, load, cap, cast: riders.cast, ind, key: carKey(ind) };
  entry.want = next;
  return next;
}

/** Stable cache key for a cab graphic's indicator state. */
export function carKey(ind: CarIndicator): string {
  return `${ind.riders}:${ind.arrow ?? "x"}:${ind.full ? "f" : "e"}:${ind.cast}`;
}

/** Paint a cab from its parts (`cabParts.ts`): its back, each rider's own
 *  standing figure in their slot (`cabRiderX`, the same as `drawCar`'s), and
 *  its front over them. `figures` are the riders, `riders` of them drawn. */
export function paintCab(
  ctx: CanvasRenderingContext2D,
  parts: CabParts,
  cab: Pick<CabGfxEntry, "w" | "kind">,
  ind: Pick<CarIndicator, "riders" | "arrow" | "full">,
  figures: readonly number[],
): void {
  ctx.drawImage(parts.back(cab.kind, cab.w), 0, 0);
  const cw = Math.max(1, Math.round(cab.w));
  const rc = Math.min(ind.riders, figures.length);
  const foot = Math.round(cabRiderFoot(FLOOR)) - RIDER_FOOT;
  for (let p = 0; p < rc; p++) {
    const rx = cabRiderX(cw, rc, p);
    if (rx === null) break;
    ctx.drawImage(parts.rider(figures[p]), Math.round(rx) - RIDER_X, foot);
  }
  ctx.drawImage(parts.front(cab.w, ind.arrow, ind.full), 0, 0);
}

/** What a cab canvas draws. The riders are copied when the state is set: the
 *  canvas draws on its first frame on screen, and by then the crowd's count
 *  may have moved on to the next riders. */
interface CabDraw {
  ind: CarIndicator;
  figures: number[];
}

/** The state each canvas made here draws, so a recycled one draws its new one. */
const drawsState = new WeakMap<ex.Graphic, CabDraw>();

function newCabCanvas(entry: CabGfxEntry, ind: CarIndicator): ex.Canvas {
  const state: CabDraw = { ind, figures: ind.figures.slice(0, ind.riders) };
  const cv = new ex.Canvas({
    width: entry.w,
    height: FLOOR,
    cache: true,
    draw: (ctx) => paintCab(ctx, cabParts(), entry, state.ind, state.figures),
  });
  drawsState.set(cv, state);
  return cv;
}

/** Get-or-create the cab graphic for a given indicator state. Keying and
 *  drawing both derive from the one {@link CarIndicator} plus the entry's
 *  fixed kind; the key can skip the kind only because each cache map belongs
 *  to a single car whose shaft never changes kind (any rebuild goes through
 *  syncMotion, which recreates the entry). */
export function carGfx(entry: CabGfxEntry, ind: CarIndicator): ex.Graphic {
  const key = carKey(ind);
  const kept = entry.gfx.get(key);
  if (kept) {
    // Shown again: it moves to the back of the line to be redrawn.
    entry.gfx.delete(key);
    entry.gfx.set(key, kept);
    return kept;
  }
  let cv: ex.Graphic | undefined;
  if (entry.gfx.size >= CAB_GFX_KEEP) {
    const [oldKey, old] = entry.gfx.entries().next().value as [string, ex.Graphic];
    entry.gfx.delete(oldKey);
    const state = drawsState.get(old);
    if (state) {
      state.ind = ind;
      state.figures = ind.figures.slice(0, ind.riders);
      (old as ex.Canvas).flagDirty();
      cv = old;
    }
  }
  cv ??= newCabCanvas(entry, ind);
  entry.gfx.set(key, cv);
  return cv;
}
