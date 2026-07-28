import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { GameMode, Unit, VacateReason } from "../../engine/types";
import { GRID } from "../../engine/facilities";
import { buildSatisfactionContext, wouldEvictFreshTenant } from "../../engine/sim/satisfactionStep";
import { vacate } from "../../engine/sim/churn";
import { wontLeaseText } from "../../game/gripeCopy";

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

const W = GRID.width;
const C = Math.floor(W / 2);
const DAY = 60 * 24;

/** A full-width ground lobby plus floors 2..top, and a center standard elevator
 *  serving them. Every rentable spot placed on floors 2..top is then served,
 *  reachable, and close to the ground lobby, so the ONLY drain a test introduces
 *  is the one it places (an adjacent office for noise, a high floor for lobby
 *  distance), never a stray access or lobby-far confound. */
function servedTower(seed: number, mode: GameMode, top = 6): Simulation {
  const sim = Simulation.newGame(seed, mode);
  sim.money = 1e12;
  sim.star = 1; // 1-star: no random fire/bomb events to perturb the run
  for (let x = 0; x < W; x++) sim.tower.place("lobby", 1, x);
  for (let f = 2; f <= top; f++) for (let x = 0; x < W; x++) sim.tower.place("floor", f, x);
  sim.buildTransport("elevatorStandard", C, 1, Math.min(top, 30));
  sim.tower.setCars(sim.tower.transports[0].id, 8);
  return sim;
}

function place(sim: Simulation, kind: "office" | "condo" | "fastFood", floor: number, x: number): Unit {
  const r = sim.tower.place(kind, floor, x);
  expect(r.ok, `place ${kind} f${floor} x${x}`).toBe(true);
  return sim.tower.units.find((u) => u.id === r.unitId)!;
}

/** Force-seat a real, happy owner/tenant so a long run reveals whether the spot
 *  SUSTAINS it or erodes it out. A condo is seated as a sold 3-person household. */
function seat(u: Unit): void {
  u.state = "occupied";
  u.everOccupied = true;
  u.satisfaction = 1;
  if (u.kind === "condo") {
    u.residents = 3;
    u.rent = 160_000;
  }
}

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
    });
  }
});

describe("move-in sustainability gate: inspector 'Won't lease' legibility", () => {
  it("names the noise cause on a gated empty Modern condo", () => {
    const sim = servedTower(8, "modern");
    place(sim, "office", 2, C - 9);
    const condo = place(sim, "condo", 2, C);
    const line = wontLeaseText(sim, condo);
    expect(line).not.toBeNull();
    expect(line).toContain("Won't lease");
    expect(line).toContain("noisy neighbor"); // the dominant gripe, surfaced for an empty unit
  });

  it("is silent on a spot that would fill", () => {
    const sim = servedTower(9, "modern");
    const condo = place(sim, "condo", 2, C);
    expect(wontLeaseText(sim, condo)).toBeNull();
  });

  it("defers to the access line (returns null) on an unreachable spot", () => {
    // No transport: the floor is not served, so the access diagnostic owns the
    // explanation and the gate line stays silent, matching the engine (it never
    // reaches the gate for an unreachable floor).
    const sim = Simulation.newGame(10, "modern");
    sim.money = 1e12;
    for (let x = 0; x < W; x++) sim.tower.place("lobby", 1, x);
    for (let x = 0; x < W; x++) sim.tower.place("floor", 2, x);
    const condo = place(sim, "condo", 2, C);
    expect(wontLeaseText(sim, condo)).toBeNull();
  });
});

describe("move-in sustainability gate: honest buy-back toast", () => {
  it("a neglect buy-back says the spot stays empty until the cause is fixed", () => {
    const sim = servedTower(11, "modern");
    place(sim, "office", 2, C - 9);
    const condo = place(sim, "condo", 2, C);
    seat(condo);
    // Drive the owner out through the notice machine, then read the departure toast.
    for (let d = 0; d < 30 && condo.everOccupied; d++) sim.tick(DAY);
    expect(condo.everOccupied).toBe(false); // it did leave
    const backs = sim.log.filter((e) => e.text.includes("bought it back"));
    const toast = backs[backs.length - 1];
    expect(toast, "a buy-back toast fired").toBeDefined();
    expect(toast!.text).toContain("stays empty until you fix the cause");
  });

  it("is honest per cause: the note follows the gate verdict, not just the reason", () => {
    // Seat a sold owner (optionally beside a noise source), vacate for a given
    // reason, and return the departure toast. The note asks the gate directly, so
    // it reflects what actually happens to the repurchased unit.
    const departToast = (seed: number, reason: VacateReason, noisy: boolean): string => {
      const sim = servedTower(seed, "modern");
      if (noisy) place(sim, "office", 2, C - 9); // a live structural drain the gate re-catches
      const condo = place(sim, "condo", 2, C);
      condo.state = "occupied";
      condo.everOccupied = true; // a SOLD owner, so the buy-back (and its note) fires
      condo.residents = 3;
      condo.rent = 160_000;
      vacate(sim, condo, reason);
      return sim.log[sim.log.length - 1].text;
    };

    // A live structural drain present: the gate re-holds the spot, so the note
    // says it stays empty for ANY reason, INCLUDING a congestion eviction that
    // co-occurred. Inferring from the reason alone would have mislabeled this
    // "add cars" and promised a re-sale the gate then refuses.
    const structuralCong = departToast(20, "congestion", true);
    expect(structuralCong).toContain("bought it back");
    expect(structuralCong).toContain("It stays empty until you fix the cause");
    expect(structuralCong).not.toContain("add cars");
    expect(departToast(21, "noise", true)).toContain("It stays empty until you fix the cause");

    // No structural drain: a congestion eviction re-sells, so the note warns the
    // crowding will keep churning owners until cars are added, and does NOT claim
    // the spot stays empty.
    const cleanCong = departToast(22, "congestion", false);
    expect(cleanCong).toContain("until you add cars");
    expect(cleanCong).not.toContain("stays empty");

    // A relocation onto a re-sellable (clean) spot gets no caveat; onto a doomed
    // (noisy) spot it honestly says it stays empty.
    const cleanReloc = departToast(23, "relocation", false);
    expect(cleanReloc).toContain("bought it back");
    expect(cleanReloc).not.toContain("stays empty");
    expect(cleanReloc).not.toContain("add cars");
    expect(departToast(24, "relocation", true)).toContain("It stays empty until you fix the cause");
  });

  it("evicts a doomed spot exactly once and never re-sells (the churn is truly stopped)", () => {
    const sim = servedTower(14, "modern");
    place(sim, "office", 2, C - 9);
    const condo = place(sim, "condo", 2, C);
    seat(condo); // a real sold owner in a noise-doomed spot
    for (let d = 0; d < 60; d++) sim.tick(DAY); // long past the single eviction
    expect(condo.state).toBe("empty");
    expect(condo.everOccupied).toBe(false);
    // Exactly ONE departure/buy-back, and no sale ever re-lists it: the endless
    // sell -> evict -> buy-back -> resell loop is broken, not merely slowed.
    expect(sim.log.filter((e) => e.text.includes("bought it back")).length).toBe(1);
    expect(sim.log.some((e) => e.text.includes("Condominium") && e.text.includes("sold"))).toBe(false);
  });
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
