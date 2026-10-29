import { describe, it, expect } from "vitest";
import { newSeededGame } from "../fixtures/towerFixtures";
import { GRID } from "../../engine/facilities";
import { rentOf, PRICED_KINDS } from "../../engine/econConfig";
import type { Simulation } from "../../engine/Simulation";
import type { FacilityKind, Unit } from "../../engine/types";
import { PortSim, describeEngines, type Leg } from "../portKit/portSim";

/** A served floor-2 tower of `mode` with `n` rooms of `kind`, `width` apart
 *  (all still on the default price). The fixture asserts its own
 *  construction through `mustBuild`. */
function roomTower(leg: Leg, mode: "classic" | "modern", seed: number, kind: FacilityKind, n: number, width: number) {
  const draft = newSeededGame(seed, mode);
  const x0 = Math.floor(GRID.width / 2) - 20;
  for (let i = 0; i < 40; i++) draft.tower.place("floor", 2, x0 + i);
  draft.money = 1e9;
  const sim = new PortSim(leg, draft);
  sim.mustBuildTransport("elevatorStandard", x0, 1, 2);
  for (let i = 0; i < n; i++) sim.mustBuild(kind, 2, x0 + i * width);
  const rooms = () => sim.state.tower.units.filter((u) => u.kind === kind);
  expect(rooms()).toHaveLength(n);
  return { sim, rooms, x0 };
}

/** Mark a condo sold, the way a save carries one: an occupied unit that has
 *  been lived in. (A vacant unit's `everOccupied` does not survive a load.) */
function sell(draft: Simulation, id: number): Unit {
  const condo = draft.tower.units.find((u) => u.id === id)!;
  condo.everOccupied = true;
  condo.state = "occupied";
  return condo;
}

/** A served floor-2 MODERN tower with `n` offices (all still on the default
 *  price). Modern keeps the continuous band, so these band-mechanics tests
 *  (exact targets, clamping, band steps) run against the shape that still has
 *  them; the Classic ladder semantics get their own describe below. */
const officeTower = (leg: Leg, seed = 1, n = 4) => roomTower(leg, "modern", seed, "office", n, 9); // office width 9

/** A served floor-2 CLASSIC tower with `n` offices (all on the Average rung). */
const classicOfficeTower = (leg: Leg, seed = 1, n = 4) => roomTower(leg, "classic", seed, "office", n, 9);

describeEngines("Batch pricing", (leg) => {
  it("sets every office to an exact price", () => {
    const { sim, rooms } = officeTower(leg, 1, 4);
    const res = sim.rentBatch("office", 12_000)!;
    expect(res.matched).toBe(4);
    expect(res.eligible).toBe(4);
    expect(res.changed).toBe(4); // all were at 10,000
    expect(rooms().every((u) => rentOf(u) === 12_000)).toBe(true);
  });

  it("clamps out-of-band targets and counts the clamp", () => {
    const { sim, rooms } = officeTower(leg, 1, 3);
    const high = sim.rentBatch("office", 999_999)!;
    expect(high.clampedHigh).toBe(3);
    expect(rooms().every((u) => rentOf(u) === 20_000)).toBe(true); // band max
    const low = sim.rentBatch("office", 1)!;
    expect(low.clampedLow).toBe(3);
    expect(rooms().every((u) => rentOf(u) === 2_000)).toBe(true); // band min
  });

  it("'default' clears the per-unit override", () => {
    const { sim, rooms } = officeTower(leg, 1, 3);
    sim.rentBatch("office", 15_000);
    expect(rooms().every((u) => u.rent === 15_000)).toBe(true);
    const res = sim.rentBatch("office", "default")!;
    expect(res.changed).toBe(3);
    expect(rooms().every((u) => u.rent === undefined)).toBe(true);
    expect(rooms().every((u) => rentOf(u) === 10_000)).toBe(true); // back to default
  });

  it("onlyDefaultPriced skips hand-tuned units", () => {
    const { sim, rooms } = officeTower(leg, 1, 3);
    const [tuned, second, third] = rooms().map((u) => u.id);
    sim.stepRent(tuned, 1); // hand-tune one office → 11,000
    const res = sim.rentBatch("office", 18_000, { onlyDefaultPriced: true })!;
    expect(res.skippedCustom).toBe(1);
    expect(res.eligible).toBe(2);
    const rent = (id: number) => rentOf(rooms().find((u) => u.id === id)!);
    expect(rent(tuned)).toBe(11_000); // preserved
    expect(rent(second)).toBe(18_000);
    expect(rent(third)).toBe(18_000);
  });

  it("never reprices a sold condo (counted as skippedSold)", () => {
    const { sim, rooms } = roomTower(leg, "modern", 2, "condo", 2, 16); // condo width 16
    const [soldId, openId] = rooms().map((u) => u.id);
    sim.setup((d) => {
      sell(d, soldId);
    });
    const res = sim.rentBatch("condo", 200_000)!;
    expect(res.skippedSold).toBe(1);
    expect(res.matched).toBe(2);
    expect(res.eligible).toBe(1);
    const rent = (id: number) => rentOf(rooms().find((u) => u.id === id)!);
    expect(rent(soldId)).toBe(160_000); // sold one untouched (still the canon 2×-cost default)
    expect(rent(openId)).toBe(200_000);
  });

  it("counts custom prices about to be overwritten when the protect toggle is off", () => {
    const { sim, rooms } = officeTower(leg, 1, 3);
    sim.stepRent(rooms()[0].id, 1); // one hand-tuned office → 11,000
    const res = sim.quoteRentBatch("office", 14_000)!; // toggle off (default)
    expect(res.customOverwritten).toBe(1);
    expect(res.skippedCustom).toBe(0);
    // With the toggle ON the same unit is left alone (skipped, not overwritten).
    const kept = sim.quoteRentBatch("office", 14_000, { onlyDefaultPriced: true })!;
    expect(kept.customOverwritten).toBe(0);
    expect(kept.skippedCustom).toBe(1);
  });

  it("preview computes the same result as apply but mutates nothing", () => {
    const { sim, rooms } = officeTower(leg, 1, 4);
    const preview = sim.quoteRentBatch("office", 13_000)!;
    expect(rooms().every((u) => u.rent === undefined)).toBe(true); // no mutation
    const apply = sim.rentBatch("office", 13_000)!;
    expect(preview).toEqual(apply);
    expect(rooms().every((u) => rentOf(u) === 13_000)).toBe(true);
  });

  it("returns null for a non-priced kind", () => {
    const { sim } = officeTower(leg, 1, 1);
    expect(sim.quoteRentBatch("security", 100)).toBeNull();
    expect(sim.rentBatch("lobby", 100)).toBeNull();
  });

  it("adjustRent still nudges one unit within its band (priceUnit parity)", () => {
    const { sim, rooms } = officeTower(leg, 1, 1);
    const id = rooms()[0].id;
    expect(sim.stepRent(id, 1)).toBe(11_000);
    expect(sim.stepRent(id, -1)).toBe(10_000);
    // clamps at the band edge
    for (let i = 0; i < 30; i++) sim.stepRent(id, 1);
    expect(rentOf(rooms()[0])).toBe(20_000);
  });

  it("every PRICED_KIND has a rent band and preview is deterministic (no RNG/clock)", () => {
    const { sim } = officeTower(leg, 1, 4);
    for (const k of PRICED_KINDS) {
      const a = sim.quoteRentBatch(k, 12_345);
      const b = sim.quoteRentBatch(k, 12_345);
      expect(a).not.toBeNull();
      expect(a).toEqual(b); // two identical previews → deterministic
    }
  });

  it("stores a batched-to-default price as no-override (never counted custom later)", () => {
    const { sim, rooms } = officeTower(leg, 1, 3);
    sim.rentBatch("office", 10_000); // the office default
    expect(rooms().every((u) => u.rent === undefined)).toBe(true); // not stored as custom
    // A later onlyDefaultPriced batch must treat them as default, not custom.
    const res = sim.rentBatch("office", 15_000, { onlyDefaultPriced: true })!;
    expect(res.skippedCustom).toBe(0);
    expect(res.changed).toBe(3);
  });
});

describe("No-Rate units earn nothing until repriced (rentOf)", () => {
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
});

describeEngines("No-Rate units earn nothing until repriced", (leg) => {
  it("adjusting a No-Rate unit's price clears the flag and resumes rent", () => {
    const { sim, rooms } = classicOfficeTower(leg, 1, 1); // Modern never holds No Rate
    const id = rooms()[0].id;
    expect(sim.noRate(id)).toBe(true);
    expect(rentOf(rooms()[0])).toBe(0);
    sim.stepRent(id, 1); // any explicit reprice returns it to market
    expect(rooms()[0].noRate).toBeUndefined();
    expect(rentOf(rooms()[0])).toBeGreaterThan(0);
  });

  it("a batch reprice also clears No-Rate (never a permanent $0 trap)", () => {
    const { sim, rooms } = classicOfficeTower(leg, 1, 2); // Modern never holds No Rate
    expect(sim.noRate(rooms()[0].id)).toBe(true);
    sim.rentBatch("office", 15_000);
    expect(rooms().every((u) => u.noRate === undefined)).toBe(true);
    expect(rooms().every((u) => rentOf(u) === 15_000)).toBe(true);
  });

  it("a batch reprice clears No-Rate only on repriced units; a skipped sold condo keeps it", () => {
    const { sim, rooms } = roomTower(leg, "classic", 2, "condo", 2, 16); // condo width 16; Modern never holds No Rate
    const [soldId, openId] = rooms().map((u) => u.id);
    sim.setup((d) => {
      const sold = sell(d, soldId); // sold → ineligible for reprice
      sold.noRate = true;
      d.tower.units.find((u) => u.id === openId)!.noRate = true; // unsold → will be repriced
    });
    const res = sim.rentBatch("condo", 200_000)!;
    expect(res.skippedSold).toBe(1);
    const byId = (id: number) => rooms().find((u) => u.id === id)!;
    expect(byId(soldId).noRate).toBe(true); // skipped unit KEEPS its flag
    expect(byId(openId).noRate).toBeUndefined(); // repriced unit cleared it
    expect(rentOf(byId(openId))).toBe(200_000);
  });
});

describeEngines("Batch pricing on the Classic ladder", (leg) => {
  it("a rung target applies exactly and an off-ladder target snaps (never clamps)", () => {
    const { sim, rooms } = classicOfficeTower(leg, 1, 3);
    const res = sim.rentBatch("office", 5_000)!; // the Low rung
    expect(res.changed).toBe(3);
    expect(res.clampedLow + res.clampedHigh).toBe(0);
    expect(rooms().every((u) => rentOf(u) === 5_000)).toBe(true);
    // A forged off-ladder target snaps to the nearest rung, ties up.
    const snapped = sim.rentBatch("office", 7_500)!;
    expect(snapped.clampedLow + snapped.clampedHigh).toBe(0);
    expect(rooms().every((u) => rentOf(u) === 10_000)).toBe(true);
  });

  it("'noRate' takes every eligible unit off the market without touching tenants", () => {
    const { sim, rooms } = classicOfficeTower(leg, 2, 3);
    const tenantId = rooms()[0].id;
    sim.setup((d) => {
      const u = d.tower.units.find((q) => q.id === tenantId)!;
      u.state = "occupied";
      u.everOccupied = true;
      u.occupants = 6;
    });
    const preview = sim.quoteRentBatch("office", "noRate")!;
    expect(preview.changed).toBe(3);
    expect(rooms().every((u) => u.noRate === undefined)).toBe(true); // preview is pure
    const res = sim.rentBatch("office", "noRate")!;
    expect(res).toEqual(preview);
    expect(rooms().every((u) => u.noRate === true)).toBe(true);
    // The occupied unit keeps its tenant (no eviction wave) and charges nothing.
    const tenant = rooms().find((u) => u.id === tenantId)!;
    expect(tenant.state).toBe("occupied");
    expect(tenant.occupants).toBe(6);
    expect(rentOf(tenant)).toBe(0);
    // A second pass changes nothing (already off-market).
    expect(sim.quoteRentBatch("office", "noRate")!.changed).toBe(0);
  });

  it("'noRate' skips sold condos (price-locked) and is refused by Modern (seam law)", () => {
    const { sim, rooms } = roomTower(leg, "classic", 3, "condo", 2, 16);
    const [soldId, openId] = rooms().map((u) => u.id);
    sim.setup((d) => {
      sell(d, soldId);
    });
    const res = sim.rentBatch("condo", "noRate")!;
    expect(res.skippedSold).toBe(1);
    expect(res.changed).toBe(1);
    expect(rooms().find((u) => u.id === soldId)!.noRate).toBeUndefined();
    expect(rooms().find((u) => u.id === openId)!.noRate).toBe(true);
    // Modern's engine never holds the state: a "noRate" batch is refused whole.
    const modern = new PortSim(leg, newSeededGame(3, "modern"));
    expect(modern.quoteRentBatch("office", "noRate")).toBeNull();
    expect(modern.rentBatch("office", "noRate")).toBeNull();
  });

  it("onlyDefaultPriced means 'still on Average', and a No Rate unit is not", () => {
    const { sim, rooms } = classicOfficeTower(leg, 4, 3);
    const [highId, offId, avgId] = rooms().map((u) => u.id);
    sim.setRent(highId, 15_000); // High
    sim.setup((d) => {
      d.tower.units.find((u) => u.id === offId)!.noRate = true;
    });
    const res = sim.rentBatch("office", 5_000, { onlyDefaultPriced: true })!;
    expect(res.skippedCustom).toBe(2); // the High unit and the off-market unit
    expect(res.changed).toBe(1);
    const byId = (id: number) => rooms().find((u) => u.id === id)!;
    expect(rentOf(byId(highId))).toBe(15_000);
    expect(byId(offId).noRate).toBe(true); // filter never drags a No Rate unit back on-market
    expect(rentOf(byId(avgId))).toBe(5_000);
  });

  it("adjustRent steps whole rungs in Classic and clamps at the ladder ends", () => {
    const { sim, rooms } = classicOfficeTower(leg, 5, 1);
    const id = rooms()[0].id;
    expect(rentOf(rooms()[0])).toBe(10_000); // new builds start on Average (AR6)
    expect(sim.stepRent(id, 1)).toBe(15_000);
    expect(sim.stepRent(id, 1)).toBe(15_000); // clamped at High
    expect(sim.stepRent(id, -1)).toBe(10_000);
    expect(sim.stepRent(id, -1)).toBe(5_000);
    expect(sim.stepRent(id, -1)).toBe(2_000);
    expect(sim.stepRent(id, -1)).toBe(2_000); // clamped at Very Low
  });
});
