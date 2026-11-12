import type { DrawCtx } from "../common";
import { hash } from "../../pixelSprites/common";
import { layerBreak } from "../../pixelSprites/layers";
import { figTree, globePendants, skylineGlass, stonePier, vines } from "./tallSkyLobby";
import {
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
  sconce,
} from "./lobby";

/**
 * Tall lobbies (#308): one slice of a lobby two or three stories high, drawn
 * whole over `stories` floors. The concourse keeps its one-story furniture at
 * people's scale on the bottom story, where people walk, and the extra height
 * is one open hall above it, not stacked copies of the one-story tile:
 *
 * - The ground lobby is a marble atrium. The fluted columns become a giant
 *   order running floor to cornice, tall arched windows rise over the
 *   consoles, a larger chandelier hangs on a long chain, and crimson banners
 *   hang between the sconces. A thin gilded string course marks each story
 *   line so the height reads at a glance.
 * - A sky lobby (Modern) is a glass atrium looking out on the skyline, framed
 *   by warm stone piers, with a living green wall over the benches, a fig
 *   tree growing up through the hall and globe pendants over the framed
 *   prints (`tallSkyLobby.ts`).
 * - The entrance stays a one-story storefront at the bottom, with a glazed
 *   transom over the grand doors filling the stories above them.
 *
 * Every slice is drawn whole and the renderer cuts it into one-story cells,
 * so adjacent slices still line up into one continuous hall.
 */

/** Whole pixel rows of the story lines inside a hall `hh` high. */
function storyLines(y0: number, hh: number, stories: number): number[] {
  return Array.from({ length: stories - 1 }, (_, k) => y0 + Math.round(((k + 1) * hh) / stories));
}

/** The hall's shell: back wall, story lines, cornice, floor and carpet. */
function hallShell(d: DrawCtx, x0: number, y0: number, ww: number, hh: number, stories: number, ground: boolean, seed: number): void {
  const { ctx } = d;
  const floorTop = y0 + hh - 5;
  if (ground) {
    const g = ctx.createLinearGradient(0, y0, 0, floorTop);
    g.addColorStop(0, "#F1E8CE");
    g.addColorStop(1, "#E3D7B3");
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, ww, floorTop - y0);
    ctx.fillStyle = "rgba(120,100,60,0.12)"; // long veins, polished marble
    ctx.fillRect(x0 + 3, y0 + 6, 1, hh - 16);
    ctx.fillRect(x0 + ww - 4, y0 + 10, 1, hh - 20);
    for (const yl of storyLines(y0, hh, stories)) {
      ctx.fillStyle = "#D9B356"; // gilded string course
      ctx.fillRect(x0, yl - 1, ww, 1);
      ctx.fillStyle = "rgba(105,90,55,0.35)";
      ctx.fillRect(x0, yl, ww, 1);
    }
  } else {
    // One curtain wall, floor to ceiling, looking out on the skyline.
    skylineGlass(d, x0, y0 + 4, ww, floorTop - y0 - 4, seed, storyLines(y0, hh, stories));
  }
  ctx.fillStyle = "#C9A24B"; // gilded cornice, at the very top only
  ctx.fillRect(x0, y0, ww, 3);
  ctx.fillStyle = "#8A7430";
  ctx.fillRect(x0, y0 + 3, ww, 1);
  ctx.fillStyle = ground ? "#DCD2B8" : "#CBC3B0";
  ctx.fillRect(x0, floorTop, ww, 5);
  ctx.fillStyle = ground ? "#F0E8D0" : "#D8D2C2";
  ctx.fillRect(x0, floorTop, ww, 1);
  ctx.fillStyle = ground ? "#8F7A48" : "#8A7E64";
  ctx.fillRect(x0, y0 + hh - 1, ww, 1);
  if (ground) {
    ctx.fillStyle = "#9A2E38";
    ctx.fillRect(x0, y0 + hh - 4, ww, 3);
    ctx.fillStyle = "#B84450";
    ctx.fillRect(x0, y0 + hh - 4, ww, 1);
    ctx.fillStyle = "#D9B356";
    ctx.fillRect(x0, y0 + hh - 5, ww, 1);
  }
}

/** A tall glazed opening with a gold frame and a round head: dark warm glass
 *  with a few city lights after dark, pale sky by day. `head` false draws a
 *  square top (the entrance transom). */
function tallWindow(d: DrawCtx, x: number, y: number, w: number, h: number, head: boolean, seed: number): void {
  const { ctx, lit } = d;
  if (w < 3 || h < 6) return;
  ctx.fillStyle = "#C9A24B";
  ctx.fillRect(x, y + (head ? 2 : 0), w, h - (head ? 2 : 0));
  if (head) {
    ctx.fillRect(x + 1, y + 1, w - 2, 1);
    ctx.fillRect(x + 2, y, Math.max(1, w - 4), 1);
  }
  const gx = x + 1;
  const gy = y + (head ? 2 : 1);
  const gw = w - 2;
  const gh = h - (head ? 3 : 2);
  const g = ctx.createLinearGradient(0, gy, 0, gy + gh);
  g.addColorStop(0, lit ? "#2E2C34" : "#B7CCDA");
  g.addColorStop(1, lit ? "#26242C" : "#D3E0E8");
  ctx.fillStyle = g;
  ctx.fillRect(gx, gy, gw, gh);
  if (head) ctx.fillRect(x + 2, y + 1, Math.max(1, w - 4), 1);
  if (lit) {
    ctx.fillStyle = "#B89A62";
    for (let yy = 3; yy < gh - 1; yy += 4) {
      for (let xx = 0; xx < gw; xx += 2) {
        if (hash(seed * 97 + xx * 13 + yy * 5) > 0.8) ctx.fillRect(gx + xx, gy + yy, 1, 1);
      }
    }
  }
  ctx.fillStyle = "rgba(138,116,48,0.8)"; // mullion and transom bars
  if (gw >= 4) ctx.fillRect(gx + (gw >> 1), gy, 1, gh);
  for (let yy = 8; yy < gh - 2; yy += 9) ctx.fillRect(gx, gy + yy, gw, 1);
}

/** The large chandelier on a long chain, hanging into the hall. */
function grandChandelier(d: DrawCtx, cx: number, y0: number, bodyY: number, ww: number): void {
  const { ctx, lit } = d;
  ctx.fillStyle = "#8A7430";
  ctx.fillRect(cx, y0 + 4, 1, bodyY - y0 - 4); // chain
  ctx.fillStyle = lit ? "#FFD76B" : "#C8A343";
  ctx.fillRect(cx - 1, bodyY, 3, 2);
  ctx.fillRect(cx - 3, bodyY + 3, 7, 2);
  ctx.fillRect(cx - 4, bodyY + 6, 9, 2);
  ctx.fillRect(cx - 2, bodyY + 9, 5, 1);
  ctx.fillStyle = lit ? "#F8E2B4" : "#A3873A"; // candle tips and drops
  for (const dx of [-3, 0, 3]) ctx.fillRect(cx + dx, bodyY + 2, 1, 1);
  for (const dx of [-4, -2, 2, 4]) ctx.fillRect(cx + dx, bodyY + 5, 1, 1);
  ctx.fillRect(cx, bodyY + 10, 1, 1);
  if (lit) {
    ctx.fillStyle = "rgba(255,214,110,0.26)";
    ctx.beginPath();
    ctx.arc(cx + 0.5, bodyY + 5, Math.min(8, ww / 2), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A crimson banner with a gold border and a swallowtail, hung from the
 *  cornice between the sconces. */
function banner(ctx: CanvasRenderingContext2D, cx: number, top: number, bottom: number): void {
  if (bottom - top < 8) return;
  ctx.fillStyle = "#8A7430"; // rod
  ctx.fillRect(cx - 2, top, 5, 1);
  ctx.fillStyle = "#D9B356";
  ctx.fillRect(cx - 2, top + 1, 5, bottom - top - 2);
  ctx.fillStyle = "#9A2E38";
  ctx.fillRect(cx - 1, top + 1, 3, bottom - top - 2);
  ctx.fillStyle = "#D9B356"; // emblem
  ctx.fillRect(cx, top + 4, 1, 3);
  ctx.fillRect(cx - 1, top + 5, 3, 1);
  ctx.fillStyle = "#9A2E38"; // swallowtail points
  ctx.fillRect(cx - 2, bottom - 1, 2, 1);
  ctx.fillRect(cx + 1, bottom - 1, 2, 1);
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
  const { ctx } = d;
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const ww = Math.max(1, Math.round(w));
  const hh = Math.max(1, Math.round(h));
  const storyH = Math.round(hh / s);
  const baseY = y0 + hh - storyH; // top of the bottom story, where people walk
  const floorTop = y0 + hh - 5;
  const cx = x0 + Math.floor(ww / 2);
  if (variant >= LOBBY_VARIANTS) {
    // The entrance: the one-story storefront at the bottom, a glazed transom
    // over the grand doors above it, plain marble over the service door.
    hallShell(d, x0, y0, ww, hh, s, true, variant);
    const grand = variant === ENTRANCE_GRAND_LEFT || variant === ENTRANCE_GRAND_RIGHT || variant === ENTRANCE_GRAND_SOLO;
    if (grand) {
      // The two grand halves frame one transom across both tiles.
      const left = variant === ENTRANCE_GRAND_RIGHT ? x0 : x0 + 1;
      const right = variant === ENTRANCE_GRAND_LEFT ? x0 + ww : x0 + ww - 1;
      tallWindow(d, left, y0 + 6, right - left, baseY - y0 - 7, false, variant);
    }
    return drawLobbyTile(d, x0, baseY, ww, storyH, variant === ENTRANCE_SERVICE ? ENTRANCE_SERVICE : variant, true);
  }
  hallShell(d, x0, y0, ww, hh, s, ground, variant + 1);
  if (variant === 0) {
    layerBreak(ctx);
    if (ground) {
      fluteColumn(ctx, cx, y0, hh, ground); // the giant order, floor to cornice
      ctx.fillStyle = "#C9A24B";
      for (const yl of storyLines(y0, hh, s)) ctx.fillRect(cx - 1, yl - 1, 3, 1);
    } else {
      stonePier(ctx, cx, y0, hh, storyLines(y0, hh, s));
    }
  } else if (variant === 1) {
    if (ground) tallWindow(d, x0 + 2, y0 + 7, ww - 4, baseY - y0 - 8, true, variant);
    else for (const yl of storyLines(y0, hh, s)) vines(ctx, x0, ww, yl, variant + yl);
    consolePanel(ctx, x0, ww, baseY, floorTop, ground, d.lit); // marks its own split
  } else if (variant === 2) {
    layerBreak(ctx);
    if (ground) grandChandelier(d, cx, y0, y0 + Math.round((baseY - y0) * 0.55), ww);
    else figTree(ctx, cx - 1, floorTop, baseY - 10);
  } else if (variant === 3) {
    if (ground) {
      banner(ctx, cx, y0 + 5, baseY - 3);
      sconce(ctx, cx, baseY, d.lit);
    } else {
      for (const yl of storyLines(y0, hh, s)) vines(ctx, x0, ww, yl, variant * 5 + yl);
      framedPrint(ctx, cx, baseY);
    }
    layerBreak(ctx);
    if (!ground) globePendants(d, cx, y0 + 4, baseY - 2);
  }
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
