import type { Simulation } from "../Simulation";

import { TOWER_POPULATION } from "../facilities";

/** Random events, VIP, fires, choices for the Simulation, as friend functions taking the
 * instance. Extracted from `Simulation.ts`; the class keeps thin delegations. */

/** A VIP periodically stays in a suite; a favorable review is a 4★ prerequisite
 * (canon). The VIP only stays in an operational, reachable Hotel Suite and is
 * pleased when that suite is genuinely well-run (served + high satisfaction). */
export function maybeVipStay(sim: Simulation): void {
  if (sim.vipFavorable || sim.star < 3) return;
  // The VIP must actually STAY: a suite with a guest in it tonight (asleep) on
  // a served floor, and a happy one. A never-occupied/empty/dirty suite can't
  // earn the review just by existing.
  const suites = sim.tower.units.filter(
    (u) => u.kind === "hotelSuite" && u.state === "asleep" && sim.tower.isFloorServed(u.floor),
  );
  if (suites.length === 0) return;
  const happy = suites.some((s) => s.satisfaction >= 0.7);
  // Canon: every suite needs a parking space of its own, the VIP arrives by
  // car, and a suite hotel without valet parking never earns the review.
  if (happy && !sim.suiteParkingShort()) {
    sim.vipFavorable = true;
    sim.vipVisits++;
    sim.emit("A VIP enjoyed their suite. Your tower earned a favorable review (4★ unlocked).", "good");
    sim.triggerVip(); // the VIP's limo pulls up (cosmetic)
  } else if (sim.clock.day - sim.lastVipNagDay >= 5) {
    // Throttle the nag lines so they can't spam the log every day.
    sim.lastVipNagDay = sim.clock.day;
    // Count the visit with the nag, not per day: the stat mirrors the events
    // the player actually saw, so a struggling tower reads "a few failed
    // visits", not one per in-game day.
    sim.vipVisits++;
    sim.emit(
      happy
        ? "🚗 The VIP circled the block and left. Every hotel suite needs a working parking space (chained to a ramp)."
        : "A VIP's suite stay was underwhelming. Improve suite access and try again.",
      "info",
    );
  }
}

/** Run the pending VIP/TOWER inspection if its day has arrived. Driven by
 *  `onDay()` in play; public so an end-to-end test can trigger the inspection
 *  directly on a deterministic population (without the crowd sim in the loop). */
export function checkVip(sim: Simulation): void {
  if (sim.evaluatedTower || sim.vipVisitDay < 0) return;
  // If the Wedding Hall is gone before the inspection (sold via ANY path,
  // the editor and bulldoze tool call tower.removeUnit directly, not sellAt),
  // cancel the pending visit so it can't keep re-failing and spamming the log.
  if (!sim.tower.builtWeddingHall) {
    sim.vipVisitDay = -1;
    return;
  }
  if (sim.clock.day < sim.vipVisitDay) return;
  sim.vipVisitDay = -1;
  sim.vipVisits++; // the inspection is a VIP visit, impressed or not
  sim.triggerVip(); // the inspecting VIP arrives by limo (cosmetic)
  const pop = sim.ratingPopulation();
  const ok =
    sim.hasOperational("weddingHall") &&
    sim.star >= 5 &&
    sim.hasOperational("metro") && // re-checked: selling the metro after 5★ must not allow the win
    pop >= TOWER_POPULATION;
  if (ok) {
    sim.star = 6;
    sim.evaluatedTower = true;
    sim.emit("The VIP was impressed! Your building is now a TOWER. You win!", "good");
  } else {
    sim.emit("The VIP was unimpressed. Grow your population and amenities, then rebuild interest.", "bad");
    sim.vipVisitDay = sim.clock.day + 5;
  }
}

/** Number of units currently on fire (for the UI / stats). */
export function fires(sim: Simulation): number {
  return sim.events.count;
}

/** Human floor label: "floor 5" above ground, "B1"/"B2"… below (floor 0 = B1). */
export function floorLabel(_sim: Simulation, floor: number): string {
  return floor >= 1 ? `floor ${floor}` : `B${1 - floor}`;
}

/** Ignite a random room (exposed for the debug/event hooks and tests). */
export function startFire(sim: Simulation): void {
  sim.events.startFire();
}

/** A bomb scare (exposed for the debug/event hooks and tests). */
export function bombThreat(sim: Simulation): void {
  sim.events.bombThreat();
}

/** Cosmetic event-visual hooks the {@link EventSystem} fires (SimContext).
 * They only bump a transient counter the renderer polls, no gameplay, RNG,
 * or save effect, so headless contexts can omit them entirely. */
export function triggerSanta(sim: Simulation): void {
  sim.santaFxSeq++;
}

export function triggerExplosion(sim: Simulation, floor: number, xTile: number): void {
  sim.explosionFx = { floor, x: xTile, seq: sim.explosionFx.seq + 1 };
}

export function triggerThief(sim: Simulation, caught: boolean, floor: number): void {
  sim.thiefFx = { caught, floor, seq: sim.thiefFx.seq + 1 };
}

export function triggerTreasure(sim: Simulation, floor: number, xTile: number): void {
  sim.treasureFx = { floor, x: xTile, seq: sim.treasureFx.seq + 1 };
}

export function triggerVip(sim: Simulation): void {
  sim.vipFxSeq++;
}

/** The player decision awaiting an answer (fire rescue / bomb ransom), or null.
 * The UI renders this and calls {@link resolveChoice}. */
export function pendingChoice(sim: Simulation): { kind: "fireRescue" | "bombThreat"; cost: number; message: string } | null {
  return sim.events.pending;
}

/** Answer the pending event choice: `accept` pays, `decline` takes the default. */
export function resolveChoice(sim: Simulation, option: "accept" | "decline"): void {
  sim.events.resolveChoice(option);
}

/** Probability a fire on `floor` is contained per day, spatial in v2 (depends
 * on Security/Medical coverage of that floor), tower-wide in v1. */
export function fireContainmentChance(sim: Simulation, floor: number): number {
  return sim.events.controlChance(floor);
}

/** Daily probability a new fire breaks out, after the fire-defense reductions
 * from any operational Security / Medical center. */
export function fireIgnitionChance(sim: Simulation): number {
  return sim.events.fireChance();
}

/** Set a cinema's monthly film-booking policy. Returns the new policy, or null
 *  if the unit isn't a cinema. */
export function setFilmPolicy(sim: Simulation, id: number, policy: "auto" | "feature" | "blockbuster"): "auto" | "feature" | "blockbuster" | null {
  const u = sim.tower.getUnit(id);
  if (!u || u.kind !== "cinema") return null;
  u.filmPolicy = policy;
  return policy;
}

/** Whether a cinema is currently showing a blockbuster (this month's booking). */
export function isShowingBlockbuster(sim: Simulation, id: number): boolean {
  return sim.economy.blockbusterIds.includes(id);
}
