import type { FacilityKind } from "../../shared/types";
import { drawPerson, LOOKS } from "../pixelSprites/people";
import { drawCarBack, drawCarFront } from "../sprites/transport";
import type { CarArrow } from "../carIndicator";
import { FLOOR } from "../scale";
import { figureOf } from "./crowdLook";

/**
 * The pieces a cab is put together from, each painted once and kept: the
 * cab's back and front for each kind, width, lantern and FULL, and each
 * rider's standing figure. A cab whose riders change is redrawn by copying
 * these few pictures instead of painting the cab and every rider again
 * pixel by pixel, so a car that takes on new people costs less to redraw
 * than the bare cab did.
 */
export interface CabParts {
  back(kind: FacilityKind, w: number): CanvasImageSource;
  front(w: number, arrow: CarArrow, full: boolean): CanvasImageSource;
  rider(figure: number): CanvasImageSource;
}

/** Where a rider's body starts and their feet stand in their picture: room
 *  on the left for the soft shadow, on the right and above for the tallest
 *  build. */
export const RIDER_X = 4;
export const RIDER_FOOT = 26;
const RIDER_W = 16;
const RIDER_H = 29;

/** Paint the standing figure `figure` names (`figureKey`) at its spot. */
export function paintRider(ctx: CanvasRenderingContext2D, figure: number): void {
  const f = figureOf(figure);
  drawPerson(ctx, RIDER_X, RIDER_FOOT, LOOKS[f.look], { lit: f.lit, frame: f.frame, pose: f.pose, empty: true, mood: f.mood });
}

function picture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  if (ctx) paint(ctx);
  return cv;
}

/** The parts, made on first use. A tower has three cab kinds, two widths and
 *  six lantern states, and the cast stands in three moods, flat or shaded, so
 *  each cache stays a few dozen pictures. */
export function canvasCabParts(): CabParts {
  const backs = new Map<string, HTMLCanvasElement>();
  const fronts = new Map<string, HTMLCanvasElement>();
  const riders = new Map<number, HTMLCanvasElement>();
  const cabW = (w: number) => Math.max(1, Math.round(w));
  return {
    back(kind, w) {
      const key = `${kind}:${w}`;
      let cv = backs.get(key);
      if (!cv) backs.set(key, (cv = picture(cabW(w), FLOOR, (ctx) => drawCarBack(ctx, w, FLOOR, kind))));
      return cv;
    },
    front(w, arrow, full) {
      const key = `${w}:${arrow ?? "x"}:${full ? "f" : "e"}`;
      let cv = fronts.get(key);
      if (!cv) fronts.set(key, (cv = picture(cabW(w), FLOOR, (ctx) => drawCarFront(ctx, w, FLOOR, arrow, full))));
      return cv;
    },
    rider(figure) {
      let cv = riders.get(figure);
      if (!cv) riders.set(figure, (cv = picture(RIDER_W, RIDER_H, (ctx) => paintRider(ctx, figure))));
      return cv;
    },
  };
}

let shared: CabParts | undefined;

/** The one set of parts every cab in the game shares. */
export function cabParts(): CabParts {
  shared ??= canvasCabParts();
  return shared;
}
