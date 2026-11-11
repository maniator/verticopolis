import { describe, expect, it } from "vitest";
import type { ElevatorSchedule } from "../../shared/engineTypes";
import { SCHEDULE_HOURS, scheduleSlots } from "../../simport/scheduleSlots";
import { MIXED, WARM, COLD, measure, openEngine, ring, tower, type Slots } from "../fixtures/scheduleTower";
import { hasWasmPackage } from "../conformance/wasmEngine";

/**
 * Auto-tune lives in the engine (#1550): the Rust query through the real WASM
 * binding. The proposal itself (the tuned rows, the seeded and kept homes, the
 * cold-day gate) is pinned in Rust by `schedule_authoring_tests`; here the
 * binding is shown to offer it in Modern and never in Classic, to name its
 * refusals, and to write nothing when asked. The TypeScript reference this
 * suite once compared it with went with the TypeScript engine (#1875).
 */

const DRAFTS: ReadonlyArray<readonly [string, ((cars: number) => ElevatorSchedule) | undefined]> = [
  ["no draft", undefined],
  ["rows only, homes untouched", (cars) => ({ activeCars: { weekday: Array(SCHEDULE_HOURS).fill(cars), weekend: Array(SCHEDULE_HOURS).fill(2) } })],
  ["hand-set homes", (cars) => ({ activeCars: { weekday: Array(SCHEDULE_HOURS).fill(1), weekend: Array(SCHEDULE_HOURS).fill(1) }, homeFloors: [3, 6, 11, 20].slice(0, cars) })],
  ["a weekday row only", () => ({ activeCars: { weekday: Array(SCHEDULE_HOURS).fill(3) } })],
];

const MEASURES: ReadonlyArray<readonly [string, Slots]> = [
  ["both days warm", [WARM, MIXED]],
  ["weekday only", [WARM, ring([])]],
  ["weekend only", [ring([]), MIXED]],
  ["five hours is cold", [COLD, COLD]],
  ["no samples", [ring([]), ring([])]],
];

const ORIGINS = [
  ["the busiest floor is up-tower", { 1: 3, 12: 9, 15: 4 }, { 1: 2, 18: 7 }],
  ["the busiest floor is skipped", { 1: 3, 6: 20 }, { 6: 20, 1: 1 }],
  ["the lobby dominates", { 1: 30, 12: 2 }, { 1: 30, 15: 2 }],
] as const;

/** The fewest proposals Modern offers over the grid below; the warm shafts
 *  alone give well over this. */
const MODERN_MIN_AVAILABLE = 40;
/** The fewest questions the grid asks, so the counts above are not empty. */
const MIN_ASKED = 100;
/** The status a successful schedule command answers with. */
const DONE = 1;

describe.skipIf(!hasWasmPackage())("the Rust Auto-tune proposal through the binding", () => {
  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: every shaft, measurement, draft and day tab`, () => {
      const f = tower(mode);
      const kinds = [f.standard, f.service, f.express] as const;
      let available = 0;
      let asked = 0;
      for (const [, wdO, weO] of ORIGINS) {
        for (const [, slots] of MEASURES) {
          kinds.forEach((id, i) => measure(f, id, i === 1 ? [slots[1], slots[0]] : slots, wdO, weO));
          const rust = openEngine(f);
          try {
            for (const id of kinds) {
              const cars = Number(f.draft.tower.getTransport(id)!.cars);
              for (const [, make] of DRAFTS) {
                for (const weekend of [false, true]) {
                  const slots = make ? scheduleSlots(make(cars)) : new Float64Array(0);
                  const got = rust.autoTuneProposal(id, slots, weekend);
                  asked++;
                  if (got.status === "available") available++;
                  else expect(got.status, `${mode} shaft ${id}`).toBe(mode === "classic" ? "unavailable-in-mode" : "insufficient-data");
                }
              }
            }
          } finally {
            rust.free();
          }
        }
      }
      expect(asked).toBeGreaterThan(MIN_ASKED);
      // Classic must never offer a proposal; Modern must offer plenty.
      if (mode === "classic") expect(available).toBe(0);
      else expect(available).toBeGreaterThan(MODERN_MIN_AVAILABLE);
    });

    it(`${mode}: stairs, missing ids and unreadable drafts`, () => {
      const f = tower(mode);
      const rust = openEngine(f);
      try {
        const none = new Float64Array(0);
        expect(rust.autoTuneProposal(f.stairs, none, false).status).toBe("not-an-elevator");
        expect(rust.autoTuneProposal(9999, none, false).status).toBe("missing-shaft");
        expect(rust.autoTuneProposal(f.standard, new Float64Array(3), false).status).toBe("invalid-draft");
      } finally {
        rust.free();
      }
    });
  }

  it("asking never writes: the save, the schedule and the undo signature stay put", () => {
    const f = tower("modern");
    measure(f, f.standard, [WARM, MIXED], { 1: 3, 12: 9 }, { 1: 2 });
    const rust = openEngine(f);
    try {
      const before = rust.serialize();
      const signature = rust.undoSignature();
      const hourlyBefore = rust.elevatorTelemetry();
      const first = rust.autoTuneProposal(f.standard, new Float64Array(0), false);
      const second = rust.autoTuneProposal(f.standard, new Float64Array(0), false);
      expect(first.status).toBe("available");
      expect(second).toEqual(first);
      expect(rust.serialize()).toBe(before);
      expect(rust.undoSignature()).toEqual(signature);
      expect(rust.elevatorTelemetry()).toBe(hourlyBefore);
      expect(rust.shaftSchedule(f.standard)).toHaveLength(0);
      // Accepting it is the ordinary schedule command, and it reads back.
      const proposal = first.proposal!;
      const slots = scheduleSlots({
        activeCars: { weekday: [...proposal.weekday!], weekend: [...proposal.weekend!] },
        homeFloors: [...proposal.homeFloors],
      });
      expect(rust.scheduleShaft(f.standard, slots)[0]).toBe(DONE);
      expect(rust.shaftSchedule(f.standard)).toHaveLength(slots.length);
    } finally {
      rust.free();
    }
  });
});
