import { expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { GameMode, Unit } from "../../engine/types";
import { GRID } from "../../engine/facilities";

/** Shared fixtures for the move-in sustainability gate tests
 *  (spec-move-in-sustainability-gate-2026-07-23), split out so the two test files
 *  (core gate behavior, and inspector/toast legibility) stay under the size guard
 *  while building identical towers. */

export const W = GRID.width;
export const C = Math.floor(W / 2);
export const DAY = 60 * 24;

/** A full-width ground lobby plus floors 2..top, and a center standard elevator
 *  serving them. Every rentable spot placed on floors 2..top is then served,
 *  reachable, and close to the ground lobby, so the ONLY drain a test introduces
 *  is the one it places (an adjacent office for noise, a high floor for lobby
 *  distance), never a stray access or lobby-far confound. */
export function servedTower(seed: number, mode: GameMode, top = 6): Simulation {
  const sim = Simulation.newGame(seed, mode);
  sim.money = 1e12;
  sim.star = 1; // 1-star: no random fire/bomb events to perturb the run
  for (let x = 0; x < W; x++) sim.tower.place("lobby", 1, x);
  for (let f = 2; f <= top; f++) for (let x = 0; x < W; x++) sim.tower.place("floor", f, x);
  expect(sim.buildTransport("elevatorStandard", C, 1, Math.min(top, 30)).ok).toBe(true);
  sim.tower.setCars(sim.tower.transports[0].id, 8);
  // Assert the topology every case relies on rather than trusting the loops: a
  // full lobby row and floor slabs were laid, the shaft stands, and floor 2 (where
  // most candidates sit) is genuinely served AND reachable. A grid, catalog, or
  // cap change that silently dropped a placement would trip this here instead of
  // quietly turning a satisfaction-drain case into an access-failure case.
  expect(sim.tower.units.filter((u) => u.kind === "lobby" && u.floor === 1).length).toBe(W);
  expect(sim.tower.units.filter((u) => u.kind === "floor" && u.floor === top).length).toBe(W);
  expect(sim.tower.isFloorServed(2)).toBe(true);
  expect(sim.floorReachable(2)).toBe(true);
  return sim;
}

export function place(sim: Simulation, kind: "office" | "condo" | "fastFood", floor: number, x: number): Unit {
  const r = sim.tower.place(kind, floor, x);
  expect(r.ok, `place ${kind} f${floor} x${x}`).toBe(true);
  return sim.tower.units.find((u) => u.id === r.unitId)!;
}

/** Force-seat a real, happy owner/tenant so a long run reveals whether the spot
 *  SUSTAINS it or erodes it out. A condo is seated as a sold 3-person household. */
export function seat(u: Unit): void {
  u.state = "occupied";
  u.everOccupied = true;
  u.satisfaction = 1;
  if (u.kind === "condo") {
    u.residents = 3;
    u.rent = 160_000;
  }
}
