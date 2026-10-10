import { describe, expect, it } from "vitest";
import { catalogFor, type Catalog, type CatalogFacility } from "./catalog";
import { GRID } from "./facilities";
import { Simulation } from "./Simulation";

const entry = (c: Catalog, key: string): CatalogFacility => {
  const f = c.facilities.find((e) => e.key === key);
  if (!f) throw new Error(`no ${key} in the catalog`);
  return f;
};

describe("catalogFor", () => {
  // The canon pooling of CLAUDE.md, read back through the catalog.
  it("states the canon pools, caps, cars and spans", () => {
    const c = catalogFor("modern");
    expect(c.pools).toEqual([
      { key: "elevators", label: "elevator shafts", cap: 24, kinds: ["elevatorStandard", "elevatorService", "elevatorExpress"] },
      { key: "walkways", label: "stairs/escalators", cap: 64, kinds: ["stairs", "escalator"] },
    ]);
    for (const key of ["elevatorStandard", "elevatorService", "elevatorExpress"]) {
      expect(entry(c, key)).toMatchObject({ pool: "elevators", maxCars: 8, fixedSpan: false });
    }
    expect(entry(c, "elevatorStandard").maxSpan).toBe(30);
    expect(entry(c, "elevatorService").maxSpan).toBe(30);
    expect(entry(c, "elevatorExpress").maxSpan).toBe(GRID.maxFloor - GRID.minFloor);
    for (const key of ["stairs", "escalator"]) {
      expect(entry(c, key)).toMatchObject({ pool: "walkways", maxSpan: 1, maxCars: null, fixedSpan: true });
    }
    for (const f of c.facilities.filter((e) => e.transport)) expect(f.buildMinutes, f.key).toBe(0);
    expect(entry(c, "metro").buildCap).toBe(1);
    expect(entry(c, "office")).toMatchObject({ buildCap: null, pool: null, maxSpan: null, carCapacity: null });
  });

  it("resolves availability, rent shape and mode-split economy for the mode", () => {
    const classic = catalogFor("classic");
    const modern = catalogFor("modern");
    expect(entry(classic, "foodHall").available).toBe(false);
    expect(entry(modern, "foodHall").available).toBe(true);
    expect(entry(classic, "condo").rent).toMatchObject({ shape: "ladder", default: 150_000, noRate: true });
    expect(entry(modern, "condo").rent).toMatchObject({ shape: "band", default: 160_000, noRate: false });
    expect(entry(classic, "rentalStudio").rent).toBeNull();
    expect(entry(classic, "shop").dailyIncome).toBe(20_000);
    expect(entry(modern, "shop").dailyIncome).toBe(2_500);
    expect(classic.economy).toMatchObject({ exterminator: null, autoBridgeToggleable: false, overheadPerUnitMonthly: 0, condoHoldTaxRate: 0 });
    expect(modern.economy).toMatchObject({ autoBridgeToggleable: true, overheadPerUnitMonthly: 700 });
    expect(modern.economy.exterminator).not.toBeNull();
    // Classic always runs the canon calendar: upkeep every three days at a
    // tenth of the monthly figure, quarterly rent in full.
    expect(classic.economy.calendars).toEqual([
      { key: "canon", quarterDays: 3, maintenancePeriodDays: 3, maintenanceScale: 0.1, quarterlyRentScale: 1 },
    ]);
    expect(modern.economy.calendars.map((c) => c.key)).toEqual(["realWorld", "canon"]);
    expect(modern.economy.calendars[0]).toMatchObject({ maintenanceScale: 1, quarterlyRentScale: 1 });
    expect(modern.economy.calendars[1].quarterlyRentScale).toBe(3 / 90);
    expect(classic.world.groundFloorStructure).toBe("lobby");
    expect(entry(classic, "office").rent?.cadence).toBe("quarterly");
    expect(entry(classic, "condo").rent?.cadence).toBe("sale");
    expect(entry(classic, "hotelSuite").rent?.cadence).toBe("nightly");
    expect(entry(modern, "rentalStudio").rent?.cadence).toBe("maintenancePeriod");
    // Only the venues that track customers quote a ticket.
    expect(entry(modern, "shop").spendPerCustomer).toBe(20);
    expect(entry(modern, "nightclub").spendPerCustomer).toBeNull();
    // Classic never counts Food Hall customers: it pays the hall nothing.
    expect(entry(classic, "foodHall").spendPerCustomer).toBeNull();
    expect(entry(modern, "foodHall").spendPerCustomer).toBe(25);
  });

  // The prices the catalog quotes are what the build and sell paths charge.
  for (const mode of ["classic", "modern"] as const) {
    it(`quotes what the engine charges (${mode})`, () => {
      const c = catalogFor(mode);
      const sim = Simulation.newGame(1, mode);
      expect(sim.money).toBe(c.economy.startingMoney);
      sim.money = 1e9;
      const must = (r: { ok: boolean; reason?: string }) => expect(r.reason ?? "ok").toBe("ok");
      const charged = (act: () => void) => {
        const before = sim.money;
        act();
        return before - sim.money;
      };
      const lobby = entry(c, "lobby");
      expect(charged(() => must(sim.build("lobby", 1, 170)))).toBe(lobby.cost);
      // The floor tool on the ground floor lays a lobby, at its price.
      expect(charged(() => must(sim.build("floor", 1, 171)))).toBe(lobby.cost);
      for (let x = 172; x < 200; x++) must(sim.build("lobby", 1, x));
      for (let fl = 2; fl <= 4; fl++) for (let x = 170; x < 200; x++) must(sim.build("floor", fl, x));
      expect(charged(() => must(sim.buildTransport("elevatorStandard", 172, 1, 4)))).toBe(
        entry(c, "elevatorStandard").cost + 3 * c.economy.transportFloorCost,
      );
      expect(charged(() => must(sim.buildTransport("stairs", 190, 1, 2)))).toBe(entry(c, "stairs").cost);
      const office = entry(c, "office");
      expect(charged(() => must(sim.build("office", 2, 180)))).toBe(office.cost);
      // A room on bare floor lays the floor under it at the floor's price.
      expect(charged(() => must(sim.build("office", 5, 180)))).toBe(office.cost + office.width * entry(c, "floor").cost);
      expect(-charged(() => expect(sim.sellAt(2, 180)).toBe(true))).toBe(office.resaleRefund);
    });
  }
});
