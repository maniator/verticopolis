import { describe, it, expect } from "vitest";
import {
  FACILITIES,
  GRID,
  LOT_WIDTH,
  MAX_CARS,
  POOLED_CAPS,
  STAR_THRESHOLDS,
  TOWER_POPULATION,
  maxSpanFor,
} from "../engine/facilities";
import { ECON } from "../engine/econConfig";

/**
 * Canon tripwire — engine constants asserted against the 1994 original's
 * ground truth as documented in docs/canon/tdt-format.md (facts derived from
 * OpenSkyscraper's reverse-engineered .TDT save format). Each block cites the
 * section of that page it guards. If a test here fails, either the change
 * broke canon (fix the change) or canon itself was re-derived from a better
 * source (update docs/canon/tdt-format.md and PARITY.md first, then this
 * table — never the other way around).
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

  it("every elevator kind supports 8 cars per shaft — service included", () => {
    expect(MAX_CARS.elevatorStandard).toBe(8);
    expect(MAX_CARS.elevatorService).toBe(8);
    expect(MAX_CARS.elevatorExpress).toBe(8);
  });

  it("spans: standard/service 30 floors, express the whole tower, walkways fixed links", () => {
    expect(maxSpanFor("elevatorStandard")).toBe(30);
    expect(maxSpanFor("elevatorService")).toBe(30);
    expect(maxSpanFor("elevatorExpress")).toBe(GRID.maxFloor - GRID.minFloor);
    expect(maxSpanFor("stairs")).toBe(1);
    expect(maxSpanFor("escalator")).toBe(1);
  });
});

describe("canon: tower geometry (tdt-format.md §4)", () => {
  it("floors run B10 (−9) through 100, matching the TDT floor map", () => {
    expect(GRID.maxFloor).toBe(100);
    expect(GRID.minFloor).toBe(-9); // floor 0 = B1, so −9 = B10
  });

  it("the buildable lot is the canon 375 segments wide", () => {
    expect(LOT_WIDTH).toBe(375);
    expect(GRID.width).toBe(LOT_WIDTH);
  });
});

describe("canon: star ladder (tdt-format.md §1)", () => {
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
