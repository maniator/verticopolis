import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { VacateReason } from "../../engine/types";
import { vacate } from "../../engine/sim/churn";
import { wontLeaseText } from "../../game/gripeCopy";
import { W, C, DAY, servedTower, place, seat } from "./moveInGateHelpers";

/**
 * The inspector "Won't lease" line and the buy-back departure toast for the
 * move-in sustainability gate (spec-move-in-sustainability-gate-2026-07-23): the
 * legibility that tells the player WHY a spot stays empty and what the repurchased
 * unit costs. Split from the core-behavior suite to stay under the file-size guard;
 * both share moveInGateHelpers.
 */

describe("move-in sustainability gate: inspector 'Won't lease' legibility", () => {
  it("names the noise cause on a gated empty Modern condo, and telegraphs the carrying cost", () => {
    const sim = servedTower(8, "modern");
    place(sim, "office", 2, C - 9);
    const condo = place(sim, "condo", 2, C);
    const line = wontLeaseText(sim, condo);
    expect(line).not.toBeNull();
    expect(line).toContain("Won't lease");
    expect(line).toContain("noisy neighbor"); // the dominant gripe, surfaced for an empty unit
    // The spec's "fix it or raze it": a held Modern unit keeps bleeding overhead
    // (and hold tax for a condo), so the note names the cost and the bulldoze escape.
    expect(line).toContain("to hold empty");
    expect(line).toContain("bulldoze it");
  });

  it("omits the carrying-cost note in Classic (no overhead or hold tax)", () => {
    const sim = servedTower(41, "classic");
    // A far-walk office is gated in Classic too, but Classic has no holding sink.
    const office = place(sim, "office", 2, 0);
    const line = wontLeaseText(sim, office);
    expect(line).not.toBeNull();
    expect(line).not.toContain("to hold empty");
  });

  it("gives a nightclub-gated vacancy the cross-floor remedy, not the lobby-tile advice", () => {
    const sim = servedTower(40, "modern", 4);
    // A nightclub one floor below the condo: its halo noise carries BETWEEN floors
    // and a lobby tile does not shield it. There is no same-floor source, so the
    // condo is not noiseAfflicted, and the generic "put a lobby tile" advice would
    // be a fix that never restores leasing.
    const clubR = sim.tower.place("nightclub", 2, C);
    expect(clubR.ok).toBe(true);
    sim.tower.units.find((u) => u.id === clubR.unitId)!.state = "occupied";
    const condo = place(sim, "condo", 3, C);
    expect(sim.noiseAfflicted(condo)).toBe(false); // cross-floor, not an adjacent source
    const line = wontLeaseText(sim, condo);
    expect(line).not.toBeNull();
    expect(line).toContain("nightclub");
    expect(line).toContain("carries between floors");
    expect(line).not.toContain("shields it"); // never the same-floor lobby-tile remedy
  });

  it("names the retail shortage on a spot gated only by unmet demand (candidate-aware cause)", () => {
    // Retail exists but stranded (floor 10 has no shaft), so a fresh tenant on the
    // reachable floor 2 reaches none of it. dominantGripe reads the real demand map
    // where the empty unit is not an origin, so without the candidate-aware cause
    // this would fall to the generic line; it must name the retail shortage.
    const sim = Simulation.newGame(42, "modern");
    sim.money = 1e12;
    sim.star = 1;
    for (let x = 0; x < W; x++) sim.tower.place("lobby", 1, x);
    for (let f = 2; f <= 10; f++) for (let x = 0; x < W; x++) sim.tower.place("floor", f, x);
    expect(sim.buildTransport("elevatorStandard", C, 1, 6).ok).toBe(true);
    sim.tower.setCars(sim.tower.transports[0].id, 8);
    // Assert the exact topology the case depends on: floor 2 reachable (the tenant),
    // floor 10 served-but-stranded (its retail unreachable), so a routing/cap change
    // can't silently turn this into a different demand condition.
    expect(sim.tower.units.filter((u) => u.kind === "floor" && u.floor === 10).length).toBe(W);
    expect(sim.floorReachable(2)).toBe(true);
    expect(sim.floorReachable(10)).toBe(false);
    place(sim, "fastFood", 10, C); // stranded retail
    const condo = place(sim, "condo", 2, C);
    const line = wontLeaseText(sim, condo);
    expect(line).not.toBeNull();
    expect(line).toContain("shops"); // the retail cause, not the generic fallback
    expect(line).not.toContain("Fix the flagged problem"); // the generic fallback string
  });

  it("presents both remedies when a condo has an adjacent source AND a nearby nightclub", () => {
    const sim = servedTower(43, "modern", 6);
    const club = sim.tower.place("nightclub", 2, C - 40); // 2 floors below: within the halo
    expect(club.ok).toBe(true);
    sim.tower.units.find((u) => u.id === club.unitId)!.state = "occupied";
    place(sim, "fastFood", 4, C - 20); // an adjacent same-floor source (the binding cause)
    const condo = place(sim, "condo", 4, C);
    expect(sim.noiseAfflicted(condo)).toBe(true);
    const line = wontLeaseText(sim, condo);
    expect(line).not.toBeNull();
    expect(line).toContain("lobby tile"); // the same-floor remedy (moving only the club would not help)
    expect(line).toContain("nightclub"); // and the cross-floor remedy
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

    // A No Rate owned condo is off-market, so attemptMoveIns skips it regardless of
    // the gate: the note must point to setting a rate, not the placement.
    const sim = servedTower(25, "modern");
    const condo = place(sim, "condo", 2, C);
    condo.state = "occupied";
    condo.everOccupied = true;
    condo.residents = 3;
    condo.rent = 160_000;
    condo.noRate = true;
    vacate(sim, condo, "noise");
    const noRateToast = sim.log[sim.log.length - 1].text;
    expect(noRateToast).toContain("off the market (No Rate)");
    expect(noRateToast).not.toContain("stays empty until you fix");
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
