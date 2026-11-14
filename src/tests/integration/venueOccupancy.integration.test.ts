import { describe, it, expect } from "vitest";
import { catalogFacility } from "../../catalog/catalogTypes";
import { catalogFor } from "../catalogFixture";
import type { FacilityKind } from "../../shared/types";
import { PortSim, describeEngines, type Leg, type Draft, draftTower } from "../portKit/portSim";

/** A facility's published facts (width, population, attendance), from the
 *  engine's Modern catalog; both modes state the same sizes. */
const facility = (kind: FacilityKind) => catalogFacility(catalogFor("modern"), kind);

/**
 * Guards commercial venue occupant behavior:
 *   - A meal venue's occupants (fast food, restaurant, food hall) are the
 *     customers inside it (`customersIn`), the people who walked in and have
 *     not left, so the room draws the people who are really there. An open
 *     one nobody has reached shows 0.
 *   - A retail shop gets no visitor trips yet, so while open it draws its
 *     full population; otherwise it would draw empty all day.
 *   - A venue with nobody inside shows 0 outside its open hours too.
 *   - Population values (the most customers a venue holds) scale with
 *     footprint: shop 20, fastFood 25, restaurant 35.
 */

function setHour(sim: Draft, hour: number): void {
  // Use 1 minute past midnight for hour 0 (Math.floor(1/60) = 0), as the
  // TypeScript clock needed. Do not call with hour=0 expecting midnight and
  // then tick to hour 1: call setHour(sim, 23) and triggerHour() instead to
  // cross the 23->0 boundary.
  sim.clock.minutes = hour * 60 || 1;
}

/** Build a minimal tower with a single tenanted commercial venue on a draft. */
function venueDraft(kind: "fastFood" | "restaurant" | "shop"): { draft: Draft; id: number } {
  const draft = draftTower(2024, "classic", "realWorld");
  draft.money = 5_000_000;
  for (let x = 0; x < 40; x++) draft.tower.place("lobby", 1, x);
  for (let f = 2; f <= 5; f++) for (let x = 0; x < 40; x++) draft.tower.place("floor", f, x);
  const shaft = draft.tower.placeTransport("elevatorStandard", 4, 1, 5);
  expect(shaft.ok, shaft.reason).toBe(true);
  const result = draft.tower.place(kind, 3, 0);
  expect(result.ok, result.reason).toBe(true);
  draft.tower.units.find((u) => u.id === result.unitId)!.state = "occupied";
  return { draft, id: result.unitId! };
}

/** The venue on `leg` with the clock set to `hour` before the engine loads it.
 *  The draft is the fixture's authoring copy; the engine starts from its save,
 *  so the first hour it steps into fires onHour. `edit` changes the draft's
 *  venue first. `venue()` reads the venue as the engine holds it, and
 *  `triggerHour()` advances one hour so onHour/updatePresence fires. */
function venueFixture(leg: Leg, kind: "fastFood" | "restaurant" | "shop", hour: number, edit?: (draft: Draft, id: number) => void) {
  const { draft, id } = venueDraft(kind);
  edit?.(draft, id);
  setHour(draft, hour);
  const sim = new PortSim(leg, draft);
  const venue = () => sim.state.tower.units.find((u) => u.id === id)!;
  // The live customer tally lives outside the state view; the room card reads it.
  const customers = () => {
    const n = sim.unitCard(id).customersIn;
    return Number.isNaN(n) ? 0 : n;
  };
  // A venue that counts its visitors leaves its head count out of the save,
  // so the head count is read from the room card too.
  const occupants = () => sim.unitCard(id).occupants;
  return { sim, venue, customers, occupants, triggerHour: () => sim.tick(60) };
}

// ---- Population values match footprint ----------------------------------------

describe("commercial venue population values scale with footprint", () => {
  it("shop has population 20", () => {
    expect(facility("shop").population).toBe(20);
  });

  it("fastFood has population 25", () => {
    expect(facility("fastFood").population).toBe(25);
  });

  it("restaurant has population 35", () => {
    expect(facility("restaurant").population).toBe(35);
  });

  it("all three are positive (gate for census inclusion)", () => {
    expect(facility("shop").population).toBeGreaterThan(0);
    expect(facility("fastFood").population).toBeGreaterThan(0);
    expect(facility("restaurant").population).toBeGreaterThan(0);
  });
});

// ---- Occupants during open hours ----------------------------------------------

describeEngines("an open venue's occupants are the customers inside it", (leg: Leg) => {
  it("fast food is open at 12:00 and shows its customers, not its population", () => {
    const { sim, venue, customers, triggerHour, occupants } = venueFixture(leg, "fastFood", 11); // positioned just before target
    sim.setCustomersIn(venue().id, 3);
    triggerHour(); // fires onHour -> updatePresence at hour 12
    expect(occupants()).toBeGreaterThan(0);
    expect(occupants()).toBe(customers());
    expect(occupants()).toBeLessThan(facility("fastFood").population);
  });

  it("restaurant open at 12:00 (lunch window) with nobody inside shows 0", () => {
    const { customers, triggerHour, occupants } = venueFixture(leg, "restaurant", 11);
    triggerHour();
    expect(occupants()).toBe(customers());
  });

  it("a shop, which no trip is sent to yet, draws its full population at 14:00", () => {
    const { sim, venue, customers, triggerHour, occupants } = venueFixture(leg, "shop", 13);
    sim.setCustomersIn(venue().id, 2);
    triggerHour();
    expect(customers()).toBe(2);
    expect(occupants()).toBe(facility("shop").population);
  });
});

// ---- Occupants while closed ---------------------------------------------------

describeEngines("occupants is 0 while venue is closed, even when tenanted", (leg: Leg) => {
  it("fast food is closed at 4:00 (before 7am open)", () => {
    const { triggerHour, occupants } = venueFixture(leg, "fastFood", 3);
    triggerHour();
    expect(occupants()).toBe(0);
  });

  it("restaurant is closed at 9:00 (between lunch and dinner windows)", () => {
    const { triggerHour, occupants } = venueFixture(leg, "restaurant", 8);
    triggerHour();
    expect(occupants()).toBe(0);
  });

  it("shop is closed at 22:00 (after 21:00 close)", () => {
    const { triggerHour, occupants } = venueFixture(leg, "shop", 21);
    triggerHour();
    expect(occupants()).toBe(0);
  });

  it("a closed fast food still draws the diners finishing a meal inside", () => {
    const { sim, venue, customers, occupants, triggerHour } = venueFixture(leg, "fastFood", 3);
    sim.setCustomersIn(venue().id, 2);
    triggerHour(); // 4:00, closed
    expect(customers()).toBe(2);
    expect(occupants()).toBe(2);
  });

  it("a tenanted-but-closed venue shows 0, not its population", () => {
    // Restaurant is only open 11-14 and 17-23; confirm zero at 3am.
    const { venue, triggerHour, occupants } = venueFixture(leg, "restaurant", 2);
    expect(venue().state).toBe("occupied");
    triggerHour();
    expect(occupants()).toBe(0);
  });
});

// ---- Transition at boundary ---------------------------------------------------

describeEngines("occupants follow the customers across the open and close hours", (leg: Leg) => {
  it("fast food shows its customers at 21:00, nobody after closing, and nobody at its 7:00 opening", () => {
    const { sim, venue, customers, triggerHour, occupants } = venueFixture(leg, "fastFood", 20);
    sim.setCustomersIn(venue().id, 4);
    triggerHour(); // now at hour 21
    expect(occupants()).toBe(customers());

    // Past close: the customers leave and the room empties with them.
    sim.setCustomersIn(venue().id, 0);
    triggerHour();
    expect(occupants()).toBe(0);

    // Re-open at 7:00: the room opens empty; nobody appears until someone walks in.
    sim.tick(8 * 60);
    expect(sim.state.clock.hour).toBe(6);
    triggerHour(); // now at hour 7
    expect(occupants()).toBe(customers());
    expect(occupants()).toBeLessThan(facility("fastFood").population);
  });
});

// Still on the TypeScript Simulation: it writes `customersIn` between two reads,
// and a save does not carry live customers, so it needs a tooling-only write on
// the engine before it can run through the port kit.
describeEngines("v2 spatial congestion reads live customers, never the commercial catalog value", (leg: Leg) => {
  it("an occupied fastFood with no customers adds zero floor congestion; live customers add pressure", () => {
    const draft = draftTower(2024, "modern", "realWorld");
    draft.money = 1_000_000;
    for (let x = 0; x < 40; x++) draft.tower.place("lobby", 1, x);
    for (let x = 0; x < 40; x++) draft.tower.place("floor", 2, x);
    const r = draft.tower.place("fastFood", 2, 0);
    draft.tower.getUnit(r.unitId!)!.state = "occupied";
    // A single weak shaft so the floor is served (unserved floors are skipped
    // by the spatial model) and 25 riders visibly stress it.
    const shaft = draft.tower.placeTransport("elevatorStandard", 30, 1, 2);
    draft.tower.setCars(shaft.transportId!, 1);
    setHour(draft, 12);
    const sim = new PortSim(leg, draft);
    // No live customers: the venue must not stress floor 2 with its catalog 25.
    // The pre-fix code summed residentCount for every present unit, so a lone
    // occupied fastFood faked a full elevator load around the clock.
    expect(sim.floorCongestion(2)).toBe(0);
    sim.setCustomersIn(r.unitId!, 25);
    expect(sim.floorCongestion(2)).toBeGreaterThan(0);
  });
});

describeEngines("a venue's first open hour", (leg: Leg) => {
  it("an empty (never-visited) fast food opens in the hour traffic first reaches it, with no stand-in crowd", () => {
    // updatePresence runs before collectTrafficIncome inside one onHour; the
    // economy flips the venue occupied at its first open hour. A meal venue
    // draws the customers inside it, and nobody has arrived yet.
    const { venue, customers, triggerHour, occupants } = venueFixture(leg, "fastFood", 6, (draft, id) => {
      const unit = draft.tower.units.find((u) => u.id === id)!;
      unit.state = "empty";
      unit.occupants = 0;
    }); // fast food opens at 7
    triggerHour(); // crosses into 7:00: traffic flips it occupied
    expect(venue().state).toBe("occupied");
    expect(occupants()).toBe(customers());
    expect(occupants()).toBeLessThan(facility("fastFood").population);
  });

  it("an empty (never-visited) shop is lit in the same hour traffic first opens it", () => {
    // No trip goes to a shop yet, so the economy stamps its full population
    // at the empty-to-occupied flip rather than leave it dark all hour.
    const { venue, triggerHour, occupants } = venueFixture(leg, "shop", 9, (draft, id) => {
      const unit = draft.tower.units.find((u) => u.id === id)!;
      unit.state = "empty";
      unit.occupants = 0;
    }); // shop opens at 10
    triggerHour(); // crosses into 10:00: traffic flips it occupied
    expect(venue().state).toBe("occupied");
    expect(occupants()).toBe(facility("shop").population);
  });
});
