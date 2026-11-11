import { Simulation } from "../../engine/Simulation";
import type { FacilityKind, GameMode } from "../../shared/types";

/**
 * A measured tower for the schedule-authoring parity tests: the Rust engine's
 * answers (through the real WASM binding) are compared with the TypeScript
 * reference over the same saved tower and the same measured telemetry.
 */

export const ring = (hours: readonly (readonly [number, number])[]): number[] => {
  const r = Array<number>(24).fill(0);
  for (const [h, v] of hours) r[h] = v;
  return r;
};
export const WARM = ring([[7, 0.9], [8, 1], [9, 0.8], [12, 0.4], [17, 0.95], [18, 0.7]]);
export const COLD = ring([[8, 0.5], [9, 0.5], [10, 0.5], [11, 0.5], [12, 0.5]]); // five hours: still cold
export const MIXED = ring([[6, 0.02], [7, 0.3], [8, 0.6], [9, 1], [10, 2.5], [11, 0.55], [14, 0.45], [20, 0.15]]);

export interface Fixture {
  sim: Simulation;
  standard: number;
  service: number;
  express: number;
  stairs: number;
}

/** A 20-story tower with a sky lobby at floor 15: a four-car local that skips
 *  floor 6, a service shaft, an express, and a stair. */
export function tower(mode: GameMode): Fixture {
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

export type Slots = readonly [number[], number[]];

/** Floors the shaft's boarding mass sits on, one slot of the day. */
const origins = (floors: Record<number, number>) => (): Map<number, number>[] =>
  Array.from({ length: 24 }, (_, h) => (h === 9 ? new Map(Object.entries(floors).map(([f, n]) => [Number(f), n])) : new Map()));

export function measure(sim: Simulation, id: number, [weekday, weekend]: Slots, weekdayOrigins: Record<number, number>, weekendOrigins: Record<number, number>): void {
  sim.elevatorHourly.set(id, { weekday: [...weekday], weekend: [...weekend] });
  sim.elevatorOrigins.set(id, { weekday: origins(weekdayOrigins)(), weekend: origins(weekendOrigins)() });
}

