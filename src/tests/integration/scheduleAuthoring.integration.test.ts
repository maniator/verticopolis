import { describe, expect, it } from "vitest";
import type { ScheduleFacts, SchedulePresetName } from "../../simport/enginePort";
import { SCHEDULE_HOURS, scheduleSlots } from "../../simport/scheduleSlots";
import { MIXED, WARM, measure, openEngine, tower } from "../fixtures/scheduleTower";
import { hasWasmPackage } from "../conformance/wasmEngine";

/**
 * The schedule dialog's advice, staging summary and presets live in the engine
 * (#1552): the Rust queries through the real WASM binding. The answers
 * themselves (the over and short hours, the staging counts, each preset's
 * rows and homes) are pinned in Rust by `schedule_facts_tests` and
 * `schedule_presets_tests`; here the binding is shown to name its refusals,
 * to follow a live stop edit, and to write nothing when asked. The TypeScript
 * reference this suite once compared them with went with the TypeScript
 * engine (#1875).
 */

const PRESETS: readonly SchedulePresetName[] = ["rush", "balanced", "feeder", "stage-up-tower"];
/** The status a successful schedule command answers with. */
const DONE = 1;
/** The fixture's sky lobby and top floor. */
const SKY_LOBBY = 15;
const TOP = 20;

describe.skipIf(!hasWasmPackage())("the Rust schedule facts and presets through the binding", () => {
  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: stairs, missing ids, unknown names and unreadable drafts`, () => {
      const f = tower(mode);
      const rust = openEngine(f);
      try {
        const bad = scheduleSlots({ activeCars: { weekday: Array(SCHEDULE_HOURS).fill(1) } });
        bad[0] = 7;
        const none = new Float64Array(0);
        expect(rust.scheduleFacts(f.stairs, none, false).status).toBe("not-an-elevator");
        expect(rust.scheduleFacts(f.standard, new Float64Array(3), false).status).toBe("invalid-draft");
        expect(rust.scheduleFacts(f.standard, bad, false).status).toBe("invalid-draft");
        expect(rust.schedulePreset(f.standard, "turbo" as SchedulePresetName).status).toBe("unknown-preset");
        expect(rust.schedulePreset(f.standard, "Rush" as SchedulePresetName).status).toBe("unknown-preset");
        expect(rust.schedulePreset(f.stairs, "rush").status).toBe("not-an-elevator");
        // Classic stages but never advises; Modern advises once a day is warm.
        const facts = rust.scheduleFacts(f.standard, none, false);
        expect(facts.status).toBe("available");
        if (mode === "classic") expect(facts.advice.status).toBe("unavailable-in-mode");
      } finally {
        rust.free();
      }
    });
  }

  it("a shaft with no cars answers its own status", () => {
    for (const mode of ["classic", "modern"] as const) {
      const f = tower(mode);
      measure(f, f.standard, [WARM, MIXED], { 1: 3 }, { 1: 2 });
      f.draft.tower.getTransport(f.standard)!.cars = 0;
      const rust = openEngine(f);
      try {
        const none = new Float64Array(0);
        expect(rust.scheduleFacts(f.standard, none, false).advice.status).toBe(mode === "modern" ? "no-cars" : "unavailable-in-mode");
        expect(rust.schedulePreset(f.standard, "stage-up-tower").status).toBe("no-cars");
        expect(rust.scheduleFacts(9999, none, false).advice.status).toBe("refused");
      } finally {
        rust.free();
      }
    }
  });

  it("a stop edit on the sky lobby moves the up-tower target", () => {
    const f = tower("modern");
    measure(f, f.standard, [WARM, MIXED], { 1: 3, 12: 9 }, { 1: 2 });
    for (const served of [true, false]) {
      const rust = openEngine(f);
      try {
        rust.markStop(f.standard, SKY_LOBBY, served);
        for (const name of PRESETS) expect(rust.schedulePreset(f.standard, name).status, name).toBe("available");
        const got = rust.scheduleFacts(f.standard, new Float64Array(0), false) as ScheduleFacts;
        // The base is the ground lobby; the top lobby is the sky lobby only while it is a stop.
        expect(got.staging!.topLobby).toBe(served ? SKY_LOBBY : TOP);
      } finally {
        rust.free();
      }
    }
  });

  it("asking never writes: the save and the schedule stay put, and a preset applies as one ordinary command", () => {
    const f = tower("modern");
    measure(f, f.standard, [WARM, MIXED], { 1: 3, 12: 9 }, { 1: 2 });
    const rust = openEngine(f);
    try {
      const before = rust.serialize();
      const signature = rust.undoSignature();
      const first = rust.schedulePreset(f.standard, "rush");
      expect(first.status).toBe("available");
      expect(rust.schedulePreset(f.standard, "rush")).toEqual(first);
      rust.scheduleFacts(f.standard, new Float64Array(0), false);
      expect(rust.serialize()).toBe(before);
      expect(rust.undoSignature()).toEqual(signature);
      expect(rust.shaftSchedule(f.standard)).toHaveLength(0);
      // Accepting it is the ordinary schedule command, and the facts then read
      // the saved schedule back through the same draft slots.
      const slots = scheduleSlots({
        activeCars: { weekday: [...first.weekday!], weekend: [...first.weekend!] },
        homeFloors: [...first.homeFloors],
      });
      expect(rust.scheduleShaft(f.standard, slots)[0]).toBe(DONE);
      expect(rust.shaftSchedule(f.standard)).toHaveLength(slots.length);
      const applied = rust.scheduleFacts(f.standard, slots, false);
      expect(applied.status).toBe("available");
      expect(applied.staging!.activeAtPeak).toBe(first.weekday![applied.staging!.peakHour]);
    } finally {
      rust.free();
    }
  });
});
