/**
 * What every screen saver scene is, and the shared pieces they draw with.
 *
 * A scene lives on its own small canvas, one canvas pixel per
 * {@link SAVER_PIXEL} CSS pixels, scaled up without smoothing for the chunky
 * 1990s look (the 4.0 fireworks use the same size). It knows nothing of the
 * game: the Night Shift and Bulletin Marquee scenes get a plain snapshot of
 * the tower, read once when the saver starts, so nothing here touches the
 * engine or runs while the saver is down.
 */

/** One canvas pixel is this many CSS pixels. */
export const SAVER_PIXEL = 4;

/** A scene's frame step never exceeds this, in seconds, so a stalled tab
 *  never jumps. */
export const MAX_STEP_S = 0.1;

/** A random number in [0, 1). Scenes take one so a test can fix it. */
export type Rng = () => number;

/** A screen saver scene: advance it, then draw it. */
export interface SaverScene {
  step(dt: number): void;
  draw(c: CanvasRenderingContext2D): void;
}

/** The night palette every scene shares. */
export const NIGHT = {
  sky: "#0b1030",
  skyLow: "#141a44",
  ground: "#06081a",
  star: "#e6dcc0",
  faintStar: "#3a4266",
  moon: "#f3eacb",
  darkRoom: "#1b2238",
  slab: "#2a3150",
  shaft: "#262b40",
  car: "#c0c0c0",
  carDoor: "#9a9a9a",
  carInside: "#2a2f45",
  amber: "#ffc94a",
} as const;

/** The lit-window colors by what a room is. */
export const WINDOW = {
  office: "#bfe0ff",
  home: "#ffc94a",
  hotel: "#ff9a6a",
  shop: "#7cff6a",
  lobby: "#e6dcc0",
} as const;

/** The lit colors a made-up tower picks from. */
export const WINDOW_MIX: readonly string[] = [
  WINDOW.office,
  WINDOW.home,
  WINDOW.hotel,
  WINDOW.home,
  WINDOW.office,
  WINDOW.shop,
];

/** A whole number from `lo` to `hi`, both included. */
export function intIn(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** One entry of a list. */
export function oneOf<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)] ?? list[0];
}
