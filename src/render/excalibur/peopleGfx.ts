import * as ex from "excalibur";
import { drawPerson, LOOKS } from "../pixelSprites/people";
import { figureOf } from "./crowdLook";

/** Every moving figure bakes into one canvas size, so the actor's footprint
 *  never depends on the pose: wide enough for a pushed cart on the right and a
 *  pulled suitcase on the left, tall enough for arms thrown up. */
export const FIGURE_W = 30;
export const FIGURE_H = 31;
/** The foot line (the contact shadow's first row). */
export const FIGURE_FOOT = 29;
/** Where the body's left edge sits, so the body is centered and a mirrored
 *  figure stands on the same spot. */
const BODY_X = 11;
/** The actor anchor that puts the foot line where the old 25px bake's was. */
export const FIGURE_ANCHOR = ex.vec(0.5, (FIGURE_FOOT + 1) / FIGURE_H);

/** The baked figures, made on first use and kept: a frame looks one up by
 *  its numeric key (`figureKey`) and allocates nothing once it is baked. */
export interface PeopleGraphics {
  get(key: number): ex.Graphic;
}

export function bakePeople(): PeopleGraphics {
  const cache = new Map<number, ex.Canvas>();
  return {
    get(key: number): ex.Graphic {
      let canvas = cache.get(key);
      if (!canvas) {
        const f = figureOf(key);
        canvas = new ex.Canvas({
          width: FIGURE_W,
          height: FIGURE_H,
          cache: true,
          draw: (ctx) => {
            ctx.save();
            if (f.left) {
              ctx.translate(FIGURE_W, 0);
              ctx.scale(-1, 1);
            }
            drawPerson(ctx, BODY_X, FIGURE_FOOT, LOOKS[f.look], { lit: f.lit, frame: f.frame, pose: f.pose, mood: f.mood });
            ctx.restore();
          },
        });
        cache.set(key, canvas);
      }
      return canvas;
    },
  };
}
