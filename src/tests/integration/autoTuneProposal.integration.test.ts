import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { SCHEDULE_HOURS, type ElevatorSchedule } from "../../engine/elevatorSchedule";
import type { FacilityKind, GameMode } from "../../engine/types";
import { autoTuneProposal } from "../../engine/port/queries";
import type { AutoTuneProposal, EnginePort } from "../../simport/enginePort";
import { scheduleSlots } from "../../simport/scheduleSlots";
import { telemetryDocument } from "../../wasmhost/telemetry";
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

const ring = (hours: readonly (readonly [number, number])[]): number[] => {
  const r = Array<number>(24).fill(0);
  for (const [h, v] of hours) r[h] = v;
  return r;
};
const WARM = ring([[7, 0.9], [8, 1], [9, 0.8], [12, 0.4], [17, 0.95], [18, 0.7]]);
const COLD = ring([[8, 0.5], [9, 0.5], [10, 0.5], [11, 0.5], [12, 0.5]]); // five hours: still cold
const MIXED = ring([[6, 0.02], [7, 0.3], [8, 0.6], [9, 1], [10, 2.5], [11, 0.55], [14, 0.45], [20, 0.15]]);

interface Fixture {
  sim: Simulation;
  standard: number;
  service: number;
  express: number;
  stairs: number;
}

/** A 20-story tower with a sky lobby at floor 15: a four-car local that skips
 *  floor 6, a service shaft, an express, and a stair. */
function tower(mode: GameMode): Fixture {
  const sim = new Simulation(31, mode, "realWorld");
  sim.money = 1e12;
  sim.star = 5;
  const W = 60;
  const put = (kind: FacilityKind, floor: number, x: number) => {
    const r = sim.tower.place(kind, floor, x);
    if (!r.ok) throw new Error(`${kind} ${floor},${x}: ${r.reason}`);
  };
  for (let x = 0; x < W; x++) put("lobby", 1, x);
  for (let f = 2; f <= 20; f++) for (let x = 0; x < W; x++) put(f === 15 ? "lobby" : "floor", f, x);
  const shaft = (kind: "elevatorStandard" | "elevatorService" | "elevatorExpress", x: number, top: number): number => {
    const r = sim.tower.placeTransport(kind, x, 1, top);
    if (!r.ok) throw new Error(`${kind}: ${r.reason}`);
    return sim.tower.transports[sim.tower.transports.length - 1].id;
  };
  const standard = shaft("elevatorStandard", 4, 20);
  const service = shaft("elevatorService", 10, 12);
  const express = shaft("elevatorExpress", 16, 20);
  const s = sim.tower.placeTransport("stairs", 24, 1, 2);
  if (!s.ok) throw new Error(`stairs: ${s.reason}`);
  const stairs = sim.tower.transports[sim.tower.transports.length - 1].id;
  sim.tower.setCars(standard, 4);
  sim.tower.setStop(standard, 6, false);
  return { sim, standard, service, express, stairs };
}

type Slots = readonly [number[], number[]];

/** Floors the shaft's boarding mass sits on, one slot of the day. */
const origins = (floors: Record<number, number>) => (): Map<number, number>[] =>
  Array.from({ length: 24 }, (_, h) => (h === 9 ? new Map(Object.entries(floors).map(([f, n]) => [Number(f), n])) : new Map()));

function measure(sim: Simulation, id: number, [weekday, weekend]: Slots, weekdayOrigins: Record<number, number>, weekendOrigins: Record<number, number>): void {
  sim.elevatorHourly.set(id, { weekday: [...weekday], weekend: [...weekend] });
  sim.elevatorOrigins.set(id, { weekday: origins(weekdayOrigins)(), weekend: origins(weekendOrigins)() });
}

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
