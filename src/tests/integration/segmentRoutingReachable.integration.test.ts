import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { Tower } from "../../engine/Tower";
import { Crowd } from "../../engine/Crowd";
import { Clock } from "../../engine/Clock";
import { EconomySystem } from "../../engine/EconomySystem";
import { computeDemandMap } from "../../engine/sim/demand";
import { FACILITIES } from "../../engine/facilities";
import type { Unit } from "../../engine/types";
import type { Person } from "../../engine/Crowd";

/**
 * Segment routing on a REACHABLE split floor (#647 fix round).
 *
 * The stranded-segment cases live in `segmentRouting.integration.test.ts`. These
 * cover the harder case the reviewers flagged: a floor whose BOTH runs reach the
 * lobby, so a trip is legal, yet a naive path could still alight on the wrong run
 * and interpolate destX across the gap. They pin that meal, return-leg, and
 * housekeeper trips route to the destination's OWN run (no gap cross), that a
 * stranded venue on a partially-reachable split floor earns nothing, and that
 * shaft balancing never re-picks a rider onto a wing it cannot reach.
 */

/** A split floor 2: LEFT run [0..24], RIGHT run [35..59], open gap [25..34]. The
 *  ground lobby is contiguous [0..59]. A standard elevator on EACH run links it to
 *  the lobby, so both runs reach the lobby but a person on one run can only cross
 *  to the other by riding down to the lobby and back up. `condoRun`/`venueRun`
 *  choose which run carries the meal origin and which the venue. */
const GAP_LO = 25;
const GAP_HI = 34;

function reachableSplitSim(condoRun: "left" | "right", venueRun: "left" | "right"): {
  sim: Simulation;
  condo: Unit;
  venue: Unit;
} {
  const sim = new Simulation(4242, "modern", "realWorld");
  sim.money = 5_000_000;
  sim.star = 1;
  for (let x = 0; x <= 59; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let x = 0; x <= 24; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true); // LEFT run
  for (let x = 35; x <= 59; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true); // RIGHT run
  // A passenger elevator inside each run, so both reach the lobby.
  expect(sim.tower.placeTransport("elevatorStandard", 0, 1, 2).ok).toBe(true); // LEFT
  expect(sim.tower.placeTransport("elevatorStandard", 56, 1, 2).ok).toBe(true); // RIGHT
  const condoX = condoRun === "left" ? 6 : 38;
  const venueX = venueRun === "left" ? 6 : 38;
  const condoRes = sim.tower.place("condo", 2, condoX);
  const venueRes = sim.tower.place("fastFood", 2, venueX);
  expect(condoRes.ok, "condo placed").toBe(true);
  expect(venueRes.ok, "venue placed").toBe(true);
  const condo = sim.tower.units.find((u) => u.id === condoRes.unitId)!;
  const venue = sim.tower.units.find((u) => u.id === venueRes.unitId)!;
  // Occupy them: the condo houses meal-goers, the venue is open for business.
  condo.state = "occupied";
  condo.occupants = FACILITIES.condo.population;
  venue.state = "occupied";
  return { sim, condo, venue };
}

/** Drive a lunch meal rush with real elevator dispatch (only `sim.tick` moves the
 *  cars). The clock is pinned to lunch and occupancy re-forced each tick so the
 *  window never closes and the condo keeps sending diners; `onHour` never fires,
 *  so no economy churn perturbs the run. Returns whether any person ever stood in
 *  the gap, plus a per-person visitor to inspect. */
function driveMealRush(sim: Simulation, condo: Unit, venue: Unit, ticks: number, visit: (p: Person) => void): boolean {
  let sawGap = false;
  for (let i = 0; i < ticks; i++) {
    condo.state = "occupied";
    condo.occupants = FACILITIES.condo.population;
    venue.state = "occupied";
    sim.clock = new Clock(12 * 60, sim.clock.calendar); // pin lunch: dispatch + crowd only
    sim.tick(1);
    for (const p of sim.crowd.people) {
      if (p.floor >= 2 && Math.round(p.x) >= GAP_LO && Math.round(p.x) <= GAP_HI) sawGap = true;
      visit(p);
    }
  }
  return sawGap;
}

describe("reachable split floor: meal outbound routes to the venue's own run", () => {
  it("a meal venue on the NON-representative (right) run draws routed diners, none in the gap", () => {
    const { sim, condo, venue } = reachableSplitSim("left", "right");
    let sawDinerAtRightVenue = false;
    let sawOutboundStuckOnLeft = false;
    const sawGap = driveMealRush(sim, condo, venue, 300, (p) => {
      if (p.mealVenueId !== venue.id) return;
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

describe("reachable split floor: a diner spawns on its origin run, never boards across the gap", () => {
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
    const sim = new Simulation(4242, "modern", "realWorld");
    sim.money = 5_000_000;
    sim.star = 1;
    for (let x = 0; x <= 59; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let x = 0; x <= 39; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true); // LEFT run
    for (let x = 50; x <= 59; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true); // RIGHT run
    expect(sim.tower.placeTransport("elevatorStandard", 38, 1, 2).ok).toBe(true); // LEFT
    expect(sim.tower.placeTransport("elevatorStandard", 52, 1, 2).ok).toBe(true); // RIGHT
    const condoRes = sim.tower.place("condo", 2, 2); // LEFT run [2..17]
    const venueRes = sim.tower.place("fastFood", 2, 20); // LEFT run [20..35]
    expect(condoRes.ok && venueRes.ok).toBe(true);
    const condo = sim.tower.units.find((u) => u.id === condoRes.unitId)!;
    const venue = sim.tower.units.find((u) => u.id === venueRes.unitId)!;
    condo.state = "occupied";
    condo.occupants = FACILITIES.condo.population;
    venue.state = "occupied";

    let sawDiner = false;
    let sawDinerOnRightRun = false;
    driveMealRush(sim, condo, venue, 300, (p) => {
      if (p.mealVenueId !== venue.id) return;
      sawDiner = true;
      if (p.floor === 2 && Math.round(p.x) >= 50) sawDinerOnRightRun = true;
    });
    expect(sawDiner, "the left-run venue actually drew diners (test is non-vacuous)").toBe(true);
    expect(sawDinerOnRightRun, "no left-run diner ever appears on the right run").toBe(false);
  });
});

describe("reachable split floor: return leg lands on the tenant's own run", () => {
  it("a right-run tenant rides out and returns to the right run without crossing the gap", () => {
    const { sim, condo, venue } = reachableSplitSim("right", "left");
    let sawReturnOnRightRun = false;
    let sawReturnStuckOnLeft = false;
    const sawGap = driveMealRush(sim, condo, venue, 400, (p) => {
      if (!(p.returning && p.originUnitId === condo.id)) return;
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

describe("reachable split floor: housekeeper routes to the room's own run", () => {
  it("a maid sent to a room on the non-representative run never crosses the gap and finishes the job", () => {
    const sim = new Simulation(77, "modern", "realWorld");
    sim.money = 5_000_000;
    sim.star = 1;
    for (let x = 0; x <= 59; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let x = 0; x <= 24; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true); // LEFT
    for (let x = 35; x <= 59; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true); // RIGHT
    // Stairs on each run join the staff network, so both runs are staff-reachable
    // (the maid rides down to the lobby and back up, never across the gap).
    expect(sim.tower.placeTransport("stairs", 0, 1, 2).ok).toBe(true); // LEFT
    expect(sim.tower.placeTransport("stairs", 52, 1, 2).ok).toBe(true); // RIGHT
    const crewRes = sim.tower.place("housekeeping", 2, 10); // LEFT run, representative
    const roomRes = sim.tower.place("hotelSingle", 2, 40); // RIGHT run, non-representative
    expect(crewRes.ok, "crew placed").toBe(true);
    expect(roomRes.ok, "room placed").toBe(true);
    const crew = sim.tower.units.find((u) => u.id === crewRes.unitId)!;
    const room = sim.tower.units.find((u) => u.id === roomRes.unitId)!;

    // Dispatch a maid from the LEFT-run crew to the RIGHT-run room. The floor-only
    // route would alight on the leftmost (left) run and glide destX across the gap;
    // the fix routes to the room's own run.
    const sent = sim.crowd.spawnStaff(
      sim.tower,
      crew.floor,
      room.floor,
      room.x + room.width / 2,
      room.id,
      1, // one game-minute of cleaning
      crew.x + crew.width / 2,
    );
    expect(sent, "the maid was dispatched (a route to the room's run exists)").toBe("sent");

    let sawGap = false;
    let sawMaidOnRoomRun = false;
    let done: { unitId: number; ok: boolean } | undefined;
    for (let i = 0; i < 400 && !done; i++) {
      sim.crowd.advance(3, sim.tower);
      for (const p of sim.crowd.people) {
        if (!p.staff || p.floor < 2) continue;
        const col = Math.round(p.x);
        if (col >= GAP_LO && col <= GAP_HI) sawGap = true;
        // The maid actually made it onto the room's own RIGHT run (x >= 35). Without
        // the fix she alights on the leftmost run and clamps at the gap edge, so
        // she never reaches the right run even though the job still "reports done".
        if (col >= 35) sawMaidOnRoomRun = true;
      }
      const results = sim.crowd.takeStaffResults();
      done = results.find((r) => r.unitId === room.id);
    }
    expect(sawGap, "the maid never stands in the gap columns").toBe(false);
    expect(sawMaidOnRoomRun, "the maid routed onto the room's own run").toBe(true);
    expect(done, "the cleaning job reported a result").toBeDefined();
    expect(done!.ok, "the maid reached the room and the job completed").toBe(true);
  });
});

describe("partially-reachable split floor: a stranded venue earns nothing", () => {
  function strandedVenueSim(): { sim: Simulation; reachable: Unit; stranded: Unit } {
    const sim = new Simulation(9, "modern", "realWorld");
    sim.money = 5_000_000;
    sim.star = 1;
    for (let x = 0; x <= 59; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let x = 0; x <= 29; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true); // LEFT (reachable)
    for (let x = 40; x <= 59; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true); // RIGHT (stranded)
    // Only the LEFT run has an elevator; the RIGHT run has no transport at all, so
    // it is connected to nothing and no patron can reach it.
    expect(sim.tower.placeTransport("elevatorStandard", 0, 1, 2).ok).toBe(true);
    const officeRes = sim.tower.place("office", 2, 5); // LEFT origin, reachable
    const reachRes = sim.tower.place("shop", 2, 15); // LEFT venue, reachable
    const strandRes = sim.tower.place("shop", 2, 44); // RIGHT venue, stranded
    for (const r of [officeRes, reachRes, strandRes]) expect(r.ok).toBe(true);
    const office = sim.tower.units.find((u) => u.id === officeRes.unitId)!;
    const reachable = sim.tower.units.find((u) => u.id === reachRes.unitId)!;
    const stranded = sim.tower.units.find((u) => u.id === strandRes.unitId)!;
    office.state = "occupied";
    office.occupants = FACILITIES.office.population;
    reachable.state = "occupied";
    stranded.state = "occupied";
    return { sim, reachable, stranded };
  }

  it("the stranded run reads unreachable while its sibling run reads reachable", () => {
    const { sim, reachable, stranded } = strandedVenueSim();
    expect(sim.tower.isFloorServed(2), "the floor is connected (its left run is)").toBe(true);
    expect(sim.positionReachable(2, reachable.x)).toBe(true);
    expect(sim.positionReachable(2, stranded.x)).toBe(false);
  });

  it("only the reachable venue contributes to the demand pool", () => {
    const { sim, reachable, stranded } = strandedVenueSim();
    const map = computeDemandMap(sim);
    // Both are built retail, but only the reachable one earns a demand fraction.
    expect(map.retailVenueCount).toBe(2);
    expect(map.fractionByUnit.has(reachable.id), "reachable venue earns a demand fraction").toBe(true);
    expect((map.fractionByUnit.get(reachable.id) ?? 0) > 0).toBe(true);
    expect(map.fractionByUnit.has(stranded.id), "stranded venue earns nothing").toBe(false);
  });

  it("traffic income fills the reachable venue and leaves the stranded one empty", () => {
    const { sim, reachable, stranded } = strandedVenueSim();
    sim.clock = new Clock(12 * 60, sim.clock.calendar); // midday: both venues open
    new EconomySystem(sim).collectTrafficIncome();
    expect(reachable.occupants, "reachable venue draws patrons").toBeGreaterThan(0);
    expect(stranded.occupants, "stranded venue draws nobody").toBe(0);
  });
});

describe("split floor: shaft balancing never re-picks a rider onto an unreachable wing", () => {
  function twoWingTower(): { tower: Tower; leftEv: number; rightEv: number } {
    const tower = new Tower();
    for (let x = 0; x <= 49; x++) expect(tower.place("lobby", 1, x).ok).toBe(true); // contiguous lobby
    for (let x = 0; x <= 19; x++) expect(tower.place("floor", 2, x).ok).toBe(true); // LEFT run
    for (let x = 30; x <= 49; x++) expect(tower.place("floor", 2, x).ok).toBe(true); // RIGHT run
    // Two SAME-KIND elevators serving the SAME floor pair (1<->2), one per wing.
    // Under a floor-keyed bank they would collide and a rider could be re-picked
    // onto the far wing; the segment-keyed bank keeps them apart.
    expect(tower.placeTransport("elevatorStandard", 2, 1, 2).ok).toBe(true); // LEFT
    expect(tower.placeTransport("elevatorStandard", 42, 1, 2).ok).toBe(true); // RIGHT
    const leftEv = tower.transports.find((t) => t.x === 2)!.id;
    const rightEv = tower.transports.find((t) => t.x === 42)!.id;
    return { tower, leftEv, rightEv };
  }

  it("a rider bound for the left wing always boards the left shaft, and vice versa", () => {
    const { tower, leftEv, rightEv } = twoWingTower();
    const crowd = new Crowd();
    for (let i = 0; i < 60; i++) {
      // Lobby -> floor 2 LEFT run (x 4): must ride the LEFT elevator, never the far
      // RIGHT one it cannot walk to across the gap.
      const toLeft = crowd.route(tower, 1, 2, 25, 4);
      expect(toLeft, "left-run trip routes").not.toBeNull();
      expect(toLeft!.shafts).toEqual([leftEv]);
      // Lobby -> floor 2 RIGHT run (x 44): must ride the RIGHT elevator.
      const toRight = crowd.route(tower, 1, 2, 25, 44);
      expect(toRight, "right-run trip routes").not.toBeNull();
      expect(toRight!.shafts).toEqual([rightEv]);
    }
  });
});
