import { describe, it, expect } from "vitest";
import type { Unit } from "../../../engine/types";
import type { DrawCtx } from "../common";
import { TILE, FLOOR } from "../../scale";
import { refMap } from "./serviceKit";
import { drawParking, drawParkingRamp } from "./garage";
import { drawSecurity, drawMedical, drawHousekeeping, drawRecycling } from "./service";

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
 * and the gaps between them are all 2. Pitch still is not asserted here, because
 * an assertion on it would pin one art choice rather than the renderer, and the
 * pitch is only even because a whole number of them fits the authored wall.
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
  { name: "security", tiles: 8, floors: 1, draw: (c: CanvasRenderingContext2D, w: number, h: number) => drawSecurity(dc(c), 0, 0, w, h) },
  { name: "medical", tiles: 16, floors: 1, draw: (c: CanvasRenderingContext2D, w: number, h: number) => drawMedical(dc(c), 0, 0, w, h) },
  { name: "housekeeping", tiles: 8, floors: 1, draw: (c: CanvasRenderingContext2D, w: number, h: number) => drawHousekeeping(dc(c), 0, 0, w, h) },
  { name: "recycling", tiles: 20, floors: 2, draw: (c: CanvasRenderingContext2D, w: number, h: number) => drawRecycling(dc(c), UNIT, 0, 0, w, h) },
];

/** The RETIRED footprint the references used to be drawn against, kept as
 *  literals on purpose: they are history, and pinning them to the live constants
 *  would hide the very drift this file guards. Painting at this size is now a
 *  deliberately off-identity scale, which is exactly what the count guard below
 *  wants to exercise. */
const REF_TILE = 11;
const REF_FLOOR = 44;

function paint(sp: (typeof SPRITES)[number], w: number, h: number) {
  const r = recorder();
  sp.draw(r.ctx, w, h);
  return r.rects;
}

describe("service sprites survive a non-identity reference map", () => {
  it("renders the security monitor wall at ONE width, not a split family", () => {
    // Ten monitors, two rows of five, each body authored 7 wide in #0E1420.
    // Edge-derived sizing landed them 8,7,7,7,7 per row, so a regular 2x5 grid
    // read broken. Selecting by the body color pins the monitors themselves
    // rather than whatever else happens to share a width.
    const rects = paint(SPRITES[2], 8 * TILE, 1 * FLOOR);
    const bodies = rects.filter((r) => r.c.toLowerCase() === "#0e1420");
    expect(bodies.length).toBe(10);
    expect(new Set(bodies.map((r) => r.w)).size).toBe(1);
    expect(new Set(bodies.map((r) => r.h)).size).toBe(1);
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
    ["recycling baled recyclables", 5, "#2E323A"],
    ["recycling sign letters", 5, "#DCE8C0"],
  ] as const)("%s renders every copy at one size", (_name, idx, color) => {
    const rects = paint(SPRITES[idx], SPRITES[idx].tiles * TILE, SPRITES[idx].floors * FLOOR);
    const fam = rects.filter((r) => r.c.toUpperCase() === color);
    expect(fam.length).toBeGreaterThanOrEqual(5);
    expect(new Set(fam.map((r) => `${r.w}x${r.h}`)).size).toBe(1);
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
    },
  );

  it("paints identically through both fills at the authored footprint", () => {
    // The proof that the uniform fill corrected the MAP rather than redrawing
    // art. At identity the two sizing rules must agree exactly, and every sprite
    // now ships at its authored footprint, so this is the case they all run in.
    const probe: Array<[number, number, number, number]> = [
      [0, 0, 80, 45], [6, 6, 7, 9], [15, 6, 7, 9], [53, 31, 24, 8],
      [71, 13, 1, 2], [0, 0, 1, 1], [79, 44, 1, 1], [3, 7, 5, 13],
    ];
    for (const [RW, RH] of [[80, 45], [160, 45], [200, 90]] as const) {
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
