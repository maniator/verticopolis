import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Simulation } from "../../engine/Simulation";
import { Clock } from "../../engine/Clock";
import { beginDwell } from "../../engine/crowd/visits";
import { add } from "../../engine/crowd/trips";
import { finish } from "../../engine/crowd/motion";
import type { Unit } from "../../engine/types";

/**
 * The attendance-tally tripwire (standing rule from the venue-people-routing
 * review, GH #302): the tally has exactly ONE decrement path, `finish()`, no
 * reconciliation pass exists in production by design, and enforcement lived
 * only in convention until this suite. Two halves:
 *
 *   1. A source-level tripwire: the only `state = "done"` assignment across
 *      the crowd modules lives inside `finish()`. A future despawn shortcut
 *      that skips `finish()` trips this before it can leak a tally.
 *   2. A runtime reconciliation property: at every step of a mixed sim, each
 *      unit's `customersIn` / `hotelCustomersIn` / `outForMeal` equals the
 *      count of live people carrying the matching stamp. Any bypass, double
 *      decrement, or ghost increment shows up as drift.
 *
 * Also pins the state-at-arrival recheck (GH #360): a commercial venue that
 * vacated or burned between spawn and arrival takes no `customersIn++`,
 * mirroring the attendance branch's isOperational recheck.
 */

const CROWD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../engine/crowd");

function setClock(sim: Simulation, hour: number, day = 0): void {
  sim.clock = new Clock((day * 24 + hour) * 60, sim.clock.calendar);
}

/** Lobby, floors 2..6, one elevator spanning it all, a tenanted two-story
 *  party hall on 2 (occupying floors 2-3), a fast food and an office on 4,
 *  an occupied (asleep) hotel single on 5: every tally kind (attendance,
 *  census, outForMeal, and the hotel-origin split) is reachable in one
 *  fixture. Simulation seeds its RNG from the year argument, so every run
 *  of these must-happen searches is deterministic. */
function mixedTower(): Simulation {
  const sim = new Simulation(2024, "modern", "realWorld");
  sim.money = 10_000_000;
  sim.star = 1; // gate random fires out of multi-hour loops
  for (let x = 0; x < 40; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let f = 2; f <= 6; f++) {
    for (let x = 0; x < 40; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
  }
  expect(sim.tower.placeTransport("elevatorStandard", 36, 1, 6).ok).toBe(true);
  const hall = sim.tower.place("partyHall", 2, 0);
  expect(hall.ok).toBe(true);
  const food = sim.tower.place("fastFood", 4, 0);
  expect(food.ok).toBe(true);
  const office = sim.tower.place("office", 4, 18);
  expect(office.ok).toBe(true);
  const hotel = sim.tower.place("hotelSingle", 5, 0);
  expect(hotel.ok).toBe(true);
  for (const u of sim.tower.units) {
    if (u.kind === "partyHall" || u.kind === "fastFood") {
      u.state = "occupied";
    }
    if (u.kind === "office") {
      u.state = "occupied";
      u.occupants = 6;
    }
    if (u.kind === "hotelSingle") {
      u.state = "asleep";
      u.occupants = 1;
    }
  }
  return sim;
}

function liveWith(sim: Simulation, pick: (p: (typeof sim.crowd.people)[number]) => boolean): number {
  return sim.crowd.people.filter((p) => p.state !== "done" && pick(p)).length;
}

/** The runtime invariant: every tally equals its live-people count. */
function reconcile(sim: Simulation): void {
  for (const u of sim.tower.units) {
    expect(u.customersIn ?? 0, `customersIn drift on ${u.kind}#${u.id}`).toBe(
      liveWith(sim, (p) => p.venueUnitId === u.id),
    );
    expect(u.hotelCustomersIn ?? 0, `hotelCustomersIn drift on ${u.kind}#${u.id}`).toBe(
      liveWith(sim, (p) => p.venueUnitId === u.id && p.countedHotelGuest === true),
    );
    expect(u.outForMeal ?? 0, `outForMeal drift on ${u.kind}#${u.id}`).toBe(
      liveWith(sim, (p) => p.originUnitId === u.id),
    );
  }
}

describe("attendance tally tripwire", () => {
  it("the only crowd despawn is finish(): one state = done assignment, inside finish", () => {
    // Every crowd module is enumerated (plus Crowd.ts, the spawn owner one
    // level up), so a future module cannot host a despawn shortcut the
    // tripwire never reads. The pattern covers the assignment form and the
    // object-literal / bracket forms; a despawn that never assigns the state
    // at all (splicing crowd.people directly) is the runtime reconciliation
    // property's job below.
    const files = readdirSync(CROWD_DIR)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => resolve(CROWD_DIR, f));
    files.push(resolve(CROWD_DIR, "../Crowd.ts"));
    const donePattern = /(?:\.state\s*=|\bstate\s*:|\["state"\]\s*=)\s*["'`]done["'`]/g;
    const assignments: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(donePattern)) {
        assignments.push(`${f.split("/").pop()}@${src.slice(0, m.index).split("\n").length}`);
      }
    }
    // Exactly one, and it lives inside finish()'s body in motion.ts. A new
    // despawn path must call finish(), never set the state directly: the
    // tally's single-drain invariant depends on it.
    expect(assignments, "route new despawn paths through finish(); see the standing rule").toHaveLength(1);
    expect(assignments[0]!, "the one done-write must live in motion.ts (finish)").toContain("motion.ts@");
    const motion = readFileSync(resolve(CROWD_DIR, "motion.ts"), "utf8");
    const finishStart = motion.indexOf("export function finish(");
    expect(finishStart, "finish() must exist in motion.ts under that exact name").toBeGreaterThan(-1);
    const nextExport = motion.indexOf("\nexport ", finishStart + 1);
    const finishBody = motion.slice(finishStart, nextExport === -1 ? undefined : nextExport);
    expect(finishBody).toContain('.state = "done"');
  });

  it("tallies reconcile against live people across a full mixed day", () => {
    const sim = mixedTower();
    // Lunch window through the evening attendance window: meal round trips,
    // office matinees, hotel mingles, and street visitors all fire.
    setClock(sim, 11);
    for (let m = 0; m < 480; m++) {
      sim.tick(1);
      if (m % 10 === 0) reconcile(sim);
    }
    setClock(sim, 18, 1);
    let sawAnyTally = false;
    for (let m = 0; m < 480; m++) {
      sim.tick(1);
      sawAnyTally ||= sim.tower.units.some((u) => (u.customersIn ?? 0) > 0);
      if (m % 10 === 0) reconcile(sim);
    }
    expect(sawAnyTally).toBe(true);
  });

  it("every tally drains to zero once the tower quiets down", () => {
    const sim = mixedTower();
    setClock(sim, 18);
    let peak = 0;
    for (let m = 0; m < 420; m++) {
      sim.tick(1);
      peak = Math.max(peak, sim.tower.units.reduce((n, u) => n + (u.customersIn ?? 0), 0));
    }
    expect(peak).toBeGreaterThan(0);
    // The evening loop ends at 01:00, past every venue's close. Keep ticking
    // the quiet night (bounded well before the 06:00 breakfast window) until
    // the tower drains; the bound covers the worst give-up-ceiling case (a
    // last-minute arrival's full dwell plus a give-up-bounded return leg).
    const drained = () =>
      sim.tower.units.every(
        (u) => (u.customersIn ?? 0) === 0 && (u.hotelCustomersIn ?? 0) === 0 && (u.outForMeal ?? 0) === 0,
      );
    for (let m = 0; m < 290 && !drained(); m++) sim.tick(1);
    for (const u of sim.tower.units) {
      expect(u.customersIn ?? 0).toBe(0);
      expect(u.hotelCustomersIn ?? 0).toBe(0);
      expect(u.outForMeal ?? 0).toBe(0);
    }
    reconcile(sim);
  });

  it("mid-stay despawn paths keep the balance: bulldozed origin and severed return", () => {
    const sim = mixedTower();
    setClock(sim, 18);
    const hall = sim.tower.units.find((u) => u.kind === "partyHall" && u.floor === 2)!;
    const room = sim.tower.units.find((u) => u.kind === "hotelSingle")!;
    // Wait for a hotel-origin dweller counted at the hall, then bulldoze the
    // room: the ghost-origin path must still route through finish() and the
    // hall tally must drain without the room's outForMeal ever going negative.
    let sawMingle = false;
    // Capped at 02:00 next day so the drain below never rewinds the clock.
    for (let m = 0; m < 480 && !sawMingle; m++) {
      sim.tick(1);
      sawMingle = sim.crowd.people.some(
        (p) => p.originUnitId === room.id && p.venueUnitId === hall.id && p.state === "dwelling",
      );
    }
    expect(sawMingle).toBe(true);
    sim.tower.removeUnit(room.id);
    // Jump to the quiet night (02:00 is at or after every point the capped
    // search can reach, so the clock never rewinds). The hall is closed, so
    // no fresh attendee holds the tally up; the ghost-origin dwellers wind
    // down through finish() inside the bounded window, before breakfast.
    setClock(sim, 2, 1);
    for (let m = 0; m < 240 && (hall.customersIn ?? 0) > 0; m++) sim.tick(1);
    expect(hall.customersIn ?? 0).toBe(0);
    reconcile(sim);
  });
});

describe("state-at-arrival recheck (census venues)", () => {
  function arrivalFixture(): { sim: Simulation; venue: Unit } {
    const sim = mixedTower();
    setClock(sim, 12);
    const venue = sim.tower.units.find((u) => u.kind === "fastFood")!;
    return { sim, venue };
  }

  it("a venue that vacated between spawn and arrival takes no customer, and finish() stays balanced", () => {
    const { sim, venue } = arrivalFixture();
    const p = add(sim.crowd, sim.tower, 1, venue.floor)!;
    expect(p).toBeTruthy();
    p.mealVenueId = venue.id;
    venue.state = "empty"; // vacated while the person was en route
    beginDwell(sim.crowd, sim.tower, p);
    expect(venue.customersIn ?? 0).toBe(0);
    expect(p.venueUnitId).toBeUndefined();
    expect(p.state).toBe("dwelling");
    // The uncounted dweller's despawn must not decrement what was never
    // incremented: zero stays zero, never -1.
    finish(sim.crowd, p, sim.tower);
    expect(venue.customersIn ?? 0).toBe(0);
    expect(p.state).toBe("done");
  });

  it("a ticketed attendance venue that vacated mid-trip seats no counted audience", () => {
    const { sim } = arrivalFixture();
    const hall = sim.tower.units.find((u) => u.kind === "partyHall" && u.floor === 2)!;
    const p = add(sim.crowd, sim.tower, 1, hall.floor)!;
    expect(p).toBeTruthy();
    p.mealVenueId = hall.id;
    hall.state = "empty"; // the arrival gate repeats the spawn gate (isTenanted)
    beginDwell(sim.crowd, sim.tower, p);
    expect(hall.customersIn ?? 0).toBe(0);
    expect(hall.occupants).toBe(0); // the mirror never seats an audience in a vacant house
    expect(p.venueUnitId).toBeUndefined();
  });

  it("a venue that burned between spawn and arrival takes no customer", () => {
    const { sim, venue } = arrivalFixture();
    const p = add(sim.crowd, sim.tower, 1, venue.floor)!;
    expect(p).toBeTruthy();
    p.mealVenueId = venue.id;
    venue.state = "fire";
    beginDwell(sim.crowd, sim.tower, p);
    expect(venue.customersIn ?? 0).toBe(0);
    expect(p.venueUnitId).toBeUndefined();
  });

  it("a tenanted venue at arrival still counts (the recheck only blocks dead states)", () => {
    const { sim, venue } = arrivalFixture();
    const p = add(sim.crowd, sim.tower, 1, venue.floor)!;
    expect(p).toBeTruthy();
    p.mealVenueId = venue.id;
    beginDwell(sim.crowd, sim.tower, p);
    expect(venue.customersIn ?? 0).toBe(1);
    expect(p.venueUnitId).toBe(venue.id);
  });
});
