import { describe, it, expect, vi } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { Clock } from "../../engine/Clock";
import { FACILITIES } from "../../engine/facilities";
import { rentOf, ECON } from "../../engine/econConfig";
import { CLASSIC_RULES, MODERN_RULES } from "../../engine/ruleSets";
import { HK_LATE_CHECKOUT_HOUR, HK_LATE_CHECKOUT_END } from "../../engine/EconomySystem";
import type { GameMode } from "../../engine/types";

const HOTEL_POP = FACILITIES.hotelSingle.population;

/**
 * #304 Phase 1: Modern hotel meal-window "late checkout" (Model A).
 *
 * A bounded fraction of last-night guests (GameRules.hotelDaytimePresence, 0 in
 * Classic, ECON.hotelDaytimePresence in Modern) take a late checkout: they stay
 * `asleep` (present) past the morning checkout, feed a lunch meal trip through
 * the EXISTING spawn path, then check out in the early afternoon. Classic never
 * defers, so its checkout stays byte-identical and no guest lingers to lunch.
 *
 * Guardrails under test: deterministic tower-order selection (no RNG), afternoon
 * checkout over still-asleep rooms (no new saved field), revenue-once, a bounded
 * midday census lift, and the housekeeping lifecycle staying a morning-only event.
 */

// A hotel wing with N rooms on a served floor, plus a lunch venue. Rooms are set
// `asleep` directly (as an overnight guest leaves them), reachable so nothing is
// silently unservable. Money preloaded so no bankruptcy interaction.
function hotelTower(mode: GameMode, rooms: number, seed = 2024): Simulation {
  const sim = new Simulation(seed, mode, "realWorld");
  sim.money = 1_000_000;
  sim.star = 3;
  // Assert every placement so a silent refusal can't degrade the topology under
  // the tests (repo fixture discipline).
  for (let x = 0; x < 40; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let f = 2; f <= 4; f++)
    for (let x = 0; x < 40; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
  // Elevator in a column clear of the restaurant (x 0-23) and the rooms (x 10-37).
  expect(sim.tower.placeTransport("elevatorStandard", 38, 1, 4).ok).toBe(true);
  // Lunch venue on floor 4 (restaurant serves lunch in Verticopolis).
  const rest = sim.tower.place("restaurant", 4, 0);
  expect(rest.ok).toBe(true);
  const ru = sim.tower.units.find((u) => u.id === rest.unitId);
  expect(ru).toBeDefined();
  ru!.state = "occupied";
  // Hotel rooms on floors 2 and 3, all asleep (an overnight guest present).
  // hotelSingle is HOTEL_W wide, so step by its width and assert each landed.
  const HOTEL_W = FACILITIES.hotelSingle.width;
  let placed = 0;
  for (let f = 2; f <= 3 && placed < rooms; f++) {
    for (let x = 10; x + HOTEL_W <= 40 && placed < rooms; x += HOTEL_W) {
      const r = sim.tower.place("hotelSingle", f, x);
      expect(r.ok).toBe(true);
      const u = sim.tower.units.find((uu) => uu.id === r.unitId)!;
      u.state = "asleep";
      placed++;
    }
  }
  expect(placed).toBe(rooms);
  return sim;
}

function asleepHotelCount(sim: Simulation): number {
  return sim.tower.units.filter((u) => u.kind === "hotelSingle" && u.state === "asleep").length;
}

function dirtyHotelCount(sim: Simulation): number {
  return sim.tower.units.filter((u) => u.kind === "hotelSingle" && u.state === "dirty").length;
}

describe("hotelDaytimePresence rule seam", () => {
  it("is 0 in Classic and the tuned Modern magnitude", () => {
    expect(CLASSIC_RULES.hotelDaytimePresence()).toBe(0);
    expect(MODERN_RULES.hotelDaytimePresence()).toBe(ECON.hotelDaytimePresence);
    expect(ECON.hotelDaytimePresence).toBeGreaterThan(0);
    expect(ECON.hotelDaytimePresence).toBeLessThan(1);
  });
});

describe("Classic checkout is unchanged (parity)", () => {
  it("checks out every asleep room in the morning, defers none", () => {
    const sim = hotelTower("classic", 10);
    expect(asleepHotelCount(sim)).toBe(10);
    sim.economy.hotelCheckout();
    expect(asleepHotelCount(sim)).toBe(0); // all gone by midday, canon
    expect(dirtyHotelCount(sim)).toBe(10);
  });

  it("late checkout is a pure no-op in Classic", () => {
    const sim = hotelTower("classic", 10);
    sim.economy.hotelCheckout();
    const moneyAfterMorning = sim.money;
    sim.economy.hotelLateCheckout();
    expect(sim.money).toBe(moneyAfterMorning); // nothing left asleep to charge
    expect(asleepHotelCount(sim)).toBe(0);
  });
});

describe("Modern defers a deterministic, bounded fraction (Guardrails 1, 5)", () => {
  it("holds round(p*N) rooms asleep past the morning checkout", () => {
    const sim = hotelTower("modern", 10);
    const n = asleepHotelCount(sim);
    const expectDeferred = Math.round(ECON.hotelDaytimePresence * n); // round(0.2*10) = 2
    sim.economy.hotelCheckout();
    expect(asleepHotelCount(sim)).toBe(expectDeferred);
    expect(dirtyHotelCount(sim)).toBe(n - expectDeferred);
  });

  it("the midday census lift is bounded by round(p*N) and never exceeds N", () => {
    const sim = hotelTower("modern", 10);
    const n = asleepHotelCount(sim);
    sim.economy.hotelCheckout();
    const stillPresent = asleepHotelCount(sim);
    expect(stillPresent).toBeLessThanOrEqual(Math.round(ECON.hotelDaytimePresence * n));
    expect(stillPresent).toBeLessThanOrEqual(n);
  });

  it("selects the same rooms on repeat runs (deterministic, no RNG draw)", () => {
    const idsDeferred = (seed: number) => {
      const sim = hotelTower("modern", 10, seed);
      sim.economy.hotelCheckout();
      return sim.tower.units
        .filter((u) => u.kind === "hotelSingle" && u.state === "asleep")
        .map((u) => u.id)
        .sort((a, b) => a - b);
    };
    // Two different RNG seeds pick the SAME deferred rooms: the choice is
    // tower-order, so it never draws from (or perturbs) the seeded stream.
    expect(idsDeferred(1)).toEqual(idsDeferred(999));
  });

  it("an empty hotel defers nothing and earns nothing at midday", () => {
    const sim = hotelTower("modern", 10);
    // Vacate every room: no overnight guests at all.
    for (const u of sim.tower.units) if (u.kind === "hotelSingle") u.state = "empty";
    const before = sim.money;
    sim.economy.hotelCheckout();
    sim.economy.hotelLateCheckout();
    expect(asleepHotelCount(sim)).toBe(0);
    expect(sim.money).toBe(before);
  });

  it("a tiny hotel rounds the deferral to zero (small towers get no midday murmur)", () => {
    // round(0.2 * N) is 0 for N <= 2, so a small hotel holds nobody past the
    // morning checkout: the feature is genuinely bounded and a two-room B&B reads
    // exactly like Classic at lunch. A future rounding tweak that broke this would
    // fail here.
    for (const n of [1, 2]) {
      const sim = hotelTower("modern", n);
      expect(Math.round(ECON.hotelDaytimePresence * n)).toBe(0); // guards the premise
      sim.economy.hotelCheckout();
      expect(asleepHotelCount(sim)).toBe(0); // all checked out, none linger
      expect(dirtyHotelCount(sim)).toBe(n);
    }
  });

  it("rounds up to exactly one deferred room at the N=5 threshold", () => {
    // round(0.2 * 5) = 1: the smallest hotel that lingers a single guest.
    const sim = hotelTower("modern", 5);
    sim.economy.hotelCheckout();
    expect(asleepHotelCount(sim)).toBe(1);
    expect(dirtyHotelCount(sim)).toBe(4);
  });
});

describe("revenue is recognized exactly once per room (Guardrail 3)", () => {
  it("morning + afternoon together bank exactly N*rent, split across the two events", () => {
    const sim = hotelTower("modern", 10);
    const n = asleepHotelCount(sim);
    const room = sim.tower.units.find((u) => u.kind === "hotelSingle")!;
    const rent = rentOf(room);
    const deferred = Math.round(ECON.hotelDaytimePresence * n);

    const start = sim.money;
    sim.economy.hotelCheckout();
    const afterMorning = sim.money;
    expect(afterMorning - start).toBe((n - deferred) * rent); // morning charged the rest

    sim.economy.hotelLateCheckout();
    const afterAfternoon = sim.money;
    expect(afterAfternoon - afterMorning).toBe(deferred * rent); // afternoon charged the deferred
    expect(afterAfternoon - start).toBe(n * rent); // every room once, no double-count, no drop
  });
});

describe("afternoon checkout is meal-timing only, not a second housekeeping morning (Guardrail 2, 8)", () => {
  it("marks the deferred rooms dirty without re-running beforeCheckout/resetShift", () => {
    const sim = hotelTower("modern", 10);
    // Spy on the housekeeping lifecycle the MORNING event owns.
    const hk = (sim.economy as unknown as { housekeeping: Record<string, unknown> }).housekeeping;
    const before = vi.spyOn(hk, "beforeCheckout" as never);
    const reset = vi.spyOn(hk, "resetShift" as never);

    sim.economy.hotelCheckout();
    expect(before).toHaveBeenCalledTimes(1); // morning ran the lifecycle
    expect(reset).toHaveBeenCalledTimes(1);
    const deferred = asleepHotelCount(sim);
    expect(deferred).toBeGreaterThan(0);

    sim.economy.hotelLateCheckout();
    expect(before).toHaveBeenCalledTimes(1); // afternoon did NOT re-run it
    expect(reset).toHaveBeenCalledTimes(1);
    expect(asleepHotelCount(sim)).toBe(0); // deferred rooms now dirty
    expect(dirtyHotelCount(sim)).toBe(10);
  });
});

describe("end-to-end lunch trips: Modern lingers, Classic does not (Guardrails 2, 6)", () => {
  // Set the clock to a lunch hour and stamp presence so asleep rooms read
  // occupants > 0 (updatePresence runs on hour boundaries; a pinned clock skips
  // it, and meal round-trippers only spawn from units with visibleOccupants > 0).
  function atLunch(sim: Simulation): void {
    sim.clock = new Clock(12 * 60, sim.clock.calendar);
    sim.updatePresence();
  }

  function countHotelOriginTrips(sim: Simulation, hotelFloors: number[]): number {
    let n = 0;
    for (let m = 0; m < 60; m++) {
      const before = new Set(sim.crowd.people.map((p) => p.id));
      sim.tick(1);
      for (const p of sim.crowd.people) {
        if (before.has(p.id)) continue;
        if (hotelFloors.includes(p.floors[0])) n++;
      }
    }
    return n;
  }

  it("Modern: deferred guests are still asleep at lunch and take hotel-origin trips", () => {
    const sim = hotelTower("modern", 10);
    sim.economy.hotelCheckout(); // defers round(0.2*10)=2 rooms, rest dirty
    expect(asleepHotelCount(sim)).toBeGreaterThan(0);
    atLunch(sim);
    const trips = countHotelOriginTrips(sim, [2, 3]);
    expect(trips).toBeGreaterThan(0);
  });

  it("Classic: no guest is asleep at lunch, so zero hotel-origin lunch trips", () => {
    const sim = hotelTower("classic", 10);
    sim.economy.hotelCheckout(); // every room checked out, none deferred
    expect(asleepHotelCount(sim)).toBe(0);
    atLunch(sim);
    const trips = countHotelOriginTrips(sim, [2, 3]);
    expect(trips).toBe(0);
  });
});

describe("the late checkout runs across a window, not a single hour (save/load robust)", () => {
  it("clears deferred rooms even when the clock lands past hour 14 (reload/catch-up)", () => {
    // A save reloaded at 15:00, or a coarse catch-up tick that fires onHour once
    // for the landing hour, skips hour 14 exactly. The window [14, 17) still
    // catches it, so a deferred room is never stranded asleep past its day.
    const sim = hotelTower("modern", 10);
    sim.economy.hotelCheckout();
    expect(asleepHotelCount(sim)).toBeGreaterThan(0); // deferred rooms held
    // Jump straight to 15:00 (hour 14 never ticked) and run one hourly pass.
    sim.clock = new Clock(15 * 60, sim.clock.calendar);
    sim.lastHour = -1; // force onHour to fire for the new hour
    sim.tick(1);
    expect(asleepHotelCount(sim)).toBe(0); // window caught hour 15, rooms checked out
  });

  it("is idempotent across the window: a second firing books no extra revenue", () => {
    const sim = hotelTower("modern", 10);
    sim.economy.hotelCheckout();
    sim.economy.hotelLateCheckout(); // hour-14 firing
    const settled = sim.money;
    sim.economy.hotelLateCheckout(); // hour-15 firing, nothing left asleep
    expect(sim.money).toBe(settled);
    // Window boundaries: starts at 14, ends before the 17:00 evening fill.
    expect(HK_LATE_CHECKOUT_HOUR).toBe(14);
    expect(HK_LATE_CHECKOUT_END).toBe(17);
  });
});

describe("midday census lift is bounded and does not flip a star (Guardrail 5 / AC7)", () => {
  it("the Modern-over-Classic midday population lift is exactly the deferred rooms, counted once", () => {
    const modern = hotelTower("modern", 10);
    const classic = hotelTower("classic", 10);
    modern.economy.hotelCheckout();
    classic.economy.hotelCheckout();
    // Stamp presence at a lunch hour so asleep rooms read occupants.
    for (const sim of [modern, classic]) {
      sim.clock = new Clock(12 * 60, sim.clock.calendar);
      sim.updatePresence();
    }
    const deferred = asleepHotelCount(modern);
    expect(asleepHotelCount(classic)).toBe(0); // Classic gone by midday

    // The whole midday population difference is the deferred hotel guests, each
    // counted once (occupants set, never incremented): not a second census.
    const lift = modern.population - classic.population;
    expect(lift).toBe(deferred * HOTEL_POP);
    expect(lift).toBeLessThanOrEqual(Math.round(ECON.hotelDaytimePresence * 10) * HOTEL_POP);
  });

  it("the deferral does not by itself flip a star rating", () => {
    const sim = hotelTower("modern", 10);
    sim.evaluateStar();
    const starBefore = sim.star;
    sim.economy.hotelCheckout();
    sim.clock = new Clock(12 * 60, sim.clock.calendar);
    sim.updatePresence();
    sim.evaluateStar();
    expect(sim.star).toBe(starBefore); // a handful of lingering rooms crosses no threshold
  });
});

describe("understaffed housekeeping: late-checkout rooms behave like ordinary dirty rooms (AC8)", () => {
  it("without a maid the afternoon-dirtied rooms stay dirty and are not re-let", () => {
    const sim = hotelTower("modern", 10); // no housekeeping unit placed
    sim.economy.hotelCheckout();
    const deferred = asleepHotelCount(sim);
    expect(deferred).toBeGreaterThan(0);
    sim.economy.hotelLateCheckout();
    expect(dirtyHotelCount(sim)).toBe(10); // every room now dirty
    // Run the rest of the day with no housekeeping: dirty rooms cannot self-clean
    // and a dirty room cannot be re-let, exactly like a morning-dirtied room.
    for (let h = 15; h < 23; h++) {
      sim.clock = new Clock(h * 60, sim.clock.calendar);
      sim.lastHour = -1;
      sim.tick(1);
    }
    expect(dirtyHotelCount(sim)).toBe(10); // still dirty, none turned over or re-let
    expect(asleepHotelCount(sim)).toBe(0); // and none re-filled (dirty blocks evening fill)
  });

  it("with a maid a late-checkout dirty room is turned over like any other", () => {
    // Purpose-built single-floor hotel: 4 rooms (round(0.2*4)=1 late-checked-out)
    // plus a housekeeping unit share floor 2, so the maid walks to every room with
    // no service transport needed. hotelSingle is 4 wide, housekeeping 8.
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 1_000_000;
    sim.star = 3;
    for (let x = 0; x < 40; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let x = 0; x < 40; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
    expect(sim.tower.placeTransport("elevatorStandard", 38, 1, 2).ok).toBe(true);
    for (const x of [0, 4, 8, 12]) {
      const r = sim.tower.place("hotelSingle", 2, x);
      expect(r.ok).toBe(true);
      const u = sim.tower.units.find((uu) => uu.id === r.unitId)!;
      u.state = "asleep";
    }
    expect(sim.tower.place("housekeeping", 2, 20).ok).toBe(true);
    const hk = sim.tower.units.find((x) => x.kind === "housekeeping");
    expect(hk).toBeDefined();
    hk!.state = "occupied";

    sim.economy.hotelCheckout();
    expect(asleepHotelCount(sim)).toBe(1); // one room genuinely deferred to the afternoon
    sim.economy.hotelLateCheckout(); // deferred room dirtied here, in the afternoon
    const dirtyAfterCheckout = dirtyHotelCount(sim);
    expect(dirtyAfterCheckout).toBe(4); // all four now dirty (3 morning + 1 late)
    // Run the maid shift through the afternoon; dirty rooms turn over to empty,
    // the late-checkout room no differently from the morning ones.
    for (let h = 15; h < 19; h++) {
      sim.clock = new Clock(h * 60, sim.clock.calendar);
      sim.lastHour = -1;
      sim.tick(60);
    }
    expect(dirtyHotelCount(sim)).toBeLessThan(dirtyAfterCheckout); // maid serviced them
  });
});
