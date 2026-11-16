/**
 * The 1994 desk's geometry: where each window opens the first time, how a
 * saved place is kept on a smaller screen, and the size limits of the windows
 * the player can resize. Pure functions over plain numbers, so the rules are
 * tested without a page (deskGeometry.test.ts). The per-window rules table in
 * docs/ui/desk-windows.md is the spec these numbers come from.
 */

/** A window's place and size on the desk, in CSS px from the desk's top left. */
export interface DeskRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The windows the desk lays out. */
export type DeskWindowId = "tower" | "info" | "tools" | "map" | "bulletin" | "towerInfo" | "control";

/** The size limits of a resizable window; a fixed window has none. */
export interface SizeLimits {
  readonly minW: number;
  readonly minH: number;
}

/** The tower window: 320x240 at the smallest, the desk at the largest. */
export const TOWER_LIMITS: SizeLimits = { minW: 320, minH: 240 };
/** The Tools window grows in height only, from 200 px to the desk's height. */
export const TOOLS_LIMITS: SizeLimits = { minW: 0, minH: 200 };

/** The gap the desk keeps between its windows and its edges. */
export const DESK_GAP = 8;
/** The width the right-hand column (the Map, the Bulletin) is given. */
export const SIDE_COLUMN = 300;
/** The Map's height on the desk, before the desk has measured it. */
export const MAP_HEIGHT = 310;
/** The room the Bulletin is given at the foot of the column. */
export const BULLETIN_HEIGHT = 222;
/** Where the Bulletin opens on a desk too short for it under the Map, from
 *  the tower window's top left: over the sky, past the floor numbers and
 *  below the menu bar and the first toasts (measured at 1024 x 600). */
export const SHORT_DESK_BULLETIN_DROP = 120;
export const SHORT_DESK_BULLETIN_INSET = 32;
/** Info's height on the desk, before the desk has measured it. */
export const INFO_HEIGHT = 64;
/** The Tools window's width on the desk (the palette's own width plus its frame). */
export const TOOLS_WIDTH = 184;

/** Where every window opens the first time on a desk of `deskW` x `deskH`:
 *  Tools down the left, Info as a strip across the top (SimTower's, owner
 *  2026-11-15) with the tower under it, and the Map, the Bulletin and Tower
 *  Info down the right. `infoH` and `mapH` are the heights Info and the Map
 *  really have once measured. Fixed-size windows take their own size, so
 *  only their corner counts, and Info its width. */
export function defaultLayout(deskW: number, deskH: number, infoH = INFO_HEIGHT, mapH = MAP_HEIGHT): Record<DeskWindowId, DeskRect> {
  const g = DESK_GAP;
  const sideX = Math.max(g, deskW - SIDE_COLUMN - g);
  const towerX = TOOLS_WIDTH + 2 * g;
  const middleW = Math.max(TOWER_LIMITS.minW, sideX - towerX - g);
  const towerY = 2 * g + infoH;
  const tower: DeskRect = { x: towerX, y: towerY, w: middleW, h: Math.max(TOWER_LIMITS.minH, deskH - towerY - g) };
  // The Bulletin sits at the foot of the column, below the Map. On a desk too
  // short for both it opens over the tower's sky at the left, below the menu
  // bar and the toasts (top right of the tower), so the ground line where the
  // first lobby goes stays clear.
  const footY = Math.max(g, deskH - BULLETIN_HEIGHT - g);
  const bulletinFits = footY >= g + mapH + g;
  return {
    tools: { x: g, y: g, w: TOOLS_WIDTH, h: Math.max(TOOLS_LIMITS.minH, Math.min(deskH - 2 * g, 600)) },
    tower,
    info: { x: towerX, y: g, w: middleW, h: 0 },
    map: { x: sideX, y: g, w: 0, h: 0 },
    bulletin: bulletinFits
      ? { x: sideX, y: footY, w: SIDE_COLUMN, h: 0 }
      : { x: towerX + SHORT_DESK_BULLETIN_INSET, y: towerY + SHORT_DESK_BULLETIN_DROP, w: SIDE_COLUMN, h: 0 },
    towerInfo: { x: Math.max(g, sideX - 240), y: towerY, w: 0, h: 0 },
    control: { x: Math.max(g, Math.round(deskW / 2 - 150)), y: Math.max(g, Math.round(deskH / 2 - 110)), w: 0, h: 0 },
  };
}

/** A saved place kept on the desk it opens on: a window bigger than the desk
 *  shrinks to fit (not below its limits), and its title bar stays on screen so
 *  it can always be dragged back. Whole pixels. */
export function fitRect(rect: DeskRect, deskW: number, deskH: number, limits: SizeLimits | null): DeskRect {
  const w = limits ? Math.max(limits.minW, Math.min(rect.w, deskW)) : rect.w;
  const h = limits ? Math.max(limits.minH, Math.min(rect.h, deskH)) : rect.h;
  const x = Math.max(0, Math.min(rect.x, deskW - Math.min(w || 120, deskW)));
  const y = Math.max(0, Math.min(rect.y, deskH - 24));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** The size a resize drag asks for, held to the window's limits and to what
 *  is left of the desk past the window's corner. `heightOnly` keeps the width. */
export function resizedTo(start: DeskRect, dx: number, dy: number, limits: SizeLimits, deskW: number, deskH: number, heightOnly: boolean): DeskRect {
  const w = heightOnly ? start.w : Math.max(limits.minW, Math.min(start.w + dx, deskW - start.x));
  const h = Math.max(limits.minH, Math.min(start.h + dy, deskH - start.y));
  return { x: start.x, y: start.y, w: Math.round(w), h: Math.round(h) };
}

/** Read a saved layout, dropping anything that is not a usable rectangle, so
 *  a damaged or older store opens the default layout for that window. */
export function parseLayout(raw: string | null): Partial<Record<DeskWindowId, DeskRect>> {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== "object") return {};
  const out: Partial<Record<DeskWindowId, DeskRect>> = {};
  const ids: readonly DeskWindowId[] = ["tower", "info", "tools", "map", "bulletin", "towerInfo", "control"];
  for (const id of ids) {
    const r = (data as Record<string, unknown>)[id];
    if (!r || typeof r !== "object") continue;
    const { x, y, w, h } = r as Record<string, unknown>;
    if ([x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 100000)) {
      out[id] = { x: x as number, y: y as number, w: w as number, h: h as number };
    }
  }
  return out;
}
