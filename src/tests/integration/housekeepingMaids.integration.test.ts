import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { HK_CLEAN_MINUTES, HK_MAIDS_PER_UNIT } from "../../engine/economy/housekeeping";
import { maxStaffFor } from "../../engine/crowd/spawn";
import { CROWD_SECONDS_PER_MINUTE } from "../../engine/Crowd";
import type { GameMode } from "../../engine/types";

/**
 * Time-simulated maids (housekeeping-overhaul GDD, epic 2): the canon shift
 * windows through GameRules (Classic noon-5 with the 16:30 no-new-room cutoff,
 * Modern 08-19), the service-elevator-or-stairs-only staff network (escalators
 * dropped, canon), the per-unit 6-maid pool with one maid per floor at a time,
 * the in-room cleaning dwell, and event-driven cycling with no per-day quota.
 */

const X0 = Math.floor(GRID.width / 2) - 20;

/** A 2★ tower with a passenger elevator and a floor-2 slab, opening at 7:00.
 *  Every placement is asserted so a silent refusal can't make a scenario lie. */
function baseTower(seed: number, mode: GameMode = "classic"): Simulation {
  const sim = Simulation.newGame(seed, mode);
  sim.star = 2;
  placeSlab(sim, 2);
  expect(sim.buildTransport("elevatorStandard", X0 + 26, 1, 2).ok).toBe(true);
  return sim;
}

/** Lay a 30-tile floor slab, asserting each tile landed. */
function placeSlab(sim: Simulation, floor: number) {
  for (let i = 0; i < 30; i++) expect(sim.tower.place("floor", floor, X0 + i).ok).toBe(true);
}

function dirtyRoom(sim: Simulation, floor: number, x: number) {
  const r = sim.tower.place("hotelSingle", floor, x);
  expect(r.ok).toBe(true);
  const room = sim.tower.units.find((u) => u.id === r.unitId)!;
  room.state = "dirty";
  return room;
}

describe("shift windows via GameRules", () => {
  it("Classic maids start at noon, not at the 8:00 checkout", () => {
    const sim = baseTower(31);
    const room = dirtyRoom(sim, 2, X0);
    expect(sim.tower.place("housekeeping", 2, X0 + 8).ok).toBe(true);
    // 7:00 -> 11:00: checkout hour passed, but the canon shift has not opened.
    for (let i = 0; i < 4; i++) sim.tick(60);
    expect(room.state).toBe("dirty");
    expect(sim.crowd.people.some((p) => p.staff)).toBe(false);
    // Crossing noon dispatches; the following hour walks and dwells her clean.
    sim.tick(60);
    expect(sim.crowd.people.some((p) => p.staff)).toBe(true);
    sim.tick(60);
    expect(room.state).toBe("empty");
  });

  it("Classic dispatch starts no new room at or after the 16:30 cutoff", () => {
    const sim = baseTower(32);
    dirtyRoom(sim, 2, X0);
    expect(sim.tower.place("housekeeping", 2, X0 + 8).ok).toBe(true);
    sim.clock.minutes = 16 * 60 + 45; // 16:45, inside the shift but past 16:30
    sim.economy.dispatchHousekeepers();
    expect(sim.crowd.people.some((p) => p.staff)).toBe(false);
    sim.clock.minutes = 16 * 60 + 15; // 16:15, before the cutoff
    sim.economy.dispatchHousekeepers();
    expect(sim.crowd.people.some((p) => p.staff)).toBe(true);
  });

  it("Modern keeps the longer 08:00 staffed day", () => {
    const sim = baseTower(33, "modern");
    const room = dirtyRoom(sim, 2, X0);
    expect(sim.tower.place("housekeeping", 2, X0 + 8).ok).toBe(true);
    // 7:00 -> 8:00 opens the Modern shift; the next hour cleans.
    sim.tick(60);
    expect(sim.crowd.people.some((p) => p.staff)).toBe(true);
    sim.tick(60);
    expect(room.state).toBe("empty");
  });
});

describe("staff network: service elevator or stairs only (canon)", () => {
  it("an escalator no longer carries staff; stairs do", () => {
    const sim = baseTower(34);
    placeSlab(sim, 3);
    const room = dirtyRoom(sim, 3, X0);
    expect(sim.tower.place("housekeeping", 2, X0 + 8).ok).toBe(true);
    expect(sim.tower.placeTransport("escalator", X0 + 18, 2, 3).ok).toBe(true);
    expect(sim.tower.staffConnected(2, 3)).toBe(false); // canon: not a staff transport
    for (let i = 0; i < 7; i++) sim.tick(60); // 7:00 -> 14:00, through the shift
    expect(room.state).toBe("dirty");
    expect(sim.log.some((l) => l.text.includes("Housekeeping can't reach"))).toBe(true);
    // Stairs restore the canon staff link and the room turns over.
    expect(sim.tower.placeTransport("stairs", X0, 2, 3).ok).toBe(true);
    expect(sim.tower.staffConnected(2, 3)).toBe(true);
    for (let i = 0; i < 2; i++) sim.tick(60);
    expect(room.state).toBe("empty");
  });
});

describe("the maid pool", () => {
  it("a unit fields at most 6 maids at once, one per floor at a time", () => {
    const sim = baseTower(35);
    // Eight hotel floors, one dirty single each, all linked by a service shaft.
    for (let f = 3; f <= 9; f++) placeSlab(sim, f);
    expect(sim.tower.placeTransport("elevatorService", X0 + 18, 1, 9).ok).toBe(true);
    for (let f = 2; f <= 8; f++) dirtyRoom(sim, f, X0);
    expect(sim.tower.place("housekeeping", 9, X0 + 8).ok).toBe(true);
    sim.clock.minutes = 13 * 60; // mid-shift
    sim.economy.dispatchHousekeepers();
    // Seven reachable dirty rooms on seven floors, but only 6 maids go out.
    expect(sim.crowd.people.filter((p) => p.staff).length).toBe(HK_MAIDS_PER_UNIT);
  });

  it("two dirty rooms on one floor get one maid at a time, and she cycles through both", () => {
    const sim = baseTower(36);
    const a = dirtyRoom(sim, 2, X0);
    const b = dirtyRoom(sim, 2, X0 + 4);
    expect(sim.tower.place("housekeeping", 2, X0 + 8).ok).toBe(true);
    sim.clock.minutes = 13 * 60;
    sim.economy.dispatchHousekeepers();
    expect(sim.crowd.people.filter((p) => p.staff).length).toBe(1); // one maid per floor per unit
    // One hour of simulation: she cleans the first room, is released, and the
    // event-driven re-dispatch sends her straight to the second (no hourly
    // tick in between: 14:00's dispatch has not run when both turn over).
    sim.tick(60);
    expect(a.state).toBe("empty");
    expect(b.state).toBe("empty");
  });
});

describe("the staff pool scales with built crews (canon: no tower-wide staff cap)", () => {
  it("maxStaffFor is exactly the operational crews' worth of maids", () => {
    const sim = baseTower(39);
    expect(maxStaffFor(sim.tower)).toBe(0); // no crews: nothing to field
    expect(sim.tower.place("housekeeping", 2, X0 + 8).ok).toBe(true);
    expect(sim.tower.place("housekeeping", 2, X0 + 16).ok).toBe(true);
    expect(maxStaffFor(sim.tower)).toBe(2 * HK_MAIDS_PER_UNIT);
    // A burning crew has no staff to send, so it drops out of the ceiling.
    sim.tower.units.find((u) => u.kind === "housekeeping")!.state = "fire";
    expect(maxStaffFor(sim.tower)).toBe(HK_MAIDS_PER_UNIT);
  });

  it("an 11th crew's maids are admitted: the old fixed 64-maid gate is gone", () => {
    // 11 crews can field 66 maids, one more crew's worth than the retired
    // MAX_STAFF = 64 constant admitted. Probe the spawn gate directly at the
    // old constant's exact value (walking 64 live maids through the crowd
    // end-to-end would need a skyscraper fixture; the gate is the unit under
    // test, and the per-crew ledgers are covered above).
    const sim = baseTower(40);
    for (let f = 3; f <= 12; f++) placeSlab(sim, f);
    for (let f = 2; f <= 12; f++) expect(sim.tower.place("housekeeping", f, X0 + 8).ok).toBe(true);
    expect(maxStaffFor(sim.tower)).toBe(11 * HK_MAIDS_PER_UNIT);
    const room = dirtyRoom(sim, 2, X0);
    sim.crowd.staffCount = 64; // the retired pool's ceiling: no longer "full"
    expect(sim.spawnStaffTrip(2, 2, room.x, room.id, HK_CLEAN_MINUTES)).toBe("sent");
    sim.crowd.staffCount = 11 * HK_MAIDS_PER_UNIT; // built capacity: the honest ceiling
    expect(sim.spawnStaffTrip(2, 2, room.x, room.id, HK_CLEAN_MINUTES)).toBe("full");
  });
});

describe("the cleaning dwell", () => {
  it("a dispatched maid carries the per-room cleaning hold, so rooms are never cleaned on arrival", () => {
    const sim = baseTower(37);
    dirtyRoom(sim, 2, X0);
    expect(sim.tower.place("housekeeping", 2, X0 + 8).ok).toBe(true);
    sim.clock.minutes = 13 * 60;
    sim.economy.dispatchHousekeepers();
    const maid = sim.crowd.people.find((p) => p.staff)!;
    expect(maid.lingerFor).toBe(HK_CLEAN_MINUTES * CROWD_SECONDS_PER_MINUTE);
  });

  it("the room stays dirty while the maid is in it and turns over only when the dwell completes", () => {
    const sim = baseTower(38);
    const room = dirtyRoom(sim, 2, X0);
    expect(sim.tower.place("housekeeping", 2, X0 + 8).ok).toBe(true);
    sim.clock.minutes = 13 * 60;
    sim.economy.dispatchHousekeepers();
    expect(sim.crowd.people.some((p) => p.staff)).toBe(true);
    // Three game-minutes (6 crowd-seconds) covers the same-floor walk but is
    // far short of the 16-crowd-second dwell: she is in the room, still
    // scrubbing, and the room has NOT turned over (arrival cleans nothing).
    sim.tick(3);
    expect(sim.crowd.people.some((p) => p.staff)).toBe(true);
    expect(room.state).toBe("dirty");
    // Let the dwell drain (with margin): only now does the room turn over.
    for (let i = 0; i < 5; i++) sim.tick(3);
    expect(room.state).toBe("empty");
  });
});
