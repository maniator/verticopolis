import * as ex from "excalibur";
import type { FacilityKind } from "../../shared/types";
import type { TransportView } from "../../simport/view";
import { cabRiderFoot, cabRiderX } from "../sprites/transport";
import { cabFit, carIndicator, NO_FIGURES, type CarIndicator } from "../carIndicator";
import { loadFigures, type CabLoad } from "./cabRiders";
import { FLOOR } from "../scale";
import { cabParts, RIDER_FOOT, RIDER_H, RIDER_W, RIDER_X, type CabParts } from "./cabParts";

/**
 * The graphic of one elevator car. It paints nothing of its own: each frame
 * it lays the shared, already painted parts (`cabParts.ts`) on top of each
 * other, the cab's back, each rider's standing figure in their slot and the
 * cab's front, or one picture of the whole cab while it is empty. A cab's riders are real people, so its looks rarely repeat;
 * when they change, the car only points at other parts, with no new canvas,
 * no paint and no texture upload. Each part is painted and uploaded once for
 * the whole tower.
 */

/** The empty, idle cab state used to seed a fresh car's graphic. */
export const IDLE_CAR: CarIndicator = { riders: 0, figures: NO_FIGURES, cast: "", arrow: null, full: false };

/** What a car's cab state reads of the car. */
export interface CabGfxEntry {
  readonly w: number;
  /** Elevator kind, so each cab wears its type's look (`cabParts.ts`). */
  readonly kind: FacilityKind;
  /** The state the car's inputs last asked for (`cabWant`). */
  want?: CabWant;
}

/** One drawn elevator car: car `i` of shaft `t`, moved along it each frame
 *  and drawing the state it shows (`shown`, a `carKey`) with `cab`. */
export interface CabActor extends CabGfxEntry {
  readonly actor: ex.Actor;
  readonly t: TransportView;
  readonly i: number;
  readonly cab: CabGraphic;
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

/** Stable key for a cab's indicator state: who rides, the lantern and FULL. */
export function carKey(ind: CarIndicator): string {
  return `${ind.riders}:${ind.arrow ?? "x"}:${ind.full ? "f" : "e"}:${ind.cast}`;
}

/** Where a rider's picture lands in the cab and how much of it shows: the
 *  slot `drawCar` uses (`cabRiderX`), cut to the cab's walls the way a
 *  painted cab cut it. */
interface RiderSlot {
  sx: number;
  dx: number;
  w: number;
}

export class CabGraphic extends ex.Graphic {
  private readonly parts: CabParts;
  private readonly kind: FacilityKind;
  private readonly cabW: number;
  private readonly cw: number;
  private readonly foot = Math.round(cabRiderFoot(FLOOR)) - RIDER_FOOT;
  private readonly back: HTMLCanvasElement;
  private front: HTMLCanvasElement;
  /** The whole cab in one picture while nobody is aboard. */
  private empty: HTMLCanvasElement | null = null;
  /** The riders' pictures and slots; the first `count` entries are drawn.
   *  The arrays keep their length, so a new load writes over them. */
  private readonly riders: HTMLCanvasElement[] = [];
  private readonly slots: RiderSlot[] = [];
  private count = 0;
  private ind: CarIndicator;

  constructor(cab: Pick<CabGfxEntry, "w" | "kind">, ind: CarIndicator = IDLE_CAR, parts: CabParts = cabParts()) {
    const cw = Math.max(1, Math.round(cab.w));
    super({ width: cw, height: FLOOR });
    this.parts = parts;
    this.kind = cab.kind;
    this.cabW = cab.w;
    this.cw = cw;
    this.back = parts.back(cab.kind, cab.w);
    this.front = parts.front(cab.w, ind.arrow, ind.full);
    this.ind = ind;
    this.show(ind);
  }

  /** Show state `ind`: its lantern and FULL, and its riders standing in the
   *  cab. Looks up kept parts only; nothing is painted here. */
  show(ind: CarIndicator): void {
    this.ind = ind;
    this.front = this.parts.front(this.cabW, ind.arrow, ind.full);
    const rc = Math.min(ind.riders, ind.figures.length);
    let n = 0;
    for (let p = 0; p < rc; p++) {
      const rx = cabRiderX(this.cw, rc, p);
      if (rx === null) break;
      const left = Math.round(rx) - RIDER_X;
      const sx = left < 0 ? -left : 0;
      const w = Math.min(RIDER_W, this.cw - left) - sx;
      if (w <= 0) continue;
      this.riders[n] = this.parts.rider(ind.figures[p]);
      const slot = this.slots[n] ?? (this.slots[n] = { sx: 0, dx: 0, w: 0 });
      slot.sx = sx;
      slot.dx = left + sx;
      slot.w = w;
      n++;
    }
    this.count = n;
    this.empty = n === 0 ? this.parts.empty(this.kind, this.cabW, ind.arrow, ind.full) : null;
  }

  protected _drawImage(ctx: ex.ExcaliburGraphicsContext, x: number, y: number): void {
    if (this.empty) {
      ctx.drawImage(this.empty, x, y);
      return;
    }
    ctx.drawImage(this.back, x, y);
    for (let p = 0; p < this.count; p++) {
      const s = this.slots[p];
      ctx.drawImage(this.riders[p], s.sx, 0, s.w, RIDER_H, x + s.dx, y + this.foot, s.w, RIDER_H);
    }
    ctx.drawImage(this.front, x, y);
  }

  clone(): CabGraphic {
    const copy = new CabGraphic({ w: this.cabW, kind: this.kind }, this.ind, this.parts);
    const options = this.cloneGraphicOptions();
    copy.opacity = options.opacity ?? 1;
    return copy;
  }
}
