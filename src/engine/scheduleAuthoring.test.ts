import { describe, it, expect } from "vitest";
import {
  presetSchedule,
  recommendedPreset,
  autoTuneSchedule,
  scheduleAdvice,
  stagingSummary,
  type ShaftContext,
} from "./scheduleAuthoring";
import { SCHEDULE_HOURS } from "./elevatorSchedule";

/**
 * The pure schedule-authoring model (elevator-scheduling #305 Phase 3): the Modern
 * presets, Auto-tune, advice, and Simulate staging summary. Pure data maps, so these
 * pin the shapes without any DOM. Positioning-first (spec §14): the count axis has no
 * economy value, so the assertions care about staging and demand-match, not thrift.
 */

const CTX: ShaftContext = { cars: 6, bottom: 1, top: 30, servedLobbies: [1, 15, 30] };

/** A rush-shaped measured curve: quiet nights, morning and evening peaks. */
function rushCurve(): number[] {
  return Array.from({ length: SCHEDULE_HOURS }, (_, h) => {
    if (h === 8 || h === 17) return 1;
    if (h >= 7 && h <= 18) return 0.5;
    return 0.1;
  });
}

describe("presetSchedule", () => {
  it("Rush fills the peaks to the full fleet and split-stages the upper half up-tower", () => {
    const s = presetSchedule("rush", CTX);
    expect(s.activeCars?.weekday?.[8]).toBe(6); // morning peak = full fleet
    expect(s.activeCars?.weekday?.[17]).toBe(6); // evening peak = full fleet
    expect(s.activeCars?.weekday?.[3]).toBe(2); // overnight skeleton
    // Lower half homes at the base lobby (1), upper half up-tower (the top lobby, 30).
    expect(s.homeFloors).toEqual([1, 1, 1, 30, 30, 30]);
  });

  it("Balanced runs the full fleet through the day and homes all at the base lobby", () => {
    const s = presetSchedule("balanced", CTX);
    expect(s.activeCars?.weekday?.[12]).toBe(6);
    expect(s.activeCars?.weekday?.[2]).toBe(2);
    expect(s.homeFloors).toEqual([1, 1, 1, 1, 1, 1]);
    expect(s.activeCars?.weekend).toEqual(s.activeCars?.weekday); // same both days
  });

  it("Feeder runs a steady half-fleet homed at the highest served lobby", () => {
    const s = presetSchedule("feeder", CTX);
    expect(new Set(s.activeCars?.weekday)).toEqual(new Set([3])); // ceil(6/2) every hour
    expect(s.homeFloors).toEqual([30, 30, 30, 30, 30, 30]); // the top lobby
  });

  it("stages express presets onto its lobby stops (no arbitrary floor)", () => {
    const express: ShaftContext = { cars: 4, bottom: 1, top: 45, servedLobbies: [1, 15, 30, 45] };
    const rush = presetSchedule("rush", express);
    // Every home target is one of the served lobbies.
    for (const f of rush.homeFloors ?? []) expect(express.servedLobbies).toContain(f);
    expect(presetSchedule("feeder", express).homeFloors?.every((f) => f === 45)).toBe(true);
  });
});

describe("recommendedPreset", () => {
  it("recommends Feeder for express and Rush for a local", () => {
    expect(recommendedPreset(true)).toBe("feeder");
    expect(recommendedPreset(false)).toBe("rush");
  });
});

describe("autoTuneSchedule", () => {
  it("sets counts proportional to measured load, floored at 1, per measured day (#466)", () => {
    const s = autoTuneSchedule(undefined, { ...CTX, hourly: { weekday: rushCurve() } })!;
    expect(s.activeCars?.weekday?.[8]).toBe(6); // load 1.0 * 6
    expect(s.activeCars?.weekday?.[12]).toBe(3); // load 0.5 * 6
    expect(s.activeCars?.weekday?.[3]).toBe(1); // load 0.1 * 6 -> round 0.6 -> 1, never 0
    // The unmeasured weekend is NOT tuned from the weekday rush: with no authored
    // row it stays absent ("all cars run"), never a phantom copy of the weekday.
    expect(s.activeCars?.weekend).toBeUndefined();
  });

  it("tunes each day from its own curve and keeps an unmeasured day's authored row (#466)", () => {
    const quiet = Array(SCHEDULE_HOURS).fill(0.2);
    const both = autoTuneSchedule(undefined, { ...CTX, hourly: { weekday: rushCurve(), weekend: quiet } })!;
    expect(both.activeCars?.weekday?.[8]).toBe(6); // weekday rush
    expect(both.activeCars?.weekend?.[8]).toBe(1); // weekend quiet: 0.2 * 6 -> 1
    // Only the weekend measured: the authored weekday row survives untouched.
    const cur = { activeCars: { weekday: Array(SCHEDULE_HOURS).fill(2) } };
    const weOnly = autoTuneSchedule(cur, { ...CTX, hourly: { weekend: quiet } })!;
    expect(weOnly.activeCars?.weekday).toEqual(Array(SCHEDULE_HOURS).fill(2));
    expect(weOnly.activeCars?.weekend?.[8]).toBe(1);
  });

  it("seeds split staging when homes are unset, but never overwrites a hand-set staging", () => {
    const seeded = autoTuneSchedule(undefined, { ...CTX, hourly: { weekday: rushCurve() } })!;
    expect(seeded.homeFloors).toEqual([1, 1, 1, 30, 30, 30]); // seeded split
    const authored = autoTuneSchedule({ homeFloors: [15, 15, 15, 15, 15, 15] }, { ...CTX, hourly: { weekday: rushCurve() } })!;
    expect(authored.homeFloors).toEqual([15, 15, 15, 15, 15, 15]); // preserved
  });

  it("returns the current schedule unchanged when there is no measured history", () => {
    const cur = { waitingCarResponse: 3 };
    expect(autoTuneSchedule(cur, { ...CTX, hourly: undefined })).toBe(cur);
    expect(autoTuneSchedule(cur, { ...CTX, hourly: { weekday: Array(24).fill(0) } })).toBe(cur);
  });
});

describe("scheduleAdvice", () => {
  it("flags an over-staffed lull and a short peak, and returns null when in line", () => {
    // Author a flat 3 cars all day against a curve that wants 6 at 17:00 and 1 overnight.
    const flat = { activeCars: { weekday: Array(SCHEDULE_HOURS).fill(3) } };
    const adv = scheduleAdvice(flat, { ...CTX, hourly: { weekday: rushCurve() } }, false)!;
    expect(adv.short).toContain(17); // wants 6, runs 3
    expect(adv.over).toContain(3); // wants 1, runs 3
    // A schedule that matches the curve advises nothing.
    const tuned = autoTuneSchedule(undefined, { ...CTX, hourly: { weekday: rushCurve() } });
    expect(scheduleAdvice(tuned, { ...CTX, hourly: { weekday: rushCurve() } }, false)).toBeNull();
  });

  it("never nags 'short' on an hour already running the full fleet", () => {
    // Full fleet all day; a curve that wants more than the fleet cannot be satisfied.
    const full = { activeCars: { weekday: Array(SCHEDULE_HOURS).fill(6) } };
    const adv = scheduleAdvice(full, { ...CTX, hourly: { weekday: Array(SCHEDULE_HOURS).fill(1) } }, false);
    expect(adv?.short ?? []).not.toContain(8); // 6 of 6 already, no nag
  });

  it("returns null with no measured history", () => {
    expect(scheduleAdvice({ activeCars: { weekday: Array(24).fill(1) } }, { ...CTX, hourly: undefined }, false)).toBeNull();
  });

  it("stays silent on a day whose own ring is unmeasured, even with the other day warm (#466)", () => {
    // The original defect: a weekday-only curve produced "short at 08:00 on
    // weekends" advice. The weekend read must see no data and say nothing.
    const flat = { activeCars: { weekday: Array(SCHEDULE_HOURS).fill(1), weekend: Array(SCHEDULE_HOURS).fill(1) } };
    const ctx = { ...CTX, hourly: { weekday: rushCurve() } };
    expect(scheduleAdvice(flat, ctx, false)).not.toBeNull(); // weekday: measured, short
    expect(scheduleAdvice(flat, ctx, true)).toBeNull(); // weekend: no ring, no advice
  });
});

describe("stagingSummary", () => {
  it("reads the measured peak hour and splits cars up-tower vs lobby from the homes", () => {
    const s = { activeCars: { weekday: Array(SCHEDULE_HOURS).fill(6) }, homeFloors: [1, 1, 1, 30, 30, 30] };
    const sum = stagingSummary(s, { ...CTX, hourly: { weekday: rushCurve() } }, false);
    expect(sum.peakHour).toBe(8); // rushCurve peaks first at 08:00
    expect(sum.activeAtPeak).toBe(6);
    expect(sum.upTowerCars).toBe(3);
    expect(sum.lobbyCars).toBe(3);
  });

  it("defaults the peak to the evening down-rush with no measured curve, unassigned cars in the lobby", () => {
    const sum = stagingSummary(undefined, CTX, false);
    expect(sum.peakHour).toBe(17);
    expect(sum.upTowerCars).toBe(0); // no homes authored: all fall back to the base lobby
    expect(sum.lobbyCars).toBe(6);
  });

  it("reads each day's peak from its own ring; an unmeasured day falls back to 17:00 (#466)", () => {
    const weekend = Array(SCHEDULE_HOURS).fill(0.1);
    weekend[11] = 1; // the weekend rush sits at 11:00, not the weekday 08:00
    const ctx = { ...CTX, hourly: { weekday: rushCurve(), weekend } };
    expect(stagingSummary(undefined, ctx, false).peakHour).toBe(8);
    expect(stagingSummary(undefined, ctx, true).peakHour).toBe(11);
    // The weekday ring alone must not name a weekend peak.
    const wdOnly = { ...CTX, hourly: { weekday: rushCurve() } };
    expect(stagingSummary(undefined, wdOnly, true).peakHour).toBe(17);
  });

  it("counts any car homed above the base lobby as up-tower, whatever the lobby layout", () => {
    // A ground-lobby-only local (the most common shaft): cars hand-homed at floor 9
    // must read as staged up-tower, never "at the lobby".
    const single: ShaftContext = { cars: 4, bottom: 1, top: 10, servedLobbies: [1] };
    const s = { homeFloors: [1, 1, 9, 9] };
    const sum = stagingSummary(s, single, false);
    expect(sum.upTowerCars).toBe(2);
    expect(sum.lobbyCars).toBe(2);
  });
});

describe("single-lobby staging fallback", () => {
  it("stages the upper half at the top served floor when the only lobby is the base", () => {
    // Without the fallback, "stage upper half up-tower" on a ground-lobby local
    // collapses onto floor 1 and the quick action is a silent no-op.
    const single: ShaftContext = { cars: 4, bottom: 1, top: 10, servedLobbies: [1] };
    const rush = presetSchedule("rush", single);
    expect(rush.homeFloors).toEqual([1, 1, 10, 10]);
    const feeder = presetSchedule("feeder", single);
    expect(feeder.homeFloors).toEqual([10, 10, 10, 10]);
  });
});
