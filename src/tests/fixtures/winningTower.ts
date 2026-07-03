import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import type { FacilityKind } from "../../engine/types";

/**
 * Deterministic E2E fixture: build a REAL, fully-served, fully-occupied tower
 * that satisfies every TOWER gate — the canonical "a player finished the game"
 * state — so tests can drive the sim to the win (or prove a gate blocks it).
 *
 * It builds actual units through the public Tower/Sim API (so `ratingPopulation`
 * is genuine capacity — this is the balance guarantee), then flips rentable
 * units to occupied to SKIP the organic move-in queue (which is slow, stochastic
 * and already covered by the crowd tests). The star ladder, VIP inspection and
 * win are then driven through the real `sim.evaluateStar()` / `sim.tick()` path.
 */

/** Center column of the lot — also the wedding-hall build spot. */
export const CX = Math.floor(GRID.width / 2);
const LEFT = 4;
const RIGHT = GRID.width - 4;

export interface WinTowerOpts {
  /** Facilities to skip, to prove a rung's gate blocks progression. */
  omit?: FacilityKind[];
  /** Highest floor to fill with offices (lower it to sit under the 15k TOWER
   *  threshold while still clearing 10k for 5★). Default clears ~17k — margin
   *  over 15k — while leaving floor 100 free for the Wedding Hall. */
  officeTop?: number;
}

/** Build the pre-win state: everything a TOWER needs EXCEPT the Wedding Hall
 *  (which the player builds last, once at 5★, to trigger the VIP inspection). */
export function buildWinningTower(sim: Simulation, opts: WinTowerOpts = {}): void {
  const omit = new Set(opts.omit ?? []);
  // Default: fill up to floor 80 (~17k occupants, margin over the 15k TOWER
  // target) and leave floor 100 clear for the Wedding Hall.
  const officeTop = opts.officeTop ?? 80;
  const t = sim.tower;
  sim.money = 1_000_000_000;

  // Full-width ground lobby (rests on the earth), so the basements can hang off
  // it across the whole lot for the full-lot Metro station.
  for (let x = 0; x < GRID.width; x++) t.place("lobby", 1, x);
  // Above-ground standard floors 2..100.
  for (let f = 2; f <= GRID.maxFloor; f++) for (let x = LEFT; x < RIGHT; x++) t.place("floor", f, x);
  // Deep basement stories, built top-down (each hangs off the floor above), full
  // width so the 340-wide Metro fits at the bottom.
  for (let f = 0; f >= GRID.minFloor; f--) for (let x = 0; x < GRID.width; x++) t.place("floor", f, x);

  // Overlapping standard elevators (cap 30 floors each) that chain service
  // B1 -> 100 by sharing a boundary floor with the next band.
  const bands: [number, number][] = [
    [0, 1],
    [1, 30],
    [30, 60],
    [60, 90],
    [90, 100],
  ];
  bands.forEach(([b, tp], i) => t.placeTransport("elevatorStandard", LEFT + i * 3, b, tp));

  // Rating gates (each skippable to test that it blocks the ladder). Rooms may
  // not sit on the lobby (floor 1) — amenities go on standard floor 2; the metro
  // is a basement facility.
  if (!omit.has("metro")) t.place("metro", GRID.minFloor, 0); // full-lot, bottom of the basement
  if (!omit.has("security")) t.place("security", 2, LEFT + 20);
  if (!omit.has("medical")) t.place("medical", 2, LEFT + 40);
  // Recycling demand scales with population (canon: ~2,500/center) — a full
  // tower runs ~17–20k occupants, so build a row of nine centers (22.5k
  // capacity) in the basement, above the metro.
  if (!omit.has("recycling")) {
    for (let i = 0; i < 9; i++) t.place("recycling", -1, LEFT + 60 + i * 20);
  }
  if (!omit.has("hotelSuite")) {
    t.place("hotelSuite", 2, LEFT + 80); // width 12
    t.place("hotelSuite", 2, LEFT + 96);
  }

  // Offices on every standard floor for population margin (~20k >> 15k target).
  const OW = 9;
  for (let f = 3; f <= officeTop; f++) {
    for (let x = LEFT + 30; x + OW <= RIGHT; x += OW) t.place("office", f, x);
  }

  // Occupy every rentable unit (capacity is real; only the turnstile is skipped).
  for (const u of t.units) {
    if (u.kind === "office" || u.kind === "condo") {
      u.state = "occupied";
      u.everOccupied = true;
      u.satisfaction = 1;
    } else if (u.kind === "hotelSuite") {
      u.state = "asleep";
      u.everOccupied = true;
      u.satisfaction = 1;
    }
  }

  // A favorable VIP suite review is a 4★ prerequisite; grant it directly (the
  // organic VIP-stay path is its own concern, tested separately).
  sim.vipFavorable = true;
}

/**
 * Advance past the scheduled VIP inspection day and run it — driving the REAL
 * win logic (`sim.checkVip`) on the real, fully-occupied population.
 *
 * We deliberately jump the clock rather than `sim.tick()` through the days: a
 * tower packed to ~17k tenants overwhelms any sane number of elevators, so the
 * crowd sim churns tenants in and out and the midnight census oscillates well
 * under 15k — a congestion artifact, not a win-logic fact. Congestion/crowd
 * behavior is covered by the crowd tests; here we isolate the completion ladder.
 *
 * The default wait is comfortably larger than the current schedule (the hall
 * books the VIP `clock.day + 3` out) so a tweak to that lead time — or an extra
 * reschedule — doesn't break the test while the game is still winnable.
 */
export function runVipInspection(sim: Simulation, waitDays = 10): void {
  sim.clock.advance(waitDays * 24 * 60);
  sim.checkVip();
}

/**
 * Build the Wedding Hall on floor 100 (the final action — it schedules the VIP
 * inspection) and deterministically finish its construction, since we jump the
 * clock instead of ticking (which would otherwise finalize it). Returns the raw
 * build result so callers can also assert the below-5★ lock.
 */
export function buildWeddingHall(sim: Simulation): { ok: boolean; reason?: string } {
  const res = sim.build("weddingHall", GRID.maxFloor, CX);
  if (res.ok) {
    const wh = sim.tower.units.find((u) => u.kind === "weddingHall");
    if (wh && wh.state === "construction") wh.state = "empty"; // operational (done building)
  }
  return res;
}
