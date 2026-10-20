import { describe, expect, it } from "vitest";
import { FACILITIES } from "../engine/facilities";
import { subtypeListFor } from "../engine/retailSubtypes";
import type { Unit } from "../engine/types";
import { OFFSETS, paintAt, unitOf } from "../tests/originSeedsHarness";
import { roomKinds } from "./atlas/catalog";

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

describe("room details follow the room wherever it is painted (#915), every kind", () => {
  // A detail seeded from the draw origin in a kind the unit file does not
  // list is caught here.
  for (const kind of roomKinds()) {
    it(`every ${kind} subtype and look paints the same pixels at every region offset`, () => {
      const moved: string[] = [];
      for (const subtype of [undefined, ...(subtypeListFor(kind) ?? [])]) {
        for (const look of SWEEP) {
          const occupants = look.occ ?? (FACILITIES[kind].population ?? 0);
          // The second basement floor (floor 0 is B1, so -1 is B2), at a column
          // that keeps every raw geography seed positive (a negative one is
          // #1029).
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
});
