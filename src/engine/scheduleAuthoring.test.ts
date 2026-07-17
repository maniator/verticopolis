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
  it("sets counts proportional to measured load, floored at 1, both day rows", () => {
    const s = autoTuneSchedule(undefined, { ...CTX, hourly: rushCurve() })!;
    expect(s.activeCars?.weekday?.[8]).toBe(6); // load 1.0 * 6
    expect(s.activeCars?.weekday?.[12]).toBe(3); // load 0.5 * 6
    expect(s.activeCars?.weekday?.[3]).toBe(1); // load 0.1 * 6 -> round 0.6 -> 1, never 0
    expect(s.activeCars?.weekend).toEqual(s.activeCars?.weekday);
  });

  it("seeds split staging when homes are unset, but never overwrites a hand-set staging", () => {
    const seeded = autoTuneSchedule(undefined, { ...CTX, hourly: rushCurve() })!;
    expect(seeded.homeFloors).toEqual([1, 1, 1, 30, 30, 30]); // seeded split
    const authored = autoTuneSchedule({ homeFloors: [15, 15, 15, 15, 15, 15] }, { ...CTX, hourly: rushCurve() })!;
    expect(authored.homeFloors).toEqual([15, 15, 15, 15, 15, 15]); // preserved
  });

  it("returns the current schedule unchanged when there is no measured history", () => {
    const cur = { waitingCarResponse: 3 };
    expect(autoTuneSchedule(cur, { ...CTX, hourly: undefined })).toBe(cur);
    expect(autoTuneSchedule(cur, { ...CTX, hourly: Array(24).fill(0) })).toBe(cur);
  });
});

describe("scheduleAdvice", () => {
  it("flags an over-staffed lull and a short peak, and returns null when in line", () => {
    // Author a flat 3 cars all day against a curve that wants 6 at 17:00 and 1 overnight.
    const flat = { activeCars: { weekday: Array(SCHEDULE_HOURS).fill(3) } };
    const adv = scheduleAdvice(flat, { ...CTX, hourly: rushCurve() }, false)!;
    expect(adv.short).toContain(17); // wants 6, runs 3
    expect(adv.over).toContain(3); // wants 1, runs 3
    // A schedule that matches the curve advises nothing.
    const tuned = autoTuneSchedule(undefined, { ...CTX, hourly: rushCurve() });
    expect(scheduleAdvice(tuned, { ...CTX, hourly: rushCurve() }, false)).toBeNull();
  });

  it("never nags 'short' on an hour already running the full fleet", () => {
    // Full fleet all day; a curve that wants more than the fleet cannot be satisfied.
    const full = { activeCars: { weekday: Array(SCHEDULE_HOURS).fill(6) } };
    const adv = scheduleAdvice(full, { ...CTX, hourly: Array(SCHEDULE_HOURS).fill(1) }, false);
    expect(adv?.short ?? []).not.toContain(8); // 6 of 6 already, no nag
  });

  it("returns null with no measured history", () => {
    expect(scheduleAdvice({ activeCars: { weekday: Array(24).fill(1) } }, { ...CTX, hourly: undefined }, false)).toBeNull();
  });
});

describe("stagingSummary", () => {
  it("reads the measured peak hour and splits cars up-tower vs lobby from the homes", () => {
    const s = { activeCars: { weekday: Array(SCHEDULE_HOURS).fill(6) }, homeFloors: [1, 1, 1, 30, 30, 30] };
    const sum = stagingSummary(s, { ...CTX, hourly: rushCurve() }, false);
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
});
