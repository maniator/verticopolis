import { describe, expect, it } from "vitest";
import { facilityFloors } from "../engine/facilities";
import type { FacilityKind, Unit } from "../engine/types";
import { OFFSETS, crop, paintAt, paintPastSeam, parseColor, rasterCtx, tail, unitOf } from "../tests/originSeedsHarness";
import { skylineWindowLit } from "./pixelSprites/skyBar";
import { FLOOR, TILE } from "./scale";

/**
 * Room details must be a function of the room alone, wherever it is painted
 * (#915). The region compositor paints a room at its offset inside a region
 * canvas, so any detail seeded from the draw origin would follow where the
 * region starts, and a room straddling two regions could show different details
 * on each side of the seam. These tests paint one room through the game's own
 * region paint at several offsets and require identical pixels.
 *
 * The software raster these tests paint into lives in
 * `tests/originSeedsHarness.ts`. This file keeps the targeted cases, which fail
 * in milliseconds on the same root cause; the sweep of every room kind is the
 * integration test `originSeedsSweep.integration.test.ts`.
 */

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
        for (const [dx, dy] of [[3 * TILE, 0], [TILE + 3, 0], [TILE + 3, FLOOR]] as const) {
          if (dy >= h) continue;
          expect(paintPastSeam(unit, dx, dy, lit), `past a seam at ${dx},${dy}`).toEqual(tail(first, w, h, dx, dy));
        }
      });
    }
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

  it("an empty sky bar still lights different windows in different rooms", () => {
    // With nobody at the bar no figure carries the variety, so the skyline
    // band is the painter bound to `skylineWindowLit`. Its lit windows are the
    // pixels in the warm and pale window colors; a bar with none, or the same
    // picture in every room, would mean the seed no longer reaches them.
    const w = 12 * TILE;
    const h = FLOOR;
    const winBot = h - Math.max(3, Math.round(h * 0.12)) - 9;
    const lights = new Set(["#f0d070", "#f0a850", "#d0d0f0"].map((c) => parseColor(c).slice(0, 3).join(",")));
    const band = (floor: number, x: number): number[] =>
      paintAt(unitOf("skyBar", { occupants: 0, width: 12, floor, x }), 0, 0, true).slice(3 * w * 4, winBot * w * 4);
    const lit = (px: number[]): number => {
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (lights.has(px.slice(i, i + 3).join(","))) n++;
      return n;
    };
    const rooms = [5, 12, 27, 43, 61].flatMap((floor) => [17, 64, 131, 208].map((x) => band(floor, x)));
    for (const px of rooms) expect(lit(px)).toBeGreaterThan(0);
    expect(new Set(rooms.map((px) => px.join(","))).size).toBeGreaterThan(1);
    expect(new Set(rooms.map(lit)).size).toBeGreaterThan(1);
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

