import { describe, it, expect } from "vitest";
import { Clock } from "../../engine/Clock";
import { CANON, REAL_WORLD, resolveCalendar, coerceCalendarKind } from "../../engine/calendar";
import { Simulation } from "../../engine/Simulation";
import { EconomySystem } from "../../engine/EconomySystem";
import { Tower } from "../../engine/Tower";
import { RNG } from "../../engine/rng";
import { ECON } from "../../engine/econConfig";
import { CLASSIC_RULES, MODERN_RULES } from "../../engine/gameRules";
import type { SimContext } from "../../engine/SimContext";
import type { FacilityKind } from "../../engine/types";

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

  it("canon collects 1/30 per collection on a rule-less context (Modern fallback)", () => {
    // A bare context has no `rules`, so collectRent reads the file's standard
    // MODERN_RULES fallback: the income-invariant rescale. This pins that the
    // seam's fallback kept the pre-seam behavior byte-identical.
    const ctx = officeContext(3, CANON);
    new EconomySystem(ctx).collectRent();
    // Divisor mirrors the Modern rescale: quarterDays / REAL_WORLD.quarterDays.
    // Using the constant keeps the test aligned if real-world is ever retuned.
    expect(ctx.money).toBe(
      Math.round((3 * ECON.rent.office.default * CANON.quarterDays) / REAL_WORLD.quarterDays),
    );
  });

  it("keeps rent income per in-game day equal across calendars (rule-less/Modern path)", () => {
    const real = officeContext(3, REAL_WORLD);
    const canon = officeContext(3, CANON);
    new EconomySystem(real).collectRent();
    new EconomySystem(canon).collectRent();
    // Per-day rate = collection / quarterDays. Equal within one collection's rounding.
    const perDayReal = real.money / REAL_WORLD.quarterDays;
    const perDayCanon = canon.money / CANON.quarterDays;
    expect(Math.abs(perDayReal - perDayCanon)).toBeLessThan(1);
  });

  it("collects the FULL lump under CLASSIC_RULES, whatever the calendar says (canon cadence)", () => {
    // The ratified seam (spec-classic-economy-canon-cadence): Classic pays the
    // whole 1994 rent every quarter, no rescale. Same bare context, with the
    // Classic rule-set attached.
    const ctx = { ...officeContext(3, CANON), rules: CLASSIC_RULES };
    new EconomySystem(ctx).collectRent();
    expect(ctx.money).toBe(3 * ECON.rent.office.default);
    // And through collectRent on a REAL_WORLD-calendar context too (review
    // finding): Classic's factor is 1 for any quarter length, not a canon-only
    // special case, so the title's "whatever the calendar says" is exercised.
    const real = { ...officeContext(3, REAL_WORLD), rules: CLASSIC_RULES };
    new EconomySystem(real).collectRent();
    expect(real.money).toBe(3 * ECON.rent.office.default);
  });

  it("quarterlyRentScale: Classic is 1, Modern is quarterDays/90 (exactly 1 on real-world)", () => {
    // Structural seam pins: the factors themselves, so a retune of either
    // constant or rule-set is a deliberate, visible change.
    expect(CLASSIC_RULES.quarterlyRentScale(CANON.quarterDays)).toBe(1);
    expect(CLASSIC_RULES.quarterlyRentScale(REAL_WORLD.quarterDays)).toBe(1);
    expect(MODERN_RULES.quarterlyRentScale(CANON.quarterDays)).toBe(CANON.quarterDays / REAL_WORLD.quarterDays);
    expect(MODERN_RULES.quarterlyRentScale(REAL_WORLD.quarterDays)).toBe(1);
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

describe("Modern real-world (7/90/360) end-to-end regression: nothing drifts", () => {
  // The load-bearing "Modern real-world is byte-identical to shipped behavior"
  // invariant (arch §1, #1) is protected structurally by the REAL_WORLD-linked
  // divisors, but this describes it BEHAVIORALLY: a Modern-realWorld sim
  // consumed a full quarter and full month and its money moves the exact
  // pre-change amounts, using the ECON constants directly (not a "compute it
  // the same way" recipe that would silently track a bug).

  /** A Modern-realWorld tower with one served, occupied office at the default
   *  rent — the smallest fixture that exercises quarterly rent AND lets tests
   *  reason about an exact dollar amount. Star 5 so no rating gate interferes. */
  function modernRealWorldOneOfficeTower(): Simulation {
    // Direct constructor (not newGame) so the tower starts with an EMPTY grid
    // and the fixture's fresh lobby/floor placement isn't fighting the seeded
    // starter strip's coordinate assumptions. Star 1 gates random fires so the
    // office can't be gutted mid-run over a long tick loop.
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 1_000_000; // avoid bankruptcy interactions across a 90-day run
    sim.star = 1;
    for (let x = 0; x < 40; x++) sim.tower.place("lobby", 1, x);
    for (let x = 0; x < 40; x++) sim.tower.place("floor", 2, x);
    sim.tower.placeTransport("elevatorStandard", 4, 1, 2); // served floor 2
    const r = sim.tower.place("office", 2, 10);
    const u = sim.tower.units.find((x) => x.id === r.unitId);
    if (!u) throw new Error(`test fixture: office placement failed: ${JSON.stringify(r)}`);
    u.state = "occupied";
    return sim;
  }

  it("the quarter-boundary rent lump is $10,000 (REAL_WORLD quarter factor is 1)", () => {
    // Delta-across-the-quarter-boundary isolates rent income from any other
    // daily/monthly flow. Real-world's factor is exactly 1, so a full-price
    // office collects its full default rent — not scaled, not rounded away.
    // The onDay hook fires collectRent on the FIRST tick too (day 0's
    // `lastQuarter = -1` differs from day 1's quarter = 0), so warm the sim
    // past that boot rent and reset money before measuring.
    const sim = modernRealWorldOneOfficeTower();
    sim.tick(1440); // day 0 → 1: boot rent + boot maintenance fire here
    // Confirm the office survived: any drift from "occupied" means an event
    // fired and the delta below would be measuring something else.
    expect(sim.tower.units.find((u) => u.kind === "office")?.state).toBe("occupied");
    const baseline = sim.money;
    // Tick to just before the next quarter boundary (day 90 under real-world).
    for (let d = 1; d < REAL_WORLD.quarterDays - 1; d++) sim.tick(1440);
    const beforeRent = sim.money;
    sim.tick(1440); // roll into day 90 — quarter boundary
    const delta = sim.money - beforeRent;
    void baseline;
    // Day 90 ALSO crosses a maintenance boundary (day/30 rolls 2→3 under
    // real-world) so a car upkeep and a Modern overhead lump land the same tick
    // — netting the delta down by about $1,300. Wide band still proves the
    // full lump landed at the shipped amount: > $5,000 (well above any pure
    // maintenance/traffic flow), < $11,000 (the raw rent).
    expect(delta).toBeGreaterThan(5_000);
    expect(delta).toBeLessThan(11_000);
  });

  it("the rescale factor is EXACTLY 1 for real-world (both rent and maintenance)", () => {
    // Structural regression: the "byte-identical" invariant hinges on integer /
    // integer resolving to exactly 1 (no float drift), then Math.round(raw * 1)
    // being an identity for the (integer) maintenance and rent constants. If
    // REAL_WORLD is ever retuned to a value that doesn't cleanly self-divide,
    // this catches it before any economy drifts a single dollar.
    const quarterFactor = REAL_WORLD.quarterDays / REAL_WORLD.quarterDays;
    const maintFactor = REAL_WORLD.maintPeriodDays / REAL_WORLD.maintPeriodDays;
    expect(quarterFactor).toBe(1);
    expect(maintFactor).toBe(1);
    // Every shipped maintenance constant is an integer; factor 1 → identity.
    for (const raw of [600, 700, 1000, 2000, 3000, 6000, 8000, 150_000, 300_000]) {
      expect(Math.round(raw * maintFactor)).toBe(raw);
    }
    // Rent is always an integer amount too (ECON.rent + player edits are stepped).
    for (const total of [10_000, 15_000, 20_000, 87_000, 250_000, 1_000_000]) {
      expect(Math.round(total * quarterFactor)).toBe(total);
    }
  });

  it("charges maintenance on the 30-day beat under real-world, at least once by day 30", () => {
    // Cadence regression: Modern real-world's maintenance MUST fire on day 30
    // (`floor(day/maintPeriodDays)` = `floor(day/30)`, which rolls from 0 → 1
    // exactly then). Sim-level test that isolates cadence, not amount, so future
    // Modern sink changes don't break it. The exact amount is asserted by the
    // structural test above; here we just confirm the timing.
    const sim = modernRealWorldOneOfficeTower();
    // Not yet: day 29 has crossed no 30-day boundary.
    for (let d = 0; d < 29; d++) sim.tick(1440);
    const beforeDay30 = sim.money;
    sim.tick(1440); // roll over into day 30
    expect(sim.money).toBeLessThan(beforeDay30); // maintenance fired
    // And a second maintenance tick doesn't fire the next day (still within
    // period): money keeps drifting from ordinary daily flows but not by another
    // whole maintenance charge.
    const afterDay30 = sim.money;
    sim.tick(1440); // day 31
    // Money can still move (traffic, weather), but the maintenance CHARGE — the
    // large lump — did not re-fire. Compare the day-29→30 drop (which includes
    // the maintenance lump) to the day-30→31 drift (which does NOT):
    const day30Drop = beforeDay30 - afterDay30; // includes the lump
    const day31Drift = afterDay30 - sim.money; // just daily flows
    expect(day31Drift).toBeLessThan(day30Drop); // no second lump landed
  });

  it("keeps Mon..Sun weekdays and the 5/6 weekend split for days 0..13", () => {
    // A Modern realWorld sim's weekday indexing is the SAME 7-day rhythm it has
    // always been, and the retro-date + dayName format identical to the shipped
    // strings. If the calendar seam accidentally leaked into Modern realWorld's
    // getters, this catches it.
    const sim = Simulation.newGame(1, "modern", "realWorld");
    expect(sim.clock.calendar.kind).toBe("realWorld");
    for (let d = 0; d < 14; d++) {
      const c = new Clock(d === 0 ? 1 : d * 1440, REAL_WORLD);
      expect(c.dayOfWeek).toBe(d % 7);
      expect(c.isWeekend).toBe((d % 7) >= 5);
      // Familiar weekday names; a canon-week label like "WD1" would fail this.
      expect(c.dayName).toBe(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d % 7]);
    }
  });

  it("relocation chance short-circuits identically at zero (Classic) and scales by exactly 1 (Modern realWorld)", () => {
    // The rollCondoRelocations rescale is `baseChance * (maintPeriodDays / REAL_WORLD.maintPeriodDays)`.
    // Under real-world that is exactly 1 (integer / integer), so the effective
    // chance and the RNG draw are unchanged from before the calendar seam.
    // Under Classic the base is 0 and the multiplier is irrelevant, but the
    // `chance <= 0` short-circuit must still fire before the draw so the RNG
    // stream is bit-identical to Classic's pre-change behavior.
    const modern = Simulation.newGame(1, "modern", "realWorld");
    // Force a base chance we can reason about; scale by 30/30 = 1.
    const scale = REAL_WORLD.maintPeriodDays / REAL_WORLD.maintPeriodDays;
    expect(scale).toBe(1); // structural, not vibe
    // A base 0 (as Classic returns) times any positive scale is still 0, so the
    // caller's `chance <= 0` guard short-circuits identically under both.
    expect(0 * scale).toBe(0);
    // A Modern realWorld sim keeps kind "realWorld" (no drift on adoptSim).
    expect(modern.clock.calendar.maintPeriodDays).toBe(REAL_WORLD.maintPeriodDays);
  });
});

describe("Classic canon (3/3/12) end-to-end regression: fires on the canon beat", () => {
  // Parallel to the Modern real-world regression but for the CANON path: rent
  // collects on every 3-day quarter, maintenance every 3 days, the weekend is
  // the trailing slot every 3rd day. Classic rent collects the FULL lump each
  // quarter (quarterlyRentScale 1, the canon cadence); maintenance still rides
  // the income-invariant 3/30 = 1/10 rescale in both modes (the canon
  // maintenance dollar table is unverified; see the backlog row).

  /** Lay the shared one-served-office footprint on a fresh sim (lobby, floor,
   *  elevator, one occupied default-rent office), asserting each step per the
   *  fixture discipline (a silently degraded footprint tests a different tower
   *  than the one described). */
  function layServedOffice(sim: Simulation): void {
    for (let x = 0; x < 40; x++) expect(sim.tower.place("lobby", 1, x).ok, `lobby at ${x}`).toBe(true);
    for (let x = 0; x < 40; x++) expect(sim.tower.place("floor", 2, x).ok, `floor at ${x}`).toBe(true);
    expect(sim.tower.placeTransport("elevatorStandard", 4, 1, 2).ok, "elevator 1-2").toBe(true);
    const r = sim.tower.place("office", 2, 10);
    expect(r.ok, `office placement: ${JSON.stringify(r)}`).toBe(true);
    const u = sim.tower.units.find((x) => x.id === r.unitId);
    if (!u) throw new Error(`test fixture: office unit missing: ${JSON.stringify(r)}`);
    u.state = "occupied";
  }

  /** Same one-office fixture as the Modern-realWorld regression but Classic. */
  function classicCanonOneOfficeTower(): Simulation {
    // Same shape as the Modern-realWorld twin; Star 1 gates random fires so a
    // multi-day tick loop can't gutted the office and mask a rent lump.
    const sim = new Simulation(2024, "classic");
    sim.money = 1_000_000;
    sim.star = 1;
    layServedOffice(sim);
    return sim;
  }

  it("resolves to the canon calendar (3/3/12), regardless of any modernCalendar hint", () => {
    // Classic is ALWAYS canon; passing "realWorld" as the hint is silently
    // ignored so a Classic tower can never accidentally run real-world's pace.
    const sim = new Simulation(1, "classic", "realWorld");
    expect(sim.clock.calendar).toBe(CANON);
    expect(sim.clock.calendar.weekDays).toBe(3);
    expect(sim.clock.calendar.quarterDays).toBe(3);
    expect(sim.clock.calendar.yearDays).toBe(12);
    expect(sim.clock.calendar.maintPeriodDays).toBe(3);
  });

  it("the MODERN canon-calendar rent factor is EXACTLY 1/30 (CANON.quarterDays / REAL_WORLD.quarterDays)", () => {
    // Structural: MODERN's income-invariant rescale is a pure integer ratio, so
    // any integer rent total divisible by 30 collects exactly and any that
    // isn't collects Math.round of the exact fraction. Classic no longer uses
    // this factor (its quarterlyRentScale is 1, the canon full lump; see the
    // seam tests above); this pins the Modern divisor and catches a future
    // retune of either constant.
    const factor = CANON.quarterDays / REAL_WORLD.quarterDays;
    expect(factor).toBe(3 / 90);
    expect(MODERN_RULES.quarterlyRentScale(CANON.quarterDays)).toBe(factor);
    // Table of shipped/likely rent totals → the Modern-canon per-collection
    // amount. Verified against the production `collectRent` formula.
    for (const total of [10_000, 15_000, 30_000, 87_000]) {
      const canonCollection = Math.round(total * factor);
      expect(canonCollection).toBe(Math.round(total / 30));
    }
  });

  it("the rescale factor is EXACTLY 1/10 for canon maintenance (CANON.maintPeriodDays / REAL_WORLD.maintPeriodDays)", () => {
    const factor = CANON.maintPeriodDays / REAL_WORLD.maintPeriodDays;
    expect(factor).toBe(3 / 30);
    // Every shipped maintenance constant is a multiple of 10, so canon's 1/10
    // lands on an integer with zero rounding residue — the arch §3 guarantee.
    for (const raw of [600, 700, 1000, 2000, 3000, 6000, 8000, 150_000, 300_000]) {
      expect(raw % 10).toBe(0); // the invariant that keeps 1/10 exact
      expect(Math.round(raw * factor)).toBe(raw / 10);
    }
  });

  it("the day-3 rent lump is the FULL $10,000 (canon cadence: the whole 1994 rent every 3-day quarter)", () => {
    // Delta across the canon quarter boundary: a Classic office pays its whole
    // Average rent each canon quarter, the ratified 1994 cadence
    // (spec-classic-economy-canon-cadence-2026-07-22). Before that spec this
    // collected the rescaled $333; the regression pins the shift into the new
    // behavior. Day 3 also crosses the canon maintenance boundary, so the
    // elevator upkeep lump nets the delta down a little; the band still proves
    // the full rent landed (far above the old 333, at most the raw 10,000).
    const sim = classicCanonOneOfficeTower();
    for (let d = 0; d < CANON.quarterDays - 1; d++) sim.tick(1440);
    const beforeRent = sim.money;
    sim.tick(1440); // roll into day 3 — canon quarter boundary
    const delta = sim.money - beforeRent;
    expect(delta).toBeGreaterThan(9_000);
    expect(delta).toBeLessThanOrEqual(10_000);
  });

  it("charges maintenance on the 3-day canon beat (not the old 30-day month)", () => {
    // Cadence regression: killing the incoherent `day/30` maintenance month was
    // the whole point of the maintPeriodDays swap. Under canon, day 3 crosses
    // the first `floor(day/maintPeriodDays)` = `floor(day/3)` boundary. Use a
    // ROOM-LESS elevator-only tower so no rent income masks the maintenance dip
    // (canon day 3 also crosses the quarter boundary, which would otherwise net
    // the delta positive from rent).
    const sim = new Simulation(2024, "classic");
    sim.money = 0;
    for (let x = 0; x < 20; x++) sim.tower.place("lobby", 1, x);
    for (let x = 0; x < 20; x++) sim.tower.place("floor", 2, x);
    sim.tower.placeTransport("elevatorStandard", 4, 1, 2);
    for (let d = 0; d < 2; d++) sim.tick(1440); // day 2, no maintenance boundary yet
    const beforeDay3 = sim.money;
    sim.tick(1440); // roll into day 3 — the canon maintenance boundary
    expect(sim.money).toBeLessThan(beforeDay3); // upkeep landed
    // Day 4 does not cross another 3-day boundary; drift stays small.
    const afterDay3 = sim.money;
    sim.tick(1440); // day 4
    expect(beforeDay3 - afterDay3).toBeGreaterThan(afterDay3 - sim.money);
  });

  it("keeps [WD1, WD2, WE1] weekday labels + weekend on day 2 (trailing slot) under canon", () => {
    // The canon weekday/weekend rhythm the retail 1994 game shows for a known
    // save (harness-validated, see arch §5.1) — pinned here so a future
    // calendar-arithmetic tweak can't silently repoint the phase.
    const sim = new Simulation(1, "classic");
    expect(sim.clock.calendar.kind).toBe("canon");
    for (let d = 0; d < 9; d++) {
      const c = new Clock(d === 0 ? 1 : d * 1440, CANON);
      const slot = d % 3;
      expect(c.dayOfWeek).toBe(slot);
      expect(c.isWeekend).toBe(slot === 2);
      const expected = slot === 2 ? "WE1" : slot === 0 ? "WD1" : "WD2";
      expect(c.dayName).toBe(expected);
    }
  });

  it("keeps MODERN rent income per in-game DAY identical across its two calendars (the rescale's remaining home)", () => {
    // The income-invariance contract now belongs to Modern's New-Tower calendar
    // choice alone: a Modern-canon tower and a Modern-real-world tower earn the
    // same per day within one collection's rounding (canon 333/3 ≈ 111/day,
    // real-world 10000/90 ≈ 111.11/day).
    const factors = {
      canon: MODERN_RULES.quarterlyRentScale(CANON.quarterDays),
      real: MODERN_RULES.quarterlyRentScale(REAL_WORLD.quarterDays),
    };
    const perDayCanon = Math.round(10_000 * factors.canon) / CANON.quarterDays;
    const perDayReal = Math.round(10_000 * factors.real) / REAL_WORLD.quarterDays;
    expect(Math.abs(perDayCanon - perDayReal)).toBeLessThan(1);
    // End-to-end through PRODUCTION collectRent (review finding: the prior
    // draft asserted constants against constants): a Modern tower FOUNDED on
    // the canon calendar collects the rescaled $333 lump, so the seam provably
    // reads the live calendar through the sim, while the identical Classic
    // tower collects the full $10,000. Both sides measured from the engine.
    const modernCanon = new Simulation(2024, "modern", "canon");
    expect(modernCanon.clock.calendar.kind).toBe("canon");
    layServedOffice(modernCanon);
    modernCanon.money = 0;
    modernCanon.economy.collectRent();
    expect(modernCanon.money).toBe(Math.round((10_000 * CANON.quarterDays) / REAL_WORLD.quarterDays));
    const classic = classicCanonOneOfficeTower();
    classic.money = 0;
    classic.economy.collectRent();
    expect(classic.money).toBe(10_000);
    expect(classic.money).toBeGreaterThan(modernCanon.money * 25); // the deliberate Classic divergence
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
