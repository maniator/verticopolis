import { describe, it, expect } from "vitest";
import { Clock } from "../engine/Clock";
import { CANON, REAL_WORLD, resolveCalendar, coerceCalendarKind } from "../engine/calendar";
import { Simulation } from "../engine/Simulation";
import { EconomySystem } from "../engine/EconomySystem";
import { Tower } from "../engine/Tower";
import { RNG } from "../engine/rng";
import { ECON } from "../engine/econConfig";
import type { SimContext } from "../engine/SimContext";
import type { FacilityKind } from "../engine/types";

/** A day-N clock on a given calendar. Clock treats minutes===0 as 07:00 day 0,
 *  so seed a day from its minute count (day 0 uses a tiny non-zero offset). */
const clockAtDay = (day: number, calendar = REAL_WORLD): Clock =>
  new Clock(day === 0 ? 1 : day * 1440, calendar);

describe("canon calendar date math (validated against the retail game)", () => {
  // currentDay -> date, proven against the real game's Finance window / load
  // screen (see gdd-classic-calendar-parity-2026-07-08): 12-day year, 3-day
  // quarter, both shown 1-indexed.
  it.each([
    { day: 55, year: 4, quarter: 2 }, // -> "Year 5, Quarter 3" (0-based index 2)
    { day: 1280, year: 106, quarter: 2 }, // -> "Year 107, Q3"
    { day: 1289, year: 107, quarter: 1 }, // -> "Year 108, Q2"
  ])("day $day reads Year $year Q$quarter on the canon calendar", ({ day, year, quarter }) => {
    const c = clockAtDay(day, CANON);
    expect(c.day).toBe(day);
    expect(c.year).toBe(year);
    expect(c.quarter).toBe(quarter);
  });

  it("uses a 3-day week with the last slot as the weekend", () => {
    expect(clockAtDay(0, CANON).isWeekend).toBe(false); // slot 0 = weekday
    expect(clockAtDay(1, CANON).isWeekend).toBe(false); // slot 1 = weekday
    expect(clockAtDay(2, CANON).isWeekend).toBe(true); // slot 2 = weekend
    expect(clockAtDay(3, CANON).isWeekend).toBe(false); // next week, slot 0
  });

  it("formats the retro date with the canon week (2 WD + 1 WE)", () => {
    // day 55: year 4 -> "5th Year", quarter 2 -> "3Q", dayOfWeek 55%3 = 1 -> "2nd WD"
    expect(clockAtDay(55, CANON).formatRetroDate()).toBe("2nd WD/3Q/5th Year");
  });
});

describe("real-world calendar is byte-identical to the shipped behavior", () => {
  it("keeps the 7 / 90 / 360 derivations", () => {
    expect(clockAtDay(5).isWeekend).toBe(true); // Saturday
    expect(clockAtDay(4).isWeekend).toBe(false); // Friday
    expect(clockAtDay(90).quarter).toBe(1);
    expect(clockAtDay(360).year).toBe(1);
  });

  it("keeps the exact retro date string", () => {
    // A bare Clock defaults to real-world; day 0 is Monday 07:00.
    expect(new Clock().formatRetroDate()).toBe("1st WD/1Q/1st Year");
    // Saturday of the first week, still Q1 Year 1.
    expect(clockAtDay(5).formatRetroDate()).toBe("1st WE/1Q/1st Year");
  });
});

describe("resolveCalendar + coerceCalendarKind", () => {
  it("gives Classic the canon calendar always", () => {
    expect(resolveCalendar("classic", "realWorld")).toBe(CANON);
    expect(resolveCalendar("classic", "canon")).toBe(CANON);
  });
  it("honors the Modern toggle, defaulting to real-world", () => {
    expect(resolveCalendar("modern", "realWorld")).toBe(REAL_WORLD);
    expect(resolveCalendar("modern", "canon")).toBe(CANON);
  });
  it("coerces unknown / missing calendar choices to real-world", () => {
    expect(coerceCalendarKind(undefined)).toBe("realWorld");
    expect(coerceCalendarKind("nonsense")).toBe("realWorld");
    expect(coerceCalendarKind("canon")).toBe("canon");
  });
});

describe("income-invariant rent rescale", () => {
  /** Minimal SimContext over a real tower with `n` occupied, served offices. */
  function officeContext(n: number, calendar = REAL_WORLD): SimContext & { money: number } {
    const tower = new Tower();
    for (let x = 0; x < 40; x++) tower.place("lobby", 1, x);
    for (let x = 0; x < 40; x++) tower.place("floor", 2, x);
    tower.placeTransport("elevatorStandard", 4, 1, 2); // floor 2 is served
    for (let i = 0; i < n; i++) {
      const r = tower.place("office", 2, i * 9);
      tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
    }
    return {
      tower,
      clock: new Clock(12 * 60, calendar),
      rng: new RNG(1),
      money: 0,
      star: 5,
      emit: () => {},
      hasAny: (kind: FacilityKind) => tower.units.some((u) => u.kind === kind),
      hasOperational: (kind: FacilityKind) =>
        tower.units.some((u) => u.kind === kind && u.state !== "construction" && u.state !== "fire"),
      floorLabel: (floor: number) => (floor >= 1 ? `floor ${floor}` : `B${1 - floor}`),
    };
  }

  it("real-world collects the full quarterly amount (factor 1)", () => {
    const ctx = officeContext(3, REAL_WORLD);
    new EconomySystem(ctx).collectRent();
    expect(ctx.money).toBe(3 * ECON.rent.office.default);
  });

  it("canon collects 1/30 per collection (3-day quarter vs real-world's 90)", () => {
    const ctx = officeContext(3, CANON);
    new EconomySystem(ctx).collectRent();
    // Divisor mirrors the production rescale: quarterDays / REAL_WORLD.quarterDays.
    // Using the constant keeps the test aligned if real-world is ever retuned.
    expect(ctx.money).toBe(
      Math.round((3 * ECON.rent.office.default * CANON.quarterDays) / REAL_WORLD.quarterDays),
    );
  });

  it("keeps rent income per in-game day equal across calendars", () => {
    const real = officeContext(3, REAL_WORLD);
    const canon = officeContext(3, CANON);
    new EconomySystem(real).collectRent();
    new EconomySystem(canon).collectRent();
    // Per-day rate = collection / quarterDays. Equal within one collection's rounding.
    const perDayReal = real.money / REAL_WORLD.quarterDays;
    const perDayCanon = canon.money / CANON.quarterDays;
    expect(Math.abs(perDayReal - perDayCanon)).toBeLessThan(1);
  });
});

describe("income-invariant maintenance rescale", () => {
  /** A tower whose only upkeep is elevator-car maintenance (no offices/condos,
   *  so the rules-fallback overhead/tax lines never fire) — isolates the
   *  calendar rescale of maintenance. */
  function elevatorContext(calendar = REAL_WORLD): { ctx: SimContext & { money: number }; carCost: number } {
    const tower = new Tower();
    for (let x = 0; x < 6; x++) tower.place("lobby", 1, x);
    for (let x = 0; x < 6; x++) tower.place("floor", 2, x);
    tower.placeTransport("elevatorStandard", 0, 1, 2);
    const cars = tower.transports[0]?.cars ?? 0;
    const carCost = cars * ECON.maintenancePerCarMonthly; // the full real-world monthly upkeep
    const ctx: SimContext & { money: number } = {
      tower,
      clock: new Clock(12 * 60, calendar),
      rng: new RNG(1),
      money: 0,
      star: 5,
      emit: () => {},
      hasAny: (kind: FacilityKind) => tower.units.some((u) => u.kind === kind),
      hasOperational: (kind: FacilityKind) =>
        tower.units.some((u) => u.kind === kind && u.state !== "construction" && u.state !== "fire"),
      floorLabel: (floor: number) => (floor >= 1 ? `floor ${floor}` : `B${1 - floor}`),
    };
    return { ctx, carCost };
  }

  it("charges the full monthly upkeep on the real-world calendar (factor 1)", () => {
    const { ctx, carCost } = elevatorContext(REAL_WORLD);
    expect(carCost).toBeGreaterThan(0); // guard: the fixture actually has cars
    new EconomySystem(ctx).payMaintenance();
    expect(ctx.money).toBe(-carCost);
  });

  it("charges 1/10 per period on the canon calendar and keeps upkeep per in-game day equal", () => {
    const { ctx: real, carCost } = elevatorContext(REAL_WORLD);
    const { ctx: canon } = elevatorContext(CANON);
    new EconomySystem(real).payMaintenance();
    new EconomySystem(canon).payMaintenance();
    expect(canon.money).toBe(-Math.round((carCost * CANON.maintPeriodDays) / REAL_WORLD.maintPeriodDays));
    // Per-day upkeep = charge / maintPeriodDays; equal across calendars.
    const perDayReal = -real.money / REAL_WORLD.maintPeriodDays;
    const perDayCanon = -canon.money / CANON.maintPeriodDays;
    expect(Math.abs(perDayReal - perDayCanon)).toBeLessThan(1);
  });
});

describe("collection cadence", () => {
  it("rolls the quarter every quarterDays and the year every yearDays, on both calendars", () => {
    for (const cal of [CANON, REAL_WORLD]) {
      const q0 = clockAtDay(0, cal).quarter;
      expect(clockAtDay(cal.quarterDays - 1, cal).quarter).toBe(q0); // still the same quarter the day before
      expect(clockAtDay(cal.quarterDays, cal).quarter).not.toBe(q0); // rolls exactly on the boundary
      expect(clockAtDay(cal.yearDays, cal).year).toBe(clockAtDay(0, cal).year + 1); // a year is 4 quarters
      expect(clockAtDay(cal.yearDays, cal).quarter).toBe(0); // and wraps back to Q1
    }
  });
});

describe("persistence & first-period safety", () => {
  it("round-trips a Modern tower's calendar choice", () => {
    const sim = Simulation.newGame(7, "modern", "canon");
    expect(sim.clock.calendar.kind).toBe("canon");
    const restored = Simulation.deserialize(sim.serialize());
    expect(restored.modernCalendar).toBe("canon");
    expect(restored.clock.calendar.kind).toBe("canon");
  });

  it("defaults a legacy Modern save (no field) to real-world", () => {
    const sim = Simulation.newGame(7, "modern", "realWorld");
    const save = sim.serialize();
    delete (save as { modernCalendar?: unknown }).modernCalendar;
    const restored = Simulation.deserialize(save);
    expect(restored.clock.calendar.kind).toBe("realWorld");
  });

  it("a Classic save always restores the canon calendar", () => {
    const sim = Simulation.newGame(7, "classic");
    const restored = Simulation.deserialize(sim.serialize());
    expect(restored.clock.calendar.kind).toBe("canon");
  });

  it("does not re-collect a period on load (lastQuarter / lastMonth re-derived from the restored calendar)", () => {
    const sim = Simulation.newGame(7, "classic");
    sim.tick(60 * 24 * 7); // a week of canon days, past the first rent/maintenance
    // Deserialize is side-effect-free on money: the re-derived period guards mean
    // the loaded tower doesn't immediately re-fire the just-passed collection.
    const restored = Simulation.deserialize(sim.serialize());
    expect(restored.money).toBe(sim.money);
    // And a fresh tick that stays inside the current canon quarter (< 3 days)
    // collects no office rent lump (this tower has no offices), so money only
    // moves by ordinary daily flows, never a spurious reloaded collection.
    const beforeTick = restored.money;
    restored.tick(60); // one hour, no day boundary crossed
    expect(restored.money).toBe(beforeTick);
  });
});
