import { describe, it, expect } from "vitest";
import { html } from "lit-html";
import { Simulation } from "../../engine/Simulation";
import { dominantGripe, vacateCause, unmetCoverage } from "../../engine/sim/gripe";
import type { DemandMap } from "../../engine/sim/demand";
import { GRID } from "../../engine/facilities";
import type { FacilityKind, Unit } from "../../engine/types";
import { facilityDiagnostics } from "../../game/facilityDiagnostics";
import { renderToFragment } from "../../ui/testing/litTestUtils";

/**
 * The pre-notice "Main gripe" inspector line and its engine read model
 * `dominantGripe`, which shares its attribution ladder with `vacateCause`
 * (vacateCause is dominantGripe with an "access" catch-all), so the two can
 * never disagree on which cause wins.
 */

const C = Math.floor(GRID.width / 2);

/** Assert a place/build/transport call actually succeeded, surfacing its
 *  `reason` on failure so a fixture never silently builds a different tower
 *  than the scenario describes (AGENTS.md fixture-construction rule). */
function expectOk<T extends { ok: boolean; reason?: string }>(r: T): T {
  expect(r.ok, r.reason).toBe(true);
  return r;
}

/** Lay a full floor of `kind`, building outward from the center so every tile
 *  is adjacent to an already-placed one (the connectivity order the tower
 *  requires). Tiles the new-game seed already laid as this kind are skipped
 *  (re-placing would fail "Structure already here"); every genuine placement
 *  is asserted. */
function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  const put = (x: number): void => {
    if (sim.tower.structureKindAt(floor, x) === kind) return;
    expectOk(sim.tower.place(kind, floor, x));
  };
  for (let x = C; x < GRID.width; x++) put(x);
  for (let x = C - 1; x >= 0; x--) put(x);
}

/** Place a unit, assert its construction, and return the live Unit. */
function placeUnit(sim: Simulation, kind: FacilityKind, floor: number, x: number): Unit {
  const r = expectOk(sim.tower.place(kind, floor, x));
  const unit = sim.tower.units.find((u) => u.id === r.unitId);
  expect(unit, `no unit for placed ${kind} at floor ${floor}, x ${x}`).toBeDefined();
  return unit!;
}

/** An occupied office on floor 2, served by an elevator and sitting near it
 *  (so it is not transport-far), with default rent and no noisy neighbor: a
 *  content tenant with nothing dragging it down until the test perturbs it. */
function servedOffice(sim: Simulation): Unit {
  sim.money = 1e9;
  sim.star = 1; // no random fire/bomb events to perturb the run
  lay(sim, "lobby", 1);
  lay(sim, "floor", 2);
  expectOk(sim.buildTransport("elevatorStandard", C, 1, 2));
  const office = placeUnit(sim, "office", 2, C - 12);
  office.state = "occupied";
  office.satisfaction = 1;
  return office;
}

/** Rendered text of a unit's diagnostics lines. */
function diagText(sim: Simulation, u: Unit): string {
  return renderToFragment(html`<div>${facilityDiagnostics(sim, u)}</div>`).textContent ?? "";
}

describe("dominantGripe (the pre-notice main gripe)", () => {
  it("returns null for a content, served, uncongested tenant", () => {
    const sim = Simulation.newGame(1);
    const office = servedOffice(sim);
    expect(sim.dominantGripe(office)).toBeNull();
    // vacateCause still resolves the same state to its "access" catch-all.
    expect(sim.vacateCause(office, sim.tower.isFloorServed(office.floor), sim.congestionAt(office.floor))).toBe("access");
  });

  it("returns access for an unserved tenant, matching vacateCause", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1e9;
    sim.star = 1;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    // No transport built: floor 2 is not served.
    const office = placeUnit(sim, "office", 2, C);
    office.state = "occupied";
    expect(sim.tower.isFloorServed(2)).toBe(false);
    expect(sim.dominantGripe(office)).toBe("access");
    expect(sim.vacateCause(office, false, 0)).toBe("access");
  });

  it("returns rent for a served office priced above the going rate", () => {
    const sim = Simulation.newGame(1);
    const office = servedOffice(sim);
    office.rent = 20_000; // office default is 10,000
    expect(sim.dominantGripe(office)).toBe("rent");
    expect(sim.vacateCause(office, true, 0)).toBe("rent");
  });

  it("returns congestion for a served tenant on a crowded floor (above rent/noise)", () => {
    const sim = Simulation.newGame(1);
    const office = servedOffice(sim);
    office.rent = 20_000; // an over-market rent that congestion must outrank
    // The engine passes the congestion ratio it already computed this tick; a
    // ratio above 1.0 is the crowded-elevator drain, harsher than everything but
    // an unreachable floor, so it wins over the over-market rent below it.
    expect(dominantGripe(sim, office, true, 2)).toBe("congestion");
    expect(vacateCause(sim, office, true, 2)).toBe("congestion");
  });

  it("returns noise for a served, uncongested condo beside an office", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1e9;
    sim.star = 1;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 2));
    // An office and a condo a few tiles apart on the same served floor: the
    // office noise carries across the built floor into the condo's 21-tile band.
    expectOk(sim.tower.place("office", 2, C - 12));
    const condo = placeUnit(sim, "condo", 2, C + 4);
    condo.state = "occupied";
    condo.satisfaction = 0.5; // unhappy but not yet on notice
    expect(sim.noiseAfflicted(condo)).toBe(true);
    expect(sim.dominantGripe(condo)).toBe("noise");
    const text = diagText(sim, condo);
    expect(text).toContain("Main gripe:");
    expect(text).toContain("noisy neighbor");
  });
});

describe("the Main gripe inspector line", () => {
  it("names an unhappy tenant's dominant drain (rent) before any notice", () => {
    const sim = Simulation.newGame(1);
    const office = servedOffice(sim);
    office.rent = 20_000;
    office.satisfaction = 0.5; // unhappy but not yet on notice
    const text = diagText(sim, office);
    expect(text).toContain("Main gripe:");
    expect(text).toContain("rent is above the going rate");
  });

  it("stays silent for a content tenant (satisfaction above the annoyance ceiling)", () => {
    const sim = Simulation.newGame(1);
    const office = servedOffice(sim); // satisfaction 1, default rent
    expect(diagText(sim, office)).not.toContain("Main gripe:");
  });

  it("defers to the dedicated long-walk line for transportFar (no duplicate Main gripe)", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1e9;
    sim.star = 1;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    // Shaft mid-lot, office at the far right: the floor is served but the
    // office's nearest shaft sits well past the walk tolerance (W1).
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 2));
    const office = placeUnit(sim, "office", 2, GRID.width - 12);
    office.state = "occupied";
    office.satisfaction = 0.5;
    expect(sim.dominantGripe(office)).toBe("transportFar");
    const text = diagText(sim, office);
    // The far walk has its own always-on line; the Main gripe line does not repeat it.
    expect(text).toContain("Long walk to transport");
    expect(text).not.toContain("Main gripe:");
  });

  it("defers to the dedicated line for access (no duplicate Main gripe)", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1e9;
    sim.star = 1;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    const office = placeUnit(sim, "office", 2, C);
    office.state = "occupied";
    office.satisfaction = 0.5;
    const text = diagText(sim, office);
    // Access has its own actionable line; the Main gripe line does not repeat it.
    expect(text).toContain("Access:");
    expect(text).not.toContain("Main gripe:");
  });
});

/** A minimal DemandMap for the pure coverage read. `unmetCoverage` reads the
 *  per-origin reachable-venue count, `share`, and whether ANY retail is BUILT in
 *  the tower (`retailVenueCount`, reachable or not). `venueCount` seeds the
 *  REACHABLE venues in `fractionByUnit`; `retailVenueCount` defaults to it but can
 *  be set higher to model retail that is built yet unreachable (all on stranded
 *  floors), where `fractionByUnit` is empty but the tower still has shops. */
function fakeDemand(
  share: number,
  entries: [number, number][],
  venueCount = share > 0 ? 1 : 0,
  retailVenueCount = venueCount,
): DemandMap {
  const fractionByUnit = new Map<number, number>();
  for (let i = 0; i < venueCount; i++) fractionByUnit.set(1000 + i, Math.min(1, share));
  return {
    fractionByUnit,
    deliveredByUnit: new Map(),
    reachableVenuesByOrigin: new Map(entries),
    share,
    retailVenueCount,
  };
}

describe("unmetCoverage (#395 retail-coverage read)", () => {
  const u = { id: 1 } as unknown as Unit;

  it("exempts a unit that is not a counted demand origin this tick", () => {
    expect(unmetCoverage(fakeDemand(2, []), u)).toBeNull();
  });

  it("exempts a tower with no retail built at all (share 0), even for a counted origin", () => {
    // An office building with no shops is the baseline, not an unmet-demand problem.
    expect(unmetCoverage(fakeDemand(0, [[1, 0]]), u)).toBeNull();
  });

  it("reads 0 coverage when retail exists in the tower but this origin can reach none", () => {
    expect(unmetCoverage(fakeDemand(1.5, [[1, 0]]), u)).toBe(0);
  });

  it("reads 0 (not exempt) for a stranded origin when retail exists but the demand pool is empty", () => {
    // share is 0 here because the pool is empty (every origin stranded), NOT because
    // there is no retail: the tower has one reachable venue, so a stranded tenant
    // that can reach none is under-served (coverage 0), not exempt.
    expect(unmetCoverage(fakeDemand(0, [[1, 0]], 1), u)).toBe(0);
  });

  it("reads 0 (not exempt) when the tower's retail is all unreachable (built but stranded)", () => {
    // A tower that HAS shops but leaves them all on stranded floors: `fractionByUnit`
    // is empty (no REACHABLE venue), yet `retailVenueCount` is 1, so a tenant that
    // can reach none is under-served (coverage 0), not the no-retail baseline. Keying
    // the exemption on the reachable count would have wrongly exempted this.
    expect(unmetCoverage(fakeDemand(0, [[1, 0]], 0, 1), u)).toBe(0);
  });

  it("reads full coverage when reachable capacity meets or beats demand", () => {
    expect(unmetCoverage(fakeDemand(0.4, [[1, 2]]), u)).toBe(1); // share < 1 → capped at 1
    expect(unmetCoverage(fakeDemand(1, [[1, 2]]), u)).toBe(1);
  });

  it("reads the shortfall (1 / share) when demand outstrips reachable capacity", () => {
    expect(unmetCoverage(fakeDemand(2, [[1, 3]]), u)).toBe(0.5);
    expect(unmetCoverage(fakeDemand(4, [[1, 3]]), u)).toBe(0.25);
  });
});
