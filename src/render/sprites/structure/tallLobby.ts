import type { DrawCtx } from "../common";
import { layerBreak, layerShell } from "../../pixelSprites/layers";
import { archedWindow, globePendants, hallGlass } from "./tallLobbyPieces";
import {
  chandelier,
  consolePanel,
  drawLobbyTile,
  ENTRANCE_GRAND_LEFT,
  ENTRANCE_GRAND_RIGHT,
  ENTRANCE_GRAND_SOLO,
  type EntranceKind,
  ENTRANCE_SERVICE,
  fluteColumn,
  framedPrint,
  LOBBY_VARIANTS,
  lobbyFloor,
  planter,
} from "./lobby";

/**
 * Tall lobbies (#308): one slice of a lobby two or three stories high, drawn
 * as one open hall over all its `stories`. There is no floor between the
 * stories: one back wall (veined marble downstairs, a skyline curtain wall in
 * a sky lobby) runs from the gilded cornice at the top to the polished floor
 * at the bottom. Nothing is stretched: the tall pieces (columns, arched
 * windows, the curtain wall, the chandelier's chain, the pendants' cords) are
 * drawn at their real height, and the furniture (the console and its lamp,
 * the bench, the planter) stands on the floor at the one-story lobby's size.
 * Downstairs the pattern repeats every four tiles: a column, a wide arched
 * window over two tiles, and a chandelier on a long chain.
 *
 * Over the entrance the doors are the one-story entrance itself, with a tall
 * glass wall above the grand doors and plain marble above the service door.
 *
 * Every slice is drawn whole and the renderer cuts it into one-story cells,
 * so adjacent slices line up into one continuous hall.
 */

/** The hall's back wall and the gilded cornice along its ceiling. */
function hallShell(d: DrawCtx, x0: number, y0: number, ww: number, floorTop: number, ground: boolean, seed: number): void {
  const { ctx } = d;
  const hh = floorTop - y0;
  if (ground) {
    const g = ctx.createLinearGradient(0, y0, 0, floorTop);
    g.addColorStop(0, "#F1E8CE");
    g.addColorStop(1, "#E3D7B3");
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, ww, hh);
    ctx.fillStyle = "rgba(120,100,60,0.12)"; // faint veins, as in the one-story lobby
    ctx.fillRect(x0 + 3, y0 + 6, 1, hh - 11);
    ctx.fillRect(x0 + ww - 4, y0 + 10, 1, hh - 15);
  } else {
    ctx.fillStyle = "#C4BCA8";
    ctx.fillRect(x0, y0, ww, hh);
    hallGlass(d, x0 + 1, y0 + 5, ww - 2, hh - 8, seed);
  }
  cornice(ctx, x0, y0, ww);
}

function cornice(ctx: CanvasRenderingContext2D, x0: number, y0: number, ww: number): void {
  ctx.fillStyle = "#C9A24B";
  ctx.fillRect(x0, y0, ww, 3);
  ctx.fillStyle = "#8A7430";
  ctx.fillRect(x0, y0 + 3, ww, 1);
}

/** The hall's chandelier: the one-story lobby's chandelier on a long chain,
 *  hung from the ceiling into the open space. */
function hallChandelier(d: DrawCtx, cx: number, y0: number, hang: number, ww: number): void {
  const { ctx, lit } = d;
  ctx.fillStyle = "#8A7430";
  ctx.fillRect(cx, y0 + 3, 1, hang);
  chandelier(ctx, cx, y0 + hang, lit, ww);
}

/** One slice of a tall lobby, `h` covering all its `stories`. `variant` is a
 *  pattern slot (`lobbyVariant`) or an entrance sentinel; a one-story lobby
 *  draws as the one-story tile. */
export function drawTallLobbyTile(
  d: DrawCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  variant: number,
  ground: boolean,
  stories: number,
): void {
  const s = Math.max(1, Math.min(3, Math.trunc(stories) || 1));
  if (s === 1) return drawLobbyTile(d, x, y, w, h, variant, ground);
  const { ctx, lit } = d;
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const ww = Math.max(1, Math.round(w));
  const storyH = Math.round(Math.max(1, Math.round(h)) / s);
  const bottom = y0 + s * storyH;
  const lowY = bottom - storyH; // top of the story people walk on
  const floorTop = bottom - 5;
  const cx = x0 + Math.floor(ww / 2);
  if (variant >= LOBBY_VARIANTS) return tallEntrance(d, x0, y0, ww, storyH, lowY, floorTop, variant);
  hallShell(d, x0, y0, ww, floorTop, ground, variant + 1);
  lobbyFloor(ctx, x0, ww, bottom, ground);
  if (variant === 0) {
    layerBreak(ctx);
    fluteColumn(ctx, cx, y0, bottom - y0, ground); // one column, ceiling to floor
  } else if (variant === 1) {
    if (ground) wideWindowHalf(d, x0, y0, ww, lowY, false);
    consolePanel(ctx, x0, ww, lowY, floorTop, ground, lit); // marks its own split
  } else if (variant === 2) {
    if (ground) wideWindowHalf(d, x0, y0, ww, lowY, true);
    layerBreak(ctx);
    if (!ground) globePendants(d, cx, y0 + 4, lowY + Math.round(storyH * 0.35));
    planter(ctx, cx, floorTop);
  } else if (variant === 3) {
    if (ground) {
      layerBreak(ctx);
      hallChandelier(d, cx, y0, Math.round((bottom - y0) * 0.3), ww);
    } else {
      framedPrint(ctx, cx, lowY);
      layerBreak(ctx);
    }
  }
}

/** One half of the ground hall's wide arched window, which spans the second
 *  and third pattern slots: the window is drawn whole, two tiles wide, and
 *  clipped to this tile, so the two halves meet at the shared mullion. */
function wideWindowHalf(d: DrawCtx, x0: number, y0: number, ww: number, lowY: number, right: boolean): void {
  const { ctx } = d;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, ww, lowY + 4 - y0);
  ctx.clip();
  archedWindow(d, (right ? x0 - ww : x0) + 1, y0 + 7, 2 * ww - 2, lowY + 4 - (y0 + 7), true, y0);
  ctx.restore();
}

/** The ground entrance slice of a tall lobby: the one-story entrance on the
 *  bottom story, under a tall glass wall (grand doors) or plain marble
 *  (service door) that runs up to the hall's cornice. */
function tallEntrance(d: DrawCtx, x0: number, y0: number, ww: number, storyH: number, lowY: number, floorTop: number, variant: number): void {
  const { ctx, lit } = d;
  const grand = variant !== ENTRANCE_SERVICE;
  const upper = (): void => {
    if (grand) {
      ctx.fillStyle = lit ? "#2A3350" : "#AFC8DE"; // the entrance's sky, carried up
      ctx.fillRect(x0, y0 + 4, ww, lowY - y0);
      // Mullions on the composite facade's 5-pixel pitch, so the two grand
      // halves line up; the right half sits one tile into the composite.
      const off = variant === ENTRANCE_GRAND_RIGHT ? ww : 0;
      ctx.fillStyle = lit ? "rgba(58,80,104,0.6)" : "rgba(90,126,154,0.6)";
      for (let k = 0; k < ww; k++) if ((k + off) % 5 === 0) ctx.fillRect(x0 + k, y0 + 4, 1, lowY - y0);
      for (let ty = y0 + 18; ty < lowY; ty += 15) ctx.fillRect(x0, ty, ww, 1);
    } else {
      const g = ctx.createLinearGradient(0, y0, 0, floorTop);
      g.addColorStop(0, "#F1E8CE");
      g.addColorStop(1, "#E3D7B3");
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, ww, lowY + 4 - y0);
    }
    cornice(ctx, x0, y0, ww);
  };
  upper();
  drawLobbyTile(d, x0, lowY, ww, storyH, variant, true);
  // The one-story entrance has its own cornice; in the hall it is open space,
  // so the wall above carries on over it.
  layerShell(ctx, upper);
}

/** Entrance kind to its sentinel variant, for {@link drawTallLobbyEntrance}. */
const ENTRANCE_VARIANT: Record<EntranceKind, number> = {
  "grand-left": ENTRANCE_GRAND_LEFT,
  "grand-right": ENTRANCE_GRAND_RIGHT,
  "grand-solo": ENTRANCE_GRAND_SOLO,
  service: ENTRANCE_SERVICE,
};

/** The ground entrance slice of a tall lobby, `h` covering all its stories. */
export function drawTallLobbyEntrance(d: DrawCtx, kind: EntranceKind, x: number, y: number, w: number, h: number, stories: number): void {
  drawTallLobbyTile(d, x, y, w, h, ENTRANCE_VARIANT[kind] ?? ENTRANCE_SERVICE, true, stories);
}
