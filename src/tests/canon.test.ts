import { describe, it, expect } from "vitest";
import {
  FACILITIES,
  GRID,
  LOT_WIDTH,
  MAX_CARS,
  POOLED_CAPS,
  STAR_THRESHOLDS,
  TOWER_POPULATION,
  TRANSPORT_CAPACITY,
  maxSpanFor,
} from "../engine/facilities";
import { ECON } from "../engine/econConfig";

/**
 * Canon tripwire — engine constants asserted against the 1994 original's
 * ground truth. Each block cites its source: a docs/canon/tdt-format.md
 * section where the .TDT save format documents the fact, or the FAQ-derived
 * canon (CLAUDE.md "Canon reference" / PARITY.md / the constant's own sourced
 * comment in facilities.ts) where the save format doesn't carry it. If a test
 * here fails, either the change broke canon (fix the change) or canon itself
 * was re-derived from a better source (update the cited canon page first,
 * then this table — never the other way around).
 */

describe("canon: transport pools (tdt-format.md §8)", () => {
  it("all three elevator kinds share one 24-shaft pool", () => {
    const pool = POOLED_CAPS.find((p) => p.kinds.includes("elevatorStandard"));
    expect(pool).toBeDefined();
    expect(pool!.cap).toBe(24);
    expect([...pool!.kinds].sort()).toEqual(
      ["elevatorExpress", "elevatorService", "elevatorStandard"].sort(),
    );
  });

  it("stairs and escalators share one 64-link pool", () => {
    const pool = POOLED_CAPS.find((p) => p.kinds.includes("stairs"));
    expect(pool).toBeDefined();
    expect(pool!.cap).toBe(64);
    expect([...pool!.kinds].sort()).toEqual(["escalator", "stairs"].sort());
  });

  // Cars-per-shaft and spans are FAQ canon (CLAUDE.md "Canon reference"),
  // not carried by the save format — the TDT elevator block merely varies
  // with car count, consistent with these caps.
  it("every elevator kind supports 8 cars per shaft — service included (FAQ canon)", () => {
    expect(MAX_CARS.elevatorStandard).toBe(8);
    expect(MAX_CARS.elevatorService).toBe(8);
    expect(MAX_CARS.elevatorExpress).toBe(8);
  });

  it("spans (in floor GAPS, floors served = span + 1): standard/service 30, express the whole tower, walkways one gap = a fixed two-floor link (FAQ canon)", () => {
    expect(maxSpanFor("elevatorStandard")).toBe(30);
    expect(maxSpanFor("elevatorService")).toBe(30);
    expect(maxSpanFor("elevatorExpress")).toBe(GRID.maxFloor - GRID.minFloor);
    expect(maxSpanFor("stairs")).toBe(1);
    expect(maxSpanFor("escalator")).toBe(1);
  });

  // Per-car passenger capacity is the value the .TDT save stores per shaft
  // (tdt-format.md §8): express 42, standard 21, service 10.
  it("car capacities match the save's stored values (express 42 / standard 21 / service 10)", () => {
    expect(TRANSPORT_CAPACITY.elevatorExpress).toBe(42);
    expect(TRANSPORT_CAPACITY.elevatorStandard).toBe(21);
    expect(TRANSPORT_CAPACITY.elevatorService).toBe(10);
  });
});

describe("canon: tower geometry (tdt-format.md §4)", () => {
  it("floors run B10 (−9) through 100, matching the TDT floor map", () => {
    expect(GRID.maxFloor).toBe(100);
    expect(GRID.minFloor).toBe(-9); // floor 0 = B1, so −9 = B10
  });

  it("the buildable lot is the canon 375 segments wide (FAQ canon; tenant extents in the save are in the same segment unit, §4)", () => {
    expect(LOT_WIDTH).toBe(375);
    // GRID.width is defined as LOT_WIDTH, so pin it to the literal too —
    // asserting it against LOT_WIDTH would be a tautology.
    expect(GRID.width).toBe(375);
  });
});

// The numeric thresholds are FAQ canon (see STAR_THRESHOLDS' sourced comment
// in facilities.ts); the save format contributes only the level field's shape
// (1–5 stars, 6 = TOWER — tdt-format.md §1).
describe("canon: star ladder (FAQ canon; level 6 = TOWER per tdt-format.md §1)", () => {
  it("population thresholds are the 1994 ladder", () => {
    expect(STAR_THRESHOLDS[2]).toBe(300);
    expect(STAR_THRESHOLDS[3]).toBe(1000);
    expect(STAR_THRESHOLDS[4]).toBe(5000);
    expect(STAR_THRESHOLDS[5]).toBe(10000);
  });

  it("TOWER is the canonical 15,000 occupants (the level-6 rating)", () => {
    expect(TOWER_POPULATION).toBe(15000);
  });
});

describe("canon: tenant populations (tdt-format.md §6)", () => {
  it("an office holds 6 workers and a condo 3 residents", () => {
    expect(FACILITIES.office.population).toBe(6);
    expect(FACILITIES.condo.population).toBe(3);
  });

  it("commercial venues carry no census population (customers are not occupants)", () => {
    // The TDT's fast-food figure of 48 counts workers + CUSTOMERS; the census
    // metric is occupants only, so commercial kinds must stay at 0 here.
    expect(FACILITIES.fastFood.population).toBe(0);
    expect(FACILITIES.restaurant.population).toBe(0);
    expect(FACILITIES.shop.population).toBe(0);
  });
});

describe("canon: economy anchors (tdt-format.md §2)", () => {
  it("a tower is founded with $2,000,000 (display dollars, never ×100 storage)", () => {
    expect(ECON.startingMoney).toBe(2_000_000);
  });
});
