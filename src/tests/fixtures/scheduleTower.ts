import type { HourlyByDay, OriginRings } from "../../shared/engineTypes";
import type { FacilityKind, GameMode } from "../../shared/types";
import type { EnginePort } from "../../simport/enginePort";
import { telemetryDocument } from "../../wasmhost/telemetry";
import { wasm } from "../conformance/wasmEngine";
import { draftTower, type Draft } from "../portKit/drafts";

/**
 * A measured tower for the schedule-authoring suites: the Rust engine's
 * answers through the real WASM binding, over a tower the port kit lays out
 * and the measured telemetry the engine is handed (telemetry never rides a
 * save, so the engine takes it as a document, the way the gallery's engine
 * leg does).
 */

export const ring = (hours: readonly (readonly [number, number])[]): number[] => {
  const r = Array<number>(24).fill(0);
  for (const [h, v] of hours) r[h] = v;
  return r;
};
export const WARM = ring([[7, 0.9], [8, 1], [9, 0.8], [12, 0.4], [17, 0.95], [18, 0.7]]);
export const COLD = ring([[8, 0.5], [9, 0.5], [10, 0.5], [11, 0.5], [12, 0.5]]); // five hours: still cold
export const MIXED = ring([[6, 0.02], [7, 0.3], [8, 0.6], [9, 1], [10, 2.5], [11, 0.55], [14, 0.45], [20, 0.15]]);

/** The binding calls the schedule suites make beyond the port. */
export type RustPort = EnginePort & {
  free(): void;
  seedElevatorTelemetry(json: string): void;
  elevatorTelemetry(): string;
  scheduleShaft(id: number, slots: Float64Array): Float64Array;
  shaftSchedule(id: number): Float64Array;
  markStop(id: number, floor: number, stop: boolean): Float64Array;
  undoSignature(): unknown;
  serialize(): string;
};

/** The measured hourly curves and boarding floors, by shaft. */
export interface Telemetry {
  hourly: Map<number, HourlyByDay>;
  origins: Map<number, OriginRings>;
}

export interface Fixture {
  draft: Draft;
  standard: number;
  service: number;
  express: number;
  stairs: number;
  telemetry: Telemetry;
}

/** The tower's width in tiles. */
const WIDTH = 60;
/** Its top floor and the sky lobby's floor. */
const TOP = 20;
const SKY_LOBBY = 15;
/** The local's car count and the floor it skips. */
const LOCAL_CARS = 4;
const SKIPPED_FLOOR = 6;

/** A 20-story tower with a sky lobby at floor 15: a four-car local that skips
 *  floor 6, a service shaft, an express, and a stair. */
export function tower(mode: GameMode): Fixture {
  const draft = draftTower(31, mode, "realWorld");
  draft.money = 1e12;
  draft.star = 5;
  const put = (kind: FacilityKind, floor: number, x: number) => {
    const r = draft.tower.place(kind, floor, x);
    if (!r.ok) throw new Error(`${kind} ${floor},${x}: ${r.reason}`);
  };
  for (let x = 0; x < WIDTH; x++) put("lobby", 1, x);
  for (let f = 2; f <= TOP; f++) for (let x = 0; x < WIDTH; x++) put(f === SKY_LOBBY ? "lobby" : "floor", f, x);
  const shaft = (kind: "elevatorStandard" | "elevatorService" | "elevatorExpress" | "stairs", x: number, top: number): number => {
    const r = draft.tower.placeTransport(kind, x, 1, top);
    if (!r.ok || r.transportId === undefined) throw new Error(`${kind}: ${r.reason}`);
    return r.transportId;
  };
  const standard = shaft("elevatorStandard", 4, TOP);
  const service = shaft("elevatorService", 10, 12);
  const express = shaft("elevatorExpress", 16, TOP);
  const stairs = shaft("stairs", 24, 2);
  draft.tower.setCars(standard, LOCAL_CARS);
  return { draft, standard, service, express, stairs, telemetry: { hourly: new Map(), origins: new Map() } };
}

export type Slots = readonly [number[], number[]];

/** Floors the shaft's boarding mass sits on, one slot of the day. */
const origins = (floors: Record<number, number>): Map<number, number>[] =>
  Array.from({ length: 24 }, (_, h) => (h === 9 ? new Map(Object.entries(floors).map(([f, n]) => [Number(f), n])) : new Map()));

/** Record a shaft's measured curves and boarding floors on the fixture. */
export function measure(f: Fixture, id: number, [weekday, weekend]: Slots, weekdayOrigins: Record<number, number>, weekendOrigins: Record<number, number>): void {
  f.telemetry.hourly.set(id, { weekday: [...weekday], weekend: [...weekend] });
  f.telemetry.origins.set(id, { weekday: origins(weekdayOrigins), weekend: origins(weekendOrigins) });
}

/** A Rust engine on the fixture's saved tower, with the local's floor 6
 *  skipped and the measured telemetry handed over. The caller frees it. */
export function openEngine(f: Fixture): RustPort {
  const engine = wasm().Engine.fromSave(f.draft.saveText()) as unknown as RustPort;
  engine.markStop(f.standard, SKIPPED_FLOOR, false);
  const stores = { elevatorUtil: new Map<number, number>(), elevatorHourly: f.telemetry.hourly, elevatorOrigins: f.telemetry.origins };
  engine.seedElevatorTelemetry(JSON.stringify(telemetryDocument(stores)));
  return engine;
}
