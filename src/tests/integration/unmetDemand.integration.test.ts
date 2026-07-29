import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import type { FacilityKind } from "../../engine/types";
import { UNMET_DEMAND_CAP, UNMET_DEMAND_FLOOR } from "../../engine/sim/constants";
import { computeDemandMap } from "../../engine/sim/demand";
import { unmetCoverage, dominantGripe } from "../../engine/sim/gripe";
import { serialize, deserialize } from "../../engine/sim/serialization";
import { VACATE_REASON_TEXT } from "../../engine/types";
import { wontLeaseText } from "../../game/gripeCopy";

/**
 * Unmet local-demand satisfaction pressure (#395): a served office/condo/hotel
 * whose reachable shops and eateries cannot cover the tower's demand is capped
 * (Classic) or, in Modern, eroded once it can reach none. A tower with no retail
 * at all is the baseline, exempt. Coupled to the demand-pool machinery (#393).
 */

const W = GRID.width;
const MID = Math.floor(W / 2);

/** Place one structure tile, asserting it either lands or is already the
 *  intended kind. A full-width lay (or strip) overlaps the pre-built starting
 *  lobby, so an "already here" collision on a tile that is ALREADY the intended
 *  kind is tolerated; any other failure reason (bounds, missing support) is a
 *  real fixture break and throws, per the AGENTS.md fixture-assertion rule. */
function placeStructure(sim: Simulation, kind: "floor" | "lobby", floor: number, x: number): void {
  const r = sim.tower.place(kind, floor, x);
  if (r.ok) return;
  const existing = sim.tower.unitAt(floor, x);
  expect(existing?.kind, `place(${kind}, ${floor}, ${x}) failed: ${r.reason ?? "unknown"}`).toBe(kind);
}

/** Lay one full-width story, spreading outward from the tower center so every
 *  tile stays connected to the starting lobby. */
function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = MID; x < W; x++) placeStructure(sim, kind, floor, x);
  for (let x = MID - 1; x >= 0; x--) placeStructure(sim, kind, floor, x);
}

function unit(sim: Simulation, id: number | undefined) {
  const u = sim.tower.units.find((x) => x.id === id);
  if (!u) throw new Error(`placement failed (id ${id})`);
  return u;
}

/** Place a room and assert its construction (surfacing `reason` on failure),
 *  then return the live unit, so a fixture-critical placement can never silently
 *  build a different tower (AGENTS.md fixture-assertion rule). */
function placeUnit(sim: Simulation, kind: FacilityKind, floor: number, x: number) {
  const r = sim.tower.place(kind, floor, x);
  expect(r.ok, `place(${kind}, ${floor}, ${x}) failed: ${r.reason ?? "unknown"}`).toBe(true);
  return unit(sim, r.unitId);
}

describe("W-new: unmet local demand (#395)", () => {
  /** A well-shafted tower (many parallel elevators, so no congestion and no W1
   *  far-walk) whose occupied-office demand dwarfs its lone reachable food venue,
   *  so retail coverage sits below the floor. Optionally omit the venue for the
   *  no-retail baseline. Returns the sim, a sample office near a shaft, and the
   *  measured coverage so a test can assert its precondition before ticking. */
  function denseOfficeTower(
    mode: "classic" | "modern",
    withFood: boolean,
    top = 5,
  ): { sim: Simulation; office: ReturnType<typeof unit>; coverage: number | null } {
    const sim = Simulation.newGame(30, mode);
    sim.money = 1e12;
    sim.star = 5;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= top; f++) lay(sim, "floor", f);
    // Parallel shafts every 40 tiles: capacity for the whole floor, and no office
    // is ever more than ~20 tiles from one, so neither congestion nor the W1
    // far-walk penalty can confound the unmet-demand drain under test.
    for (let sx = 10; sx < W - 10; sx += 40) expect(sim.buildTransport("elevatorStandard", sx, 1, top).ok).toBe(true);
    if (withFood) {
      // One fast food near the right edge: the only reachable retail. Its
      // capacity is the mode headline through the seam (#572): Modern 2,000,
      // Classic 5,000, so a Classic caller needs a denser office pool to stay
      // clearly under the coverage floor.
      expect(sim.tower.place("fastFood", 2, W - 30).ok).toBe(true);
      sim.tower.units.find((u) => u.kind === "fastFood")!.state = "occupied";
    }
    let first: ReturnType<typeof unit> | undefined;
    for (let f = 2; f <= top; f++) {
      for (let x = 14; x + 9 <= W - 40; x += 11) {
        const r = sim.tower.place("office", f, x);
        if (!r.ok) continue;
        const o = unit(sim, r.unitId);
        o.state = "occupied";
        o.satisfaction = 1;
        if (!first) first = o;
      }
    }
    expect(first, "denseOfficeTower placed no offices (placement rules changed?)").toBeDefined();
    const office = first!;
    return { sim, office, coverage: unmetCoverage(computeDemandMap(sim), office) };
  }

  it("caps an office in an under-served tower at the unmet-demand ceiling without evicting it (Classic)", () => {
    // Four floors of offices (review finding): against the Classic 5,000
    // fast-food capacity (#572), the old three-floor pool sat within 4% of the
    // coverage floor, one small retune from flipping the precondition.
    const { sim, office, coverage } = denseOfficeTower("classic", true, 4);
    expect(coverage).not.toBeNull();
    expect(coverage!).toBeLessThan(UNMET_DEMAND_FLOOR); // precondition: genuinely under-served
    for (let i = 0; i < 40; i++) sim.tick(60);
    expect(office.satisfaction).toBeLessThanOrEqual(UNMET_DEMAND_CAP + 1e-9);
    expect(office.satisfaction).toBeGreaterThan(0); // capped, not eroded to nothing (Classic never evicts)
    expect(office.state).toBe("occupied");
    // Cap-only unmet demand (Classic caps but never erodes) is still named as the
    // dominant gripe, so the inspector shows an actionable line instead of leaving
    // the office pinned at the ceiling in silence (the cap-only noise case reports
    // the same way).
    expect(dominantGripe(sim, office)).toBe("unmetDemand");
    // Classic ordering is untouched by the #548 comparison: with zero erosion on
    // both sides (cap-only world) a noisy capped tenant still reads "noise" first.
    expect(dominantGripe(sim, office, true, 0, false, true)).toBe("noise");
  }, 30000);

  it("leaves a tower with no reachable retail untouched (baseline: no shops is not a problem)", () => {
    // The same dense office tower but with NO food venue: share is 0, so unmet
    // demand is exempt and the well-served offices stay happy.
    const { sim, office, coverage } = denseOfficeTower("modern", false, 3);
    expect(coverage).toBeNull(); // exempt: no retail at all in the tower
    for (let i = 0; i < 20; i++) sim.tick(60);
    expect(office.satisfaction).toBeGreaterThan(0.9);
    expect(office.state).toBe("occupied");
  }, 30000);

  it("names unmet demand as the dominant gripe for a reachable tenant when all retail is on a disconnected island (Modern)", () => {
    // Reachability is uncapped in Modern now, so a tenant is served iff reachable
    // (no "served but too far" state). To get 0 reachable retail coverage for a
    // SERVED tenant, strand the RETAIL instead: the tower has retail, but it sits
    // on a disconnected elevator island the tenant cannot reach. Coverage 0 with
    // retail present ⇒ unmet demand, not an access gripe (the tenant's own floor
    // is reachable) and not "no retail at all".
    const sim = Simulation.newGame(21, "modern");
    sim.money = 1e12;
    sim.star = 5;
    const X0 = MID - 15;
    const X1 = MID + 45;
    const strip = (kind: "floor" | "lobby", f: number) => {
      for (let x = X0; x <= X1; x++) placeStructure(sim, kind, f, x);
    };
    strip("lobby", 1);
    for (let f = 2; f <= 40; f++) strip("floor", f);
    // A ground elevator makes the floor-2 tenants reachable.
    expect(sim.tower.placeTransport("elevatorStandard", MID, 1, 30).ok).toBe(true);
    // A DISCONNECTED retail island: an elevator serving 35..40 only, with no shaft
    // bridging 30..35, so floor 40 never connects to the ground lobby (neither
    // served nor reachable). Modern has no walk budget, so a disconnected island
    // is the only way to make its retail unreachable.
    expect(sim.tower.placeTransport("elevatorStandard", MID + 12, 35, 40).ok).toBe(true);
    // The tenants under test: reachable ground offices (their own floor is fine).
    for (const x of [X0, MID + 18]) placeUnit(sim, "office", 2, x).state = "occupied";
    const tenant = sim.tower.units.find((u) => u.kind === "office" && u.floor === 2)!;
    // The tower's only retail sits on the unreachable island.
    placeUnit(sim, "fastFood", 40, MID + 30).state = "occupied";
    expect(sim.tower.isFloorServed(2)).toBe(true);
    expect(sim.floorReachable(2)).toBe(true); // the tenant is reachable (no access drain)
    expect(sim.floorReachable(40)).toBe(false); // ...but the retail island is not
    expect(unmetCoverage(computeDemandMap(sim), tenant)).toBe(0); // retail exists, tenant reaches none
    // The tenant is served, uncongested, market-rent, near a shaft, un-noisy, and
    // near the ground lobby, so unmet demand is the dominant, attributable gripe.
    const cong = sim.simModel === "v2" ? (sim.spatialCongestionByFloor().get(2) ?? 0) : sim.congestion();
    expect(dominantGripe(sim, tenant, true, cong, false, false, false)).toBe("unmetDemand");
  }, 30000);

  it("names unmet demand over noise when it is the steeper drain, and noise again once coverage recovers (#548)", () => {
    // A noisy tenant in a starved tower: without the harshest-drain comparison
    // the ladder said "noise" and the player soundproofed a building dying of
    // no shops. The cinema is the noise source on purpose: it is commercial
    // (noiseAfflicted reads it) but an attendance venue, so it adds nothing to
    // the retail pool and coverage genuinely stays 0.
    const sim = Simulation.newGame(22, "modern");
    sim.money = 1e12;
    sim.star = 5;
    const X0 = MID - 15;
    const X1 = MID + 45;
    const strip = (kind: "floor" | "lobby", f: number) => {
      for (let x = X0; x <= X1; x++) placeStructure(sim, kind, f, x);
    };
    strip("lobby", 1);
    for (let f = 2; f <= 40; f++) strip("floor", f);
    expect(sim.tower.placeTransport("elevatorStandard", MID, 1, 30).ok).toBe(true);
    // The disconnected retail island (35..40 only), exactly as the test above.
    expect(sim.tower.placeTransport("elevatorStandard", MID + 12, 35, 40).ok).toBe(true);
    const tenant = placeUnit(sim, "office", 2, X0);
    tenant.state = "occupied";
    placeUnit(sim, "cinema", 2, X0 + 9).state = "occupied"; // adjacent: inside the office noise band
    placeUnit(sim, "fastFood", 40, MID + 30).state = "occupied"; // the only retail, stranded
    expect(sim.noiseAfflicted(tenant)).toBe(true);
    expect(unmetCoverage(computeDemandMap(sim), tenant)).toBe(0);
    // Both drains active; unmet demand erodes at full depth (0.12) versus the
    // office noise rate (0.07), so the ladder names the drain that is actually
    // pushing the tenant out.
    expect(dominantGripe(sim, tenant, true, 0, false, true, false)).toBe("unmetDemand");
    // Bridge the island: the fast food becomes reachable, coverage recovers to
    // full, and the same noisy tenant reads plain "noise" again.
    expect(sim.tower.placeTransport("elevatorStandard", MID + 24, 30, 35).ok).toBe(true);
    expect(sim.floorReachable(40)).toBe(true);
    expect(unmetCoverage(computeDemandMap(sim), tenant)).toBe(1);
    expect(dominantGripe(sim, tenant, true, 0, false, true, false)).toBe("noise");
  }, 30000);

  it("the won't-lease card names the retail shortage for an empty noisy spot, matching the occupied unit beside it (#548)", () => {
    // The empty candidate is not an origin in the real memoized map, so without
    // the candidate-aware coverage riding into the harshest-drain comparison the
    // card would blame the noisy neighbor while the occupied office next door
    // names the shortage, telling the player to soundproof a building that is
    // dying of no shops on the one surface that explains an empty spot.
    const sim = Simulation.newGame(23, "modern");
    sim.money = 1e12;
    sim.star = 5;
    const X0 = MID - 15;
    const X1 = MID + 45;
    const strip = (kind: "floor" | "lobby", f: number) => {
      for (let x = X0; x <= X1; x++) placeStructure(sim, kind, f, x);
    };
    strip("lobby", 1);
    for (let f = 2; f <= 40; f++) strip("floor", f);
    expect(sim.tower.placeTransport("elevatorStandard", MID, 1, 30).ok).toBe(true);
    expect(sim.tower.placeTransport("elevatorStandard", MID + 12, 35, 40).ok).toBe(true);
    // An OCCUPIED office feeds the pool so the candidate's coverage really is 0
    // (a lone empty candidate would fold only its own probe demand).
    placeUnit(sim, "office", 3, X0).state = "occupied";
    const spot = placeUnit(sim, "office", 2, X0); // the empty candidate under test
    placeUnit(sim, "cinema", 2, X0 + 9).state = "occupied"; // adjacent noise, pool-inert
    placeUnit(sim, "fastFood", 40, MID + 30).state = "occupied"; // the only retail, stranded
    expect(sim.noiseAfflicted(spot)).toBe(true);
    const text = wontLeaseText(sim, spot);
    expect(text).not.toBeNull();
    expect(text!).toContain("shops");
    expect(text!).not.toContain("noisy neighbor");
  }, 30000);

  it("the nightclub halo also yields the noise tier to a steeper unmet-demand drain (#548)", () => {
    // The halo names "noise" through its own tier AFTER the guarded W2 line, so
    // an unguarded club tier would hand the misattribution right back: a condo
    // in a starved tower would read "noise", the player would move the club,
    // and the tenant would keep dying at the unmet rate. A club is itself a
    // demand-pool venue (its capacity feeds coverage), so a naturally starved
    // club tower is enormous; the guard is pinned here through the eviction
    // path's own flag-and-coverage arguments instead, at exact magnitudes.
    const sim = Simulation.newGame(24, "modern");
    sim.money = 1e12;
    sim.star = 5;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= 4; f++) lay(sim, "floor", f);
    expect(sim.buildTransport("elevatorStandard", MID, 1, 4).ok).toBe(true);
    const condo = placeUnit(sim, "condo", 2, MID + 12);
    condo.state = "occupied";
    condo.everOccupied = true;
    condo.residents = 3;
    // The club one floor up: inside the negative halo, but on a different floor
    // so the same-floor W2 band never fires and the club tier is the one under test.
    placeUnit(sim, "nightclub", 3, MID + 12).state = "occupied";
    expect(sim.noiseAfflicted(condo)).toBe(false); // W2 quiet: cross-floor halo only
    // Starved (coverage 0): the full-depth 0.12 unmet erosion beats the halo
    // penalty at distance 1, so the steeper drain takes the tier.
    expect(dominantGripe(sim, condo, true, 0, false, false, false, true, 0)).toBe("unmetDemand");
    // Barely inside the evict floor (coverage 0.34): the unmet erosion is a few
    // thousandths, the club's penalty binds, and the honest name is "noise".
    expect(dominantGripe(sim, condo, true, 0, false, false, false, true, 0.34)).toBe("noise");
    // No unmet drain at all: the halo names "noise" exactly as before #548.
    expect(dominantGripe(sim, condo, true, 0, false, false, false, false, 1)).toBe("noise");
  }, 30000);

  it("a loaded, heavily oversubscribed tower sheds with every departure blamed on unmet demand, then self-limits (#548)", () => {
    // Grumbal's regression: "the room says it's fair" is not a number. Build a
    // share ~13 tower (past the share-12 bar the party set), round-trip it
    // through serialize/deserialize to model a loaded save meeting the new
    // constants, run five game days, and MEASURE: the vacate-cause histogram,
    // the condo buy-back total, and the self-limiting recovery.
    const sim = Simulation.newGame(30, "modern");
    sim.money = 1e12;
    sim.star = 5;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= 7; f++) lay(sim, "floor", f);
    for (let sx = 10; sx < W - 10; sx += 40) expect(sim.buildTransport("elevatorStandard", sx, 1, 7).ok).toBe(true);
    placeUnit(sim, "fastFood", 2, W - 30).state = "occupied";
    // Three sold condos on floor 2: the buy-back half of the measurement.
    for (const cx of [14, 32, 50]) {
      const condo = placeUnit(sim, "condo", 2, cx);
      condo.state = "occupied";
      condo.everOccupied = true;
      condo.residents = 3;
      condo.satisfaction = 1;
    }
    // Offices on floors 3..7 push the pool far past the shed boundary.
    for (let f = 3; f <= 7; f++) {
      for (let x = 14; x + 9 <= W - 40; x += 11) {
        const r = sim.tower.place("office", f, x);
        if (!r.ok) continue;
        const o = unit(sim, r.unitId);
        o.state = "occupied";
        o.satisfaction = 1;
      }
    }
    const dm0 = computeDemandMap(sim);
    expect(dm0.share).toBeGreaterThan(10); // precondition: deep in the shed region
    const office0 = sim.tower.units.find((u) => u.kind === "office")!;
    const coverage0 = unmetCoverage(dm0, office0)!;
    const sim2 = deserialize(serialize(sim));
    for (let i = 0; i < 5 * 24; i++) sim2.tick(60);
    // Every departure in the run names the real cause: too few shops within
    // reach. No departure is blamed on noise, access, or lobby distance.
    const vacates = sim2.log.filter((e) => e.text.startsWith("A tenant left ") || e.text.startsWith("The owner left "));
    expect(vacates.length).toBeGreaterThan(20);
    for (const e of vacates) expect(e.text).toContain(VACATE_REASON_TEXT.unmetDemand);
    // The sold condos churned and were bought back for real money.
    const buybacks = sim2.log.filter((e) => e.text.includes("You bought it back for $"));
    expect(buybacks.length).toBeGreaterThan(0);
    const total = buybacks.reduce((sum, e) => sum + Number(/\$([\d,]+)/.exec(e.text)![1].replace(/,/g, "")), 0);
    expect(total).toBeGreaterThan(0);
    // Self-limiting: departures shrink the pool, coverage rises through the same
    // number, and the survivors stabilize instead of the tower wiping.
    const dmEnd = computeDemandMap(sim2);
    const officeEnd = sim2.tower.units.find((u) => u.kind === "office" && u.state === "occupied");
    expect(officeEnd, "the shed did not self-limit: no occupied office survived").toBeDefined();
    expect(unmetCoverage(dmEnd, officeEnd!)!).toBeGreaterThan(coverage0);
    expect(sim2.tower.units.filter((u) => u.kind === "office" && u.state === "occupied").length).toBeGreaterThan(10);
  }, 60000);
});
