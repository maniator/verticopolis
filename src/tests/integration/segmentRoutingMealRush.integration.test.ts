import { expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { FACILITIES } from "../../engine/facilities";
import type { Person } from "../../engine/crowd/person";
import { PortSim, describeEngines, type Leg } from "../portKit/portSim";

/**
 * Meal trips on a REACHABLE split floor (#647 fix round), on both engines.
 *
 * A floor whose BOTH runs reach the lobby, so a trip is legal, yet a naive path
 * could still alight on the wrong run and interpolate destX across the gap.
 * These pin that meal and return-leg trips route to the destination's OWN run
 * (no gap cross). The housekeeper and stranded-venue cases on the same kind of
 * floor are in `segmentRoutingReachable.integration.test.ts`.
 */

/** A split floor 2: LEFT run [0..24], RIGHT run [35..59], open gap [25..34]. The
 *  ground lobby is contiguous [0..59]. A standard elevator on EACH run links it to
 *  the lobby, so both runs reach the lobby but a person on one run can only cross
 *  to the other by riding down to the lobby and back up. `condoRun`/`venueRun`
 *  choose which run carries the meal origin and which the venue. */
const GAP_LO = 25;
const GAP_HI = 34;

/** A tower with a condo and a fast food on floor 2, both occupied. */
interface MealTower {
  sim: PortSim;
  condo: number;
  venue: number;
}

/** The draft's condo and venue, occupied, loaded into the engine on `leg`. */
function mealTower(leg: Leg, draft: Simulation, condoAt: number, venueAt: number): MealTower {
  const condoRes = draft.tower.place("condo", 2, condoAt);
  const venueRes = draft.tower.place("fastFood", 2, venueAt);
  expect(condoRes.ok, `condo placed: ${condoRes.reason}`).toBe(true);
  expect(venueRes.ok, `venue placed: ${venueRes.reason}`).toBe(true);
  const condo = draft.tower.units.find((u) => u.id === condoRes.unitId)!;
  const venue = draft.tower.units.find((u) => u.id === venueRes.unitId)!;
  // Occupy them: the condo houses meal-goers, the venue is open for business.
  condo.state = "occupied";
  condo.occupants = FACILITIES.condo.population;
  venue.state = "occupied";
  return { sim: new PortSim(leg, draft), condo: condo.id, venue: venue.id };
}

/** A draft with the lobby [0..59], money and the first star. */
function splitDraft(seed: number): Simulation {
  const draft = new Simulation(seed, "modern", "realWorld");
  draft.money = 5_000_000;
  draft.star = 1;
  for (let x = 0; x <= 59; x++) expect(draft.tower.place("lobby", 1, x).ok).toBe(true);
  return draft;
}

function reachableSplitSim(leg: Leg, condoRun: "left" | "right", venueRun: "left" | "right"): MealTower {
  const draft = splitDraft(4242);
  for (let x = 0; x <= 24; x++) expect(draft.tower.place("floor", 2, x).ok).toBe(true); // LEFT run
  for (let x = 35; x <= 59; x++) expect(draft.tower.place("floor", 2, x).ok).toBe(true); // RIGHT run
  // A passenger elevator inside each run, so both reach the lobby.
  expect(draft.tower.placeTransport("elevatorStandard", 0, 1, 2).ok).toBe(true); // LEFT
  expect(draft.tower.placeTransport("elevatorStandard", 56, 1, 2).ok).toBe(true); // RIGHT
  return mealTower(leg, draft, condoRun === "left" ? 6 : 38, venueRun === "left" ? 6 : 38);
}

/** Drive a lunch meal rush with real elevator dispatch (only `tick` moves the
 *  cars). The clock is pinned to lunch and occupancy re-forced each tick so the
 *  window never closes and the condo keeps sending diners. `onHour` fires once,
 *  on the first tick (the move from 07:00 into the 12:00 hour), and never after,
 *  so no hourly economy churn perturbs the rest of the run. Returns whether any person ever stood in
 *  the gap, plus a per-person visitor to inspect. */
function driveMealRush({ sim, condo, venue }: MealTower, ticks: number, visit: (p: Person) => void): boolean {
  let sawGap = false;
  for (let i = 0; i < ticks; i++) {
    sim.setUnitState(condo, "occupied", FACILITIES.condo.population);
    sim.setUnitState(venue, "occupied");
    sim.setClock(12 * 60); // pin lunch: dispatch + crowd only
    sim.tick(1);
    for (const p of sim.people()) {
      if (p.floor >= 2 && Math.round(p.x) >= GAP_LO && Math.round(p.x) <= GAP_HI) sawGap = true;
      visit(p);
    }
  }
  return sawGap;
}

describeEngines("reachable split floor: meal outbound routes to the venue's own run", (leg: Leg) => {
  it("a meal venue on the NON-representative (right) run draws routed diners, none in the gap", () => {
    const tower = reachableSplitSim(leg, "left", "right");
    let sawDinerAtRightVenue = false;
    let sawOutboundStuckOnLeft = false;
    const sawGap = driveMealRush(tower, 300, (p) => {
      if (p.mealVenueId !== tower.venue) return;
      // A genuinely routed patron: DWELLING at this venue, standing on the venue's
      // own RIGHT run (x >= 35), reached by riding down and back up, not teleported.
      if (p.state === "dwelling" && p.floor === 2 && Math.round(p.x) >= 35) sawDinerAtRightVenue = true;
      // The bug: an OUTBOUND diner that routed to the floor's representative (left)
      // run and then tried to slide destX to the right venue would end its stroll
      // stuck on the LEFT run. With the fix the outbound leg lands on the venue's
      // own run, so no non-returning diner ever strolls the venue floor's left run.
      if (!p.returning && p.state === "toDest" && p.floor === 2 && Math.round(p.x) <= 24) {
        sawOutboundStuckOnLeft = true;
      }
    });
    expect(sawGap, "no person ever stands in the gap columns").toBe(false);
    expect(sawDinerAtRightVenue, "the right-run venue drew a routed diner onto its own run").toBe(true);
    expect(sawOutboundStuckOnLeft, "no outbound diner strolls the wrong (left) run toward the venue").toBe(false);
  });
});

describeEngines("reachable split floor: a diner spawns on its origin run, never boards across the gap", (leg: Leg) => {
  it("a left-run condo's diners (venue also left) never appear on the right run", () => {
    // Both the condo and its venue sit on the LEFT run, so a left-run diner has no
    // legitimate business on the RIGHT run at any point of the trip. Before the
    // sprite-origin fix, `makePerson` placed the figure at a whole-floor `pickX`
    // tile, so ~half the diners spawned on the RIGHT run, were edge-clamped by the
    // walk guard at x=35, and boarded the LEFT elevator from across the gap: a
    // board-teleport the plain gap-column check ([25..34]) never catches. This pins
    // that every meal-goer stays on its origin run (x <= 24) while on floor 2.
    // A WIDE left run [0..39] holds both the condo and its (width-16) food venue;
    // gap [40..49]; a separate right run [50..59]. So a diner wrongly placed at a
    // whole-floor `pickX` tile could land on the right run (x >= 50).
    const draft = splitDraft(4242);
    for (let x = 0; x <= 39; x++) expect(draft.tower.place("floor", 2, x).ok).toBe(true); // LEFT run
    for (let x = 50; x <= 59; x++) expect(draft.tower.place("floor", 2, x).ok).toBe(true); // RIGHT run
    expect(draft.tower.placeTransport("elevatorStandard", 38, 1, 2).ok).toBe(true); // LEFT
    expect(draft.tower.placeTransport("elevatorStandard", 52, 1, 2).ok).toBe(true); // RIGHT
    const tower = mealTower(leg, draft, 2, 20); // condo LEFT [2..17], venue LEFT [20..35]

    let sawDiner = false;
    let sawDinerOnRightRun = false;
    driveMealRush(tower, 300, (p) => {
      if (p.mealVenueId !== tower.venue) return;
      sawDiner = true;
      if (p.floor === 2 && Math.round(p.x) >= 50) sawDinerOnRightRun = true;
    });
    expect(sawDiner, "the left-run venue actually drew diners (test is non-vacuous)").toBe(true);
    expect(sawDinerOnRightRun, "no left-run diner ever appears on the right run").toBe(false);
  });
});

describeEngines("reachable split floor: return leg lands on the tenant's own run", (leg: Leg) => {
  it("a right-run tenant rides out and returns to the right run without crossing the gap", () => {
    const tower = reachableSplitSim(leg, "right", "left");
    let sawReturnOnRightRun = false;
    let sawReturnStuckOnLeft = false;
    const sawGap = driveMealRush(tower, 400, (p) => {
      if (!(p.returning && p.originUnitId === tower.condo)) return;
      // Home again on the right run: the return leg routed to the tenant's own
      // segment, never across the gap.
      if (p.state === "toDest" && p.floor === 2 && Math.round(p.x) >= 35) sawReturnOnRightRun = true;
      // The bug: a return routed to the floor's representative (left) run would
      // land the tenant on the wrong run, stranding them away from home. With the
      // fix the return leg reaches the origin's own run, so a returning right-run
      // tenant never ends its stroll on the left run.
      if (p.state === "toDest" && p.floor === 2 && Math.round(p.x) <= 24) sawReturnStuckOnLeft = true;
    });
    expect(sawGap, "no person ever stands in the gap columns").toBe(false);
    expect(sawReturnOnRightRun, "a right-run tenant returned to its own run").toBe(true);
    expect(sawReturnStuckOnLeft, "no returning right-run tenant ends up stranded on the left run").toBe(false);
  });
});
