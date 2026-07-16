import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { rentOf, PRICED_KINDS } from "../../engine/econConfig";

/** A served floor-2 MODERN tower with `n` offices (all still on the default
 *  price). Modern keeps the continuous band, so these band-mechanics tests
 *  (exact targets, clamping, band steps) run against the shape that still has
 *  them; the Classic ladder semantics get their own describe below. */
function officeTower(seed = 1, n = 4) {
  const sim = Simulation.newGame(seed, "modern");
  const x0 = Math.floor(GRID.width / 2) - 20;
  for (let i = 0; i < 40; i++) sim.tower.place("floor", 2, x0 + i);
  sim.buildTransport("elevatorStandard", x0, 1, 2);
  sim.money = 1e9;
  for (let i = 0; i < n; i++) sim.build("office", 2, x0 + i * 9); // office width 9
  const offices = sim.tower.units.filter((u) => u.kind === "office");
  return { sim, offices, x0 };
}

describe("Batch pricing", () => {
  it("sets every office to an exact price", () => {
    const { sim, offices } = officeTower(1, 4);
    const res = sim.applyRentBatch("office", 12_000)!;
    expect(res.matched).toBe(4);
    expect(res.eligible).toBe(4);
    expect(res.changed).toBe(4); // all were at 10,000
    expect(offices.every((u) => rentOf(u) === 12_000)).toBe(true);
  });

  it("clamps out-of-band targets and counts the clamp", () => {
    const { sim, offices } = officeTower(1, 3);
    const high = sim.applyRentBatch("office", 999_999)!;
    expect(high.clampedHigh).toBe(3);
    expect(offices.every((u) => rentOf(u) === 20_000)).toBe(true); // band max
    const low = sim.applyRentBatch("office", 1)!;
    expect(low.clampedLow).toBe(3);
    expect(offices.every((u) => rentOf(u) === 2_000)).toBe(true); // band min
  });

  it("'default' clears the per-unit override", () => {
    const { sim, offices } = officeTower(1, 3);
    sim.applyRentBatch("office", 15_000);
    expect(offices.every((u) => u.rent === 15_000)).toBe(true);
    const res = sim.applyRentBatch("office", "default")!;
    expect(res.changed).toBe(3);
    expect(offices.every((u) => u.rent === undefined)).toBe(true);
    expect(offices.every((u) => rentOf(u) === 10_000)).toBe(true); // back to default
  });

  it("onlyDefaultPriced skips hand-tuned units", () => {
    const { sim, offices } = officeTower(1, 3);
    sim.adjustRent(offices[0].id, 1); // hand-tune one office → 11,000
    const res = sim.applyRentBatch("office", 18_000, { onlyDefaultPriced: true })!;
    expect(res.skippedCustom).toBe(1);
    expect(res.eligible).toBe(2);
    expect(rentOf(offices[0])).toBe(11_000); // preserved
    expect(rentOf(offices[1])).toBe(18_000);
    expect(rentOf(offices[2])).toBe(18_000);
  });

  it("never reprices a sold condo (counted as skippedSold)", () => {
    const sim = Simulation.newGame(2, "modern");
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let i = 0; i < 40; i++) sim.tower.place("floor", 2, x0 + i);
    sim.buildTransport("elevatorStandard", x0, 1, 2);
    sim.money = 1e9;
    sim.build("condo", 2, x0);
    sim.build("condo", 2, x0 + 16); // condo width 16
    const condos = sim.tower.units.filter((u) => u.kind === "condo");
    condos[0].everOccupied = true; // sold
    const res = sim.applyRentBatch("condo", 200_000)!;
    expect(res.skippedSold).toBe(1);
    expect(res.matched).toBe(2);
    expect(res.eligible).toBe(1);
    expect(rentOf(condos[0])).toBe(160_000); // sold one untouched (still the canon 2×-cost default)
    expect(rentOf(condos[1])).toBe(200_000);
  });

  it("counts custom prices about to be overwritten when the protect toggle is off", () => {
    const { sim, offices } = officeTower(1, 3);
    sim.adjustRent(offices[0].id, 1); // one hand-tuned office → 11,000
    const res = sim.previewRentBatch("office", 14_000)!; // toggle off (default)
    expect(res.customOverwritten).toBe(1);
    expect(res.skippedCustom).toBe(0);
    // With the toggle ON the same unit is left alone (skipped, not overwritten).
    const kept = sim.previewRentBatch("office", 14_000, { onlyDefaultPriced: true })!;
    expect(kept.customOverwritten).toBe(0);
    expect(kept.skippedCustom).toBe(1);
  });

  it("preview computes the same result as apply but mutates nothing", () => {
    const { sim, offices } = officeTower(1, 4);
    const preview = sim.previewRentBatch("office", 13_000)!;
    expect(offices.every((u) => u.rent === undefined)).toBe(true); // no mutation
    const apply = sim.applyRentBatch("office", 13_000)!;
    expect(preview).toEqual(apply);
    expect(offices.every((u) => rentOf(u) === 13_000)).toBe(true);
  });

  it("returns null for a non-priced kind", () => {
    const { sim } = officeTower(1, 1);
    expect(sim.previewRentBatch("security", 100)).toBeNull();
    expect(sim.applyRentBatch("lobby", 100)).toBeNull();
  });

  it("adjustRent still nudges one unit within its band (priceUnit parity)", () => {
    const { sim, offices } = officeTower(1, 1);
    expect(sim.adjustRent(offices[0].id, 1)).toBe(11_000);
    expect(sim.adjustRent(offices[0].id, -1)).toBe(10_000);
    // clamps at the band edge
    for (let i = 0; i < 30; i++) sim.adjustRent(offices[0].id, 1);
    expect(rentOf(offices[0])).toBe(20_000);
  });

  it("every PRICED_KIND has a rent band and preview is deterministic (no RNG/clock)", () => {
    const { sim } = officeTower(1, 4);
    for (const k of PRICED_KINDS) {
      const a = sim.previewRentBatch(k, 12_345);
      const b = sim.previewRentBatch(k, 12_345);
      expect(a).not.toBeNull();
      expect(a).toEqual(b); // two identical previews → deterministic
    }
  });

  it("stores a batched-to-default price as no-override (never counted custom later)", () => {
    const { sim, offices } = officeTower(1, 3);
    sim.applyRentBatch("office", 10_000); // the office default
    expect(offices.every((u) => u.rent === undefined)).toBe(true); // not stored as custom
    // A later onlyDefaultPriced batch must treat them as default, not custom.
    const res = sim.applyRentBatch("office", 15_000, { onlyDefaultPriced: true })!;
    expect(res.skippedCustom).toBe(0);
    expect(res.changed).toBe(3);
  });
});

describe("No-Rate units earn nothing until repriced", () => {
  it("rentOf returns 0 for a No-Rate unit of every priced kind, ignoring any stored rent", () => {
    for (const kind of PRICED_KINDS) {
      expect(rentOf({ kind, noRate: true })).toBe(0);
      // An override is inert while the unit is off the market.
      expect(rentOf({ kind, rent: 99_999, noRate: true })).toBe(0);
    }
    // Flag clear (undefined/false) reads the price normally.
    expect(rentOf({ kind: "office", rent: 12_000 })).toBe(12_000);
    expect(rentOf({ kind: "office", rent: 12_000, noRate: false })).toBe(12_000);
  });

  it("adjusting a No-Rate unit's price clears the flag and resumes rent", () => {
    const { sim, offices } = officeTower(1, 1);
    const office = offices[0];
    office.noRate = true;
    expect(rentOf(office)).toBe(0);
    sim.adjustRent(office.id, 1); // any explicit reprice returns it to market
    expect(office.noRate).toBeUndefined();
    expect(rentOf(office)).toBeGreaterThan(0);
  });

  it("a batch reprice also clears No-Rate (never a permanent $0 trap)", () => {
    const { sim, offices } = officeTower(1, 2);
    offices[0].noRate = true;
    sim.applyRentBatch("office", 15_000);
    expect(offices.every((u) => u.noRate === undefined)).toBe(true);
    expect(offices.every((u) => rentOf(u) === 15_000)).toBe(true);
  });

  it("a batch reprice clears No-Rate only on repriced units; a skipped sold condo keeps it", () => {
    const sim = Simulation.newGame(2, "modern");
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let i = 0; i < 40; i++) sim.tower.place("floor", 2, x0 + i);
    sim.buildTransport("elevatorStandard", x0, 1, 2);
    sim.money = 1e9;
    sim.build("condo", 2, x0);
    sim.build("condo", 2, x0 + 16); // condo width 16
    const condos = sim.tower.units.filter((u) => u.kind === "condo");
    condos[0].everOccupied = true; // sold → ineligible for reprice
    condos[0].noRate = true;
    condos[1].noRate = true; // unsold → will be repriced
    const res = sim.applyRentBatch("condo", 200_000)!;
    expect(res.skippedSold).toBe(1);
    expect(condos[0].noRate).toBe(true); // skipped unit KEEPS its flag
    expect(condos[1].noRate).toBeUndefined(); // repriced unit cleared it
    expect(rentOf(condos[1])).toBe(200_000);
  });
});

/** A served floor-2 CLASSIC tower with `n` offices (all on the Average rung). */
function classicOfficeTower(seed = 1, n = 4) {
  const sim = Simulation.newGame(seed);
  const x0 = Math.floor(GRID.width / 2) - 20;
  for (let i = 0; i < 40; i++) sim.tower.place("floor", 2, x0 + i);
  sim.buildTransport("elevatorStandard", x0, 1, 2);
  sim.money = 1e9;
  for (let i = 0; i < n; i++) expect(sim.build("office", 2, x0 + i * 9).ok).toBe(true);
  const offices = sim.tower.units.filter((u) => u.kind === "office");
  return { sim, offices, x0 };
}

describe("Batch pricing on the Classic ladder", () => {
  it("a rung target applies exactly and an off-ladder target snaps (never clamps)", () => {
    const { sim, offices } = classicOfficeTower(1, 3);
    const res = sim.applyRentBatch("office", 5_000)!; // the Low rung
    expect(res.changed).toBe(3);
    expect(res.clampedLow + res.clampedHigh).toBe(0);
    expect(offices.every((u) => rentOf(u) === 5_000)).toBe(true);
    // A forged off-ladder target snaps to the nearest rung, ties up.
    const snapped = sim.applyRentBatch("office", 7_500)!;
    expect(snapped.clampedLow + snapped.clampedHigh).toBe(0);
    expect(offices.every((u) => rentOf(u) === 10_000)).toBe(true);
  });

  it("'noRate' takes every eligible unit off the market without touching tenants", () => {
    const { sim, offices } = classicOfficeTower(2, 3);
    offices[0].state = "occupied";
    offices[0].everOccupied = true;
    offices[0].occupants = 6;
    const preview = sim.previewRentBatch("office", "noRate")!;
    expect(preview.changed).toBe(3);
    expect(offices.every((u) => u.noRate === undefined)).toBe(true); // preview is pure
    const res = sim.applyRentBatch("office", "noRate")!;
    expect(res).toEqual(preview);
    expect(offices.every((u) => u.noRate === true)).toBe(true);
    // The occupied unit keeps its tenant (no eviction wave) and charges nothing.
    expect(offices[0].state).toBe("occupied");
    expect(offices[0].occupants).toBe(6);
    expect(rentOf(offices[0])).toBe(0);
    // A second pass changes nothing (already off-market).
    expect(sim.previewRentBatch("office", "noRate")!.changed).toBe(0);
  });

  it("'noRate' skips sold condos (price-locked) and is refused by Modern (seam law)", () => {
    const sim = Simulation.newGame(3);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let i = 0; i < 40; i++) sim.tower.place("floor", 2, x0 + i);
    sim.buildTransport("elevatorStandard", x0, 1, 2);
    sim.money = 1e9;
    expect(sim.build("condo", 2, x0).ok).toBe(true);
    expect(sim.build("condo", 2, x0 + 16).ok).toBe(true);
    const condos = sim.tower.units.filter((u) => u.kind === "condo");
    condos[0].everOccupied = true; // sold
    const res = sim.applyRentBatch("condo", "noRate")!;
    expect(res.skippedSold).toBe(1);
    expect(res.changed).toBe(1);
    expect(condos[0].noRate).toBeUndefined();
    expect(condos[1].noRate).toBe(true);
    // Modern's engine never holds the state: a "noRate" batch is refused whole.
    const modern = Simulation.newGame(3, "modern");
    expect(modern.previewRentBatch("office", "noRate")).toBeNull();
    expect(modern.applyRentBatch("office", "noRate")).toBeNull();
  });

  it("onlyDefaultPriced means 'still on Average', and a No Rate unit is not", () => {
    const { sim, offices } = classicOfficeTower(4, 3);
    sim.priceUnit(offices[0], 15_000); // High
    offices[1].noRate = true;
    const res = sim.applyRentBatch("office", 5_000, { onlyDefaultPriced: true })!;
    expect(res.skippedCustom).toBe(2); // the High unit and the off-market unit
    expect(res.changed).toBe(1);
    expect(rentOf(offices[0])).toBe(15_000);
    expect(offices[1].noRate).toBe(true); // filter never drags a No Rate unit back on-market
    expect(rentOf(offices[2])).toBe(5_000);
  });

  it("adjustRent steps whole rungs in Classic and clamps at the ladder ends", () => {
    const { sim, offices } = classicOfficeTower(5, 1);
    const id = offices[0].id;
    expect(rentOf(offices[0])).toBe(10_000); // new builds start on Average (AR6)
    expect(sim.adjustRent(id, 1)).toBe(15_000);
    expect(sim.adjustRent(id, 1)).toBe(15_000); // clamped at High
    expect(sim.adjustRent(id, -1)).toBe(10_000);
    expect(sim.adjustRent(id, -1)).toBe(5_000);
    expect(sim.adjustRent(id, -1)).toBe(2_000);
    expect(sim.adjustRent(id, -1)).toBe(2_000); // clamped at Very Low
  });
});
