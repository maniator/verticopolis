import type { Unit } from "../../../engine/types";
import type { DrawCtx } from "../common";
import { drawGrandCompact, drawGrandFacadeLeft, drawGrandFacadeRight, drawServiceEntrance } from "./entrance";

/**
 * The lobby concourse: the repeating pattern tiles (column, chandelier/planter,
 * sconce/art) plus the ground-floor entrance dispatch. Extracted verbatim from
 * `structure.ts`; the entrance-variant tiles dispatch to `entrance.ts`.
 */

/** The lobby pattern repeats on this many structural tiles: column, plain,
 *  centerpiece (chandelier / planter), plain. The engine bakes one shared
 *  graphic per variant and picks by {@link lobbyVariant}, so adjacent tiles
 *  always line up into one continuous concourse. */
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
  // this into a near-endless loop (deserialize clamps width too — second belt).
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
 * tower's grand entrance — warm marble, gilded cornice, red carpet, fluted
 * columns and chandeliers that glow in the evening. Sky lobbies read as their
 * cooler, airier cousins: pale stone, planters and framed art instead of
 * chandeliers, same gold trim so they still read as "lobby" at a glance.
 */
function drawLobbyTile(d: DrawCtx, x: number, y: number, w: number, h: number, variant: number, ground: boolean) {
  const { ctx, lit } = d;
  // Back wall: warm marble downstairs, cool stone up in the sky lobbies.
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, ground ? "#f8f1dc" : "#eef2f7");
  g.addColorStop(1, ground ? "#e3d7b3" : "#d6dee9");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // Wainscot line so the wall reads paneled, not flat.
  ctx.fillStyle = ground ? "rgba(120,100,60,0.16)" : "rgba(70,90,115,0.14)";
  ctx.fillRect(x, y + 19, w, 1);
  // Gilded cornice along the ceiling.
  ctx.fillStyle = "#caa84a";
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = "#8a7430";
  ctx.fillRect(x, y + 2, w, 1);
  // Polished floor with a sheen line.
  ctx.fillStyle = ground ? "#c9b177" : "#b3bfcd";
  ctx.fillRect(x, y + h - 5, w, 5);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(x, y + h - 5, w, 1);
  ctx.fillStyle = ground ? "#8f7a48" : "#8794a4";
  ctx.fillRect(x, y + h - 1, w, 1);
  if (ground) {
    // Red carpet with gold edging, running the whole concourse.
    ctx.fillStyle = "#a3243c";
    ctx.fillRect(x, y + h - 4, w, 3);
    ctx.fillStyle = "#d9b356";
    ctx.fillRect(x, y + h - 5, w, 1);
  }

  // Decorations center on the slice and stay inside it, whatever the caller's
  // tile scale — in-engine each slice is its own 11px baked canvas, so anything
  // painted past the edge would be clipped into a visible seam.
  const cx = x + Math.floor(w / 2);
  if (variant === 0) {
    // Fluted column, cornice to floor, with gold capital and base.
    ctx.fillStyle = ground ? "#f1e8ce" : "#e4eaf2";
    ctx.fillRect(cx - 1, y + 5, 3, h - 12);
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillRect(cx - 1, y + 5, 1, h - 12);
    ctx.fillStyle = ground ? "rgba(105,90,55,0.4)" : "rgba(70,85,110,0.4)";
    ctx.fillRect(cx + 1, y + 5, 1, h - 12);
    ctx.fillStyle = "#caa84a";
    ctx.fillRect(cx - 2, y + 3, 5, 2);
    ctx.fillRect(cx - 2, y + h - 7, 5, 2);
  } else if (variant === 2 && ground) {
    // Chandelier — gold tiers on a chain, aglow after dark.
    ctx.fillStyle = "#8a7430";
    ctx.fillRect(cx, y + 3, 1, 3);
    ctx.fillStyle = lit ? "#ffd76b" : "#c8a343";
    ctx.fillRect(cx - 2, y + 6, 5, 2);
    ctx.fillRect(cx - 3, y + 9, 7, 2);
    ctx.fillStyle = lit ? "#fff1b0" : "#a3873a";
    for (const dx of [-3, 0, 3]) ctx.fillRect(cx + dx, y + 8, 1, 1);
    if (lit) {
      ctx.fillStyle = "rgba(255,214,110,0.28)";
      ctx.beginPath();
      ctx.arc(cx + 0.5, y + 9, Math.min(6.5, w / 2 - 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (variant === 2) {
    // Sky-lobby planter: a potted shrub instead of a chandelier.
    ctx.fillStyle = "#7c8798";
    ctx.fillRect(cx - 2, y + h - 9, 5, 4);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(cx - 2, y + h - 9, 5, 1);
    ctx.fillStyle = "#567f46";
    ctx.beginPath();
    ctx.arc(cx + 0.5, y + h - 11, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6f9c58";
    ctx.fillRect(cx - 1, y + h - 13, 2, 2);
  } else if (variant === 3) {
    if (ground) {
      // Wall sconce, warm when the evening lights come on.
      ctx.fillStyle = "#caa84a";
      ctx.fillRect(cx - 1, y + 12, 3, 1);
      ctx.fillStyle = lit ? "#ffe9a0" : "#b5924a";
      ctx.fillRect(cx, y + 10, 1, 2);
    } else {
      // Framed print between the sky-lobby windows.
      ctx.fillStyle = "#8a7430";
      ctx.fillRect(cx - 2, y + 9, 5, 7);
      ctx.fillStyle = "#b9cadb";
      ctx.fillRect(cx - 1, y + 10, 3, 5);
      ctx.fillStyle = "#5d7a95";
      ctx.fillRect(cx - 1, y + 13, 3, 2);
    }
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
