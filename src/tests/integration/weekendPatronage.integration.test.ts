import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { GameMode } from "../../engine/types";

// A fresh game already lays a ground lobby spanning this x-range (40 tiles), so
// the tower is built on top of it rather than re-placing floor 1.
const LOBBY_X0 = 167;
const LOBBY_X1 = 206;

/**
 * A small, fully reachable tower: a demand pool (four occupied offices on floor
 * 2) and one occupied commercial venue on floor 3, one ride from the lobby. Same
 * seed and identical structure across calls, so the venue's take on two different
 * calendar days is compared like-for-like, isolating the weekday/weekend
 * multiplier (#398).
 */
function venueTower(
  seed: number,
  mode: GameMode,
  venue: "restaurant" | "fastFood",
): { sim: Simulation; venueId: number } {
  const sim = Simulation.newGame(seed, mode);
  sim.money = 1e9;
  for (let x = LOBBY_X0; x <= LOBBY_X1; x++) sim.tower.place("floor", 2, x);
  for (let x = LOBBY_X0; x <= LOBBY_X1; x++) sim.tower.place("floor", 3, x);
  // Elevator at the right edge (clear of every unit) so floors 2 and 3 are each
  // reachable within one ride of the lobby.
  expect(sim.tower.placeTransport("elevatorStandard", LOBBY_X1, 1, 3).ok).toBe(true);
  // Occupied offices (width 9) on floor 2, spaced so none overlaps another or the
  // edge shaft, give the venue a real, reachable demand pool.
  for (const x of [LOBBY_X0, LOBBY_X0 + 10, LOBBY_X0 + 20, LOBBY_X0 + 30]) {
    const o = sim.tower.place("office", 2, x);
    expect(o.ok, o.reason).toBe(true);
    sim.tower.units.find((u) => u.id === o.unitId)!.state = "occupied";
  }
  const v = sim.tower.place(venue, 3, LOBBY_X0);
  expect(v.ok, v.reason).toBe(true);
  sim.tower.units.find((u) => u.id === v.unitId)!.state = "occupied";
  return { sim, venueId: v.unitId! };
}

/**
 * Bank one open-hours window of the venue's own retail profit on a given calendar
 * day. The clock is parked at 07:00 on that day without ticking (so the seeded
 * stream is untouched by the jump) and weather is pinned clear; the window then
 * runs 07:00 to 15:00, staying inside the day so no boundary re-rolls weather or
 * resets the daily counter. `profitToday` is the venue's flushed dollar take, a
 * clean per-venue signal that ignores the rest of the tower's economy.
 */
function venueProfitOnDay(sim: Simulation, venueId: number, day: number): number {
  sim.clock.minutes = day * 1440 + 7 * 60; // 07:00 on the target day
  sim.weather = "clear";
  const v = sim.tower.units.find((u) => u.id === venueId)!;
  v.profitToday = 0;
  for (let h = 0; h < 8; h++) sim.tick(60);
  return v.profitToday ?? 0;
}

describe("Weekday/weekend commercial swing (#398)", () => {
  it("Classic: a restaurant banks more on the canon weekend day than on a weekday", () => {
    // CANON calendar: 3-day week (day-of-week 0 and 1 are weekdays, 2 the weekend).
    const weekday = venueTower(31, "classic", "restaurant");
    const weekend = venueTower(31, "classic", "restaurant");
    expect(weekday.sim.clock.calendar.weekDays).toBe(3);
    const weekdayProfit = venueProfitOnDay(weekday.sim, weekday.venueId, 1);
    const weekendProfit = venueProfitOnDay(weekend.sim, weekend.venueId, 2);
    expect(weekdayProfit).toBeGreaterThan(0);
    // The 1994 restaurant ratio is 48/35 (≈ 1.37×): the weekend take is larger.
    expect(weekendProfit).toBeGreaterThan(weekdayProfit);
  }, 30000);

  it("Modern: a fast-food counter banks LESS on the weekend (no office-lunch crowd)", () => {
    // REAL_WORLD calendar: 7-day week, weekend = days-of-week 5 and 6.
    const weekday = venueTower(32, "modern", "fastFood");
    const weekend = venueTower(32, "modern", "fastFood");
    expect(weekday.sim.clock.calendar.weekDays).toBe(7);
    const weekdayProfit = venueProfitOnDay(weekday.sim, weekday.venueId, 1);
    const weekendProfit = venueProfitOnDay(weekend.sim, weekend.venueId, 5);
    expect(weekdayProfit).toBeGreaterThan(0);
    // Modern fast food quiets on weekends (0.7× tunable): the weekend take is smaller.
    expect(weekendProfit).toBeLessThan(weekdayProfit);
  }, 30000);
});
