import { describe, it, expect, vi } from "vitest";
import type { Unit } from "../../../engine/types";
import type { DrawCtx } from "../common";
import { FACILITIES, facilityFloors } from "../../../engine/facilities";
import { TILE, FLOOR } from "../../scale";
import { refMap } from "./serviceKit";
import { drawParking, drawParkingRamp } from "./garage";
import { drawSecurity, drawMedical, drawHousekeeping } from "./service";
import { drawRecycling } from "./recycling";

/** Every `refMap` call the painters make, as (RW, RH, w, h). The wrapper passes
 *  straight through, so the paint is unchanged. */
const refMapCalls = vi.hoisted(() => [] as Array<{ RW: number; RH: number; w: number; h: number }>);
vi.mock("./serviceKit", async (importOriginal) => {
  const real = await importOriginal<typeof import("./serviceKit")>();
  return {
    ...real,
    refMap: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, RW: number, RH: number) => {
      refMapCalls.push({ RW, RH, w, h });
      return real.refMap(ctx, x, y, w, h, RW, RH);
    },
  };
});

/**
 * The service sprites were once authored in a reference space (TILE 11 by
 * FLOOR 44) that the world no longer uses, so `refMap` resampled every rect.
 * Resampling is acceptable; resampling INCONSISTENTLY is not. When a rect's size
 * is derived from its mapped edges, two identically authored objects land at
 * different sizes depending on where their sub-pixel position falls, and a wall
 * of monitors renders 8,7,7,7,7 instead of five of a kind.
 *
 * Nothing covered this family before, which is why a P1 shipped inside a diff of
 * three constants (issue #812). These guards are about UNIFORMITY, not beauty.
 * Even PITCH is now reachable too: the references were re-authored onto the live
 * 10 by 45 grid, so the security wall's five monitors are 7 wide on a 9 pitch
 * and the gaps between them are all 2. Pitch is asserted for the monitor wall
 * and the two shelf families (the linen stacks and the cabinet bottles), whose
 * even pitch this re-author was written to deliver. Elsewhere it is not
 * asserted, because an assertion on it would pin one art choice rather than
 * the renderer, and the pitch is only even because a whole number of them fits
 * the authored wall.
 */

/** Records fillRect geometry. A Proxy absorbs every other context call, which
 *  keeps the offscreen paths inside these sprites from needing a real canvas. */
function recorder() {
  const rects: Array<{ x: number; y: number; w: number; h: number; c: string }> = [];
  const store: Record<string | symbol, unknown> = {};
  const ctx: unknown = new Proxy({} as Record<string | symbol, unknown>, {
    get(_t, prop) {
      if (prop === "fillRect") {
        return (x: number, y: number, w: number, h: number) =>
          rects.push({ x, y, w, h, c: String(store.fillStyle ?? "") });
      }
      if (prop === "canvas") return { width: 4096, height: 4096, getContext: () => ctx };
      if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createPattern") {
        return () => ({ addColorStop: () => {} });
      }
      if (prop === "measureText") return () => ({ width: 4 });
      if (prop in store) return store[prop];
      return () => {};
    },
    set(_t, prop, value) {
      store[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as CanvasRenderingContext2D, rects };
}

const dc = (ctx: CanvasRenderingContext2D): DrawCtx => ({ ctx, lit: false, anim: 0, hour: 12 });
const UNIT = { id: 7, kind: "parking", x: 0, floor: 1, width: 4, state: "occupied", occupants: 0 } as unknown as Unit;

/** The six sprites, each with the tile footprint its reference was authored for.
 *  Signatures differ, so each carries its own caller. */
const SPRITES = [
  { name: "parking", tiles: 4, floors: 1, draw: (c: CanvasRenderingContext2D, w: number, h: number) => drawParking(dc(c), UNIT, 0, 0, w, h) },
  { name: "parkingRamp", tiles: 16, floors: 1, draw: (c: CanvasRenderingContext2D, w: number, h: number) => drawParkingRamp(c, UNIT, 0, 0, w, h) },
  { name: "security", tiles: 8, floors: 1, draw: (c: CanvasRenderingContext2D, w: number, h: number) => drawSecurity(dc(c), { ...UNIT, kind: "security" }, 0, 0, w, h) },
  { name: "medical", tiles: 16, floors: 1, draw: (c: CanvasRenderingContext2D, w: number, h: number) => drawMedical(dc(c), { ...UNIT, kind: "medical" }, 0, 0, w, h) },
  { name: "housekeeping", tiles: 8, floors: 1, draw: (c: CanvasRenderingContext2D, w: number, h: number) => drawHousekeeping(dc(c), { ...UNIT, kind: "housekeeping" }, 0, 0, w, h) },
  { name: "recycling", tiles: 20, floors: 2, draw: (c: CanvasRenderingContext2D, w: number, h: number) => drawRecycling(dc(c), UNIT, 0, 0, w, h) },
];

/** The RETIRED footprint the references used to be drawn against, kept as
 *  literals on purpose: they are history, and pinning them to the live constants
 *  would hide the very drift this file guards. Painting at this size is now a
 *  deliberately off-identity scale, which is exactly what the count guard below
 *  wants to exercise. */
const REF_TILE = 11;
const REF_FLOOR = 44;

const sprite = (name: string) => {
  const sp = SPRITES.find((s) => s.name === name);
  if (!sp) throw new Error(`no service sprite named ${name}`);
  return sp;
};

function paint(sp: (typeof SPRITES)[number], w: number, h: number) {
  const r = recorder();
  sp.draw(r.ctx, w, h);
  return r.rects;
}

describe("service sprites on the grid they are authored for", () => {
  it.each(SPRITES.map((s) => [s.name, s] as const))(
    "%s keeps every filled rect inside its own canvas at the shipped scale",
    (_name, sp) => {
      // The references are authored on the CURRENT grid, and RW/RH derive from
      // the world constants, so refMap keeps hitting identity even if the grid
      // moves; the art would then be wrong without anything resampling. The
      // grid pin below is what fails first on such a move. This guard is the
      // second line: no authored rect may fall off the canvas. It records
      // fillRect only, so text (the recycling FULL label) is outside it.
      const w = sp.tiles * TILE;
      const h = sp.floors * FLOOR;
      const outside = paint(sp, w, h).filter((r) => r.x < 0 || r.y < 0 || r.x + r.w > w || r.y + r.h > h);
      expect(outside.map((r) => `${r.x},${r.y} ${r.w}x${r.h} ${r.c}`)).toEqual([]);
    },
  );

  it("renders the security monitor wall at ONE width, not a split family", () => {
    // Ten monitors, two rows of five, each body authored 7 wide in #0E1420.
    // Edge-derived sizing landed them 8,7,7,7,7 per row, so a regular 2x5 grid
    // read broken. Selecting by the body color pins the monitors themselves
    // rather than whatever else happens to share a width.
    const rects = paint(sprite("security"), 8 * TILE, 1 * FLOOR);
    const bodies = rects.filter((r) => r.c.toLowerCase() === "#0e1420");
    expect(bodies.length).toBe(10);
    expect(new Set(bodies.map((r) => `${r.w}x${r.h}`))).toEqual(new Set(["7x9"]));
    // The headline defect of #812 was the pitch: 2px gutters in every row and
    // column, so the columns step by 9 and the rows by 11.
    const steps = (vs: number[]) => {
      const u = [...new Set(vs)].sort((a, b) => a - b);
      return { count: u.length, steps: new Set(u.slice(1).map((v, i) => v - u[i])) };
    };
    expect(steps(bodies.map((r) => r.x))).toEqual({ count: 5, steps: new Set([9]) });
    expect(steps(bodies.map((r) => r.y))).toEqual({ count: 2, steps: new Set([11]) });
  });

  // A fully general sweep was tried and abandoned: grouping rects by color and
  // rendered height cannot tell one repeated motif from two unrelated details
  // that happen to share a tone, so it flags elements that were never a family.
  // Forcing that version green would mean changing art to satisfy a bad
  // heuristic. These target the motifs that ARE repeated, by the color that
  // identifies them.
  // Colors chosen because each identifies exactly ONE motif. The hazard stripe
  // was tried and dropped: its tone is also a bin color, so filtering by it
  // returns two genuinely different authored sizes and the assertion would be
  // measuring the test's own ambiguity rather than the renderer.
  it.each([
    ["recycling baled recyclables", "recycling", "#2E323A"],
    ["recycling sign letters", "recycling", "#DCE8C0"],
  ] as const)("%s renders every copy at one size", (_label, name, color) => {
    const sp = sprite(name);
    const rects = paint(sp, sp.tiles * TILE, sp.floors * FLOOR);
    const fam = rects.filter((r) => r.c.toUpperCase() === color);
    expect(fam.length).toBeGreaterThanOrEqual(5);
    expect(new Set(fam.map((r) => `${r.w}x${r.h}`)).size).toBe(1);
  });

  // The linen and the bottles share their tones with other objects in the same
  // room (the cart's towels, the rack's towel), so these pick them by color
  // AND by the shelf or cabinet they sit in, and check count, size and pitch.
  const SHELVES = [
    // name, sprite, colors, region [x0, x1), copies, size, column pitch
    ["housekeeping linen", "housekeeping", ["#F4F0EC", "#CFE0FF", "#E8D8C0"], [4, 31], 12, "5x5", 6],
    ["medical bottles", "medical", ["#9FD0C8", "#E8C9A0", "#5DB4E8", "#F4A0A0", "#DCE8C0"], [95, 116], 10, "3x4", 4],
  ] as const;
  it.each(SHELVES)("%s renders every copy at one size on one pitch", (_label, name, colors, [x0, x1], copies, size, pitch) => {
    const sp = sprite(name);
    const rects = paint(sp, sp.tiles * TILE, sp.floors * FLOOR);
    const fam = rects.filter((r) => (colors as readonly string[]).includes(r.c.toUpperCase()) && r.x >= x0 && r.x + r.w <= x1 && r.w > 1 && r.h > 1);
    expect(fam.length).toBe(copies);
    expect(new Set(fam.map((r) => `${r.w}x${r.h}`))).toEqual(new Set([size]));
    const xs = [...new Set(fam.map((r) => r.x))].sort((a, b) => a - b);
    expect(new Set(xs.slice(1).map((x, i) => x - xs[i]))).toEqual(new Set([pitch]));
  });

  it.each(SPRITES.map((s) => [s.name, s] as const))(
    "%s draws the same rect count at the shipped scale as at the retired one",
    (_name, sp) => {
      // Nothing may be dropped or invented by the map, only resized. The shipped
      // scale is now identity, so this compares it against the old 11 by 44
      // footprint to keep an off-identity case under the guard.
      const ref = paint(sp, sp.tiles * REF_TILE, sp.floors * REF_FLOOR);
      const now = paint(sp, sp.tiles * TILE, sp.floors * FLOOR);
      expect(now.length).toBe(ref.length);
      // A drop or an invention inside the map would be matched by the same
      // change in the other scale, so also require the paint to be real: some
      // rects, none of them empty, at both scales.
      expect(now.length).toBeGreaterThan(0);
      for (const r of [...ref, ...now]) expect(Math.min(r.w, r.h), `${sp.name} ${r.x},${r.y} ${r.w}x${r.h} ${r.c}`).toBeGreaterThan(0);
    },
  );

  it.each(SPRITES.map((s) => [s.name, s] as const))(
    "%s is authored on its own grid, and every refMap call resamples it to the footprint the engine gives its kind",
    (name, sp) => {
      // The bounds guard cannot see a sprite whose own RW/RH drifted from its
      // room: a wrong pair still stays in bounds, keeps its rect count and just
      // resamples. So read the pair each painter hands refMap. The reference is
      // the grid the art was drawn on (`tiles`); the box is the engine's own
      // facility data, which the SimTower widths made wider than the art for
      // security, medical, housekeeping and recycling. The map stretches the art
      // uniformly to that box until it is redrawn.
      const kind = name as keyof typeof FACILITIES;
      expect(facilityFloors(kind)).toBe(sp.floors);
      const boxW = FACILITIES[kind].width * TILE;
      refMapCalls.length = 0;
      paint(sp, boxW, sp.floors * FLOOR);
      expect(refMapCalls.length).toBeGreaterThan(0);
      for (const c of refMapCalls) expect(c).toEqual({ RW: sp.tiles * TILE, RH: sp.floors * FLOOR, w: boxW, h: sp.floors * FLOOR });
    },
  );

  it.each([
    ["the security monitor bodies", "security", "#0E1420", 10],
    ["the recycling baled recyclables", "recycling", "#2E323A", 5],
    ["the recycling sign letters", "recycling", "#DCE8C0", 5],
  ] as const)("%s still render at one size at the retired footprint, where the map resamples", (_label, name, color, atLeast) => {
    // The shipped scale is identity, so `F` and `Fu` agree there and the
    // uniform-size tests above could not tell them apart. Off identity is where
    // `Fu` earns its keep. No shipped path hands the painters another size (the
    // gallery and preview draw at world size and zoom with `ctx.scale`), so this
    // holds the families to one size for a caller that does. Swapping `Fu` for
    // `F` in one of these motifs breaks it.
    const sp = sprite(name);
    const fam = paint(sp, sp.tiles * REF_TILE, sp.floors * REF_FLOOR).filter((r) => r.c.toUpperCase() === color.toUpperCase());
    expect(fam.length).toBeGreaterThanOrEqual(atLeast);
    expect(new Set(fam.map((r) => `${r.w}x${r.h}`)).size).toBe(1);
  });

  it.each(SHELVES)("%s still render at one size at the retired footprint", (_label, name, colors, [x0, x1], copies) => {
    // The same swap guard for the shelf families: they are checked only at
    // identity above, where `F` and `Fu` agree, so a `Fu` turned into `F` would
    // pass CI. The region follows the room onto the retired grid.
    const sp = sprite(name);
    const fam = paint(sp, sp.tiles * REF_TILE, sp.floors * REF_FLOOR).filter(
      (r) =>
        (colors as readonly string[]).includes(r.c.toUpperCase()) &&
        r.x >= Math.floor((x0 * REF_TILE) / TILE) &&
        r.x + r.w <= Math.ceil((x1 * REF_TILE) / TILE) &&
        r.w > 1 &&
        r.h > 1,
    );
    expect(fam.length).toBe(copies);
    expect(new Set(fam.map((r) => `${r.w}x${r.h}`)).size).toBe(1);
  });

  it("pins the grid the references are authored on", () => {
    // The bounds guard above only fails when the grid SHRINKS: if TILE or FLOOR
    // grows, the derived canvas grows with it and the authored rects still fit,
    // so the art would sit in the top-left of a bigger room unnoticed. Either
    // direction means the six references need re-authoring, so pin the grid.
    expect([TILE, FLOOR]).toEqual([10, 45]);
  });

  it.each([
    ["a full lot and a full plant", 1, 1],
    ["a half-full plant", 1, 0.6],
    ["a plant past amber", 1, 0.85],
  ] as const)("keeps every filled rect inside its canvas with %s", (_label, parkingUse, recycleFill) => {
    // The default state draws no parked car, no pile and an empty gauge, so
    // those branches need their own pass under the same bounds guard.
    for (const sp of SPRITES) {
      const r = recorder();
      const state = (c: CanvasRenderingContext2D) => ({ ...dc(c), parkingUse, recycleFill });
      const w = sp.tiles * TILE;
      const h = sp.floors * FLOOR;
      if (sp.name === "parking") drawParking(state(r.ctx), UNIT, 0, 0, w, h);
      else if (sp.name === "recycling") drawRecycling(state(r.ctx), UNIT, 0, 0, w, h);
      else continue;
      const outside = r.rects.filter((q) => q.x < 0 || q.y < 0 || q.x + q.w > w || q.y + q.h > h);
      expect(outside.map((q) => `${sp.name} ${q.x},${q.y} ${q.w}x${q.h} ${q.c}`)).toEqual([]);
      expect(r.rects.length).toBeGreaterThan(paint(sp, w, h).length);
    }
  });

  it("paints identically through both fills at the authored footprint", () => {
    // The proof that the uniform fill corrected the MAP rather than redrawing
    // art. At identity the two sizing rules must agree exactly, and every sprite
    // now ships at its authored footprint, so this is the case they all run in.
    const probe: Array<[number, number, number, number]> = [
      [0, 0, 80, 45], [6, 6, 7, 9], [15, 6, 7, 9], [53, 31, 24, 8],
      [71, 13, 1, 2], [0, 0, 1, 1], [79, 44, 1, 1], [3, 7, 5, 13],
    ];
    // Every footprint this file draws, parking's 40 x 45 included. This probes
    // the map at each size; that each painter really passes its own size is the
    // call-site test above.
    for (const [RW, RH] of [[40, 45], [80, 45], [160, 45], [200, 90]] as const) {
      const a = recorder();
      const b = recorder();
      const fa = refMap(a.ctx, 0, 0, RW, RH, RW, RH);
      const fb = refMap(b.ctx, 0, 0, RW, RH, RW, RH);
      for (const [rx, ry, rw, rh] of probe) {
        if (rx + rw > RW || ry + rh > RH) continue;
        fa.F(rx, ry, rw, rh, "#123456");
        fb.Fu(rx, ry, rw, rh, "#123456");
      }
      expect(b.rects).toEqual(a.rects);
    }
  });
});
