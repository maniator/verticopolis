import { expect, it } from "vitest";
import { catalogFacility } from "../../catalog/catalogTypes";
import { catalogFor } from "../catalogFixture";
import type { FacilityKind } from "../../shared/types";
import type { Person } from "../../shared/engineTypes";
import { PortSim, describeEngines, type Leg, draftTower } from "../portKit/portSim";

/** A facility's published facts (width, population, attendance), from the
 *  engine's Modern catalog; both modes state the same sizes. */
const facility = (kind: FacilityKind) => catalogFacility(catalogFor("modern"), kind);

/**
 * The two venue-capacity cases of `personRoundTrip.integration.test.ts` that
 * stamp a venue's live customer tally, on both engines. The tally is not in
 * the save, so each test sets it mid-run through `setCustomersIn` and reads it
 * back from the engine's unit card.
 */

/** One served office (6 workers) on floor 2 and a fastFood on floor 5, both
 *  occupied, loaded into the engine on `leg`. Returns the sim and the venue. */
function officeAndFastFood(leg: Leg): { sim: PortSim; ff: number } {
  const draft = draftTower(2024, "modern", "realWorld");
  draft.money = 1_000_000;
  draft.star = 1; // gate fires
  for (let x = 0; x < 40; x++) expect(draft.tower.place("lobby", 1, x).ok).toBe(true);
  for (let f = 2; f <= 5; f++) for (let x = 0; x < 40; x++) expect(draft.tower.place("floor", f, x).ok).toBe(true);
  expect(draft.tower.placeTransport("elevatorStandard", 4, 1, 5).ok).toBe(true);
  const office = draft.tower.place("office", 2, 10);
  const ff = draft.tower.place("fastFood", 5, 0);
  for (const r of [office, ff]) {
    expect(r.ok, `placed: ${r.reason}`).toBe(true);
    const u = draft.tower.units.find((x) => x.id === r.unitId)!;
    u.state = "occupied";
    u.occupants = 6; // full office headcount, so meal round-trippers spawn at once
  }
  return { sim: new PortSim(leg, draft), ff: ff.unitId! };
}

/** The venue's live customer tally as the engine reports it (none reads 0). */
function customersIn(sim: PortSim, id: number): number {
  const n = sim.unitCard(id).customersIn;
  return Number.isNaN(n) ? 0 : n;
}

describeEngines("venue customer capacity: the cap holds against a stamped-full venue", (leg: Leg) => {
  it("an en-route eater arriving at a just-filled venue eats uncounted (arrival clamp)", () => {
    const { sim, ff } = officeAndFastFood(leg);
    sim.setClock(12 * 60);
    const cap = facility("fastFood").population;
    // Wait for one meal round-tripper to be en route to the venue.
    let traveler: Person | undefined;
    for (let m = 0; m < 30 && !traveler; m++) {
      sim.tick(1);
      traveler = sim.people().find((p) => p.mealVenueId === ff && p.state !== "dwelling");
    }
    expect(traveler).toBeDefined();
    expect(customersIn(sim, ff), "nobody is counted at the venue before the stamp").toBe(0);
    // The venue fills while they travel (stamp the count at capacity, standing
    // in for other arrivals), so their arrival must NOT push past the cap.
    sim.setCustomersIn(ff, cap);
    let dwelt = false;
    for (let m = 0; m < 90 && !dwelt; m++) {
      sim.tick(1);
      expect(customersIn(sim, ff)).toBe(cap);
      const now = sim.people().find((p) => p.id === traveler!.id);
      expect(now, "the traveler stays in the crowd until they sit down").toBeDefined();
      traveler = now!;
      dwelt = traveler.state === "dwelling";
    }
    // They made it to the table and were never counted: venueUnitId unset
    // means finish() will not decrement either, so the balanced-accounting
    // contract holds around the clamp.
    expect(dwelt, "the traveler reached the venue and sat down").toBe(true);
    expect(traveler!.venueUnitId).toBeUndefined();
  });

  it("control: without the stamp, the same lunch sends diners who are counted at the venue", () => {
    // The two cases above and below assert an absence (no count, no trip); this
    // shows each engine does spawn meal trips to this venue and does set
    // venueUnitId on a counted arrival, so those absences are earned.
    const { sim, ff } = officeAndFastFood(leg);
    sim.setClock(12 * 60);
    let firstTripMinute: number | undefined;
    let sawCounted = false;
    for (let m = 0; m < 90 && !sawCounted; m++) {
      sim.tick(1);
      for (const p of sim.people()) {
        if (p.mealVenueId === ff) firstTripMinute ??= m;
        if (p.venueUnitId === ff) sawCounted = true;
      }
    }
    // The spawn-filter case watches 60 minutes, so a trip must spawn inside them.
    expect(firstTripMinute, "a meal trip to the venue spawned").toBeDefined();
    expect(firstTripMinute!, "within the spawn-filter case's 60-minute window").toBeLessThan(60);
    expect(sawCounted, "an arrival was counted at the venue").toBe(true);
    expect(customersIn(sim, ff)).toBeGreaterThan(0);
  });

  it("a full venue attracts no new meal trips (spawn-side filter)", () => {
    const { sim, ff } = officeAndFastFood(leg);
    const cap = facility("fastFood").population;
    sim.setCustomersIn(ff, cap); // full before lunch begins
    sim.setClock(12 * 60);
    for (let m = 0; m < 60; m++) {
      sim.tick(1);
      expect(customersIn(sim, ff), "the stamp holds, so the venue stays full").toBe(cap);
      expect(sim.people().some((p) => p.mealVenueId === ff)).toBe(false);
    }
  });
});

/** A tower of its own with an occupied party hall on floors 3 and 4 and an
 *  occupied fast food on floor 2. The hall keeps attendance, so a stamp
 *  mirrors into its occupants; the fast food keeps none. */
function withPartyHall(leg: Leg): { sim: PortSim; hall: number; ff: number } {
  const draft = draftTower(2024, "modern", "realWorld");
  draft.money = 1_000_000;
  for (let x = 0; x < 40; x++) expect(draft.tower.place("lobby", 1, x).ok).toBe(true);
  for (let f = 2; f <= 4; f++) for (let x = 0; x < 40; x++) expect(draft.tower.place("floor", f, x).ok).toBe(true);
  expect(draft.tower.placeTransport("elevatorStandard", 38, 1, 4).ok).toBe(true);
  const hall = draft.tower.place("partyHall", 3, 0);
  const ff = draft.tower.place("fastFood", 2, 0);
  for (const r of [hall, ff]) {
    expect(r.ok, `placed: ${r.reason}`).toBe(true);
    draft.tower.units.find((x) => x.id === r.unitId)!.state = "occupied";
  }
  return { sim: new PortSim(leg, draft), hall: hall.unitId!, ff: ff.unitId! };
}

/** A unit's live occupants as the engine's unit card reports them. A load
 *  re-derives an attendance venue's occupants from its unsaved tally, so the
 *  save would not show the mirror. */
function occupants(sim: PortSim, id: number): number {
  return sim.unitCard(id).occupants;
}

describeEngines("setCustomersIn: refusals and the attendance mirror", (leg: Leg) => {
  it("refuses an unknown unit and a count that is not a whole number from 0 to 2^53-1, changing nothing", () => {
    const { sim, ff } = withPartyHall(leg);
    sim.setCustomersIn(ff, 3);
    for (const [id, count] of [
      [9999, 1],
      [ff + 0.5, 1],
      [-1, 1],
      [Number.NaN, 1],
      [ff, -1],
      [ff, 2.5],
      [ff, Number.NaN],
      [ff, Number.POSITIVE_INFINITY],
      [ff, 2 ** 53],
    ] as const) {
      expect(() => sim.setCustomersIn(id, count), `${id} ${count}`).toThrow(/refused/);
      expect(customersIn(sim, ff), `${id} ${count} left the tally`).toBe(3);
    }
    // Both ends of the range are taken.
    sim.setCustomersIn(ff, 0);
    expect(customersIn(sim, ff)).toBe(0);
    sim.setCustomersIn(ff, Number.MAX_SAFE_INTEGER);
    expect(customersIn(sim, ff)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("mirrors the tally into an attendance venue's occupants, and leaves a plain venue's occupants alone", () => {
    const { sim, hall, ff } = withPartyHall(leg);
    expect(facility("partyHall").attendance, "the party hall keeps attendance").not.toBeNull();
    expect(facility("fastFood").attendance, "the fast food keeps none").toBeNull();
    const ffOccupants = occupants(sim, ff);
    sim.setCustomersIn(hall, 5);
    expect(customersIn(sim, hall)).toBe(5);
    expect(occupants(sim, hall), "the hall's occupants follow its tally").toBe(5);
    sim.setCustomersIn(ff, 4);
    expect(customersIn(sim, ff)).toBe(4);
    expect(occupants(sim, ff), "the fast food's occupants are not the tally").toBe(ffOccupants);
  });

  it("makes a later setup throw, since its reload from the save would drop the stamp", () => {
    const { sim, ff } = withPartyHall(leg);
    sim.setCustomersIn(ff, 3);
    expect(() => sim.setup(() => undefined)).toThrow(/drop an earlier setCustomersIn/);
    expect(customersIn(sim, ff), "the refused setup left the stamp").toBe(3);
  });
});
