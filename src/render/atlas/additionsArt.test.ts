import { describe, expect, it } from "vitest";
import { FACILITIES, facilityFloors } from "../../engine/facilities";
import type { FacilityKind } from "../../engine/types";
import { recyclingLook } from "../sprites/facilities/recyclingLook";
import { FLOOR, TILE } from "../scale";
import { RECYCLE_BREAKS, RECYCLE_STEPS, roomJobs, type StillJob } from "./catalog";
import { CINEMA_CYCLES, clockFor, cycleStep, cycleSteps } from "./cycles";
import { paint, type UnitPaint } from "./paint";
import { recyclingFillStep } from "./recyclingFill";

/**
 * The art behind the atlas's added data: the recycling center paints the same
 * calls for every fill between two breaks, and the cinema the same calls for
 * every clock that shows the same marquee and screen steps. Checked on the
 * paint the bake runs (`paint.ts`), through a context that records every call.
 */

/** A 2D context that records every call and property set, in order: equal
 *  logs paint equal pixels. */
function recordingCtx(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in target) return target[prop];
      if (prop === "canvas") return { width: 4096, height: 4096 };
      return (...args: unknown[]) => {
        log.push(`${prop}(${JSON.stringify(args)})`);
        if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createPattern") {
          return { addColorStop: (...stop: unknown[]) => log.push(`stop(${JSON.stringify(stop)})`) };
        }
        if (prop === "measureText") return { width: 4 * String(args[0]).length };
        if (prop === "getLineDash") return [];
        return undefined;
      };
    },
    set(target, prop, value) {
      if (typeof prop === "string") {
        target[prop] = value;
        log.push(`${prop}=${typeof value === "object" ? "[object]" : String(value)}`);
      }
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

function room(kind: FacilityKind, extra: Partial<UnitPaint>): UnitPaint {
  return { p: "unit", kind, state: "occupied", floor: 5, x: 17, id: 3, width: FACILITIES[kind].width, occupants: 0, outForMeal: 0, lit: false, hour: 14, anim: 0, ...extra };
}

function calls(s: UnitPaint): string[] {
  const { ctx, log } = recordingCtx();
  paint(ctx, s, s.width * TILE, facilityFloors(s.kind) * FLOOR);
  return log;
}

/** The double just below a positive `x`. */
function below(x: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  view.setBigUint64(0, view.getBigUint64(0) - 1n);
  return view.getFloat64(0);
}

describe("the recycling center's fill breaks", () => {
  const same = (a: number, b: number) => JSON.stringify(recyclingLook(a)) === JSON.stringify(recyclingLook(b));

  it("are ascending, each the first fill of a new look", () => {
    // 17 bags and 63 gauge rows (the 9th bag and the 32nd row both arrive
    // at exactly 0.5), the second row past 0.5, amber past 0.7, FULL at 1.
    expect(RECYCLE_BREAKS).toHaveLength(17 + 63 - 1 + 3);
    for (let i = 0; i < RECYCLE_BREAKS.length; i++) {
      const b = RECYCLE_BREAKS[i];
      if (i > 0) expect(b).toBeGreaterThan(RECYCLE_BREAKS[i - 1]);
      expect(same(b, below(b)), `break ${b}`).toBe(false);
    }
    expect(RECYCLE_BREAKS).toContain(0.5);
    expect(RECYCLE_BREAKS).toContain(0.7000000000000001);
    expect(RECYCLE_BREAKS[RECYCLE_BREAKS.length - 1]).toBe(1);
  });

  it("hold the look still between two breaks", () => {
    const starts = [0, ...RECYCLE_BREAKS];
    for (let f = 0; f <= 1; f += 1 / 4096) {
      const n = recyclingFillStep(RECYCLE_BREAKS, f);
      expect(same(f, starts[n]), `fill ${f}`).toBe(true);
    }
    for (const b of RECYCLE_BREAKS) {
      expect(recyclingFillStep(RECYCLE_BREAKS, below(b))).toBe(recyclingFillStep(RECYCLE_BREAKS, b) - 1);
    }
  });

  it("read the fill the way the art does: clamped, a non-finite fill as 0", () => {
    expect(recyclingFillStep(RECYCLE_BREAKS, -2)).toBe(0);
    expect(recyclingFillStep(RECYCLE_BREAKS, Number.NaN)).toBe(0);
    expect(recyclingFillStep(RECYCLE_BREAKS, Infinity)).toBe(0);
    expect(recyclingFillStep(RECYCLE_BREAKS, 7)).toBe(RECYCLE_BREAKS.length);
    expect(JSON.stringify(recyclingLook(Infinity))).toBe(JSON.stringify(recyclingLook(0)));
  });

  it("paint the same calls as the chain step a fill lands on, at every eighth and in between", () => {
    const starts = [0, ...RECYCLE_BREAKS];
    const fills = [0.01, 0.2, 0.37, 0.5, 0.55, 0.7, 0.70001, 0.99, 1, ...Array.from({ length: RECYCLE_STEPS + 1 }, (_, k) => k / RECYCLE_STEPS)];
    for (const fill of fills) {
      const n = recyclingFillStep(RECYCLE_BREAKS, fill);
      expect(calls(room("recycling", { recycleFill: fill })), `fill ${fill}`).toEqual(calls(room("recycling", { recycleFill: starts[n] })));
    }
    // And a different step paints differently.
    expect(calls(room("recycling", { recycleFill: 0.37 }))).not.toEqual(calls(room("recycling", { recycleFill: 0.38 })));
  });

  it("bake as an alternative to the eighths on every recycling frame", () => {
    const jobs = roomJobs().filter((j): j is StillJob => j.type === "still" && j.name.startsWith("room/recycling/"));
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.chains?.fill.steps).toHaveLength(RECYCLE_STEPS + 1);
      expect(j.chains?.fillExact).toMatchObject({ input: "recyclingFillExact", alternativeTo: "fill" });
      expect(j.chains?.fillExact.steps.map((s) => (s as UnitPaint).recycleFill ?? 0)).toEqual([0, ...RECYCLE_BREAKS]);
    }
  });
});

describe("the cinema's marquee and screen cycles", () => {
  it("step with the clock and repeat every 2 seconds", () => {
    expect(cycleSteps(CINEMA_CYCLES, 0)).toEqual({ marquee: 0, screen: 0 });
    expect(cycleSteps(CINEMA_CYCLES, 1.3)).toEqual({ marquee: 1, screen: 3 });
    expect(cycleSteps(CINEMA_CYCLES, 3.3)).toEqual(cycleSteps(CINEMA_CYCLES, 1.3));
    expect(cycleStep(CINEMA_CYCLES.screen, -4)).toBe(0);
    expect(cycleStep(CINEMA_CYCLES.marquee, Number.NaN)).toBe(0);
  });

  it("find a clock for every pairing of steps, and none for a step that does not exist", () => {
    for (let m = 0; m < 2; m++) {
      for (let s = 0; s < 5; s++) {
        const t = clockFor(CINEMA_CYCLES, { marquee: m, screen: s });
        expect(t).not.toBeNull();
        expect(cycleSteps(CINEMA_CYCLES, t!)).toEqual({ marquee: m, screen: s });
      }
    }
    expect(clockFor(CINEMA_CYCLES, { screen: 5 })).toBeNull();
  });

  it("are all the art reads from the clock: two clocks with the same steps paint the same calls", () => {
    for (const x of [17, 64, 131]) {
      for (let i = 0; i < 80; i++) {
        const t = i * 0.137;
        const same = clockFor(CINEMA_CYCLES, cycleSteps(CINEMA_CYCLES, t))!;
        const at = (anim: number) => calls(room("cinema", { x, anim, occupants: 9 }));
        expect(at(t), `x ${x} clock ${t}`).toEqual(at(same));
      }
    }
    // A different step paints differently.
    expect(calls(room("cinema", { anim: 0 }))).not.toEqual(calls(room("cinema", { anim: 0.3 })));
  });

  it("bake on every cinema still frame, each picture at a clock that shows only its own step", () => {
    const jobs = roomJobs().filter((j): j is StillJob => j.type === "still" && j.name.startsWith("room/cinema/"));
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(Object.keys(j.cycles ?? {})).toEqual(["marquee", "screen"]);
      for (const [key, cycle] of Object.entries(j.cycles!)) {
        expect(cycle.rate).toBe(CINEMA_CYCLES[key].rate);
        cycle.steps.forEach((s, k) => {
          const want = { marquee: 0, screen: 0, [key]: k };
          expect(cycleSteps(CINEMA_CYCLES, (s as UnitPaint).anim)).toEqual(want);
        });
      }
      expect(j.cycleChecks).toHaveLength(j.chains ? 20 : 10);
    }
    expect(roomJobs().some((j) => j.type === "still" && !j.name.startsWith("room/cinema/") && j.cycles)).toBe(false);
  });
});
