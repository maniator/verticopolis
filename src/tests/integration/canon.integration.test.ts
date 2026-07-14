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
} from "../../engine/facilities";
import { ECON } from "../../engine/econConfig";
import { FASTFOOD_SUBTYPES, RESTAURANT_SUBTYPES, SHOP_SUBTYPES, subtypeListFor } from "../../engine/retailSubtypes";

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

  // Per-car passenger capacity: the value each elevator's .TDT header stores as
  // its per-car capacity (tdt-format.md §8): express 42, standard 21, service 10.
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

  it("commercial venue populations scale with footprint (shop 20, fastFood 25, restaurant 35)", () => {
    // Design note: Verticopolis uses footprint-scaled ambient occupant counts
    // (larger room, more customers; not a strict per-tile ratio)
    // for the renderer heatmap. The 1994 Finance Window used a flat 35 per venue
    // (fastFood 5 units × 35 = 175 per inspector data). Our values diverge by design:
    // shop (12 tiles) = 20, fastFood (16 tiles) = 25, restaurant (24 tiles) = 35.
    // All three are positive so the census gate (population > 0) is preserved; the
    // live population census uses u.customersIn (meal round-trippers), not this field.
    expect(FACILITIES.shop.population).toBe(20);
    expect(FACILITIES.fastFood.population).toBe(25);
    expect(FACILITIES.restaurant.population).toBe(35);
    // Gate invariant: all are positive so isCommercialKind population > 0 check holds.
    expect(FACILITIES.shop.population).toBeGreaterThan(0);
    expect(FACILITIES.fastFood.population).toBeGreaterThan(0);
    expect(FACILITIES.restaurant.population).toBeGreaterThan(0);
  });
});

describe("canon: economy anchors (tdt-format.md §2)", () => {
  it("a tower is founded with $2,000,000 (display dollars, never ×100 storage)", () => {
    expect(ECON.startingMoney).toBe(2_000_000);
  });
});

describe("canon: retail subtypes (tdt-format.md §7)", () => {
  // Order is load-bearing: the .TDT format writes an ORDINAL byte, not a
  // string, so an index change here would silently reinterpret every legacy
  // save's variants. Match the canon doc §7 lists verbatim.
  it("has 5 restaurant variants in §7 order", () => {
    expect([...RESTAURANT_SUBTYPES]).toEqual([
      "English Pub",
      "French",
      "Chinese",
      "Sushi Bar",
      "Steak House",
    ]);
  });

  it("has 5 fast-food variants in §7 order", () => {
    expect([...FASTFOOD_SUBTYPES]).toEqual([
      "Japanese Soba",
      "Chinese Cafe",
      "Hamburger Stand",
      "Ice Cream",
      "Coffee Shop",
    ]);
  });

  it("has 11 shop variants in §7 order", () => {
    expect([...SHOP_SUBTYPES]).toEqual([
      "Men's Clothing",
      "Pet Store",
      "Flower Shop",
      "Book Store",
      "Drug Store",
      "Boutique",
      "Electronics",
      "Bank",
      "Hair Salon",
      "Post Office",
      "Sports Gear",
    ]);
  });

  // The commercial-venue inspector converts a venue's traffic income into a
  // customer estimate via `ECON.retailSpendPerCustomer[kind]`. Every kind that
  // carries a canon subtype list MUST be tabled there, or that venue's whole
  // inspector block silently disappears (the guard returns "" on an undefined
  // spend). This pins the coupling so a new retail kind can't ship half-wired.
  it("tables a positive spend-per-customer for every retail subtype kind", () => {
    for (const kind of ["shop", "fastFood", "restaurant"] as const) {
      expect(subtypeListFor(kind)).not.toBeNull();
      const spend = ECON.retailSpendPerCustomer[kind];
      expect(spend).toBeDefined();
      expect(spend!).toBeGreaterThan(0);
    }
  });
});
