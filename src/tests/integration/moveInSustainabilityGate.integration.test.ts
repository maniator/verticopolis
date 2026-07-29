import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { GameMode, Unit } from "../../engine/types";
import { buildSatisfactionContext, wouldEvictFreshTenant } from "../../engine/sim/satisfactionStep";
import { computeDemandMap } from "../../engine/sim/demand";
import { wontLeaseText } from "../../game/gripeCopy";
import { W, C, DAY, servedTower, place, seat } from "./moveInGateHelpers";

/**
 * The move-in sustainability gate (spec-move-in-sustainability-gate-2026-07-23):
 * a condo or office no longer sells / leases into a spot whose own placement
 * would just erode a fresh tenant back below the leave bar and evict them, an
 * endless sell -> erode -> notice -> buy-back -> resell churn that nets zero
 * money but reads as a bug (the reported "infinite money glitch"). The spot
 * stays VACANT until the player fixes the cause, matching the 1994 original
 * where a badly placed office simply "rimangono vuoti".
 *
 * The gate consults the SAME satisfactionStep the per-tick update runs, against
 * the tenant the sale WOULD produce, and draws no RNG, so a Classic tower's
 * seeded stream is untouched except where a spot is genuinely gated (the golden
 * master proves Classic is byte-identical). These tests pin: the churn stops,
 * the predicate agrees with the real forward simulation, sustainable spots are
 * NOT over-blocked, and Classic reaches parity (noise caps but never evicts, so
 * a Classic noisy spot still fills).
 */

describe("move-in sustainability gate: the churn stops", () => {
  it("a Modern noisy condo never sells; it stays vacant instead of churning", () => {
    const sim = servedTower(1, "modern");
    place(sim, "office", 2, C - 9); // the noisy neighbor
    const condo = place(sim, "condo", 2, C); // immediately beside it
    // A month of hourly move-in rolls. Pre-gate this condo would sell, erode,
    // give notice, be bought back, and re-sell over and over.
    for (let i = 0; i < 30 * 24; i++) sim.tick(60);
    expect(sim.noiseAfflicted(condo)).toBe(true); // the drain really is present
    expect(condo.state).toBe("empty"); // never seated
    expect(condo.everOccupied).toBe(false); // no sale ever banked
    // No churn: the condo never sold once, so no sell/buy-back money cycle ran
    // (the reported "infinite money glitch" was this net-zero loop).
    expect(sim.log.some((e) => e.text.includes("Condominium") && e.text.includes("sold"))).toBe(false);
  });

  it("a Modern far-walk office never leases into a spot it would churn out of", () => {
    const sim = servedTower(2, "modern");
    // An office far from the only shaft (center): past the far-walk tolerance.
    const office = place(sim, "office", 2, 0);
    for (let i = 0; i < 14 * 24; i++) sim.tick(60);
    expect(office.state).toBe("empty");
    expect(office.everOccupied).toBe(false);
  });
});

describe("move-in sustainability gate: no over-block of sustainable spots", () => {
  it("a well-placed Modern condo still sells", () => {
    const sim = servedTower(3, "modern");
    const condo = place(sim, "condo", 2, C); // near lobby, served, no noisy neighbor
    expect(wouldEvictFreshTenant(sim, condo, buildSatisfactionContext(sim))).toBe(false);
    let guard = 0;
    while (!condo.everOccupied && guard++ < 400) sim.tick(60);
    expect(condo.everOccupied).toBe(true); // it fills like any healthy spot
  });

  it("a well-placed Modern office still leases", () => {
    const sim = servedTower(4, "modern");
    const office = place(sim, "office", 2, C + 12); // near the center shaft
    expect(wouldEvictFreshTenant(sim, office, buildSatisfactionContext(sim))).toBe(false);
    let guard = 0;
    while (!office.everOccupied && guard++ < 2000) sim.tick(60);
    expect(office.everOccupied).toBe(true);
  });
});

describe("move-in sustainability gate: Classic parity (caps but never evicts)", () => {
  it("a Classic noisy office still leases (noise caps satisfaction, never erodes it out)", () => {
    const sim = servedTower(5, "classic");
    place(sim, "fastFood", 2, C - 20); // a noisy commercial neighbor (width 16), within 11 tiles
    const office = place(sim, "office", 2, C);
    expect(sim.noiseAfflicted(office)).toBe(true);
    expect(wouldEvictFreshTenant(sim, office, buildSatisfactionContext(sim))).toBe(false); // caps at 0.6, above the 0.4 bar
    let guard = 0;
    while (!office.everOccupied && guard++ < 2000) sim.tick(60);
    expect(office.everOccupied).toBe(true);
  });

  it("a genuinely isolated condo is gated in BOTH modes (very far from any lobby)", () => {
    for (const mode of ["classic", "modern"] as GameMode[]) {
      // Floor 20 with only the ground lobby is 19 floors up: the very-far band,
      // whose erosion outpaces recovery in both modes.
      const sim = servedTower(6, mode, 22);
      const condo = place(sim, "condo", 20, C);
      expect(wouldEvictFreshTenant(sim, condo, buildSatisfactionContext(sim)), mode).toBe(true);
    }
  });
});

describe("move-in sustainability gate: unmet-demand doom (retail-starved spot)", () => {
  it("gates a Modern spot that reaches no retail, and fills it once the retail is reachable", () => {
    // Floors 2..10 exist but the shaft only serves 1..6, so floor 10 is stranded.
    const sim = Simulation.newGame(30, "modern");
    sim.money = 1e12;
    sim.star = 1;
    for (let x = 0; x < W; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let f = 2; f <= 10; f++) for (let x = 0; x < W; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
    expect(sim.buildTransport("elevatorStandard", C, 1, 6).ok).toBe(true);
    sim.tower.setCars(sim.tower.transports[0].id, 8);
    // Retail EXISTS but only on the stranded floor 10, so a tenant on the reachable
    // floor 2 reaches ZERO shops: coverage 0, the Modern unmet-demand erosion that
    // actually evicts. Without registering the empty candidate as a demand origin,
    // the gate would miss this and let the spot lease and then churn.
    place(sim, "fastFood", 10, C);
    const condo = place(sim, "condo", 2, C); // reachable, quiet, near the lobby
    expect(sim.floorReachable(2)).toBe(true);
    expect(sim.floorReachable(10)).toBe(false);
    expect(wouldEvictFreshTenant(sim, condo, buildSatisfactionContext(sim, true))).toBe(true);

    // Make the retail reachable: a second shaft up to floor 10. Coverage rises and
    // the spot becomes livable, so the gate lets it fill (auto-heal).
    expect(sim.buildTransport("elevatorStandard", C + 20, 1, 10).ok).toBe(true);
    sim.tower.setCars(sim.tower.transports[1].id, 8);
    expect(sim.floorReachable(10)).toBe(true);
    expect(wouldEvictFreshTenant(sim, condo, buildSatisfactionContext(sim, true))).toBe(false);
  });

  it("is batch-aware: a spot that is fine alone is gated once fills saturate the retail", () => {
    const sim = servedTower(50, "modern", 4);
    place(sim, "fastFood", 2, C - 30); // reachable retail, far enough to add no noise
    const condo = place(sim, "condo", 3, C); // well placed: only unmet demand can gate it
    const ctx = buildSatisfactionContext(sim, true);
    // Reachable retail covers a lone fresh tenant (its own demand alone is light),
    // so the gate allows it.
    expect(wouldEvictFreshTenant(sim, condo, ctx)).toBe(false);
    // Now raise the running pool the way attemptMoveIns does as earlier vacancies
    // fill in the same pass, past the retail capacity. The SAME spot is gated: a
    // fresh tenant here would over-subscribe the retail and churn (the batch case).
    const dm = (ctx.demandMap ??= computeDemandMap(sim));
    dm.pool += dm.totalCap * 100;
    expect(wouldEvictFreshTenant(sim, condo, ctx)).toBe(true);
  });

  it("a hotel check-in raises tower demand, so the batch pool tracks it (asleep rooms are origins)", () => {
    const sim = servedTower(44, "modern");
    const room = sim.tower.place("hotelSingle", 2, C + 30);
    expect(room.ok).toBe(true);
    const u = sim.tower.units.find((x) => x.id === room.unitId)!;
    const before = computeDemandMap(sim).pool;
    u.state = "asleep"; // a guest checks in mid-evening
    u.everOccupied = true;
    expect(computeDemandMap(sim).pool).toBeGreaterThan(before); // the check-in adds demand
    // attemptMoveIns therefore adds originDemand(room) to the running pool on
    // check-in, mirroring the condo/office fill path, so a later same-pass candidate
    // is judged against the raised coverage rather than stale demand.
    expect(sim.tower.units.filter((x) => x.state === "asleep").length).toBe(1);
  });
});

describe("move-in sustainability gate: repair path (a fixed cause lets the spot fill)", () => {
  it("Classic: a poor-access office stays vacant, then fills once a shaft reaches it (auto-heal)", () => {
    const sim = servedTower(31, "classic", 6);
    // An office at the far edge, past the far-walk tolerance from the central shaft:
    // the gate holds it vacant (Classic office far-walk erodes in both modes).
    const office = place(sim, "office", 2, 0);
    expect(wouldEvictFreshTenant(sim, office, buildSatisfactionContext(sim, true))).toBe(true);
    let guard = 0;
    while (!office.everOccupied && guard++ < 300) sim.tick(60);
    expect(office.everOccupied).toBe(false); // stays empty while access is poor

    // Fix the cause: a shaft right beside it. The gate now allows it and it fills,
    // proving the vacancy auto-heals the moment the placement problem is fixed.
    expect(sim.buildTransport("elevatorStandard", 0, 1, 6).ok).toBe(true);
    const nearShaft = sim.tower.transports[1].id;
    sim.tower.setCars(nearShaft, 8);
    expect(wouldEvictFreshTenant(sim, office, buildSatisfactionContext(sim, true))).toBe(false);
    guard = 0;
    while (!office.everOccupied && guard++ < 2000) sim.tick(60);
    expect(office.everOccupied).toBe(true);

    // Relapse: tear the near shaft back out. Access is poor again (the office is
    // far-walk from the lone central shaft), so a fresh tenant would be gated once
    // more AND the seated office erodes back out and stays vacant. This catches a
    // stale or one-way gate/satisfaction state that a fix-only test would miss.
    sim.tower.removeTransport(nearShaft);
    expect(sim.tower.isFloorServed(2)).toBe(true); // still served by the central shaft
    expect(wouldEvictFreshTenant(sim, office, buildSatisfactionContext(sim, true))).toBe(true);
    guard = 0;
    while (office.everOccupied && guard++ < 4000) sim.tick(60);
    expect(office.everOccupied).toBe(false); // the tenant left and the gate holds it vacant
  });
});

describe("move-in sustainability gate: predicate agrees with the real simulation", () => {
  // Each case: seat a real tenant and run a month. A spot the predicate GATES
  // must actually erode its tenant out (ends empty); a spot it ALLOWS must hold
  // its tenant (stays occupied). The gate and the engine can't disagree.
  const cases: { name: string; mode: GameMode; top: number; build: (sim: Simulation) => Unit }[] = [
    { name: "clean condo", mode: "modern", top: 6, build: (s) => place(s, "condo", 2, C) },
    { name: "clean office", mode: "modern", top: 6, build: (s) => place(s, "office", 2, C + 12) },
    {
      name: "noisy condo (modern)",
      mode: "modern",
      top: 6,
      build: (s) => {
        place(s, "office", 2, C - 9);
        return place(s, "condo", 2, C);
      },
    },
    { name: "far-walk office (modern)", mode: "modern", top: 6, build: (s) => place(s, "office", 2, 0) },
    { name: "very-far condo (classic)", mode: "classic", top: 22, build: (s) => place(s, "condo", 20, C) },
    {
      name: "noisy office (classic, caps only)",
      mode: "classic",
      top: 6,
      build: (s) => {
        place(s, "fastFood", 2, C - 20);
        return place(s, "office", 2, C);
      },
    },
  ];
  for (const c of cases) {
    // 60s budget: the very-far classic case simulates 30 days in a 22-floor
    // tower, ~5s on a warm dev machine and measured past the default timeout
    // on a loaded CI runner. The budget is a hang guard, not a target; the
    // other cases finish in well under a second.
    it(`${c.name}: predicate matches the 30-day outcome`, () => {
      const sim = servedTower(7, c.mode, c.top);
      const u = c.build(sim);
      // Use the exact context the engine's gate builds (congestion neutralized);
      // these fixtures are uncongested so it coincides with the live context, but
      // asserting against the real gate input keeps the differential honest.
      const gated = wouldEvictFreshTenant(sim, u, buildSatisfactionContext(sim, true));
      seat(u);
      for (let d = 0; d < 30; d++) sim.tick(DAY);
      const evicted = u.state === "empty" && !u.everOccupied;
      expect(evicted, `${c.name}: gated=${gated} but evicted=${evicted}`).toBe(gated);
    }, 60_000);
  }
});

describe("move-in sustainability gate: congestion is excluded (transient load never blocks placement)", () => {
  it("a well-placed spot is gated under a frozen high-congestion context but livable under the engine's neutralized one", () => {
    const sim = servedTower(12, "modern");
    const condo = place(sim, "condo", 2, C + 30); // served, near the lobby, no noise: placement is fine
    // A hand-forced rush-hour snapshot: under a context that freezes high
    // congestion, the congestion branch erodes the probe every step and the gate
    // WOULD block this healthy spot. This is exactly the over-block the fix avoids.
    const frozen = buildSatisfactionContext(sim);
    frozen.globalCong = 2;
    frozen.congMap = null;
    expect(wouldEvictFreshTenant(sim, condo, frozen)).toBe(true);
    // The engine builds the gate context with congestion neutralized, so the same
    // spot reads livable and fills like any healthy placement.
    const gate = buildSatisfactionContext(sim, true);
    expect(gate.globalCong).toBe(0);
    expect(gate.congMap).toBeNull();
    expect(wouldEvictFreshTenant(sim, condo, gate)).toBe(false);
    let guard = 0;
    while (!condo.everOccupied && guard++ < 400) sim.tick(60);
    expect(condo.everOccupied).toBe(true);
  });

  it("a FAR-band spot (capped but not eroding) is not gated", () => {
    // Floor 9 with only the ground lobby is 8 floors up: the FAR band (a renewal
    // ceiling of 0.70, NO erosion), so satisfaction caps below 1 but never slides
    // to the 0.40 bar. A cap alone must not gate; only a net erosion does.
    const sim = servedTower(15, "modern", 12);
    const condo = place(sim, "condo", 9, C);
    expect(wouldEvictFreshTenant(sim, condo, buildSatisfactionContext(sim, true))).toBe(false);
  });
});

describe("move-in sustainability gate: the predicate is pure (no RNG, no mutation)", () => {
  it("leaves serialize() byte-identical across many calls (drives no rng, mutates nothing)", () => {
    const sim = servedTower(13, "modern");
    place(sim, "office", 2, C - 9);
    const condo = place(sim, "condo", 2, C);
    const office = place(sim, "office", 2, C + 30);
    for (let i = 0; i < 5; i++) sim.tick(60); // advance to a non-trivial, seeded state
    const before = JSON.stringify(sim.serialize()); // serialize() captures the rng cursor
    for (let i = 0; i < 50; i++) {
      wouldEvictFreshTenant(sim, condo, buildSatisfactionContext(sim, true));
      wouldEvictFreshTenant(sim, office, buildSatisfactionContext(sim, true));
      wontLeaseText(sim, condo);
    }
    expect(JSON.stringify(sim.serialize())).toBe(before);
  });
});
