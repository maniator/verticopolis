import { expect, it } from "vitest";
import type { Person } from "../../shared/engineTypes";
import type { FacilityKind } from "../../shared/types";
import { PortSim, describeEngines, type Leg, draftTower } from "../portKit/portSim";
import { roomTallies } from "../portKit/rooms";

/**
 * The runtime half of the attendance-tally tripwire (GH #302) on both engines:
 * at every checked step of a mixed run, each room's `customersIn`,
 * `hotelCustomersIn` and `outForMeal` equals the count of live people carrying
 * the matching stamp, through the despawn-adjacent teardowns too (for the last
 * two, a value below 0 reads as 0; see `reconcile`). The source
 * tripwire and the arrival rechecks stay in
 * `attendanceTripwire.integration.test.ts`, which drives the TypeScript crowd
 * functions directly.
 *
 * `mixedTower` and `reconcile` mirror the copies in that file (whose
 * drain-to-zero case still uses them); change both together.
 *
 * The counters are not in the save, so they are read the way the game reads
 * them, from the engine's frame through the host's view reader, except
 * `customersIn`, which comes raw from the unit card so a negative tally shows
 * (see `roomTallies` for what the frame cannot show). The people come from the
 * engine's crowd view.
 */

const minutes = (hour: number, day = 0): number => (day * 24 + hour) * 60;

/** `demolish`'s second argument: bulldoze (as the originals' raw removals did)
 *  rather than sell. */
const BULLDOZE = true;

/** Lobby, floors 2..6, one elevator spanning it all, a tenanted two-story
 *  party hall on 2 (floors 2-3), a fast food and an office on 4, and an
 *  occupied (asleep) hotel single on 5: every tally kind (attendance, census,
 *  outForMeal and the hotel-origin split) is reachable in one fixture. */
function mixedTower(leg: Leg): PortSim {
  const draft = draftTower(2024, "modern", "realWorld");
  draft.money = 10_000_000;
  draft.star = 1; // gate random fires out of multi-hour loops
  for (let x = 0; x < 40; x++) expect(draft.tower.place("lobby", 1, x).ok).toBe(true);
  for (let f = 2; f <= 6; f++) {
    for (let x = 0; x < 40; x++) expect(draft.tower.place("floor", f, x).ok).toBe(true);
  }
  expect(draft.tower.placeTransport("elevatorStandard", 36, 1, 6).ok).toBe(true);
  for (const [kind, floor, x] of [["partyHall", 2, 0], ["fastFood", 4, 0], ["office", 4, 18], ["hotelSingle", 5, 0]] as const) {
    const r = draft.tower.place(kind, floor, x);
    expect(r.ok, `${kind} placed: ${r.reason}`).toBe(true);
  }
  for (const u of draft.tower.units) {
    if (u.kind === "partyHall" || u.kind === "fastFood") u.state = "occupied";
    if (u.kind === "office") {
      u.state = "occupied";
      u.occupants = 6;
    }
    if (u.kind === "hotelSingle") {
      u.state = "asleep";
      u.occupants = 1;
    }
  }
  return new PortSim(leg, draft);
}

function live(sim: PortSim): Person[] {
  return sim.people().filter((p) => p.state !== "done");
}

function liveWith(sim: PortSim, pick: (p: Person) => boolean): number {
  return live(sim).filter(pick).length;
}

/** A room's counters by id; fails the test, labeled, when the room is gone. */
function tallies(sim: PortSim, id: number) {
  const t = roomTallies(sim).find((r) => r.id === id);
  expect(t, `room #${id} in the frame`).toBeDefined();
  return t!;
}

/** The runtime invariant: every tally equals its live-people count.
 *  `hotelCustomersIn` and `outForMeal` read 0 at or below 0 through the frame,
 *  so a decrement of those two past 0 goes unseen here (#1819). */
function reconcile(sim: PortSim): void {
  const people = live(sim);
  const count = (pick: (p: Person) => boolean) => people.filter(pick).length;
  for (const r of roomTallies(sim)) {
    expect(r.customersIn, `customersIn drift on ${r.kind}#${r.id}`).toBe(count((p) => p.venueUnitId === r.id));
    expect(r.hotelCustomersIn, `hotelCustomersIn drift on ${r.kind}#${r.id}`).toBe(
      count((p) => p.venueUnitId === r.id && p.countedHotelGuest === true),
    );
    expect(r.outForMeal, `outForMeal drift on ${r.kind}#${r.id}`).toBe(count((p) => p.originUnitId === r.id));
  }
}

function unitOf(sim: PortSim, kind: FacilityKind, floor?: number) {
  const u = sim.state.tower.units.find((x) => x.kind === kind && (floor === undefined || x.floor === floor));
  expect(u, `the fixture's ${kind}`).toBeDefined();
  return u!;
}

describeEngines("attendance tally tripwire: tallies reconcile against live people", (leg: Leg) => {
  it("tallies reconcile against live people across a full mixed day", () => {
    const sim = mixedTower(leg);
    // Lunch window through the evening attendance window: meal round trips,
    // office matinees, hotel mingles, and street visitors all fire.
    let sawOutForMeal = false;
    let sawHotelSplit = false;
    sim.setClock(minutes(11));
    for (let m = 0; m < 480; m++) {
      sim.tick(1);
      if (m % 10 === 0) {
        // The pins read at the reconcile minutes, so a reconcile saw each move.
        const rooms = roomTallies(sim);
        sawOutForMeal ||= rooms.some((r) => r.outForMeal > 0);
        sawHotelSplit ||= rooms.some((r) => r.hotelCustomersIn > 0);
        reconcile(sim);
      }
    }
    sim.setClock(minutes(18, 1));
    let sawAnyTally = false;
    for (let m = 0; m < 480; m++) {
      sim.tick(1);
      sawAnyTally ||= roomTallies(sim).some((r) => r.customersIn > 0);
      if (m % 10 === 0) reconcile(sim);
    }
    expect(sawAnyTally).toBe(true);
    // All three counters moved, so those equalities are not 0 against 0 on a
    // field one engine leaves out: a hotel guest's lunch at the fast food
    // counts in its hotel split.
    expect(sawOutForMeal, "a tenant was out for a meal").toBe(true);
    expect(sawHotelSplit, "a hotel guest was counted at a venue").toBe(true);
    // The frame names every room the tower holds, so the reconcile walks
    // every unit the original did except the floor and lobby tiles, which no
    // person names as a venue or an origin (not checked here).
    const roomIds = roomTallies(sim).map((r) => r.id).sort((a, b) => a - b);
    const unitIds = sim.state.tower.units
      .filter((u) => u.kind !== "floor" && u.kind !== "lobby")
      .map((u) => u.id)
      .sort((a, b) => a - b);
    expect(roomIds).toEqual(unitIds);
  });

  it("mid-stay despawn paths keep the balance: bulldozed origin and severed return", () => {
    const sim = mixedTower(leg);
    sim.setClock(minutes(18));
    const hall = unitOf(sim, "partyHall", 2).id;
    const room = unitOf(sim, "hotelSingle").id;
    // Wait for a hotel-origin dweller counted at the hall, then bulldoze the
    // room: the ghost-origin path must still route through finish() and the
    // hall's customersIn must drain to 0 with its guests.
    let sawMingle = false;
    // Capped at 02:00 next day so the drain below never rewinds the clock.
    for (let m = 0; m < 480 && !sawMingle; m++) {
      sim.tick(1);
      sawMingle = sim.people().some((p) => p.originUnitId === room && p.venueUnitId === hall && p.state === "dwelling");
    }
    expect(sawMingle).toBe(true);
    // Balanced while the hotel-origin guest is counted at the hall, and the
    // instant their origin vanishes.
    reconcile(sim);
    expect(tallies(sim, room).outForMeal, "the room's guest is out").toBeGreaterThan(0);
    expect(sim.demolish(room, BULLDOZE), "the hotel room is bulldozed").toBe(true);
    reconcile(sim);
    // The bulldoze leaves its guests live, so the ghost-origin drain below has
    // someone to route through finish().
    expect(liveWith(sim, (p) => p.originUnitId === room), "ghost-origin guests survive the bulldoze").toBeGreaterThan(0);
    // Jump to the quiet night (02:00 is at or after every point the capped
    // search can reach, so the clock never rewinds). The hall is closed, so
    // no fresh attendee holds the tally up; the ghost-origin dwellers wind
    // down through finish() inside the bounded window, before breakfast.
    sim.setClock(minutes(2, 1));
    expect(tallies(sim, hall).customersIn, "the hall still holds counted guests to drain").toBeGreaterThan(0);
    for (let m = 0; m < 240 && tallies(sim, hall).customersIn > 0; m++) sim.tick(1);
    expect(tallies(sim, hall).customersIn).toBe(0);
    reconcile(sim);
  });
});

describeEngines("attendance tally tripwire: mid-visit teardown (issue #302 scenario walk)", (leg: Leg) => {
  it("bulldozing the venue mid-visit: the tally dies with the unit and a rebuilt unit takes no ghost decrement", () => {
    // Run the evening attendance window until the party hall holds counted
    // visitors who are still live people. The bound stops at 450 so the clock
    // jump to 02:00 day 1 below never moves the clock backward.
    const sim = mixedTower(leg);
    sim.setClock(minutes(18));
    const hall = unitOf(sim, "partyHall", 2);
    for (let m = 0; m < 450 && tallies(sim, hall.id).customersIn === 0; m++) sim.tick(1);
    expect(tallies(sim, hall.id).customersIn).toBeGreaterThan(0);
    // `venueUnitId` is stamped only when an arrival is counted and is cleared
    // by finish(), so this equality is exact: people still en route carry only
    // the `mealVenueId` intent.
    expect(liveWith(sim, (p) => p.venueUnitId === hall.id)).toBe(tallies(sim, hall.id).customersIn);

    expect(sim.demolish(hall.id, BULLDOZE), "the hall is bulldozed").toBe(true);
    expect(sim.state.tower.units.some((u) => u.id === hall.id)).toBe(false);
    // The surviving units stay balanced the instant the venue vanishes.
    reconcile(sim);
    // Rebuild on the hall's own tiles (same floor, same left edge). The lookup
    // by floor and x cannot match the fixture's other fastFood on floor 4, and
    // ids are monotonic, so the ghost visitors' venue stamp can never resolve
    // to the new unit.
    expect(sim.build("fastFood", hall.floor, hall.x).ok, "the fastFood is rebuilt on the hall's tiles").toBe(true);
    // The build command answers no id, so bind by the hall's own tiles: exactly
    // one unit stands there, and it is the new fastFood.
    const there = sim.state.tower.units.filter((u) => u.floor === hall.floor && u.x === hall.x && u.kind !== "floor");
    expect(there.map((u) => u.kind), "one rebuilt unit on the hall's tiles").toEqual(["fastFood"]);
    const fresh = there[0];
    expect(fresh!.id).not.toBe(hall.id);
    // Sever the return path too: bulldozing the only elevator while ghost
    // visitors are dwelling or riding forces the unreachable-return and
    // shaft-vanished despawn branches, which must also route through finish()
    // (a rider's seat is released and nothing decrements customersIn twice;
    // the other two read 0 below 0, see `roomTallies`).
    expect(sim.state.tower.transports, "the fixture's one elevator").toHaveLength(1);
    const shaft = sim.state.tower.transports[0]!;
    expect(sim.demolish(shaft.id, BULLDOZE), "the only elevator is bulldozed").toBe(true);
    expect(sim.state.tower.transports, "the elevator is gone").toHaveLength(0);
    expect(tallies(sim, fresh!.id), "the rebuilt unit survives the elevator's removal").toBeDefined();
    // Quiet night, before the 06:00 breakfast window: the ghost visitors drain
    // through finish() with no venue left to decrement. The rebuilt unit's
    // counters are watched EVERY tick, so even a transient ghost decrement of
    // customersIn (a dip to -1 later compensated) trips the guard. A dip in
    // hotelCustomersIn or outForMeal reads 0 through the frame (see
    // `roomTallies`), so for those two only a rise above 0 shows.
    sim.setClock(minutes(2, 1));
    expect(liveWith(sim, (p) => p.venueUnitId === hall.id), "ghost visitors are left to drain").toBeGreaterThan(0);
    let freshTouched = false;
    for (let m = 0; m < 220 && liveWith(sim, (p) => p.venueUnitId === hall.id) > 0; m++) {
      sim.tick(1);
      const t = tallies(sim, fresh!.id);
      freshTouched ||= t.customersIn !== 0 || t.hotelCustomersIn !== 0 || t.outForMeal !== 0;
    }
    expect(liveWith(sim, (p) => p.venueUnitId === hall.id)).toBe(0);
    expect(freshTouched, "the rebuilt unit's counters moved during the ghost drain").toBe(false);
    reconcile(sim);
  });

  it("a fire mid-visit guts the venue through the real event system without touching the tally", () => {
    // The same counted-attendee setup as above.
    const sim = mixedTower(leg);
    sim.setClock(minutes(18));
    const hallId = unitOf(sim, "partyHall", 2).id;
    const hall = () => unitOf(sim, "partyHall", 2);
    for (let m = 0; m < 450 && tallies(sim, hallId).customersIn === 0; m++) sim.tick(1);
    expect(tallies(sim, hallId).customersIn).toBeGreaterThan(0);
    expect(liveWith(sim, (p) => p.venueUnitId === hallId)).toBe(tallies(sim, hallId).customersIn);
    // Ignite the hall as the daily roll's outbreak does: the unit burns, the
    // event system's active set knows it, and the paid rescue is offered.
    // The original re-armed the blaze through the load path and set the
    // offer by hand; this is the engine's own outbreak on a chosen room.
    sim.startFireAt(hallId);
    expect(hall().state).toBe("fire");
    expect(sim.state.events.pending?.kind, "the rescue is offered").toBe("fireRescue");
    for (let m = 0; m < 30; m++) sim.tick(1);
    // Still balanced mid-blaze: the fire state never touches the tallies.
    expect(hall().state, "still ablaze before the rescue").toBe("fire");
    reconcile(sim);
    // End the blaze through the real paid-rescue path: accepting runs
    // extinguishAll, which guts every burning unit. The gut zeroes the
    // occupants mirror and the tenancy fields but must leave the tallies
    // alone; the counted visitors are still live people who drain through
    // finish().
    const countedAtGut = tallies(sim, hallId).customersIn;
    expect(countedAtGut).toBeGreaterThan(0);
    expect(sim.answerChoice(true), "the rescue is paid").toBe(true);
    expect(hall().state).toBe("gutted");
    expect(hall().occupants).toBe(0); // the gut zeroed the mirror
    expect(tallies(sim, hallId).customersIn).toBe(countedAtGut); // and never the tally
    reconcile(sim);
    // Drain on the gutted shell: every decrement is a finish() call, and the
    // occupants mirror must hold at 0 on the non-operational unit even as
    // each decrement resyncs it. Watched every tick. 02:00 day 1 is at or
    // after every minute the bounded search and the blaze can reach.
    sim.setClock(minutes(2, 1));
    let mirrorMoved = false;
    for (let m = 0; m < 240 && tallies(sim, hallId).customersIn > 0; m++) {
      sim.tick(1);
      mirrorMoved ||= hall().occupants !== 0;
    }
    expect(tallies(sim, hallId).customersIn).toBe(0);
    expect(mirrorMoved, "a gutted venue's occupants mirror must stay 0 through the drain").toBe(false);
    reconcile(sim);
  });

  it("startFireAt refuses a tile, a second outbreak and a burned-out room, changing nothing", () => {
    const sim = mixedTower(leg);
    const lobby = sim.state.tower.units.find((u) => u.kind === "lobby")!.id;
    const hall = unitOf(sim, "partyHall", 2).id;
    const food = unitOf(sim, "fastFood").id;
    const refused = (id: number, why: string) => {
      const before = sim.state.tower.units.map((u) => u.state);
      const pending = sim.state.events.pending;
      expect(() => sim.startFireAt(id), why).toThrow(/refused/);
      expect(sim.state.tower.units.map((u) => u.state), `${why}: no room changed`).toEqual(before);
      expect(sim.state.events.pending, `${why}: the choice is as it was`).toEqual(pending);
    };
    refused(lobby, "a lobby tile cannot catch fire");
    sim.startFireAt(hall);
    refused(food, "a fire already burns, with its offer pending");
    expect(sim.answerChoice(true), "the rescue is paid").toBe(true);
    expect(unitOf(sim, "partyHall", 2).state).toBe("gutted");
    refused(hall, "a gutted shell cannot re-ignite");
    // With the fire out and the choice answered, a new outbreak is taken.
    sim.startFireAt(food);
    expect(unitOf(sim, "fastFood").state).toBe("fire");
    // A declined offer clears the choice and leaves the fire burning, which
    // still refuses an outbreak on its own.
    expect(sim.answerChoice(false), "the rescue is declined").toBe(true);
    expect(sim.state.events.pending, "the offer is answered").toBeNull();
    expect(unitOf(sim, "fastFood").state).toBe("fire");
    // The office is a finished, unburned room, so only the burning fire refuses it.
    expect(unitOf(sim, "office").state).toBe("occupied");
    refused(unitOf(sim, "office").id, "a fire still burns with no choice pending");
  });
});
