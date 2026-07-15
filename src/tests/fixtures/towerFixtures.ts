import type { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import type { Unit } from "../../engine/types";

/**
 * Shared tower-construction helpers for integration fixtures. Every one
 * asserts its own construction (AGENTS.md: "fixtures must assert their own
 * construction"), so a scenario can never silently degrade into a different
 * tower than the test describes. Kept in one place so the noise-memo
 * differential test and the hour-cost bench cannot drift apart.
 */

/** Tower center column: lay outward from here so structure stays connected. */
export const MID = Math.floor(GRID.width / 2);

/** Place a structural tile and assert it ended up built as `kind`. End-state,
 *  not the place() return, so it tolerates the newGame ground-lobby seed a
 *  full-width lay re-covers, while a real failure (off-lot, disconnected,
 *  sky-lobby refusal) surfaces as an empty or wrong-kind tile. */
export function layTile(sim: Simulation, kind: "floor" | "lobby", floor: number, x: number): void {
  sim.tower.place(kind, floor, x);
  const built = sim.tower.structureKindAt(floor, x);
  if (built !== kind) throw new Error(`lay ${kind} at ${floor},${x} did not build (got ${built ?? "empty"})`);
}

/** Lay a full-width story of `kind`, spreading outward from center. */
export function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = MID; x < GRID.width; x++) layTile(sim, kind, floor, x);
  for (let x = MID - 1; x >= 0; x--) layTile(sim, kind, floor, x);
}

/** Build a transport and assert it placed: a failed shaft would silently leave
 *  an unserved tower and invalidate the scenario. */
export function mustBuild(sim: Simulation, kind: Parameters<Simulation["buildTransport"]>[0], x: number, bottom: number, top: number): void {
  const r = sim.buildTransport(kind, x, bottom, top);
  if (!r.ok) throw new Error(`buildTransport ${kind} at ${x} (${bottom}-${top}) failed: ${r.reason ?? "no reason"}`);
}

/** Place a room and assert it seated, returning the created unit. */
export function placeUnit(sim: Simulation, kind: Parameters<Simulation["tower"]["place"]>[0], floor: number, x: number): Unit {
  const r = sim.tower.place(kind, floor, x);
  if (!r.ok || r.unitId === undefined) throw new Error(`place ${kind} at ${floor},${x} failed: ${r.reason ?? "no reason"}`);
  const u = sim.tower.units.find((q) => q.id === r.unitId);
  if (!u) throw new Error(`place ${kind} at ${floor},${x}: unit ${r.unitId} not found`);
  return u;
}
