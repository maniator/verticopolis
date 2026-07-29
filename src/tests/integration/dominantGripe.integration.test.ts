import { describe, it, expect } from "vitest";
import { html } from "lit-html";
import { Simulation, TRANSPORT_FAR_TILES } from "../../engine/Simulation";
import { dominantGripe, vacateCause, unmetCoverage } from "../../engine/sim/gripe";
import type { DemandMap } from "../../engine/sim/demand";
import { UNMET_DEMAND_FLOOR } from "../../engine/sim/constants";
import { GRID } from "../../engine/facilities";
import type { FacilityKind, Unit } from "../../engine/types";
import { facilityDiagnostics } from "../../game/facilityDiagnostics";
import { gripeLineText } from "../../game/gripeCopy";
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

  it("names an unhappy rental tenant's drain too, before the notice fires", () => {
    // The rentals are a retention game: the player is meant to fix the cause in
    // time to keep the tenant. Without this line the Apartment's only feedback
    // was the notice itself, by which point the early warning every other tenant
    // kind gets had already been skipped.
    const sim = Simulation.newGame(1, "modern");
    servedOffice(sim); // lays the lobby, floor 2, and the center shaft
    sim.star = 3; // the Apartment needs 3 stars to place
    const apt = placeUnit(sim, "rentalApartment", 2, C + 6);
    sim.star = 1;
    apt.state = "occupied";
    apt.rent = 20_000; // over the going rate, the cause dominantGripe names first
    apt.satisfaction = 0.5; // unhappy but not yet on notice
    const text = diagText(sim, apt);
    expect(text).toContain("Main gripe:");
    expect(text).toContain("rent is above the going rate");
  });

  it("names the forgiving Studio's drains too (rent), not just the Apartment's", () => {
    // The guard is `isRentalKind`, so the Studio half needs its own positive case:
    // narrowing the guard to rentalApartment would otherwise leave the suite green
    // while the Studio silently lost the card lines it really does earn. Over-market
    // rent applies to every rental kind (satisfactionStep's rent pressure reads
    // isRentalKind), so it is the Studio's cleanest positive.
    const sim = Simulation.newGame(1, "modern");
    sim.money = 1e9;
    servedOffice(sim);
    sim.star = 3;
    const studio = placeUnit(sim, "rentalStudio", 2, C + 6);
    sim.star = 1;
    studio.state = "occupied";
    studio.rent = 20_000;
    studio.satisfaction = 0.5;
    const text = diagText(sim, studio);
    expect(text).toContain("Main gripe:");
    expect(text).toContain("rent is above the going rate");
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

  it("gives the demanding Apartment that same long-walk line, and never the Studio", () => {
    // The card's dedicated lines are what the "Main gripe" and "Won't lease" lines
    // defer to for transportFar, so without this the Apartment's #502 drain had no
    // line on any path. The Studio feels no far-walk drain, so a line there would
    // name a hike it never minds: both guards mirror the engine kind for kind.
    const sim = Simulation.newGame(1, "modern");
    sim.money = 1e9;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 2));
    sim.star = 3; // the Apartment needs 3 stars to place
    const apt = placeUnit(sim, "rentalApartment", 2, GRID.width - 12);
    const studio = placeUnit(sim, "rentalStudio", 2, GRID.width - 20);
    sim.star = 1;
    for (const u of [apt, studio]) {
      u.state = "occupied";
      u.satisfaction = 0.5;
    }
    expect(sim.tower.nearestTransportDistance(apt)).toBeGreaterThan(TRANSPORT_FAR_TILES);
    expect(sim.tower.nearestTransportDistance(studio)).toBeGreaterThan(TRANSPORT_FAR_TILES);
    expect(diagText(sim, apt)).toContain("Long walk to transport");
    expect(diagText(sim, studio)).not.toContain("Long walk to transport");
  });

  it("the Apartment accepts an honest unmet-demand flag; the Studio never does", () => {
    // Post-#661 rentals are demand origins and the Apartment carries the
    // coverage drain, so its tier answers a caller-supplied flag honestly. The
    // Studio stays out of the drain, so its ladder must refuse the same flag;
    // this pins both halves of that contract by handing the flag directly.
    const sim = Simulation.newGame(1, "modern");
    sim.money = 1e9;
    servedOffice(sim);
    sim.star = 3;
    const apt = placeUnit(sim, "rentalApartment", 2, C + 20);
    const studio = placeUnit(sim, "rentalStudio", 2, C + 40);
    sim.star = 1;
    for (const u of [apt, studio]) u.state = "occupied";
    // served, uncongested, at the going rate, near the shaft and the lobby, quiet:
    // every higher tier is inactive, so the flag is the only thing that could speak.
    // Post-#661 the Apartment is a coverage kind, so a true flag is honest for
    // it, exactly as for the condo below; only the Studio still refuses it.
    expect(dominantGripe(sim, apt, true, 0, false, false, false, true)).toBe("unmetDemand");
    expect(dominantGripe(sim, studio, true, 0, false, false, false, true)).not.toBe("unmetDemand");
    // A condo in the same spot IS a coverage kind, so the flag is honest for it:
    // this is the shift out of the failing condition, not just into it.
    const condo = placeUnit(sim, "condo", 2, C + 60);
    condo.state = "occupied";
    expect(dominantGripe(sim, condo, true, 0, false, false, false, true)).toBe("unmetDemand");
  });

  it("shows neither dedicated line for a unit stranded on a disconnected run", () => {
    // Both lines ride on the engine's `served`, which is segment-aware since #647.
    // A unit on a run with no way down feels NEITHER drain (only the unserved one),
    // so gating these on the floor-level `isFloorServed` would pile two invented
    // problems on top of the access line that is the actual story.
    const sim = Simulation.newGame(1, "modern");
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    // Floors 2..12 split into a LEFT run [0..99] and a RIGHT run [200..299]. The runs
    // sit far apart so the stranded unit also clears the far-walk tolerance (79),
    // which is what makes the W1 half of this test non-vacuous.
    for (let f = 2; f <= 12; f++) {
      for (let x = 0; x <= 99; x++) expectOk(sim.tower.place("floor", f, x));
      for (let x = 200; x <= 299; x++) expectOk(sim.tower.place("floor", f, x));
    }
    // A shaft inside the LEFT run only, so the RIGHT run is stranded at every floor.
    expectOk(sim.tower.placeTransport("elevatorStandard", 2, 1, 12));
    sim.star = 3;
    const stranded = placeUnit(sim, "rentalApartment", 12, 250); // RIGHT run, far up
    sim.star = 1;
    stranded.state = "occupied";
    // The fixture really is the case under test: served floor, unreachable position,
    // a hike to the nearest shaft, and a lobby 11 floors down (a live drain band).
    expect(sim.tower.isFloorServed(12)).toBe(true);
    expect(sim.positionReachable(12, stranded.x)).toBe(false);
    expect(sim.tower.nearestTransportDistance(stranded)).toBeGreaterThan(TRANSPORT_FAR_TILES);
    expect(sim.rules.lobbyDistanceDrain(sim.tower.nearestLobbyFloorDistance(12)).cap).toBeLessThan(1);
    const text = diagText(sim, stranded);
    expect(text).not.toContain("Long walk to transport");
    expect(text).not.toMatch(/Too far from any lobby|Far from the nearest lobby/);
  });

  it("gives the Apartment the far-from-a-lobby line, and never the Studio", () => {
    // Same split for the lobby-distance drain (W-new): the engine caps the
    // Apartment's satisfaction high above a lobby and leaves the Studio alone.
    const sim = Simulation.newGame(1, "modern");
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= 12; f++) lay(sim, "floor", f);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 12));
    sim.star = 3;
    const apt = placeUnit(sim, "rentalApartment", 12, C - 12);
    const studio = placeUnit(sim, "rentalStudio", 12, C - 20);
    sim.star = 1;
    for (const u of [apt, studio]) u.state = "occupied";
    // The drain really is present at this height, so the line is not vacuous.
    expect(sim.rules.lobbyDistanceDrain(sim.tower.nearestLobbyFloorDistance(12)).cap).toBeLessThan(1);
    // Both severities of the line lead with one of these two phrases; matching the
    // bare word "lobby" would pass on the unrelated access line and pin nothing.
    const LOBBY_LINE = /Too far from any lobby|Far from the nearest lobby/;
    expect(diagText(sim, apt)).toMatch(LOBBY_LINE);
    expect(diagText(sim, studio)).not.toMatch(LOBBY_LINE);
  });

  it("names the capacity shortfall for a tenant whose reachable retail is oversubscribed", () => {
    // A full-width floor of occupied offices sharing one fast food venue: every
    // office reaches it, but the pool dwarfs its capacity (share > 2, coverage
    // below the 0.5 floor), so the gripe prescribes more venues anywhere
    // connected (the demand model is tower-uniform, so nearness carries
    // nothing and "near this floor" would be a false promise). Modern fixture:
    // the mechanism under test is mode-shared, and Classic's 1994 top-tier
    // ceilings (#572) give one venue several times the capacity, so this
    // office block would no longer oversubscribe it there.
    const sim = Simulation.newGame(1, "modern");
    sim.money = 1e9;
    sim.star = 1;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    // Parallel shafts every 40 tiles so no office is transport-far or congested.
    for (let sx = 10; sx < GRID.width - 10; sx += 40) {
      expectOk(sim.buildTransport("elevatorStandard", sx, 1, 2));
    }
    const food = placeUnit(sim, "fastFood", 2, GRID.width - 30);
    food.state = "occupied";
    let sample: Unit | undefined;
    for (let x = 14; x + 9 <= GRID.width - 40; x += 11) {
      const r = sim.tower.place("office", 2, x);
      if (!r.ok) continue; // tiles under a shaft column: skip, the rest suffice
      const o = sim.tower.units.find((u) => u.id === r.unitId)!;
      o.state = "occupied";
      // The sample must sit outside the venue's noise band so unmet demand,
      // the last sink, is the dominant gripe under test.
      if (!sample && x < GRID.width - 120) sample = o;
    }
    expect(sample, "fixture placed no sample office").toBeDefined();
    // Assert the precondition through the SAME hour-memoized map the render
    // reads (review finding: a locally built map could pass while the render's
    // memo fell back to the other phrasing).
    const coverage = unmetCoverage(sim.demandMap(), sample!);
    expect(coverage).not.toBeNull();
    expect(coverage!).toBeGreaterThan(0); // reaches the venue...
    expect(coverage!).toBeLessThan(UNMET_DEMAND_FLOOR); // ...which is oversubscribed
    sample!.satisfaction = 0.5;
    const text = diagText(sim, sample!);
    expect(text).toContain("Main gripe:");
    expect(text).toContain("Add venues on any connected floor");
    expect(text).not.toContain("reachable from here");
  }, 30000);

  it("names the broken connection for a tenant whose retail is all stranded", () => {
    // The tower HAS retail, but it sits on an unserved floor: the office
    // reaches none of it (coverage 0), so the fix is a connection and the
    // gripe prescribes reconnecting the retail.
    const sim = Simulation.newGame(1);
    const office = servedOffice(sim);
    lay(sim, "floor", 3);
    // No transport reaches floor 3: the venue is built and operational but
    // stranded, so it counts as existing retail that no shopper can reach.
    const food = placeUnit(sim, "fastFood", 3, C + 40);
    food.state = "occupied";
    expect(sim.tower.isFloorServed(3)).toBe(false);
    expect(unmetCoverage(sim.demandMap(), office)).toBe(0); // via the render's own memo
    office.satisfaction = 0.5;
    const text = diagText(sim, office);
    expect(text).toContain("Main gripe:");
    expect(text).toContain("none of them are reachable from here");
    expect(text).not.toContain("Add venues on any connected floor");
  }, 30000);

  it("stays silent when coverage 0 comes from the tenant's own far floor (access owns it)", () => {
    // The tower's retail is perfectly connected; what fails is the TENANT's
    // floor, served (a network connects it) but reachably-close only past the
    // Classic walk budget (a 10-flight stair climb). Coverage reads 0 for it, and
    // the gripe copy defers to the dedicated red "Access: no route" line rather
    // than blaming retail that is not broken (the reconnect copy would misprescribe).
    const sim = Simulation.newGame(21);
    sim.money = 1e9;
    sim.star = 5;
    const X0 = C - 15;
    const X1 = C + 45;
    const put = (kind: "floor" | "lobby", f: number, x: number): void => {
      if (sim.tower.structureKindAt(f, x) === kind) return;
      expectOk(sim.tower.place(kind, f, x));
    };
    for (let x = X0; x <= X1; x++) put("lobby", 1, x);
    for (let f = 2; f <= 40; f++) for (let x = X0; x <= X1; x++) put("floor", f, x);
    expectOk(sim.tower.placeTransport("elevatorStandard", C, 1, 30));
    for (let f = 30; f < 40; f++) expectOk(sim.tower.placeTransport("stairs", C + 20, f, f + 1));
    placeUnit(sim, "office", 2, X0).state = "occupied";
    placeUnit(sim, "fastFood", 2, C + 30).state = "occupied";
    const far = placeUnit(sim, "office", 40, C + 30);
    far.state = "occupied";
    expect(sim.tower.isFloorServed(40)).toBe(true); // served (no access "not connected")...
    expect(sim.floorReachable(40)).toBe(false); // ...but only via a 10-flight stair climb
    expect(unmetCoverage(sim.demandMap(), far)).toBe(0);
    expect(gripeLineText(sim, far, "unmetDemand")).toBeUndefined();
    // The reachable ground-floor office still reads the honest capacity copy
    // through the same entry point (its coverage is nonzero).
    const near = sim.tower.units.find((u) => u.kind === "office" && u.floor === 2)!;
    expect(gripeLineText(sim, near, "unmetDemand")).toContain("Add venues on any connected floor");
  }, 30000);

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
    // Back the share out into a pool/cap pair (the gate reads these; this hand-built
    // map only exercises unmetCoverage, which reads share, so any consistent pair
    // works), with a neutral snapshot bonus to match.
    pool: share,
    totalCap: 1,
    bonus: 1,
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
