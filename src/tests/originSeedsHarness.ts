import { FACILITIES, facilityFloors } from "../engine/facilities";
import type { FacilityKind, Unit } from "../engine/types";
import { paintSettledUnit } from "../render/regionPaint";
import { FLOOR, TILE } from "../render/scale";
import type { DrawCtx } from "../render/sprites";

/**
 * The shared harness for the room-origin tests (`render/originSeeds.test.ts`
 * and `render/originSeedsSweep.integration.test.ts`). Vitest has no 2D raster,
 * so {@link rasterCtx} is a small software canvas covering the calls room
 * sprites make: solid fills (with coverage at fractional edges and source-over
 * alpha), square-pen strokes, text as a placeholder block, translate and
 * scale, and a rectangular clip. It is built for equality between offsets; its
 * pixels differ from a browser's. Any other call throws, so a test cannot pass
 * by skipping a draw it does not understand.
 */

export interface Raster {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  data: Float64Array;
}

export function parseColor(c: string): [number, number, number, number] {
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)).concat(1) as [number, number, number, number];
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const p = m[1].split(",").map((s) => Number(s.trim()));
    if (p.some((v) => !Number.isFinite(v))) throw new Error(`rasterCtx: bad color ${c}`);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  throw new Error(`rasterCtx: unsupported fill style ${c}`);
}

export function rasterCtx(w: number, h: number): Raster {
  const data = new Float64Array(w * h * 4);
  interface State {
    fill: string; stroke: string; align: string; alpha: number; lineWidth: number;
    sx: number; sy: number; tx: number; ty: number; clip: [number, number, number, number];
  }
  let st: State = { fill: "#000000", stroke: "#000000", align: "left", alpha: 1, lineWidth: 1, sx: 1, sy: 1, tx: 0, ty: 0, clip: [0, 0, w, h] };
  const stack: State[] = [];
  let path: [number, number, number, number] | null = null;
  // Line segments of the current path, in device pixels, for `stroke`.
  let segs: [number, number, number, number][] = [];
  let pen: [number, number] | null = null;
  const dev = (x: number, y: number): [number, number] => [x * st.sx + st.tx, y * st.sy + st.ty];
  // Edge coverage snapped to 1/256, so the same edge reached through a
  // different translation (an ulp apart) covers a pixel identically.
  const cover = (v: number): number => Math.round(v * 256) / 256;
  const blend = (px: number, py: number, rgba: [number, number, number, number], a: number): void => {
    // Stored as bytes after every blend, like a real canvas, so float noise
    // from a far-off origin cannot survive into the comparison.
    const i = (py * w + px) * 4;
    for (let k = 0; k < 3; k++) data[i + k] = Math.round(rgba[k] * a + data[i + k] * (1 - a));
    data[i + 3] = Math.round(255 * a + data[i + 3] * (1 - a));
  };
  const impl: Record<string, unknown> = {
    save: () => stack.push({ ...st, clip: [...st.clip] as State["clip"] }),
    restore: () => {
      const s = stack.pop();
      if (!s) throw new Error("rasterCtx: restore without a matching save");
      st = s;
    },
    beginPath: () => {
      path = null;
      segs = [];
      pen = null;
    },
    moveTo: (x: number, y: number) => {
      pen = dev(x, y);
    },
    lineTo: (x: number, y: number) => {
      if (!pen) throw new Error("rasterCtx: lineTo without moveTo");
      const to = dev(x, y);
      segs.push([pen[0], pen[1], to[0], to[1]]);
      pen = to;
    },
    // A square pen `lineWidth` wide swept along each segment, every pixel it
    // touches blended once. A browser antialiases its strokes; this pen gives
    // the same pixels under any whole-pixel translation, which is all the
    // comparison needs.
    stroke: () => {
      const rgba = parseColor(st.stroke);
      const hit = new Set<number>();
      for (const [x0, y0, x1, y1] of segs) {
        const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 4) + 1;
        for (let k = 0; k <= n; k++) {
          const half = st.lineWidth / 2;
          const cx = x0 + ((x1 - x0) * k) / n;
          const cy = y0 + ((y1 - y0) * k) / n;
          for (let py = Math.floor(cover(cy - half + 0.5)); py < Math.floor(cover(cy + half + 0.5)); py++) {
            for (let px = Math.floor(cover(cx - half + 0.5)); px < Math.floor(cover(cx + half + 0.5)); px++) {
              if (px < st.clip[0] || py < st.clip[1] || px >= st.clip[2] || py >= st.clip[3]) continue;
              hit.add(py * w + px);
            }
          }
        }
      }
      for (const i of hit) blend(i % w, Math.floor(i / w), rgba, rgba[3] * st.alpha);
    },
    // Text stands in as a block four pixels a character wide, anchored the way
    // the canvas anchors it, so a label that moved would still show.
    measureText: (text: string) => ({ width: text.length * 4 }),
    fillText: (text: string, x: number, y: number) => {
      const tw = text.length * 4;
      let left = x;
      if (st.align === "center") left = x - tw / 2;
      else if (st.align === "right") left = x - tw;
      (impl.fillRect as (x: number, y: number, w: number, h: number) => void)(left, y - 5, tw, 5);
    },
    rect: (x: number, y: number, rw: number, rh: number) => {
      // Only a single-rect clip path is modeled; a second rect would union.
      if (path) throw new Error("rasterCtx: more than one rect in a path");
      const [x0, y0] = dev(x, y);
      const [x1, y1] = dev(x + rw, y + rh);
      path = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
    },
    clip: () => {
      if (!path) throw new Error("rasterCtx: clip without a rect path");
      const c = st.clip;
      st.clip = [Math.max(c[0], path[0]), Math.max(c[1], path[1]), Math.min(c[2], path[2]), Math.min(c[3], path[3])];
    },
    translate: (x: number, y: number) => {
      st.tx += x * st.sx;
      st.ty += y * st.sy;
    },
    scale: (x: number, y: number) => {
      st.sx *= x;
      st.sy *= y;
    },
    fillRect: (x: number, y: number, rw: number, rh: number) => {
      const [ax, ay] = dev(x, y);
      const [bx, by] = dev(x + rw, y + rh);
      const x0 = Math.max(Math.min(ax, bx), st.clip[0]);
      const y0 = Math.max(Math.min(ay, by), st.clip[1]);
      const x1 = Math.min(Math.max(ax, bx), st.clip[2]);
      const y1 = Math.min(Math.max(ay, by), st.clip[3]);
      if (x1 <= x0 || y1 <= y0) return;
      const rgba = parseColor(st.fill);
      for (let py = Math.floor(y0); py < Math.ceil(y1); py++) {
        const cy = cover(Math.min(y1, py + 1) - Math.max(y0, py));
        for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
          const cx = cover(Math.min(x1, px + 1) - Math.max(x0, px));
          blend(px, py, rgba, rgba[3] * st.alpha * cx * cy);
        }
      }
    },
  };
  const ctx = new Proxy(impl, {
    get(t, prop) {
      if (prop === "fillStyle") return st.fill;
      if (prop === "strokeStyle") return st.stroke;
      if (prop === "globalAlpha") return st.alpha;
      if (prop === "imageSmoothingEnabled") return false;
      if (typeof prop === "string" && Object.prototype.hasOwnProperty.call(t, prop)) return t[prop];
      throw new Error(`rasterCtx: unsupported ${String(prop)}`);
    },
    set(_t, prop, value) {
      if (prop === "fillStyle") st.fill = String(value);
      else if (prop === "strokeStyle") st.stroke = String(value);
      else if (prop === "textAlign") st.align = String(value);
      else if (prop === "globalAlpha") st.alpha = Number(value);
      else if (prop === "lineWidth") st.lineWidth = Number(value);
      else if (prop !== "imageSmoothingEnabled" && prop !== "font") throw new Error(`rasterCtx: unsupported set ${String(prop)}`);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, w, h, data };
}

/** The pixels of `r` in the `w` x `h` window at (ox, oy). */
export function crop(r: Raster, ox: number, oy: number, w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = oy; y < oy + h; y++) {
    for (let x = ox; x < ox + w; x++) {
      const i = (y * r.w + x) * 4;
      for (let k = 0; k < 4; k++) out.push(r.data[i + k]);
    }
  }
  return out;
}

export function unitOf(kind: FacilityKind, over: Partial<Unit> = {}): Unit {
  return {
    id: 9, kind, floor: 12, x: 31, width: FACILITIES[kind].width, state: "occupied",
    satisfaction: 1, occupants: FACILITIES[kind].population ?? 0, ...over,
  } as Unit;
}

/** The game's region paint of `u` with the room at (ox, oy) inside a region
 *  that leaves the same margin on every side, cropped back to the room. */
export function paintAt(u: Unit, ox: number, oy: number, lit: boolean, hour = 20, dead = false): number[] {
  const w = u.width * TILE;
  const h = facilityFloors(u.kind) * FLOOR;
  const r = rasterCtx(w + 2 * ox, h + 2 * oy);
  const d: DrawCtx = { ctx: r.ctx, lit, anim: 0, hour };
  paintSettledUnit(d, u, ox, oy, w, h, dead);
  return crop(r, ox, oy, w, h);
}

/** The game's region paint of `u` with the room's left and top edges at
 *  (-dx, -dy), as in the second region of a room that straddles a seam: the
 *  canvas holds only the part past the seam, cropped from (0, 0). */
export function paintPastSeam(u: Unit, dx: number, dy: number, lit: boolean): number[] {
  const w = u.width * TILE;
  const h = facilityFloors(u.kind) * FLOOR;
  const r = rasterCtx(w - dx, h - dy);
  const d: DrawCtx = { ctx: r.ctx, lit, anim: 0, hour: 20 };
  paintSettledUnit(d, u, -dx, -dy, w, h, false);
  return crop(r, 0, 0, w - dx, h - dy);
}

/** The window of a full paint (`full`, `w` wide) from (dx, dy) to its far
 *  corner, to compare with {@link paintPastSeam}. */
export function tail(full: number[], w: number, h: number, dx: number, dy: number): number[] {
  const out: number[] = [];
  for (let y = dy; y < h; y++) out.push(...full.slice((y * w + dx) * 4, (y * w + w) * 4));
  return out;
}

/** The per-unit origin, the two region offsets the atlas pre-flight checks
 *  (one a multiple of 8 px across and one not), and two small offsets with
 *  prime sums (3 and 7), so a detail keyed on an absolute coordinate
 *  modulo a small palette size cannot land on the same pick by luck. */
export const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [4 * TILE, FLOOR],
  [7 * TILE, 2 * FLOOR],
  [1, 2],
  [3, 4],
];
