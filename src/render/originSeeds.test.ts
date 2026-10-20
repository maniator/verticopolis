import { describe, expect, it } from "vitest";
import { FACILITIES, facilityFloors } from "../engine/facilities";
import { subtypeListFor } from "../engine/retailSubtypes";
import type { FacilityKind, Unit } from "../engine/types";
import { roomKinds } from "./atlas/catalog";
import { skylineWindowLit } from "./pixelSprites/skyBar";
import { paintSettledUnit } from "./regionPaint";
import { FLOOR, TILE } from "./scale";
import type { DrawCtx } from "./sprites";

/**
 * Room details must be a function of the room alone, wherever it is painted
 * (#915). The region compositor paints a room at its offset inside a region
 * canvas, so any detail seeded from the draw origin would follow where the
 * region starts, and a room straddling two regions could show different details
 * on each side of the seam. These tests paint one room through the game's own
 * region paint at several offsets and require identical pixels.
 *
 * Vitest has no 2D raster, so {@link rasterCtx} is a small software canvas
 * covering the calls room sprites make: solid fills (with coverage at
 * fractional edges and source-over alpha), square-pen strokes, text as a
 * placeholder block, translate and scale, and a rectangular clip. It is built for equality
 * between offsets; its pixels differ from a browser's. Any other call throws, so
 * the test cannot pass by skipping a draw it does not understand.
 */

interface Raster {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  data: Float64Array;
}

function parseColor(c: string): [number, number, number, number] {
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

function rasterCtx(w: number, h: number): Raster {
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
function crop(r: Raster, ox: number, oy: number, w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = oy; y < oy + h; y++) {
    for (let x = ox; x < ox + w; x++) {
      const i = (y * r.w + x) * 4;
      for (let k = 0; k < 4; k++) out.push(r.data[i + k]);
    }
  }
  return out;
}

function unitOf(kind: FacilityKind, over: Partial<Unit> = {}): Unit {
  return {
    id: 9, kind, floor: 12, x: 31, width: FACILITIES[kind].width, state: "occupied",
    satisfaction: 1, occupants: FACILITIES[kind].population ?? 0, ...over,
  } as Unit;
}

/** The game's region paint of `u` with the room at (ox, oy) inside a region
 *  that leaves the same margin on every side, cropped back to the room. */
function paintAt(u: Unit, ox: number, oy: number, lit: boolean, hour = 20, dead = false): number[] {
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
function paintPastSeam(u: Unit, dx: number, dy: number, lit: boolean): number[] {
  const w = u.width * TILE;
  const h = facilityFloors(u.kind) * FLOOR;
  const r = rasterCtx(w - dx, h - dy);
  const d: DrawCtx = { ctx: r.ctx, lit, anim: 0, hour: 20 };
  paintSettledUnit(d, u, -dx, -dy, w, h, false);
  return crop(r, 0, 0, w - dx, h - dy);
}

/** The window of a full paint (`full`, `w` wide) from (dx, dy) to its far
 *  corner, to compare with {@link paintPastSeam}. */
function tail(full: number[], w: number, h: number, dx: number, dy: number): number[] {
  const out: number[] = [];
  for (let y = dy; y < h; y++) out.push(...full.slice((y * w + dx) * 4, (y * w + w) * 4));
  return out;
}

/** The per-unit origin, the two region offsets the atlas pre-flight checks
 *  (one a multiple of 8 px across and one not), and two small offsets with
 *  prime sums (3 and 7), so a detail keyed on an absolute coordinate
 *  modulo a small palette size cannot land on the same pick by luck. */
const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [4 * TILE, FLOOR],
  [7 * TILE, 2 * FLOOR],
  [1, 2],
  [3, 4],
];

const CASES: ReadonlyArray<{ label: string; unit: Unit }> = [
  { label: "security", unit: unitOf("security") },
  { label: "medical", unit: unitOf("medical") },
  { label: "housekeeping", unit: unitOf("housekeeping") },
  { label: "skyBar", unit: unitOf("skyBar") },
  { label: "fitnessClub (climbing wall)", unit: unitOf("fitnessClub", { subtype: "Climbing Wall" }) },
  { label: "fitnessClub in the basement", unit: unitOf("fitnessClub", { subtype: "Climbing Wall", floor: -3, x: 2 }) },
  { label: "security in the basement", unit: unitOf("security", { floor: -3, x: 2 }) },
  { label: "medical in the basement", unit: unitOf("medical", { floor: -3, x: 2 }) },
  { label: "housekeeping in the basement", unit: unitOf("housekeeping", { floor: -3, x: 2 }) },
  // A basement sky bar is left out: its bottles index a negative seed (#1029).
  { label: "boutique (phone repair)", unit: unitOf("boutiqueBay", { subtype: "Phone Repair" }) },
  { label: "clinic (pharmacy)", unit: unitOf("clinic", { subtype: "Pharmacy" }) },
  { label: "amusements (claw parlor)", unit: unitOf("amusements", { subtype: "Claw Parlor" }) },
  // Basement placements give a negative raw seed, so a pick that goes back to a
  // plain `% length` fails here (the claw prize would index undefined).
  { label: "boutique (phone repair) in the basement", unit: unitOf("boutiqueBay", { subtype: "Phone Repair", floor: -3, x: 2 }) },
  { label: "clinic (pharmacy) in the basement", unit: unitOf("clinic", { subtype: "Pharmacy", floor: -3, x: 2 }) },
  { label: "amusements (claw parlor) in the basement", unit: unitOf("amusements", { subtype: "Claw Parlor", floor: -3, x: 2 }) },
];

/** The looks the sweep paints each kind and subtype in: the settled states,
 *  lit and unlit, a day, evening and late-night hour (so rooms closed by their
 *  business hours draw their shutter), an open room with nobody in it, one
 *  person, or full, a basement placement, and a dead parking space (the mark
 *  only applies to parking). The on-notice ribbon (`vacating`) fills a triangle the raster does not
 *  model; it is drawn from the room's own corner. */
const SWEEP: ReadonlyArray<{ state: Unit["state"]; lit: boolean; hour: number; occ?: number; basement?: boolean; dead?: boolean }> = [
  { state: "occupied", lit: false, hour: 12 },
  { state: "occupied", lit: false, hour: 12, occ: 0 },
  { state: "occupied", lit: true, hour: 20, basement: true },
  { state: "occupied", lit: false, hour: 12, dead: true },
  { state: "occupied", lit: true, hour: 20 },
  { state: "occupied", lit: true, hour: 2 },
  { state: "occupied", lit: false, hour: 12, occ: 1 },
  { state: "empty", lit: false, hour: 12 },
  { state: "moving_in", lit: false, hour: 12 },
  { state: "asleep", lit: true, hour: 2 },
  { state: "dirty", lit: true, hour: 20 },
  { state: "infested", lit: false, hour: 12 },
  { state: "gutted", lit: false, hour: 12 },
];

describe("room details follow the room wherever it is painted (#915)", () => {
  for (const { label, unit } of CASES) {
    for (const lit of [false, true]) {
      it(`${label}${lit ? " (lit)" : ""} paints the same pixels at every region offset`, () => {
        const [first, ...rest] = OFFSETS.map(([ox, oy]) => paintAt(unit, ox, oy, lit));
        expect(first.some((v) => v !== 0)).toBe(true); // the room actually painted
        for (const other of rest) expect(other).toEqual(first);
        // The part of the room past a region seam, painted from a negative
        // origin, matches the same part of the whole room.
        const w = unit.width * TILE;
        const h = facilityFloors(unit.kind) * FLOOR;
        for (const [dx, dy] of [[3 * TILE, 0], [TILE + 3, FLOOR]] as const) {
          if (dy >= h) continue;
          expect(paintPastSeam(unit, dx, dy, lit), `past a seam at ${dx},${dy}`).toEqual(tail(first, w, h, dx, dy));
        }
      });
    }
  }

  // A sweep of every room kind and subtype, so a detail seeded from the draw
  // origin in a kind nobody listed above is caught too.
  for (const kind of roomKinds()) {
    it(`every ${kind} subtype and look paints the same pixels at every region offset`, () => {
      const moved: string[] = [];
      for (const subtype of [undefined, ...(subtypeListFor(kind) ?? [])]) {
        for (const look of SWEEP) {
          const occupants = look.occ ?? (FACILITIES[kind].population ?? 0);
          // The shallowest basement floor, at a column that keeps every raw
          // geography seed positive (a negative one is #1029).
          const where = look.basement ? { floor: -1, x: 40 } : {};
          const unit = unitOf(kind, { subtype, state: look.state, occupants, ...where });
          const dead = kind === "parking" && look.dead === true;
          const [first, ...rest] = OFFSETS.map(([ox, oy]) => paintAt(unit, ox, oy, look.lit, look.hour, dead));
          expect(first.some((v) => v !== 0), `${kind}/${subtype ?? "-"} painted`).toBe(true);
          const key = first.join(",");
          if (rest.some((r) => r.join(",") !== key)) moved.push(`${subtype ?? "-"} ${JSON.stringify(look)}`);
        }
      }
      expect(moved).toEqual([]);
    }, 60_000); // the metro fills the lot, so its sweep alone takes seconds
  }

  it("still varies the details from room to room", () => {
    // The seeds moved to the room's floor and column; placements of one kind
    // must still be able to differ along each axis, or the fix dropped the
    // variety (or one axis of it). The three staff rooms read the unit only
    // for the staff seed, so for them the whole room varying is the shirts
    // varying.
    const over = (kind: FacilityKind): Partial<Unit> => (kind === "fitnessClub" ? { subtype: "Climbing Wall" } : {});
    for (const kind of ["security", "medical", "housekeeping", "skyBar", "fitnessClub"] as const) {
      const byFloor = new Set([5, 12, 27, 43].map((floor) => paintAt(unitOf(kind, { ...over(kind), floor }), 0, 0, true).join(",")));
      expect(byFloor.size, `${kind} across floors`).toBeGreaterThan(1);
      const byColumn = new Set([17, 64, 131, 208].map((x) => paintAt(unitOf(kind, { ...over(kind), x }), 0, 0, true).join(",")));
      expect(byColumn.size, `${kind} across columns`).toBeGreaterThan(1);
    }
  });

  it("varies the moved details themselves", () => {
    // An empty climbing gym draws no figures, so the holds are the only part
    // of it that depends on the room's seed.
    const holds = new Set([5, 12, 27, 43, 61].flatMap((floor) => [17, 64, 131].map((x) =>
      paintAt(unitOf("fitnessClub", { subtype: "Climbing Wall", occupants: 0, floor, x }), 0, 0, true).join(","))));
    expect(holds.size).toBeGreaterThan(1);
    // The skyline windows: one window must light up in some rooms and not in
    // others, and one room must have both lit and dark windows.
    const seeds = Array.from({ length: 40 }, (_, n) => n * 167 + 29 * (n % 7));
    expect(new Set(seeds.map((s) => skylineWindowLit(s, 2, 1))).size).toBe(2);
    const room: boolean[] = [];
    for (let b = 0; b < 8; b++) for (let r = 0; r < 4; r++) room.push(skylineWindowLit(seeds[3], b, r));
    expect(new Set(room).size).toBe(2);
    // The parts bins, the pharmacy shelves and the claw machine prizes, in
    // rooms with nobody in them, so no figure carries the variety instead.
    for (const [kind, subtype] of [["boutiqueBay", "Phone Repair"], ["clinic", "Pharmacy"], ["amusements", "Claw Parlor"]] as const) {
      const looks = new Set([5, 12, 27, 43, 61].flatMap((floor) => [17, 64, 131].map((x) =>
        paintAt(unitOf(kind, { subtype, occupants: 0, floor, x }), 0, 0, true).join(","))));
      expect(looks.size, `${kind}/${subtype}`).toBeGreaterThan(1);
    }
  });

  it("the comparison catches a detail that follows the draw origin", () => {
    // Controls. A paint that seeds a color from its absolute x must fail the
    // same comparison the rooms pass.
    const paint = (ox: number): number[] => {
      const r = rasterCtx(40 + 2 * ox, 10);
      r.ctx.fillStyle = ox % 2 ? "#ff0000" : "#00ff00";
      r.ctx.fillRect(ox, 0, 40, 10);
      return crop(r, ox, 0, 40, 10);
    };
    expect(paint(3)).not.toEqual(paint(0));
    // A smoke check that the real pipeline (region paint, raster, crop) can
    // tell two room pictures apart at all: the same room moved to another
    // floor, painted at a region offset, differs from the original at the
    // origin for at least one of a few floors (two floors can share a look by
    // chance). The synthetic control above is the one that proves a detail
    // following the draw origin fails the comparison.
    for (const { label, unit } of CASES) {
      const base = paintAt(unit, 0, 0, true).join(",");
      const moved = [1, 2, 3, 4].map((df) => paintAt({ ...unit, floor: unit.floor + df }, 7 * TILE, 2 * FLOOR, true).join(","));
      expect(moved.some((m) => m !== base), label).toBe(true);
    }
  });
});
