/**
 * Paints a draw list onto a 2D canvas context (#343). Nothing here reads the
 * simulation: it takes the marks and a theme, looks each kind's style up, and
 * fills rectangles. A pattern is one cached tile per fill, pattern and theme,
 * so a repaint is at most one `fillRect` per mark (Classic skips the kinds it
 * does not draw, without resolving their style), with the style resolved once
 * per run of same-kind marks (the draw list groups them) and the fill style
 * changing only when the style does.
 *
 * Units are device pixels: the caller sizes the canvas's backing store to the
 * layout (CSS size times `devicePixelRatio`) and applies no context scale, so
 * a pattern tile's 1-pixel marks stay crisp at any ratio. Use one pattern source
 * per canvas: a repeating fill is created on one context and cached by fill,
 * pattern and theme only.
 */
import { drawsOnMap, mapStyleFor, patternInk, type MapPattern, type MapTheme } from "./style";
import type { MapMark } from "./drawList";

/** The slice of a 2D context the painter uses. */
export interface MapPaintContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

/** Hands back what to assign to `fillStyle` for a fill and pattern: the plain
 *  color for `solid`, a repeating tile otherwise. */
export interface PatternSource {
  get(fill: string, pattern: MapPattern, theme: MapTheme): string | CanvasPattern;
}

/** Side of a pattern tile in device pixels. */
export const PATTERN_TILE = 4;

/** The ink marks inside a pattern tile, as `[x, y]` tile pixels. The rest of
 *  the tile is the fill. */
export function patternCells(pattern: MapPattern): ReadonlyArray<readonly [number, number]> {
  const n = PATTERN_TILE;
  const cells: Array<readonly [number, number]> = [];
  switch (pattern) {
    case "solid":
      break;
    case "dots":
      cells.push([1, 1]);
      break;
    case "diagonal":
      for (let i = 0; i < n; i++) cells.push([i, i]);
      break;
    case "horizontal":
      for (let x = 0; x < n; x++) cells.push([x, 1]);
      break;
    case "grid":
      for (let i = 0; i < n; i++) {
        cells.push([i, 0]);
        if (i > 0) cells.push([0, i]);
      }
      break;
    case "checker":
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (Math.floor(x / 2) % 2 === Math.floor(y / 2) % 2) cells.push([x, y]);
      break;
    case "outline":
      for (let i = 0; i < n; i++) {
        cells.push([i, 0]);
        cells.push([i, n - 1]);
        if (i > 0 && i < n - 1) {
          cells.push([0, i]);
          cells.push([n - 1, i]);
        }
      }
      break;
  }
  return cells;
}

/** What turns a tile into a repeating fill: the paint target's `createPattern`.
 *  A real `CanvasRenderingContext2D` fits. */
export type PatternTarget = Pick<CanvasRenderingContext2D, "createPattern">;

/**
 * A pattern source over a scratch-canvas factory (`document.createElement('canvas')`
 * in the page, a fake in tests) and the context the patterns are used on.
 * `solid` is the plain color. A tile that cannot be built right now (no 2D
 * context, no pattern) answers the plain fill for this call and is not cached,
 * so a later call tries again.
 */
export function createPatternSource(makeCanvas: () => HTMLCanvasElement, target: PatternTarget): PatternSource {
  const cache = new Map<string, CanvasPattern>();
  return {
    get(fill, pattern, theme) {
      if (pattern === "solid") return fill;
      const key = `${theme}|${pattern}|${fill}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const tile = makeCanvas();
      tile.width = PATTERN_TILE;
      tile.height = PATTERN_TILE;
      const ctx = tile.getContext("2d");
      if (!ctx) return fill;
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, PATTERN_TILE, PATTERN_TILE);
      ctx.fillStyle = patternInk(fill);
      for (const [x, y] of patternCells(pattern)) ctx.fillRect(x, y, 1, 1);
      const made = target.createPattern(tile, "repeat");
      if (!made) return fill;
      cache.set(key, made);
      return made;
    },
  };
}

/** A mark smaller than this on either side (map pixels) paints as a plain
 *  fill: a pattern needs room to read, and a thin mark would only look noisy. */
export const MIN_PATTERN_SIDE = PATTERN_TILE;

/**
 * Clear the map and paint `marks` in order, skipping kinds the theme does not
 * draw (`drawsOnMap`). Returns how many `fillRect` calls the marks took, which
 * the budget tests read.
 */
export function paintMapMarks(
  ctx: MapPaintContext,
  width: number,
  height: number,
  marks: ReadonlyArray<MapMark>,
  theme: MapTheme,
  patterns: PatternSource,
): number {
  ctx.clearRect(0, 0, width, height);
  let last: string | CanvasPattern | null = null;
  let kind: MapMark["kind"] | null = null;
  let styled: string | CanvasPattern = "";
  let plain: string | CanvasPattern = "";
  let drawn = true;
  let fills = 0;
  for (const mark of marks) {
    if (mark.kind !== kind) {
      // The draw list groups same-kind marks, so this resolves about once per kind.
      kind = mark.kind;
      drawn = drawsOnMap(kind, theme);
      if (drawn) {
        const style = mapStyleFor(kind, theme);
        styled = patterns.get(style.fill, style.pattern, theme);
        plain = patterns.get(style.fill, "solid", theme);
      }
    }
    if (!drawn) continue;
    const small = mark.rect.w < MIN_PATTERN_SIDE || mark.rect.h < MIN_PATTERN_SIDE;
    const fillStyle = small ? plain : styled;
    if (fillStyle !== last) {
      ctx.fillStyle = fillStyle;
      last = fillStyle;
    }
    ctx.fillRect(mark.rect.x, mark.rect.y, mark.rect.w, mark.rect.h);
    fills++;
  }
  return fills;
}
