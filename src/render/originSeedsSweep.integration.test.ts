import { describe, expect, it } from "vitest";
import { kindFacts } from "../tests/catalogKinds";
import type { Unit } from "../shared/types";
import { OFFSETS, paintAt, paintPastSeam, tail, unitOf } from "../tests/originSeedsHarness";
import { roomKinds, variantPlacements } from "./atlas/catalog";
import { FLOOR, TILE } from "./scale";
import type { DrawCtx } from "./sprites";

/**
 * The broad canary behind `originSeeds.test.ts` (#915): every room kind,
 * subtype and look, painted through the game's region paint at several offsets,
 * must come out the same. Each case runs the software raster five times, and
 * the metro alone takes seconds, so the sweep lives in the integration tier.
 * The unit file keeps the targeted cases that fail in milliseconds on the same
 * root cause.
 */

/** The looks the sweep paints each kind and subtype in: the settled states,
 *  lit and unlit, a day, evening and late-night hour (so rooms closed by their
 *  business hours draw their shutter), an open room with nobody in it, one
 *  person, or full, a basement placement, and a dead parking space (the mark
 *  only applies to parking). The on-notice ribbon (`vacating`) fills a triangle the raster does not
 *  model; it is drawn from the room's own corner. */
type Look = { state: Unit["state"]; lit: boolean; hour: number; occ?: number; basement?: boolean; dead?: boolean; satisfaction?: number; scene?: Partial<DrawCtx> };

/** Besides those, the scene inputs a `DrawCtx` carries (every parking space in
 *  use, the recycling centers most of the way full, a tower with nobody in
 *  it, a moment into the animation) and a fed-up room, whose figures take
 *  the stress tint. */
const SWEEP: ReadonlyArray<Look> = [
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
  { state: "occupied", lit: false, hour: 12, scene: { parkingUse: 1 } },
  { state: "occupied", lit: true, hour: 20, scene: { recycleFill: 0.7 } },
  { state: "occupied", lit: false, hour: 12, scene: { staffed: false } },
  { state: "occupied", lit: true, hour: 20, scene: { anim: 1.37 } },
  { state: "occupied", lit: false, hour: 12, satisfaction: 0.1 },
];

/** Where a room's part past a region seam starts: one tile and a few pixels
 *  across, and that a floor down. */
const SEAMS: ReadonlyArray<readonly [number, number]> = [
  [TILE + 3, 0],
  [TILE + 3, FLOOR],
];

describe("room details follow the room wherever it is painted (#915), every kind", () => {
  // A detail seeded from the draw origin in a kind the unit file does not
  // list is caught here.
  for (const kind of roomKinds()) {
    it(`every ${kind} subtype and look paints the same pixels at every region offset`, () => {
      const moved: string[] = [];
      for (const subtype of [undefined, ...(kindFacts(kind).subtypes ?? [])]) {
        for (const look of SWEEP) {
          const occupants = look.occ ?? (kindFacts(kind).population);
          // A deep basement floor (floor 0 is B1, so -3 is B4) at a small
          // column, where the raw geography seed is negative (#1029).
          const where = look.basement ? { floor: -3, x: 2 } : {};
          const mood = look.satisfaction === undefined ? {} : { satisfaction: look.satisfaction };
          const unit = unitOf(kind, { subtype, state: look.state, occupants, ...where, ...mood });
          const dead = kind === "parking" && look.dead === true;
          const [first, ...rest] = OFFSETS.map(([ox, oy]) => paintAt(unit, ox, oy, look.lit, look.hour, dead, look.scene));
          expect(first.some((v) => v !== 0), `${kind}/${subtype ?? "-"} painted`).toBe(true);
          const key = first.join(",");
          if (rest.some((r) => r.join(",") !== key)) moved.push(`${subtype ?? "-"} ${JSON.stringify(look)}`);
        }
      }
      expect(moved).toEqual([]);
    }, 60_000); // the metro fills the lot, so its sweep alone takes seconds

    it(`every ${kind} subtype at each sampled placement paints the same pixels at every offset and past a seam`, () => {
      // The placements the atlas bakes each room variant from
      // (`variantPlacements`), each painted whole at every offset and in the
      // part past a region seam, painted from a negative origin.
      const moved: string[] = [];
      const h = kindFacts(kind).floors * FLOOR;
      for (const subtype of [undefined, ...(kindFacts(kind).subtypes ?? [])]) {
        for (const { floor, x, id } of variantPlacements(kind)) {
          const unit = unitOf(kind, { subtype, floor, x, id });
          const w = unit.width * TILE;
          const [first, ...rest] = OFFSETS.map(([ox, oy]) => paintAt(unit, ox, oy, true));
          const at = `${subtype ?? "-"} at ${floor},${x}`;
          if (rest.some((r) => r.join(",") !== first.join(","))) moved.push(`${at} across offsets`);
          for (const [dx, dy] of SEAMS) {
            if (dy >= h || dx >= w) continue;
            if (paintPastSeam(unit, dx, dy, true).join(",") !== tail(first, w, h, dx, dy).join(",")) moved.push(`${at} past a seam at ${dx},${dy}`);
          }
        }
      }
      expect(moved).toEqual([]);
    }, 60_000);
  }
});
