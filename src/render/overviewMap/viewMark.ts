/**
 * The overview MAP window's backdrop and its view mark (#343): the sky and
 * ground behind the tower, and the outline of what the main view shows, or
 * the edge band and chevron when the view sits past the map's edge. Like
 * `paint.ts`, it reads no simulation and takes a slice of a 2D context, so
 * the tests drive it with a recording stub.
 *
 * Units are map (device) pixels; `px` is how many of them make one CSS pixel
 * (the device pixel ratio), so lines keep their CSS width on any screen.
 */
import { edgeBand, type ViewPlacement } from "./extent";
import { lineToMapY, type MapLayout, type MapRect } from "./geometry";
import type { MapTheme } from "./style";

/** The sky and the ground behind the tower, per theme. Classic keeps the
 *  retail window's idea (the main view's sky and earth behind the tower) in a
 *  darker day blue than the main view's sky, so the Classic gray silhouette
 *  stands out against it (the retail sky follows the time of day; v1 keeps a
 *  fixed day color). Modern is darker still, behind its room colors. */
export const MAP_BACKDROP: Readonly<Record<MapTheme, { readonly sky: string; readonly ground: string }>> = {
  classic: { sky: "#4a6a9a", ground: "#5a4632" },
  modern: { sky: "#1d2838", ground: "#2e2418" },
};

/** The floor line the street sits on: floor 1 (the ground floor) stands on it,
 *  and the basements are under it. */
export const GROUND_LINE = 0;

/** The ground's top edge as a share of the map's height, 0 at the top and 1
 *  at the bottom, held to the map. The window turns it into the backdrop's
 *  color stop. */
export function groundShare(layout: MapLayout): number {
  const share = lineToMapY(layout, GROUND_LINE) / layout.height;
  return Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 1;
}

/** The view mark's ink. Classic draws the retail map's dotted outline with an
 *  inverting pen: the window gives the mark's canvas a CSS `difference` blend
 *  in Classic (`overview-map.css`), so the white ink reads dark over the light
 *  gray tower and pale over the dark sky. A canvas composite mode would not do
 *  it, since it blends only with the mark canvas's own (cleared) pixels. Modern
 *  draws a solid white outline over a dark halo. */
export const VIEW_MARK = {
  ink: "#ffffff",
  halo: "rgba(0, 0, 0, 0.65)",
} as const;

/** The outline's width and the edge band's thickness, in CSS pixels. */
export const VIEW_MARK_CSS = { line: 1, haloLine: 3, band: 3, bandMinWidth: 12, chevron: 5, minSide: 4 } as const;

/** The slice of a 2D context the view mark uses. */
export interface ViewMarkContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  setLineDash(segments: number[]): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
}

/** A device-pixel count for a CSS width: at least one whole pixel. */
function devicePx(css: number, px: number): number {
  const ratio = Number.isFinite(px) && px > 0 ? px : 1;
  return Math.max(1, Math.round(css * ratio));
}

/** The edge band drawn for a view past the map's edge, in the same whole
 *  device pixels the painter uses, so the window grabs exactly what it drew.
 *  Null when the view is on the map. */
export function viewMarkBand(layout: MapLayout, placement: ViewPlacement, px: number): MapRect | null {
  return edgeBand(layout, placement, devicePx(VIEW_MARK_CSS.band, px), devicePx(VIEW_MARK_CSS.bandMinWidth, px));
}

/** The rectangle grown about its center to at least `side` each way and kept
 *  on the map, so a zoomed-in view still shows as a visible mark. */
export function visibleRect(layout: MapLayout, rect: MapRect, side: number): MapRect {
  const w = Math.min(layout.width, Math.max(rect.w, side));
  const h = Math.min(layout.height, Math.max(rect.h, side));
  const x = Math.max(0, Math.min(layout.width - w, rect.x + rect.w / 2 - w / 2));
  const y = Math.max(0, Math.min(layout.height - h, rect.y + rect.h / 2 - h / 2));
  return { x, y, w, h };
}

/**
 * Clear the overlay and draw the view mark for `placement`: the outline of the
 * visible area when it is on the map, or the edge band with a chevron
 * pointing past the edge when the whole view lies beyond it. Returns what was
 * drawn, which the tests read.
 */
export function paintViewMark(
  ctx: ViewMarkContext,
  layout: MapLayout,
  placement: ViewPlacement,
  theme: MapTheme,
  px: number,
): "outline" | "band" | "none" {
  ctx.clearRect(0, 0, layout.width, layout.height);
  if (placement.outside !== "none") {
    const band = viewMarkBand(layout, placement, px);
    if (!band) return "none";
    ctx.fillStyle = VIEW_MARK.ink;
    ctx.fillRect(band.x, band.y, band.w, band.h);
    paintChevron(ctx, band, placement.outside === "above", devicePx(VIEW_MARK_CSS.chevron, px));
    return "band";
  }
  if (!(placement.rect.w > 0) || !(placement.rect.h > 0)) return "none";
  const line = devicePx(VIEW_MARK_CSS.line, px);
  const r = visibleRect(layout, placement.rect, devicePx(VIEW_MARK_CSS.minSide, px));
  if (theme === "classic") {
    ctx.setLineDash([line, line]);
    strokeInside(ctx, r, line, VIEW_MARK.ink);
    ctx.setLineDash([]);
  } else {
    strokeInside(ctx, r, devicePx(VIEW_MARK_CSS.haloLine, px), VIEW_MARK.halo);
    strokeInside(ctx, r, line, VIEW_MARK.ink);
  }
  return "outline";
}

/** A stroke that sits inside the rectangle, so the map's edge never clips it. */
function strokeInside(ctx: ViewMarkContext, r: MapRect, width: number, color: string): void {
  const w = Math.min(width, r.w / 2, r.h / 2);
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.strokeRect(r.x + w / 2, r.y + w / 2, r.w - w, r.h - w);
}

/** A small triangle beside the band on the map's side, its tip touching the
 *  band, pointing past the map's edge. */
function paintChevron(ctx: ViewMarkContext, band: MapRect, up: boolean, size: number): void {
  const cx = band.x + band.w / 2;
  const base = up ? band.y + band.h + size : band.y - size;
  const tip = up ? band.y + band.h : band.y;
  ctx.beginPath();
  ctx.moveTo(cx - size, base);
  ctx.lineTo(cx + size, base);
  ctx.lineTo(cx, tip);
  ctx.closePath();
  ctx.fill();
}
