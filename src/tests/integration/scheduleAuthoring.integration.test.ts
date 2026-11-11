import { describe, expect, it } from "vitest";
import { SCHEDULE_HOURS } from "../../engine/elevatorSchedule";
import type { ElevatorSchedule } from "../../shared/engineTypes";
import { autoTuneProposal, scheduleFacts, schedulePreset } from "../../engine/port/queries";
import type { EnginePort, PresetProposal, ScheduleFacts, SchedulePresetName } from "../../simport/enginePort";
import { scheduleSlots } from "../../simport/scheduleSlots";
import { telemetryDocument } from "../../wasmhost/telemetry";
import { COLD, MIXED, WARM, measure, ring, tower, type Slots } from "../fixtures/scheduleTower";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * The schedule dialog's advice, staging summary and presets live in the engine
 * (#1552): the Rust queries, through the real WASM binding, against the
 * TypeScript reference they replace, over the same saved tower and the same
 * measured telemetry. Telemetry never rides a save, so the Rust engine is
 * handed the reference's document the way the gallery's engine leg is.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but the engine's WASM package was not built");

type RustPort = EnginePort & { free(): void; seedElevatorTelemetry(json: string): void; serialize(): string };

const asJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const PRESETS: readonly SchedulePresetName[] = ["rush", "balanced", "feeder", "stage-up-tower"];

const MEASURES: ReadonlyArray<readonly [string, Slots]> = [
  ["both days warm", [WARM, MIXED]],
  ["weekday only", [WARM, ring([])]],
  ["weekend only", [ring([]), MIXED]],
  ["five hours is cold", [COLD, COLD]],
  ["no samples", [ring([]), ring([])]],
];

/** Drafts for a shaft of `cars` cars: rows well off the measured load, a full
 *  fleet, a short home list, and homes above the base. */
const DRAFTS = (cars: number): ReadonlyArray<readonly [string, ElevatorSchedule | undefined]> => [
  ["no draft", undefined],
  ["one car every hour", { activeCars: { weekday: Array(SCHEDULE_HOURS).fill(1), weekend: Array(SCHEDULE_HOURS).fill(1) } }],
  ["the full fleet", { activeCars: { weekday: Array(SCHEDULE_HOURS).fill(cars), weekend: Array(SCHEDULE_HOURS).fill(cars) } }],
  [
    "a ragged row",
    { activeCars: { weekday: Array.from({ length: SCHEDULE_HOURS }, (_, h) => (h * 3) % (cars + 1)), weekend: Array.from({ length: SCHEDULE_HOURS }, (_, h) => (h + 1) % (cars + 1)) } },
  ],
  ["homes above the base", { activeCars: { weekday: Array(SCHEDULE_HOURS).fill(cars) }, homeFloors: [3, 11, 20, 1].slice(0, cars) }],
  ["one home only", { homeFloors: [20] }],
  // The fixture skips floor 6, so a home there snaps to its nearer neighbor.
  ["homes on the skipped floor", { homeFloors: [6, 7, 6, 7].slice(0, cars) }],
  ["a longer list than the fleet", { homeFloors: [3, 6, 9, 12, 15, 18, 20, 2, 4, 5] }],
];

describe.skipIf(!hasWasmPackage())("the Rust schedule facts and presets match the TypeScript reference", () => {
  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: facts over every shaft, measurement, draft and day tab`, () => {
      const f = tower(mode);
      const kinds = [f.standard, f.service, f.express] as const;
      let compared = 0;
      let ready = 0;
      let recommendedFeeder = 0;
      for (const [mname, slots] of MEASURES) {
        kinds.forEach((id, i) => measure(f.sim, id, i === 1 ? [slots[1], slots[0]] : slots, { 1: 3, 12: 9 }, { 1: 2 }));
        const rust = wasm().Engine.fromSave(JSON.stringify(f.sim.serialize())) as unknown as RustPort;
        try {
          rust.seedElevatorTelemetry(JSON.stringify(telemetryDocument(f.sim)));
          for (const id of kinds) {
            const cars = f.sim.tower.getTransport(id)!.cars;
            for (const [dname, draft] of DRAFTS(cars)) {
              for (const weekend of [false, true]) {
                const slots = draft ? scheduleSlots(draft) : new Float64Array(0);
                const want = scheduleFacts(f.sim, id, slots, weekend);
                const got = asJson<ScheduleFacts>(rust.scheduleFacts(id, slots, weekend));
                expect(got, `${mode} ${mname} / ${dname} / weekend=${weekend} / shaft ${id}`).toEqual(want);
                compared++;
                if (got.advice.status === "ready") ready++;
                if (got.recommended === "feeder") recommendedFeeder++;
              }
            }
          }
        } finally {
          rust.free();
        }
      }
      expect(compared).toBeGreaterThan(100);
      if (mode === "classic") expect(ready).toBe(0);
      else {
        expect(ready).toBeGreaterThan(40);
        expect(recommendedFeeder).toBeGreaterThan(0);
      }
    });

    it(`${mode}: every preset on 1, 2, 3 and 8 cars, each shaft kind`, () => {
      const f = tower(mode);
      const kinds = [f.standard, f.service, f.express] as const;
      let available = 0;
      for (const cars of [1, 2, 3, 8]) {
        for (const id of kinds) f.sim.tower.setCars(id, cars);
        const rust = wasm().Engine.fromSave(JSON.stringify(f.sim.serialize())) as unknown as RustPort;
        try {
          for (const id of kinds) {
            for (const name of PRESETS) {
              const want = schedulePreset(f.sim, id, name);
              const got = asJson<PresetProposal>(rust.schedulePreset(id, name));
              expect(got, `${mode} ${cars} cars / shaft ${id} / ${name}`).toEqual(want);
              if (got.status === "available") available++;
            }
          }
        } finally {
          rust.free();
        }
      }
      // Classic answers only the staging play; Modern answers all four.
      expect(available).toBe(mode === "classic" ? 12 : 48);
    });

    it(`${mode}: stairs, missing ids, unknown names and unreadable drafts`, () => {
      const f = tower(mode);
      const rust = wasm().Engine.fromSave(JSON.stringify(f.sim.serialize())) as unknown as RustPort;
      try {
        const bad = scheduleSlots({ activeCars: { weekday: Array(SCHEDULE_HOURS).fill(1) } });
        bad[0] = 7;
        const none = new Float64Array(0);
        for (const [name, id, slots] of [
          ["stairs", f.stairs, none],
          ["a missing id", 9999, none],
          ["a fractional id", 1.5, none],
          ["a short draft", f.standard, new Float64Array(3)],
          ["a bad row flag", f.standard, bad],
          ["stairs with a bad draft", f.stairs, bad],
        ] as const) {
          expect(asJson(rust.scheduleFacts(id, slots, false)), name).toEqual(scheduleFacts(f.sim, id, slots, false));
        }
        for (const [name, id, preset] of [
          ["stairs", f.stairs, "rush"],
          ["a missing id", 9999, "rush"],
          ["a fractional id", 1.5, "rush"],
          ["an unknown name", f.standard, "turbo"],
          ["an empty name", f.standard, ""],
          ["a capitalized name", f.standard, "Rush"],
        ] as const) {
          expect(asJson(rust.schedulePreset(id, preset as SchedulePresetName)), name).toEqual(schedulePreset(f.sim, id, preset));
        }
        expect(rust.scheduleFacts(f.stairs, none, false).status).toBe("not-an-elevator");
        expect(rust.scheduleFacts(f.standard, new Float64Array(3), false).status).toBe("invalid-draft");
        expect(rust.schedulePreset(f.standard, "turbo" as SchedulePresetName).status).toBe("unknown-preset");
        expect(rust.schedulePreset(f.stairs, "rush").status).toBe("not-an-elevator");
      } finally {
        rust.free();
      }
    });
  }

  it("a shaft with no cars answers its own status in both engines", () => {
    for (const mode of ["classic", "modern"] as const) {
      const f = tower(mode);
      measure(f.sim, f.standard, [WARM, MIXED], { 1: 3 }, { 1: 2 });
      f.sim.tower.getTransport(f.standard)!.cars = 0;
      const rust = wasm().Engine.fromSave(JSON.stringify(f.sim.serialize())) as unknown as RustPort;
      try {
        rust.seedElevatorTelemetry(JSON.stringify(telemetryDocument(f.sim)));
        expect(f.sim.tower.getTransport(f.standard)!.cars).toBe(0);
        const none = new Float64Array(0);
        for (const name of PRESETS) {
          expect(asJson(rust.schedulePreset(f.standard, name)), `${mode} ${name}`).toEqual(schedulePreset(f.sim, f.standard, name));
        }
        expect(asJson(rust.scheduleFacts(f.standard, none, false))).toEqual(scheduleFacts(f.sim, f.standard, none, false));
        expect(asJson(rust.autoTuneProposal(f.standard, none, false))).toEqual(autoTuneProposal(f.sim, f.standard, none, false));
        expect(rust.scheduleFacts(f.standard, none, false).advice.status).toBe(mode === "modern" ? "no-cars" : "unavailable-in-mode");
        expect(rust.schedulePreset(f.standard, "stage-up-tower").status).toBe("no-cars");
        expect(rust.scheduleFacts(9999, none, false).advice.status).toBe("refused");
      } finally {
        rust.free();
      }
    }
  });

  it("a stop edit on the sky lobby moves the up-tower target the same way in both engines", () => {
    const f = tower("modern");
    measure(f.sim, f.standard, [WARM, MIXED], { 1: 3, 12: 9 }, { 1: 2 });
    for (const served of [true, false]) {
      f.sim.tower.setStop(f.standard, 15, served);
      const rust = wasm().Engine.fromSave(JSON.stringify(f.sim.serialize())) as unknown as RustPort;
      try {
        rust.seedElevatorTelemetry(JSON.stringify(telemetryDocument(f.sim)));
        for (const name of PRESETS) {
          expect(asJson(rust.schedulePreset(f.standard, name)), `${name}, sky lobby served=${served}`).toEqual(schedulePreset(f.sim, f.standard, name));
        }
        const slots = new Float64Array(0);
        const got = asJson<ScheduleFacts>(rust.scheduleFacts(f.standard, slots, false));
        expect(got).toEqual(scheduleFacts(f.sim, f.standard, slots, false));
        // The base is the ground lobby; the top lobby is the sky lobby only while it is a stop.
        expect(got.staging!.topLobby).toBe(served ? 15 : 20);
      } finally {
        rust.free();
      }
    }
  });

  it("asking never writes: the save and the schedule stay put, and a preset applies as one ordinary command", () => {
    const f = tower("modern");
    measure(f.sim, f.standard, [WARM, MIXED], { 1: 3, 12: 9 }, { 1: 2 });
    const rust = wasm().Engine.fromSave(JSON.stringify(f.sim.serialize())) as unknown as RustPort & {
      scheduleShaft(id: number, slots: Float64Array): Float64Array;
      shaftSchedule(id: number): Float64Array;
      undoSignature(): unknown;
    };
    try {
      rust.seedElevatorTelemetry(JSON.stringify(telemetryDocument(f.sim)));
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
      expect(rust.scheduleShaft(f.standard, slots)[0]).toBe(1);
      expect(rust.shaftSchedule(f.standard)).toHaveLength(slots.length);
      const applied = rust.scheduleFacts(f.standard, slots, false);
      expect(applied.status).toBe("available");
      expect(applied.staging!.activeAtPeak).toBe(first.weekday![applied.staging!.peakHour]);
    } finally {
      rust.free();
    }
  });
});
