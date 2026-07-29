import { describe, it, expect } from "vitest";
import { buildSatisfactionContext, wouldEvictFreshTenant } from "../../engine/sim/satisfactionStep";
import { vacateCause } from "../../engine/sim/gripe";
import { W, C, servedTower, place, placeRental } from "./moveInGateHelpers";
import { FACILITIES } from "../../engine/facilities";
import { Simulation } from "../../engine/Simulation";

/**
 * The move-in sustainability gate covers the Modern rentals too (reconciled with
 * PR #650 when rental living merged onto the gate). A vacant Studio/Apartment is
 * a lease tenant that erodes on placement exactly like an office/condo, so a bad
 * spot must stay VACANT rather than lease -> erode -> give notice -> re-list
 * forever (the same net-zero churn the gate stops for condos/offices).
 *
 * The gate respects the forgiving/demanding split by construction, because it
 * runs the SAME satisfactionStep the per-tick update runs: the demanding
 * Apartment feels the far-walk and lobby drains and so is gated out of a
 * bad-access spot, while the forgiving Studio (which feels neither, only noise)
 * leases into the very same spot. No new gate logic per kind: the per-kind drains
 * in satisfactionStep do the discriminating. Unmet demand belongs to the
 * demanding Apartment only (#661: rentals are real demand origins now, and the
 * coverage drain reads the Apartment like a condo; the forgiving Studio stays
 * out of it on both the live and gate paths).
 */

describe("move-in gate covers rentals: a bad spot stays vacant", () => {
  it("a far-walk Apartment is gated (the demanding tenant would churn out of it)", () => {
    const sim = servedTower(21, "modern");
    // Far from the only (center) shaft, past the walking tolerance: the Apartment
    // feels this far-walk drain (#502), an office would too, a condo would not.
    const apt = placeRental(sim, "rentalApartment", 2, 0);
    expect(wouldEvictFreshTenant(sim, apt, buildSatisfactionContext(sim))).toBe(true);
    // Behavioral: a fortnight of hourly rolls never leases it (no churn loop).
    for (let i = 0; i < 14 * 24; i++) sim.tick(60);
    expect(apt.state).toBe("empty");
    expect(apt.everOccupied).toBe(false);
  });

  it("the forgiving Studio LEASES into that same far-walk spot (it feels no far-walk drain)", () => {
    const sim = servedTower(22, "modern");
    const studio = placeRental(sim, "rentalStudio", 2, 0); // identical bad-access spot
    expect(wouldEvictFreshTenant(sim, studio, buildSatisfactionContext(sim))).toBe(false);
    let guard = 0;
    while (!studio.everOccupied && guard++ < 2000) sim.tick(60);
    expect(studio.everOccupied).toBe(true); // the on-ramp still fills a scrappy tower
  });

  it("a noisy Apartment is gated, just like a noisy condo", () => {
    const sim = servedTower(23, "modern");
    place(sim, "office", 2, C - 13); // the noisy neighbor
    const apt = placeRental(sim, "rentalApartment", 2, C); // beside it
    expect(sim.noiseAfflicted(apt)).toBe(true); // the drain really is present
    expect(wouldEvictFreshTenant(sim, apt, buildSatisfactionContext(sim))).toBe(true);
    for (let i = 0; i < 14 * 24; i++) sim.tick(60);
    expect(apt.everOccupied).toBe(false);
  });
});

describe("move-in gate covers rentals: no over-block of a good spot", () => {
  it("a well-placed Apartment still leases (near shaft and lobby, quiet)", () => {
    const sim = servedTower(24, "modern");
    const apt = placeRental(sim, "rentalApartment", 2, C + 6); // by the center shaft
    expect(wouldEvictFreshTenant(sim, apt, buildSatisfactionContext(sim))).toBe(false);
    let guard = 0;
    while (!apt.everOccupied && guard++ < 3000) sim.tick(60);
    expect(apt.everOccupied).toBe(true);
    expect(apt.width).toBe(FACILITIES.rentalApartment.width); // the catalog, not the same object
  });
});

describe("move-in gate: the Apartment carries unmet-demand, the Studio stays exempt (#661)", () => {
  it("an Apartment is gated beside a condo on a spot with unreachable retail; a Studio is not", () => {
    // The stranded-retail setup that gates a condo/office by unmet demand:
    // retail exists only on an unreachable floor, so a reachable tenant reaches
    // ZERO shops (coverage 0). Rentals are demand origins now, so the live
    // Apartment feels this drain exactly like a condo and the gate agrees; the
    // forgiving Studio still reads no coverage and leases.
    const sim = Simulation.newGame(31, "modern");
    sim.money = 1e12;
    sim.star = 3; // rentals unlocked for placement
    for (let x = 0; x < W; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let f = 2; f <= 10; f++) for (let x = 0; x < W; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
    expect(sim.buildTransport("elevatorStandard", C, 1, 6).ok).toBe(true); // serves 1..6 only
    sim.tower.setCars(sim.tower.transports[0].id, 8);
    expect(sim.tower.place("fastFood", 10, C).ok).toBe(true); // retail stranded on the unreachable floor 10
    const condo = place(sim, "condo", 2, C - 20); // reachable, quiet, near the lobby
    const aptR = sim.tower.place("rentalApartment", 2, C + 4);
    expect(aptR.ok, "place apartment f2").toBe(true);
    const apt = sim.tower.units.find((u) => u.id === aptR.unitId)!;
    sim.star = 1; // back to no-events for the gate reads
    expect(sim.floorReachable(2)).toBe(true);
    expect(sim.floorReachable(10)).toBe(false);
    const ctx = buildSatisfactionContext(sim, true);
    // The condo (a demand origin) is gated by the unmet-demand doom...
    expect(wouldEvictFreshTenant(sim, condo, ctx)).toBe(true);
    // ...and the Apartment now shares that fate: it is a demand origin whose
    // coverage reads zero here, the GDD's unmet-local-demand churn made real.
    expect(wouldEvictFreshTenant(sim, apt, ctx)).toBe(true);
    // The forgiving Studio still ignores coverage and would lease the spot.
    sim.star = 3;
    const stR = sim.tower.place("rentalStudio", 2, C + 16);
    expect(stR.ok, "place studio f2").toBe(true);
    sim.star = 1;
    const studio = sim.tower.units.find((u) => u.id === stR.unitId)!;
    expect(wouldEvictFreshTenant(sim, studio, ctx)).toBe(false);
    // The revived live branch (#661): an occupied Apartment in this retail
    // desert now names unmet local demand as its dominant gripe, the branch
    // that was dead while rentals were not demand origins.
    apt.state = "occupied";
    apt.residents = 3;
    apt.everOccupied = true;
    expect(sim.dominantGripe(apt)).toBe("unmetDemand");
    // vacateCause shares the ladder (dominantGripe ?? "access"), so the
    // departure at notice time names the same cause, not the access catch-all.
    expect(vacateCause(sim, apt, true, 0)).toBe("unmetDemand");
  });
});

describe("move-in gate covers rentals: Classic is untouched (rentals are Modern-only)", () => {
  it("a Classic tower cannot reach the rental branches at all", () => {
    // What this can honestly pin: rentals are unreachable in Classic, so no rental
    // branch and no rental rng draw is live there. The BYTE-parity half (that the
    // seeded stream is untouched) is pinned by goldenMaster.integration.test.ts,
    // which hashes serialize() after a fixed Classic run; a stray Classic draw
    // flips that hash. An earlier version of this test asserted a grid constant
    // was positive, which stayed green with the whole feature reverted.
    const sim = servedTower(25, "classic");
    sim.star = 5; // even fully unlocked
    for (const kind of ["rentalStudio", "rentalApartment"] as const) {
      expect(sim.isUnlocked(kind), `${kind} unlocked in Classic`).toBe(false);
      expect(sim.build(kind, 2, C).ok, `${kind} built in Classic`).toBe(false);
    }
    sim.star = 1;
    // A real Classic tenant kind, so the run below exercises the shared gate path
    // rather than ticking an empty tower and proving nothing.
    const office = place(sim, "office", 2, C - 20);
    const startMinutes = sim.clock.minutes;
    for (let i = 0; i < 7 * 24; i++) sim.tick(60);
    expect(sim.clock.minutes).toBeGreaterThan(startMinutes); // the week really ran
    expect(office.everOccupied).toBe(true); // and the gate seated a Classic tenant
    expect(sim.tower.units.some((u) => u.kind === "rentalStudio" || u.kind === "rentalApartment")).toBe(false);
  });
});
