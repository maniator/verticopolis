import { Simulation } from "../Simulation";

import { CROWD_SECONDS_PER_MINUTE } from "../Crowd";
import { HK_CHECKOUT_HOUR } from "../EconomySystem";

import { FACILITIES } from "../facilities";

import { CROWD_MAX_STEP } from "./constants";

/** Tick loop + per-hour/day cadence for the Simulation, as friend functions taking the
 * instance. Extracted from `Simulation.ts`; the class keeps thin delegations. */

/** Advance the world by `dtMinutes` of game time. */
export function tick(sim: Simulation, dtMinutes: number): void {
  if (sim.simModel === "v2") {
    // Decompose into ≤30-min sub-steps that never skip an hour boundary, so
    // onHour/onDay fire for EVERY elapsed hour/day and the integrators get a
    // bounded step, headless then matches the (pre-chunked) browser. (F4)
    const EPS = 1e-6;
    let remaining = dtMinutes;
    while (remaining > EPS) {
      const toNextHour = 60 - (sim.clock.minuteOfDay % 60);
      // Guarantee forward progress: when we're sitting essentially on an hour
      // boundary (toNextHour ≈ 0, possible with fractional minutes from the
      // browser loop's accumulator) take a normal step instead of a vanishing
      // one, so the loop can't stall in tiny increments. (review/Copilot F4-2)
      const cap = toNextHour > EPS ? Math.min(30, toNextHour) : 30;
      const step = Math.min(remaining, cap);
      sim.advanceStep(step);
      remaining -= step;
    }
    return;
  }
  sim.advanceStep(dtMinutes);
}

/** One integration step: move time, cars and crowd, finalise construction, and
 * fire the hour/day boundary handlers exactly once if crossed. */
export function advanceStep(sim: Simulation, dtMinutes: number): void {
  sim.clock.advance(dtMinutes);
  // Cars and the drawn crowd (tenants and staff alike) interact through
  // boarding windows only a fraction of a game-minute wide, so they advance
  // TOGETHER in short chunks even when the outer step is coarse (fast game
  // speeds), a car that teleports 16 floors in one 20-minute step passes
  // every waiter unboardable and every rider's floor unalightable. Cars
  // answer the drawn people's calls too (hall calls where waiters stand,
  // cab stops where riders are headed), not just the statistical demand,
  // see ElevatorDispatch.update. The unit-list scans (statistical demand,
  // trip spawning) run once for the whole step; only the cheap car/person
  // movement runs per chunk.
  const rush = sim.rushFactor();
  sim.elevators.accumulate(sim.tower, dtMinutes, rush);
  // Open a new outer-step epoch for the read-only elevator queue projection, at
  // the same cadence as accumulate, never inside the car/crowd sub-step loop
  // below. Then derive it eagerly, here in the sim step, so the single
  // crowd.people scan lands once per step and every render frame only reads the
  // cached snapshot (I/O matrix: "a render frame runs no scan over crowd.people
  // or tower.units"). The memo makes this the sole build per step.
  sim.crowd.beginStep();
  sim.crowd.queueView(sim.tower);
  // Prime the crowd's view of this month's blockbuster bookings (a live
  // read-only reference, no copy) so the venue-visit spawn path can weight
  // the bigger cinema crowd without the crowd ever touching the economy.
  sim.crowd.blockbusters = sim.economy.blockbusterSet;
  // The crowd runs on its own seconds, a few per game-minute, capped so a
  // huge outer tick still can't teleport (or mass-spawn) everyone at once.
  // Pass the live `sim.weather` so the crowd's rain thinning reads the exact same
  // value the economy's rain channel does (weather-shapes-crowd, #430): one source
  // per tick, so the two layers can never disagree about whether it is raining.
  sim.crowd.spawn(Math.min(CROWD_MAX_STEP, dtMinutes * CROWD_SECONDS_PER_MINUTE), sim.tower, sim.clock, sim.weather);
  // The movement loop honors the same cap IN TOTAL: a month-long catch-up
  // tick (legacy v1 model) advances cars/people by at most CROWD_MAX_STEP
  // crowd-seconds of motion, not a month of thousands of chunks.
  const moveMinutes = Math.min(dtMinutes, CROWD_MAX_STEP / CROWD_SECONDS_PER_MINUTE);
  for (let left = moveMinutes; left > 0; ) {
    const chunk = Math.min(left, 2.5);
    // Pass the clock so a shaft with an authored schedule reads its live day-type
    // row and hour (active-car count, home floors, dwell, response). An unscheduled
    // shaft ignores it, so this changes nothing until a schedule exists (#305 Phase 2).
    sim.elevators.moveCars(sim.tower, chunk, sim.crowd.elevatorCalls(sim.tower), sim.clock);
    sim.crowd.advance(chunk * CROWD_SECONDS_PER_MINUTE, sim.tower);
    left -= chunk;
  }
  // Maids who finished (or abandoned) their room since the last step: the room
  // turns over only when the in-room cleaning dwell completes, never instantly,
  // you can watch them work. Freed maids cycle onto their next room with ONE
  // batched dispatch after the whole drain (not one full dispatch scan per
  // result), so cycling stays event-driven between the hourly ticks without
  // rescanning the tower per maid; dispatch itself self-gates on the shift's
  // no-new-room cutoff.
  const staffJobs = sim.crowd.takeStaffResults();
  for (const job of staffJobs) {
    sim.economy.onHousekeeperResult(job.unitId, job.ok);
  }
  if (staffJobs.length > 0) sim.economy.dispatchHousekeepers();
  sim.finishConstruction();

  const hour = sim.clock.hour;
  if (hour !== sim.lastHour) {
    sim.lastHour = hour;
    sim.onHour();
  }

  const day = sim.clock.day;
  if (day !== sim.lastDay) {
    sim.lastDay = day;
    sim.onDay();
  }
}

/** Hourly: presence, move-ins, satisfaction, traffic income. */
export function onHour(sim: Simulation): void {
  sim.onHourRuns++;
  sim.updatePresence();
  // Guests check out in the morning (not at midnight), so overnight hotel
  // population is still present at the midnight TOWER/VIP evaluation.
  if (sim.clock.hour === HK_CHECKOUT_HOUR) {
    sim.economy.hotelCheckout();
  }
  // Housekeeping works the mode's day shift (GameRules: Classic the canon
  // 12:00-17:00, Modern 08:00-19:00). A booked exterminator lands AFTER this
  // morning's checkout (so infested rooms spread one last time while the crew
  // was en route). `resolveExtermination` is idempotent and self-guards on the
  // due day, so it runs across the whole shift window, not just its first
  // tick: a save reloaded later on the due day still clears its rooms that day
  // instead of stranding them en route until tomorrow. Dispatch then keeps
  // sending maids to dirty rooms (it self-gates on the shift's no-new-room
  // cutoff, and freed maids re-dispatch event-driven between these hourly
  // ticks; see Housekeeping.onResult).
  const hkShift = sim.rules.housekeepingShift();
  if (sim.clock.hour >= hkShift.start && sim.clock.hour < hkShift.end) {
    sim.resolveExtermination();
    sim.economy.dispatchHousekeepers();
  }
  sim.updateSatisfaction();
  sim.attemptMoveIns();
  sim.economy.collectTrafficIncome();
  sim.sampleElevatorUtil();
  sim.evaluateStar();
}

/** Daily: rent, maintenance, events, VIP. (Hotel checkout is hourly @08:00.) */
export function onDay(sim: Simulation): void {
  sim.weather = Simulation.weatherFor(sim.clock.day);

  // Maintenance rides the calendar's period, not a hard-coded 30-day month:
  // under the canon calendar a whole year is 12 days, so a 30-day "month" is
  // incoherent. Real-world keeps its 30-day month (period = 30).
  const period = Math.floor(sim.clock.day / sim.clock.calendar.maintPeriodDays);
  if (period !== sim.lastMonth) {
    sim.lastMonth = period;
    sim.economy.payMaintenance();
    sim.rollCondoRelocations();
  }

  const q = sim.clock.quarter;
  if (q !== sim.lastQuarter) {
    sim.lastQuarter = q;
    // Snapshot the balance ENTERING the quarter (before rent lands), matching
    // the real game's finance-window "Last Quarter's Balance".
    sim.lastQuarterMoney = sim.money;
    sim.economy.collectRent();
  }

  sim.events.maybeRandomEvent();
  sim.maybeVipStay();
  sim.checkVip();
  sim.reportMoveIns();
  sim.checkMilestones();
  sim.nudgeStranded();
  sim.nudgeMetroPlatform();
  sim.nudgeServiceShortfalls();
  sim.rollOverRetailDay();
  // Close the day's ledger so the income breakdown averages over whole days.
  sim.ledger.endDay();
}

/** Finalise any units whose construction period has elapsed. */
export function finishConstruction(sim: Simulation): void {
  if (sim.constructing.size === 0) return;
  for (const id of [...sim.constructing]) {
    const u = sim.tower.getUnit(id);
    if (!u || u.state !== "construction") {
      sim.constructing.delete(id);
      continue;
    }
    if (sim.clock.minutes >= (u.completeAt ?? 0)) {
      u.state = "empty";
      u.completeAt = undefined;
      sim.constructing.delete(id);
      sim.emit(`${FACILITIES[u.kind].name} on ${sim.floorLabel(u.floor)} is now open for business.`, "good");
    }
  }
}

export function hourTicks(sim: Simulation): number {
  return sim.onHourRuns;
}
