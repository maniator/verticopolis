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

/** The unit ids maids were dispatched to, in spawn (= dispatch) order. Keyed
 *  on `cleanUnitId` (not just `p.staff`) so any future staff spawned without a
 *  cleaning job can't pollute the observed order. */
function dispatchOrder(sim: Simulation): number[] {
  return sim.crowd.people.filter((p) => p.staff && p.cleanUnitId !== undefined).map((p) => p.cleanUnitId!);
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
      dirtyRoom(sim, 5, X0, 1); // equal urgency at differing distances (distinct scores)
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

describe("triage tiebreaks and edges", () => {
  it("equal scores fall to the unit-id tiebreak (two identical rooms on one distant floor)", () => {
    const { sim } = triageTower(65, "modern");
    // Same floor, same dirtyDays: identical scores, so placement (id) order
    // decides. One maid per floor serializes them; the FIRST assignment is the
    // observable tiebreak winner.
    const a = dirtyRoom(sim, 5, X0, 1);
    const b = dirtyRoom(sim, 5, X0 + 4, 1);
    expect(a.id).toBeLessThan(b.id);
    sim.clock.minutes = 13 * 60;
    sim.economy.dispatchHousekeepers();
    expect(dispatchOrder(sim)).toEqual([a.id]); // one-per-floor: only the tiebreak winner goes
  });

  it("unreachable rooms sort last, stay deterministic together, and still raise the can't-reach nudge", () => {
    const { sim } = triageTower(66, "modern");
    // Floors 9-10 exist beyond every staff transport: two unreachable dirty
    // rooms (the -Infinity pair whose ordering must come from the id tiebreak,
    // never from NaN comparator luck) plus one reachable fresh room.
    for (let f = 9; f <= 10; f++)
      for (let i = 0; i < 30; i++) expect(sim.tower.place("floor", f, X0 + i).ok).toBe(true);
    const reachable = dirtyRoom(sim, 3, X0);
    dirtyRoom(sim, 9, X0, 2);
    dirtyRoom(sim, 10, X0, 2);
    sim.clock.minutes = 13 * 60;
    sim.economy.dispatchHousekeepers();
    // Only the reachable room gets a maid; the unreachable pair is reported.
    expect(dispatchOrder(sim)).toEqual([reachable.id]);
    expect(sim.log.some((l) => l.text.includes("Housekeeping can't reach 2 dirty room(s)"))).toBe(true);
  });

  it("locks the ratified 10:1 weight at its boundary (a day of dirt beats 9 floors, loses to 11)", () => {
    const wins = (() => {
      const { sim } = triageTower(67, "modern");
      for (let f = 9; f <= 11; f++)
        for (let i = 0; i < 30; i++) expect(sim.tower.place("floor", f, X0 + i).ok).toBe(true);
      expect(sim.tower.placeTransport("stairs", X0, 8, 9).ok).toBe(true);
      expect(sim.tower.placeTransport("stairs", X0 + 8, 9, 10).ok).toBe(true);
      expect(sim.tower.placeTransport("stairs", X0, 10, 11).ok).toBe(true);
      const near = dirtyRoom(sim, 2, X0); // fresh at distance 0: score 0
      const nine = dirtyRoom(sim, 11, X0 + 24, 1); // 1 day at distance 9: 10 - 9 = 1 > 0
      sim.clock.minutes = 13 * 60;
      sim.economy.dispatchHousekeepers();
      return dispatchOrder(sim).slice(0, 2).join(",") === `${nine.id},${near.id}`;
    })();
    expect(wins).toBe(true); // 9 floors: the day of dirt wins
    const loses = (() => {
      const { sim } = triageTower(68, "modern");
      for (let f = 9; f <= 13; f++)
        for (let i = 0; i < 30; i++) expect(sim.tower.place("floor", f, X0 + i).ok).toBe(true);
      for (let f = 8; f <= 12; f++)
        expect(sim.tower.placeTransport("stairs", X0 + (f % 2) * 8, f, f + 1).ok).toBe(true);
      const near = dirtyRoom(sim, 2, X0); // fresh at distance 0: score 0
      const eleven = dirtyRoom(sim, 13, X0 + 24, 1); // 1 day at distance 11: 10 - 11 = -1 < 0
      sim.clock.minutes = 13 * 60;
      sim.economy.dispatchHousekeepers();
      return dispatchOrder(sim).slice(0, 2).join(",") === `${near.id},${eleven.id}`;
    })();
    expect(loses).toBe(true); // 11 floors: the commute wins
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
