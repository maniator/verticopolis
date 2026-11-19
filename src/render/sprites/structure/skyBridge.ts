import { lobbyFloor } from "./lobby";

/**
 * Sky bridge looks (Modern; owner, 2026-11-16: "let the users choose"; art
 * picked from the redrawn mockups, 2026-11-17). Each look is drawn as one
 * whole bridge: a frame where it meets each sky lobby, a roof and deck on the
 * lobby's ceiling and floor lines, a pattern spaced to fit the span, and an
 * underside that hangs into the open air below (nothing can stand under a
 * bridge tile, so it never covers a room). The renderer bakes one canvas per
 * tile: tile `i` of an `n`-tile bridge draws the whole bridge shifted left by
 * `i` tiles and clipped to its own cell, so neighboring tiles join into one
 * picture. People are drawn by the crowd layer on top.
 */

/** The catalog's look names (`rules.skyBridge.looks`) this file draws. The
 *  plain lobby draws as a lobby tile. */
export const BRIDGE_LOOK = { glass: "Glass Skywalk", truss: "Steel Truss", deco: "Deco Arcade", garden: "Garden Walk" } as const;

/** Which part of a bridge tile a cell shows: the bridge's own story, or the
 *  underside in the open-air cell below it. */
export type BridgePart = "deck" | "under";

/** Whether this file draws the look named `look`; the plain lobby and an
 *  unknown name do not. */
export function drawsBridgeLook(look: string): boolean {
  return look === BRIDGE_LOOK.glass || look === BRIDGE_LOOK.truss || look === BRIDGE_LOOK.deco || look === BRIDGE_LOOK.garden;
}

/** The size of one cell and the bridge's lighting, shared by every draw. */
interface Bridge {
  /** The whole bridge's width in pixels: `n` cells. */
  width: number;
  /** One cell's width (a tile) and height (a story). */
  w: number;
  h: number;
  /** The span in tiles. */
  n: number;
  lit: boolean;
}

function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, c: string, w = 1): void {
  g.strokeStyle = c;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

/** `count` evenly spaced points across the bridge, the first at `start`
 *  of a step from the left end (0 for joints, 0.5 for bay centers). */
function spaced(width: number, count: number, start: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < count; k++) out.push(Math.round(((k + start) * width) / count));
  return out;
}

/** How many bays of about `tiles` tiles fit the span, at least one. */
function bays(n: number, tiles: number): number {
  return Math.max(1, Math.round(n / tiles));
}

/** Draw tile `i` of an `n`-tile bridge in look `look`, part `part`, into a
 *  `w` by `h` cell at the origin. */
export function drawBridgeTile(g: CanvasRenderingContext2D, look: string, i: number, n: number, lit: boolean, w: number, h: number, part: BridgePart = "deck"): void {
  const draw = part === "deck" ? DECKS[look] : UNDERS[look];
  if (!draw) return;
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  g.translate(-i * w, 0);
  draw(g, { width: n * w, w, h, n, lit });
  g.restore();
}

type Draw = (g: CanvasRenderingContext2D, b: Bridge) => void;

const DECKS: Record<string, Draw> = {
  /** A: one shallow glass vault over the whole span, ribs spaced to fit,
   *  steel collars at both lobbies, the lobby's floor as its deck. */
  [BRIDGE_LOOK.glass]: (g, { width, h, n, lit }) => {
    const steel = lit ? "#56647a" : "#7d8c9f";
    rect(g, 0, 4, width, h - 9, lit ? "rgba(255,206,120,0.75)" : "rgba(150,195,230,0.9)");
    g.fillStyle = lit ? "rgba(255,214,140,0.35)" : "rgba(214,236,250,0.95)";
    g.beginPath();
    g.moveTo(0, 5);
    g.quadraticCurveTo(width / 2, -3, width, 5);
    g.lineTo(width, 6);
    g.lineTo(0, 6);
    g.fill();
    g.strokeStyle = steel;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 5.5);
    g.quadraticCurveTo(width / 2, -2.5, width, 5.5);
    g.stroke();
    const ribs = bays(n, 2);
    for (const x of spaced(width, ribs, 0).slice(1)) rect(g, x, 3, 1, h - 8, steel);
    if (!lit) for (const x of spaced(width, ribs, 0.25)) line(g, x, h - 8, x + 6, 9, "rgba(240,250,255,0.7)");
    lobbyFloor(g, 0, width, h, false);
    if (lit) rect(g, 0, h - 1, width, 1, "#9fd3ff");
    rect(g, 0, 0, 2, h, steel);
    rect(g, width - 2, 0, 2, h, steel);
  },
  /** B: a Warren truss whose diagonals mirror at the center, its panel count
   *  even and fitted to the span, in a deep oxide red. */
  [BRIDGE_LOOK.truss]: (g, { width, h, n, lit }) => {
    const steel = lit ? "#6a2a24" : "#8e3b32";
    const dark = lit ? "#3f1915" : "#652a24";
    rect(g, 0, 4, width, h - 10, lit ? "#3a2e2a" : "#ddd3bd");
    rect(g, 0, 0, width, 4, steel);
    rect(g, 0, h - 9, width, 3, steel);
    rect(g, 0, h - 6, width, 6, dark);
    const panels = trussPanels(n);
    const joints = spaced(width, panels, 0);
    joints.push(width);
    for (let k = 0; k < panels; k++) {
      const [a, b] = [joints[k], joints[k + 1]];
      if (k < panels / 2) line(g, a, h - 8, b, 2, steel, 2);
      else line(g, a, 2, b, h - 8, steel, 2);
      if (k > 0) rect(g, a - 1, 2, 2, h - 10, steel);
      if (lit) rect(g, Math.round((a + b) / 2) - 1, 6, 3, 2, "#ffd98a");
    }
    for (let x = 3; x < width - 2; x += 5) rect(g, x, 1, 1, 1, lit ? "#c98b82" : "#efc0b8");
    rect(g, 0, 0, 3, h - 6, dark);
    rect(g, width - 3, 0, 3, h - 6, dark);
  },
  /** C: a stone gallery in the tower's tan, arched windows spaced to fit, a
   *  pier at each lobby and a keystone lamp at the center. */
  [BRIDGE_LOOK.deco]: (g, { width, h, n, lit }) => {
    const stone = lit ? "#6d6656" : "#cbbf9f";
    const shade = lit ? "#4a4537" : "#a39470";
    rect(g, 0, 0, width, h, stone);
    rect(g, 0, 0, width, 4, shade);
    rect(g, 0, 4, width, 1, stone);
    rect(g, 0, h - 6, width, 6, shade);
    const count = bays(n, 2.5);
    const step = width / count;
    const r = Math.max(2, Math.min(step / 2 - 3, 8));
    for (const cx of spaced(width, count, 0.5)) {
      g.fillStyle = lit ? "#f2cf7c" : "#86a8c8";
      g.beginPath();
      g.moveTo(cx - r, h - 8);
      g.lineTo(cx - r, 15);
      g.arc(cx, 15, r, Math.PI, 0);
      g.lineTo(cx + r, h - 8);
      g.fill();
      rect(g, cx, 13, 1, h - 21, shade);
      rect(g, cx - 1, 5, 3, 2, shade);
    }
    rect(g, 0, 0, 4, h, shade);
    rect(g, width - 4, 0, 4, h, shade);
    rect(g, Math.round(width / 2) - 2, 0, 4, 4, lit ? "#ffe7a3" : "#e6dcc2");
  },
  /** D: a pergola walk with posts spaced to fit, vines, a low glass rail and
   *  planter trees spaced along the span. */
  [BRIDGE_LOOK.garden]: (g, { width, h, n, lit }) => {
    const wood = lit ? "#5a4630" : "#8c6a45";
    rect(g, 0, 4, width, h - 9, lit ? "#26302a" : "#e3eadb");
    rect(g, 0, h - 16, width, 11, lit ? "rgba(160,200,255,0.22)" : "rgba(200,225,240,0.75)");
    lobbyFloor(g, 0, width, h, false);
    rect(g, 0, 2, width, 3, wood);
    const posts = bays(n, 2);
    for (const x of spaced(width, posts, 0)) rect(g, x, 2, 2, h - 7, wood);
    rect(g, width - 2, 2, 2, h - 7, wood);
    const vine = lit ? "#2e4a2e" : "#5d8f52";
    for (let x = 0; x < width; x += 3) rect(g, x, 5, 2, 2 + ((x * 7) % 5), vine);
    for (const cx of spaced(width, bays(n, 5.5), 0.5)) {
      rect(g, cx - 6, h - 13, 12, 8, lit ? "#4a3a2a" : "#7b5b3d");
      rect(g, cx - 1, h - 19, 2, 6, lit ? "#3a2a1a" : "#5a3d22");
      g.fillStyle = lit ? "#1f3b22" : "#4f8a45";
      g.beginPath();
      g.arc(cx, h - 25, 7, 0, Math.PI * 2);
      g.fill();
    }
    if (lit) for (const x of spaced(width, posts, 0.5)) rect(g, x, h - 8, 2, 2, "#ffe7a3");
  },
};

/** The truss's panel count: even, so the diagonals mirror at the center,
 *  and about two tiles a panel. */
function trussPanels(n: number): number {
  return Math.max(2, 2 * Math.round(n / 4));
}

const UNDERS: Record<string, Draw> = {
  /** A: a slim steel belly girder that dips toward the middle. */
  [BRIDGE_LOOK.glass]: (g, { width, n, lit }) => {
    const steel = lit ? "#3c4554" : "#6b7787";
    const edge = lit ? "#9fd3ff" : "#9aa7b6";
    const dip = Math.min(16, 5 + n * 0.5);
    g.fillStyle = steel;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(width, 0);
    g.lineTo(width, 5);
    g.quadraticCurveTo(width / 2, 2 * dip, 0, 5);
    g.fill();
    g.strokeStyle = edge;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(width, 5.5);
    g.quadraticCurveTo(width / 2, 2 * dip + 0.5, 0, 5.5);
    g.stroke();
    for (const x of spaced(width, bays(n, 2), 0).slice(1)) rect(g, x, 0, 1, 4, edge);
  },
  /** B: V braces down to a bottom chord, with a knee brace into each tower. */
  [BRIDGE_LOOK.truss]: (g, { width, n, lit }) => {
    const steel = lit ? "#6a2a24" : "#8e3b32";
    const dark = lit ? "#3f1915" : "#652a24";
    const depth = 13;
    const panels = trussPanels(n);
    const joints = spaced(width, panels, 0);
    joints.push(width);
    for (let k = 0; k < panels; k++) {
      const [a, b] = [joints[k], joints[k + 1]];
      const m = (a + b) / 2;
      line(g, a, 0, m, depth, steel, 2);
      line(g, m, depth, b, 0, steel, 2);
    }
    const half = (joints[1] - joints[0]) / 2;
    rect(g, half, depth - 1, width - 2 * half, 3, dark);
    line(g, 0, depth + 11, half, depth, steel, 2);
    line(g, width, depth + 11, width - half, depth, steel, 2);
  },
  /** C: a shallow stone arch springing from the two end piers. */
  [BRIDGE_LOOK.deco]: (g, { width, lit }) => {
    const stone = lit ? "#6d6656" : "#cbbf9f";
    const shade = lit ? "#4a4537" : "#a39470";
    const spring = 24;
    const crown = 7;
    g.fillStyle = stone;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(width, 0);
    g.lineTo(width, spring);
    g.quadraticCurveTo(width / 2, 2 * crown - spring, 0, spring);
    g.fill();
    g.strokeStyle = shade;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(width, spring);
    g.quadraticCurveTo(width / 2, 2 * crown - spring, 0, spring);
    g.stroke();
    rect(g, 0, 0, 4, spring + 2, shade);
    rect(g, width - 4, 0, 4, spring + 2, shade);
    rect(g, Math.round(width / 2) - 2, crown - 3, 4, 4, shade);
  },
  /** D: a timber beam with vines trailing down. */
  [BRIDGE_LOOK.garden]: (g, { width, lit }) => {
    rect(g, 0, 0, width, 5, lit ? "#5a4630" : "#8c6a45");
    rect(g, 0, 5, width, 1, lit ? "#3f3122" : "#6b4f33");
    const vine = lit ? "#2e4a2e" : "#5d8f52";
    const leaf = lit ? "#3a5a36" : "#7aaa66";
    for (let x = 1; x < width - 1; x += 3) {
      const len = 3 + ((x * 13) % 11);
      rect(g, x, 5, 1, len, vine);
      if (len > 7) rect(g, x - 1, 3 + len, 3, 2, leaf);
    }
  },
};
