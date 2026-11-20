/**
 * The title screen's skyline: five buildings and their lit windows on a
 * 460 by 200 grid. The game draws it inline on the splash
 * (`splashTemplate.ts`, colored from the `--splash-*` tokens), and
 * `scripts/gen-splash-skyline.ts` writes the same shapes to
 * `src/public/splash-skyline.svg`, the image the docs site's landing page
 * tiles. Plain data with no imports, so the script can load it in Node.
 */

/** The skyline's `viewBox`. */
export const SKYLINE_VIEWBOX = "0 0 460 200";

/** Each building's outline, left to right, as an SVG path. */
export const SKYLINE_BUILDINGS: readonly string[] = [
  "M-5 200 V120 h34 V98 h16 V120 h40 V200 z",
  "M95 200 V80 h26 V56 h12 V80 h26 V200 z",
  "M200 200 V54 h20 V30 h9 V10 h9 V30 h9 V54 h20 V200 z",
  "M310 200 V92 h30 V68 h15 V92 h30 V200 z",
  "M410 200 V60 h20 V36 h11 V60 h34 V200 z",
];

/** The lit windows' top-left corners, two to a line in the drawing. */
export const SKYLINE_WINDOWS: readonly (readonly [x: number, y: number])[] = [
  [8, 130],
  [8, 146],
  [104, 92],
  [104, 112],
  [214, 66],
  [214, 90],
  [320, 100],
  [424, 72],
];

/** A lit window's size. */
export const SKYLINE_WINDOW_SIZE = { width: 3, height: 4 } as const;

/** The lit windows' color, the same in the game and the image. */
export const SKYLINE_WINDOW_COLOR = "#ffdca0";
