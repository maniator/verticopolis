import type { Unit } from "../../../engine/types";
import type { DrawCtx } from "../common";
import { personSeated, windowView } from "../../pixelSprites/common";
import { drawGrandCompact, drawGrandFacadeLeft, drawGrandFacadeRight, drawServiceEntrance } from "./entrance";

/**
 * The lobby concourse: the repeating pattern tiles (column, reception desk,
 * chandelier/planter, sconce/art) plus the ground-floor entrance dispatch.
 * Extracted verbatim from `structure.ts`; the entrance-variant tiles dispatch
 * to `entrance.ts`. The per-tile art is ported from page-05's `lobbyGround`
 * and `skyLobby` build scripts: warm veined marble, a gilded cornice, a red
 * carpet and reception desk downstairs; airy skyline windows and an info desk
 * upstairs.
 */

/** The lobby pattern repeats on this many structural tiles: column, reception
 *  desk, centerpiece (chandelier / planter), sconce / art. The engine bakes one
 *  shared graphic per variant and picks by {@link lobbyVariant}, so adjacent
 *  tiles always line up into one continuous concourse. */
export const LOBBY_VARIANTS = 4;

/** Which pattern slot a lobby tile at grid x occupies. Defense-in-depth on
 *  top of deserialize's geometry clamps: a fractional, negative or non-finite
 *  x from any other caller (previews, tools, future fake units) still lands
 *  on a real variant instead of indexing the engine's baked-graphics array
 *  out of bounds. */
export function lobbyVariant(x: number): number {
  const t = Math.trunc(Number.isFinite(x) ? x : 0) % LOBBY_VARIANTS;
  return t < 0 ? t + LOBBY_VARIANTS : t;
}

/** Sentinel "variant" for the left half of the wide grand entrance: the
 *  left storefront display window. Outside the {@link LOBBY_VARIANTS} range
 *  so the engine can address it distinctly from the repeating cycle. */
export const ENTRANCE_GRAND_LEFT = LOBBY_VARIANTS;
/** Sentinel "variant" for the right half of the wide grand entrance: the
 *  doors + doorman + right display window. */
export const ENTRANCE_GRAND_RIGHT = LOBBY_VARIANTS + 1;
/** Sentinel "variant" for the compact 1-tile grand entrance, used as the
 *  narrow-lobby fallback when the lobby is too narrow to fit the wide 2-tile
 *  storefront. */
export const ENTRANCE_GRAND_SOLO = LOBBY_VARIANTS + 2;
/** Sentinel "variant" for the quiet service entrance at the opposite frontage
 *  edge. Same-shape door as the grand tile, no glow, no doorman. */
export const ENTRANCE_SERVICE = LOBBY_VARIANTS + 3;

/** Bake-target entry point for the ground-floor entrance tiles. `lobbyVariant`
 *  never returns the sentinel variants (they're outside its 0..LOBBY_VARIANTS
 *  cycle), so the engine bakes the entrance tiles by calling this directly.
 *
 *  `grand-left` / `grand-right` are the two 11-wide slices of the wide 2-tile
 *  storefront (glass display window with chandelier + double doors + doorman
 *  visible through the right window). `grand-solo` is the compact 1-tile
 *  fallback for lobbies too narrow to fit the wide version. `service` is the
 *  quiet mirrored door at the opposite frontage edge. */
export type EntranceKind = "grand-left" | "grand-right" | "grand-solo" | "service";
export function drawLobbyEntrance(
  d: DrawCtx,
  kind: EntranceKind,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const v =
    kind === "grand-left"
      ? ENTRANCE_GRAND_LEFT
      : kind === "grand-right"
        ? ENTRANCE_GRAND_RIGHT
        : kind === "grand-solo"
          ? ENTRANCE_GRAND_SOLO
          : ENTRANCE_SERVICE;
  drawLobbyTile(d, x, y, w, h, v, true);
}

export function drawLobby(d: DrawCtx, u: Unit, x: number, y: number, w: number, h: number) {
  // One pattern slice per structural tile of the unit, scaled to whatever the
  // caller renders a tile as (the engine bakes at TILE px; the gallery draws
  // bigger). Keyed by absolute tile x so runs stay aligned however sliced.
  // The slice count is capped by the pixel span so a forged width can't turn
  // this into a near-endless loop (deserialize clamps width too, a second belt).
  const tiles = Math.max(1, Math.min(Math.round(u.width) || 1, Math.ceil(w)));
  const pitch = w / tiles;
  for (let t = 0; t < tiles; t++) {
    const x0 = x + t * pitch;
    const tw = t === tiles - 1 ? x + w - x0 : pitch;
    drawLobbyTile(d, x0, y, tw, h, lobbyVariant(u.x + t), u.floor === 1);
  }
}

/**
 * One 11px slice of the lobby concourse. The ground lobby (floor 1) is the
 * tower's grand entrance: warm veined marble, a gilded cornice, a red carpet,
 * fluted columns and chandeliers that glow in the evening, and a staffed
 * reception counter. Sky lobbies read as their airy transfer-floor cousins:
 * floor-to-ceiling skyline windows, the same gold trim, planters and framed
 * prints instead of chandeliers, an info desk with an attendant. Decoration
 * reads only `lit`, `variant`, and `ground`.
 */
function drawLobbyTile(d: DrawCtx, x: number, y: number, w: number, h: number, variant: number, ground: boolean) {
  const { ctx, lit } = d;
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const ww = Math.max(1, Math.round(w));
  const hh = Math.max(1, Math.round(h));
  const floorTop = y0 + hh - 5; // top row of the polished floor band
  const cx = x0 + Math.floor(ww / 2);

  // Back wall: warm veined marble downstairs, floor-to-ceiling skyline glass in
  // the sky lobbies.
  if (ground) {
    const g = ctx.createLinearGradient(0, y0, 0, floorTop);
    g.addColorStop(0, "#F1E8CE");
    g.addColorStop(1, "#E3D7B3");
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, ww, floorTop - y0);
    // Faint warm veins so the marble reads polished, not flat.
    ctx.fillStyle = "rgba(120,100,60,0.12)";
    ctx.fillRect(x0 + 3, y0 + 6, 1, hh - 16);
    ctx.fillRect(x0 + ww - 4, y0 + 10, 1, hh - 20);
  } else {
    ctx.fillStyle = "#E8E6DE"; // pale stone behind the glass
    ctx.fillRect(x0, y0, ww, floorTop - y0);
    // A tall skyline window: cool day/night sky behind an ink + slate mullion
    // grid, receding so it never competes with a foreground prop.
    windowView(ctx, x0 + 1, y0 + 5, ww - 2, floorTop - y0 - 8, lit, variant + 1);
  }

  // Gilded cornice along the ceiling (identical on every variant so the top
  // line reads as one continuous concourse).
  ctx.fillStyle = "#C9A24B";
  ctx.fillRect(x0, y0, ww, 3);
  ctx.fillStyle = "#8A7430";
  ctx.fillRect(x0, y0 + 3, ww, 1);

  // Polished floor with a sheen line and a dark base.
  ctx.fillStyle = ground ? "#DCD2B8" : "#DCD6C6";
  ctx.fillRect(x0, floorTop, ww, 5);
  ctx.fillStyle = ground ? "#F0E8D0" : "#F0ECDC";
  ctx.fillRect(x0, floorTop, ww, 1);
  ctx.fillStyle = ground ? "#8F7A48" : "#9A8E72";
  ctx.fillRect(x0, y0 + hh - 1, ww, 1);
  if (ground) {
    // Red carpet with a gilded edge, running the whole concourse.
    ctx.fillStyle = "#9A2E38";
    ctx.fillRect(x0, y0 + hh - 4, ww, 3);
    ctx.fillStyle = "#B84450";
    ctx.fillRect(x0, y0 + hh - 4, ww, 1);
    ctx.fillStyle = "#D9B356";
    ctx.fillRect(x0, y0 + hh - 5, ww, 1);
  }

  // Per-variant centerpiece, centered on the slice and kept inside it (each
  // slice is its own baked 11px canvas, so anything past the edge is clipped
  // into a visible seam).
  if (variant === 0) {
    fluteColumn(ctx, cx, y0, hh, ground);
  } else if (variant === 1) {
    receptionDesk(ctx, x0, ww, floorTop, ground, lit);
  } else if (variant === 2) {
    if (ground) chandelier(ctx, cx, y0, lit, ww);
    else planter(ctx, cx, floorTop);
  } else if (variant === 3) {
    if (ground) sconce(ctx, cx, y0, lit);
    else framedPrint(ctx, cx, y0);
  } else if (variant === ENTRANCE_GRAND_LEFT && ground) {
    drawGrandFacadeLeft(d, x, y, w, h);
  } else if (variant === ENTRANCE_GRAND_RIGHT && ground) {
    drawGrandFacadeRight(d, x, y, w, h);
  } else if (variant === ENTRANCE_GRAND_SOLO && ground) {
    drawGrandCompact(d, x, y, w, h);
  } else if (variant === ENTRANCE_SERVICE && ground) {
    drawServiceEntrance(ctx, x, y, w, h);
  }
}

/** Fluted column, cornice to floor, with a gold capital and base. */
function fluteColumn(ctx: CanvasRenderingContext2D, cx: number, y0: number, hh: number, ground: boolean): void {
  ctx.fillStyle = ground ? "#F1E8CE" : "#E4EAF2";
  ctx.fillRect(cx - 1, y0 + 5, 3, hh - 12);
  ctx.fillStyle = "rgba(255,255,255,0.6)"; // fluted highlight
  ctx.fillRect(cx - 1, y0 + 5, 1, hh - 12);
  ctx.fillStyle = ground ? "rgba(105,90,55,0.4)" : "rgba(70,85,110,0.4)";
  ctx.fillRect(cx + 1, y0 + 5, 1, hh - 12);
  ctx.fillStyle = "#C9A24B"; // gold capital + base
  ctx.fillRect(cx - 2, y0 + 3, 5, 2);
  ctx.fillRect(cx - 2, y0 + hh - 7, 5, 2);
}

/** A staffed reception (ground) or info (sky) counter: a warm walnut desk with
 *  a lamp and a seated attendant behind it. The desk face is drawn over the
 *  figure so only the receptionist's head and shoulders read above the counter,
 *  the "behind-the-counter staff" build from the people system. */
function receptionDesk(ctx: CanvasRenderingContext2D, x0: number, ww: number, floorTop: number, ground: boolean, lit: boolean): void {
  const dl = x0 + 1;
  const dw = ww - 2;
  const deskH = 9;
  const deskTop = floorTop - deskH;
  // The attendant sits behind the counter (drawn first so the desk occludes the
  // lower body). Seed is fixed so the same slot always seats the same figure.
  personSeated(ctx, x0 + Math.floor(ww / 2) - 3, floorTop - 1, ground ? 4 : 7);
  // Walnut desk body with a lit top rail.
  ctx.fillStyle = "#6B4A2B";
  ctx.fillRect(dl, deskTop, dw, deskH);
  ctx.fillStyle = "#8A6440";
  ctx.fillRect(dl, deskTop, dw, 1);
  ctx.fillStyle = "#4E3620"; // shaded base so the desk sits on the floor
  ctx.fillRect(dl, floorTop - 1, dw, 1);
  if (ground) {
    // A brass desk lamp that glows warm in the evening.
    ctx.fillStyle = "#7A6A50";
    ctx.fillRect(dl + 1, deskTop - 3, 1, 3);
    ctx.fillStyle = lit ? "#F8E2B4" : "#8A7A5C";
    ctx.fillRect(dl, deskTop - 4, 3, 2);
    if (lit) {
      ctx.fillStyle = "rgba(248,226,180,0.3)";
      ctx.fillRect(dl - 1, deskTop - 4, 5, 4);
    }
  } else {
    // A small monitor on the info desk instead of a lamp.
    ctx.fillStyle = "#3A4250";
    ctx.fillRect(dl + dw - 4, deskTop + 2, 3, 3);
    ctx.fillStyle = "#8FB6D8";
    ctx.fillRect(dl + dw - 4, deskTop + 2, 3, 2);
  }
}

/** Chandelier: gold tiers on a chain, aglow after dark. */
function chandelier(ctx: CanvasRenderingContext2D, cx: number, y0: number, lit: boolean, ww: number): void {
  ctx.fillStyle = "#8A7430";
  ctx.fillRect(cx, y0 + 3, 1, 3); // chain
  ctx.fillStyle = lit ? "#FFD76B" : "#C8A343";
  ctx.fillRect(cx - 2, y0 + 6, 5, 2);
  ctx.fillRect(cx - 3, y0 + 9, 7, 2);
  ctx.fillStyle = lit ? "#F8E2B4" : "#A3873A";
  for (const dx of [-3, 0, 3]) ctx.fillRect(cx + dx, y0 + 8, 1, 1);
  if (lit) {
    ctx.fillStyle = "rgba(255,214,110,0.28)";
    ctx.beginPath();
    ctx.arc(cx + 0.5, y0 + 9, Math.min(6.5, ww / 2 - 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Sky-lobby planter: a potted shrub standing on the floor. */
function planter(ctx: CanvasRenderingContext2D, cx: number, floorTop: number): void {
  ctx.fillStyle = "#8C5A3A"; // brass pot
  ctx.fillRect(cx - 2, floorTop - 4, 5, 4);
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillRect(cx - 2, floorTop - 4, 5, 1);
  ctx.fillStyle = "#4E7A3E"; // shrub
  ctx.beginPath();
  ctx.arc(cx + 0.5, floorTop - 6, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5AA85A";
  ctx.fillRect(cx - 1, floorTop - 8, 2, 2);
}

/** Wall sconce, warm when the evening lights come on. */
function sconce(ctx: CanvasRenderingContext2D, cx: number, y0: number, lit: boolean): void {
  ctx.fillStyle = "#C9A24B";
  ctx.fillRect(cx - 1, y0 + 12, 3, 1);
  ctx.fillStyle = lit ? "#F8E2B4" : "#8A7A5C";
  ctx.fillRect(cx, y0 + 10, 1, 2);
  if (lit) {
    ctx.fillStyle = "rgba(248,226,180,0.26)";
    ctx.fillRect(cx - 2, y0 + 9, 5, 5);
  }
}

/** Framed print between the sky-lobby windows. */
function framedPrint(ctx: CanvasRenderingContext2D, cx: number, y0: number): void {
  ctx.fillStyle = "#8A7430";
  ctx.fillRect(cx - 2, y0 + 9, 5, 7);
  ctx.fillStyle = "#B9CADB";
  ctx.fillRect(cx - 1, y0 + 10, 3, 5);
  ctx.fillStyle = "#5D7A95";
  ctx.fillRect(cx - 1, y0 + 13, 3, 2);
}
