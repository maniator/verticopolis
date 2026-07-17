import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import type { GameMode, Unit } from "../../engine/types";

/**
 * Modern smart dispatch (housekeeping-overhaul GDD, epic 4): dirty rooms are
 * triaged by days-dirty urgency weighted against travel cost through the
 * GameRules seam (Classic stays the original's opportunistic tower order).
 * Order is observed through the crowd: maids spawn in dispatch order, so the
 * staff people array records who was sent first.
 */

const X0 = Math.floor(GRID.width / 2) - 20;

/** A 2★ tower with floors 2..8, a passenger elevator, and a service shaft
 *  linking every floor, plus a crew on floor 2. Placements asserted. */
function triageTower(seed: number, mode: GameMode): { sim: Simulation; crew: Unit } {
  const sim = Simulation.newGame(seed, mode);
  sim.star = 2;
  for (let f = 2; f <= 8; f++) for (let i = 0; i < 30; i++) expect(sim.tower.place("floor", f, X0 + i).ok).toBe(true);
  expect(sim.buildTransport("elevatorStandard", X0 + 26, 1, 8).ok).toBe(true);
  expect(sim.tower.placeTransport("elevatorService", X0 + 18, 1, 8).ok).toBe(true);
  const hk = sim.tower.place("housekeeping", 2, X0 + 8);
  expect(hk.ok).toBe(true);
  return { sim, crew: sim.tower.units.find((u) => u.id === hk.unitId)! };
}

function dirtyRoom(sim: Simulation, floor: number, x: number, dirtyDays?: number): Unit {
  const r = sim.tower.place("hotelSingle", floor, x);
  expect(r.ok).toBe(true);
  const room = sim.tower.units.find((u) => u.id === r.unitId)!;
  room.state = "dirty";
  if (dirtyDays !== undefined) room.dirtyDays = dirtyDays;
  return room;
}

/** The unit ids maids were dispatched to, in spawn (= dispatch) order. */
function dispatchOrder(sim: Simulation): number[] {
  return sim.crowd.people.filter((p) => p.staff).map((p) => p.cleanUnitId!);
}

describe("Modern smart dispatch (GameRules triage)", () => {
  it("rescues the about-to-infest room first even when a fresh room is nearer", () => {
    const { sim } = triageTower(61, "modern");
    const near = dirtyRoom(sim, 2, X0); // fresh, same floor as the crew: score 0
    const far = dirtyRoom(sim, 8, X0, 2); // 2 days dirty, 6 floors away: 2*10 - 6 = 14
    sim.clock.minutes = 13 * 60;
    sim.economy.dispatchHousekeepers();
    expect(dispatchOrder(sim)).toEqual([far.id, near.id]);
  });

  it("does not commute for a marginal case: equal urgency goes to the nearer room first", () => {
    const { sim } = triageTower(62, "modern");
    const near = dirtyRoom(sim, 2, X0); // fresh, distance 0: score 0
    const far = dirtyRoom(sim, 8, X0); // fresh, distance 6: score -6
    sim.clock.minutes = 13 * 60;
    sim.economy.dispatchHousekeepers();
    expect(dispatchOrder(sim)).toEqual([near.id, far.id]);
  });

  it("is deterministic: the same tower dispatches in the same order every run", () => {
    const build = () => {
      const { sim } = triageTower(63, "modern");
      dirtyRoom(sim, 3, X0, 1);
      dirtyRoom(sim, 5, X0, 1); // equal urgency and differing distance + id tiebreaks
      dirtyRoom(sim, 4, X0, 2);
      sim.clock.minutes = 13 * 60;
      sim.economy.dispatchHousekeepers();
      return dispatchOrder(sim);
    };
    const a = build();
    expect(a.length).toBe(3);
    expect(build()).toEqual(a);
  });
});

describe("Classic keeps the opportunistic tower order", () => {
  it("serves rooms in placement order, ignoring how dirty they are", () => {
    const { sim } = triageTower(64, "classic");
    const first = dirtyRoom(sim, 2, X0); // fresh, placed first
    const older = dirtyRoom(sim, 8, X0, 2); // 2 days dirty, placed second
    sim.clock.minutes = 13 * 60;
    sim.economy.dispatchHousekeepers();
    expect(dispatchOrder(sim)).toEqual([first.id, older.id]);
  });
});
