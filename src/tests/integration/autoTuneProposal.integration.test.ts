import { describe, expect, it } from "vitest";
import { SCHEDULE_HOURS, type ElevatorSchedule } from "../../engine/elevatorSchedule";
import { autoTuneProposal } from "../../engine/port/queries";
import type { AutoTuneProposal, EnginePort } from "../../simport/enginePort";
import { scheduleSlots } from "../../simport/scheduleSlots";
import { telemetryDocument } from "../../wasmhost/telemetry";
import { MIXED, WARM, COLD, measure, ring, tower, type Slots } from "../fixtures/scheduleTower";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * Auto-tune lives in the engine (#1550): the Rust query, through the real
 * WASM binding, against the TypeScript reference it replaces, over the same
 * saved tower and the same measured telemetry. Telemetry never rides a save,
 * so the Rust engine is handed the reference's document the way the gallery's
 * engine leg is.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but the engine's WASM package was not built");

type RustPort = EnginePort & {
  free(): void;
  seedElevatorTelemetry(json: string): void;
  elevatorTelemetry(): string;
  scheduleShaft(id: number, slots: Float64Array): Float64Array;
  serialize(): string;
};

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

const asJson = (p: AutoTuneProposal) => JSON.parse(JSON.stringify(p)) as AutoTuneProposal;

describe.skipIf(!hasWasmPackage())("the Rust Auto-tune proposal matches the TypeScript reference", () => {
  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: every shaft, measurement, draft and day tab`, () => {
      const f = tower(mode);
      const kinds = [f.standard, f.service, f.express] as const;
      let available = 0;
      let compared = 0;
      for (const [oname, wdO, weO] of ORIGINS) {
        for (const [mname, slots] of MEASURES) {
          kinds.forEach((id, i) => measure(f.sim, id, i === 1 ? [slots[1], slots[0]] : slots, wdO, weO));
          const rust = wasm().Engine.fromSave(JSON.stringify(f.sim.serialize())) as unknown as RustPort;
          try {
            rust.seedElevatorTelemetry(JSON.stringify(telemetryDocument(f.sim)));
            for (const id of kinds) {
              const cars = f.sim.tower.getTransport(id)!.cars;
              for (const [dname, make] of DRAFTS) {
                for (const weekend of [false, true]) {
                  const slots = make ? scheduleSlots(make(cars)) : new Float64Array(0);
                  const want = autoTuneProposal(f.sim, id, slots, weekend);
                  const got = asJson(rust.autoTuneProposal(id, slots, weekend));
                  expect(got, `${mode} ${oname} / ${mname} / ${dname} / weekend=${weekend} / shaft ${id}`).toEqual(want);
                  compared++;
                  if (got.status === "available") available++;
                }
              }
            }
          } finally {
            rust.free();
          }
        }
      }
      expect(compared).toBeGreaterThan(100);
      // Classic must never offer a proposal; Modern must offer plenty.
      if (mode === "classic") expect(available).toBe(0);
      else expect(available).toBeGreaterThan(40);
    });

    it(`${mode}: stairs, missing ids and unreadable drafts`, () => {
      const f = tower(mode);
      const rust = wasm().Engine.fromSave(JSON.stringify(f.sim.serialize())) as unknown as RustPort;
      try {
        const bad = scheduleSlots({ activeCars: { weekday: Array(SCHEDULE_HOURS).fill(1) } });
        bad[0] = 7;
        const cases: Array<[string, number, Float64Array]> = [
          ["stairs", f.stairs, new Float64Array(0)],
          ["a missing id", 9999, new Float64Array(0)],
          ["a fractional id", 1.5, new Float64Array(0)],
          ["a short draft", f.standard, new Float64Array(3)],
          ["a bad row flag", f.standard, bad],
          ["stairs with a bad draft", f.stairs, bad],
        ];
        for (const [name, id, slots] of cases) {
          const want = autoTuneProposal(f.sim, id, slots, false);
          expect(asJson(rust.autoTuneProposal(id, slots, false)), name).toEqual(want);
        }
        expect(rust.autoTuneProposal(f.stairs, new Float64Array(0), false).status).toBe("not-an-elevator");
        expect(rust.autoTuneProposal(9999, new Float64Array(0), false).status).toBe("missing-shaft");
        expect(rust.autoTuneProposal(f.standard, new Float64Array(3), false).status).toBe("invalid-draft");
      } finally {
        rust.free();
      }
    });
  }

  it("asking never writes: the save, the schedule and the undo signature stay put", () => {
    const f = tower("modern");
    measure(f.sim, f.standard, [WARM, MIXED], { 1: 3, 12: 9 }, { 1: 2 });
    const rust = wasm().Engine.fromSave(JSON.stringify(f.sim.serialize())) as unknown as RustPort;
    try {
      rust.seedElevatorTelemetry(JSON.stringify(telemetryDocument(f.sim)));
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
      expect(rust.scheduleShaft(f.standard, slots)[0]).toBe(1);
      expect(rust.shaftSchedule(f.standard)).toHaveLength(slots.length);
    } finally {
      rust.free();
    }
  });
});
