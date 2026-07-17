import type { Simulation } from "../Simulation";

import { METRO_PLATFORM_CUTOFF_MSG } from "./constants";
import { isTenantFloorUnit } from "../milestones";
import { isMetroPlatformServed } from "../tower/routing";

import { FACILITIES, GARBAGE_COLLECT_HOUR, PARKING_WORKERS_PER_SPACE, RECYCLING_POP_PER_CENTER, isHotelKind } from "../facilities";
import type { FacilityKind, Unit } from "../types";

import { isOperational, isTenanted } from "../types";
import { HK_MAIDS_PER_UNIT, HK_NOMINAL_ROOMS_PER_MAID } from "../economy/housekeeping";

/** Recycling / parking / staff / stranded advisories for the Simulation, as friend functions taking the
 * instance. Extracted from `Simulation.ts`; the class keeps thin delegations. */

/** Operational Recycling Centers (finished, not on fire). */
export function recyclingCenters(sim: Simulation): number {
  return sim.countOperational("recycling");
}

/** Population whose daily garbage the tower can process. */
export function recyclingCapacity(sim: Simulation): number {
  return sim.recyclingCenters() * RECYCLING_POP_PER_CENTER;
}

/** The canon 4★ recycling gate: DEMAND MET, not merely built, one center
 *  per ~{@link RECYCLING_POP_PER_CENTER} population, so the requirement keeps
 *  growing with the tower exactly as in the original. */
export function recyclingDemandMet(sim: Simulation): boolean {
  return sim.tower.totalPopulation() <= sim.recyclingCapacity();
}

/**
 * How full every recycling center is right now, 0..1 (centers share the
 * tower's load). Garbage accumulates through the day from the pre-dawn
 * truck collection ({@link GARBAGE_COLLECT_HOUR}); a tower over capacity
 * hits 100% before the day is out, the original's "it filled up, build
 * more". Derived from the clock and population, never persisted.
 */
export function recyclingFill(sim: Simulation): number {
  const cap = sim.recyclingCapacity();
  if (cap === 0) return 0;
  const sinceCollect = (sim.clock.minuteOfDay - GARBAGE_COLLECT_HOUR * 60 + 1440) % 1440;
  return Math.min(1, (sim.tower.totalPopulation() / cap) * (sinceCollect / 1440));
}

/** Functional parking spaces the tower NEEDS: one per ~24 office workers
 *  (canon: offices demand parking from 3★) plus one per hotel suite (canon:
 *  suite guests, and the VIP, arrive by car). Below parking's own unlock star
 *  the demand is zero by definition: the player cannot build a ramp or space
 *  yet, so no advisory driven by this may tell them to build one. */
export function parkingDemand(sim: Simulation): { officePop: number; offices: number; suites: number; total: number } {
  if (sim.star < FACILITIES.parking.minStar) {
    return { officePop: 0, offices: 0, suites: 0, total: 0 };
  }
  let officePop = 0;
  let suites = 0;
  for (const u of sim.tower.units) {
    if (u.kind === "office" && isTenanted(u)) officePop += FACILITIES.office.population;
    else if (u.kind === "hotelSuite" && isOperational(u)) suites++;
  }
  const offices = Math.ceil(officePop / PARKING_WORKERS_PER_SPACE);
  return { officePop, offices, suites, total: offices + suites };
}

/** Housekeeping supply vs. demand, the legibility figure behind the stats row
 *  and the per-station inspector line (the housekeeping analog of
 *  {@link parkingDemand}). `outOfReach` reuses the same staff-network reach test
 *  as the cleanliness overlay: a hotel room is reachable when a crew stands on
 *  its floor or shares its staff-network component (service elevators and
 *  stairs, never escalators or passenger elevators). */
export interface HousekeepingCoverage {
  /** Total operational hotel rooms in service (the readout denominator). This
   *  counts infested rooms too; they are not cleanable, so the serviceable
   *  workload is `rooms - infested`, and callers that compare against capacity
   *  net out `infested` themselves. */
  rooms: number;
  /** Operational housekeeping crews. */
  crews: number;
  /** Maids the crews field: `crews * HK_MAIDS_PER_UNIT`. */
  maids: number;
  /** Rooms the maids NOMINALLY turn over in a day, per the canon anchor
   *  (`maids * HK_NOMINAL_ROOMS_PER_MAID`). An estimate for readouts: real
   *  throughput is emergent from travel time over the staff network plus the
   *  per-room cleaning dwell, so a spread-out, stair-only tower does far less
   *  than this figure while a compact one approaches it. */
  dailyCapacity: number;
  /** Hotel rooms no crew can reach over the staff network (never cleanable
   *  until the service network extends to them). */
  outOfReach: number;
  /** Rooms waiting on housekeeping right now. */
  dirty: number;
  /** Rooms lost to cockroaches (housekeeping can no longer help these). */
  infested: number;
}

export function housekeepingCoverage(sim: Simulation): HousekeepingCoverage {
  // Crew reach, computed once (same shape as sim/congestion.ts cleanliness map).
  const comps = sim.tower.staffComponents();
  const crewFloors = new Set<number>();
  const crewComps = new Set<number>();
  let crews = 0;
  for (const u of sim.tower.units) {
    if (u.kind !== "housekeeping" || !isOperational(u)) continue;
    crews++;
    crewFloors.add(u.floor);
    const c = comps.get(u.floor);
    if (c !== undefined) crewComps.add(c);
  }
  let rooms = 0;
  let outOfReach = 0;
  let dirty = 0;
  let infested = 0;
  for (const u of sim.tower.units) {
    if (!isHotelKind(u.kind) || !isOperational(u)) continue;
    rooms++;
    if (u.state === "dirty") dirty++;
    else if (u.state === "infested") infested++;
    const c = comps.get(u.floor);
    const reachable = crewFloors.has(u.floor) || (c !== undefined && crewComps.has(c));
    if (!reachable) outOfReach++;
  }
  const maids = crews * HK_MAIDS_PER_UNIT;
  return { rooms, crews, maids, dailyCapacity: maids * HK_NOMINAL_ROOMS_PER_MAID, outOfReach, dirty, infested };
}

/** Outcome of a {@link callExterminator} attempt, for the UI to surface. `ok`
 *  false carries a `reason`: `unavailable` (Classic has no exterminator),
 *  `pending` (a dispatch is already en route), `none` (no infested rooms), or
 *  `funds` (can't afford it; `cost`/`rooms` still populated so the UI can say
 *  how much it would be). */
export interface ExterminatorResult {
  ok: boolean;
  reason?: "unavailable" | "pending" | "none" | "funds";
  cost?: number;
  rooms?: number;
}

/** Dispatch a paid exterminator (Modern only) to clear cockroach infestations
 *  tower-wide. Charges `calloutFee + perRoomFee * infestedRooms` up front and
 *  schedules the treatment for the next day, so the rooms keep earning nothing
 *  and spread one more morning while the crew is en route (the "waiting still
 *  hurts" design). Classic returns `unavailable`: its infested rooms are
 *  bulldoze-only (1994 parity). */
export function callExterminator(sim: Simulation): ExterminatorResult {
  const recovery = sim.rules.infestationRecovery();
  if (!recovery) return { ok: false, reason: "unavailable" };
  if (sim.exterminationDueDay !== undefined) return { ok: false, reason: "pending" };
  const ids: number[] = [];
  for (const u of sim.tower.units) if (isHotelKind(u.kind) && u.state === "infested") ids.push(u.id);
  const rooms = ids.length;
  if (rooms === 0) return { ok: false, reason: "none" };
  const cost = recovery.calloutFee + recovery.perRoomFee * rooms;
  if (sim.money < cost) return { ok: false, reason: "funds", cost, rooms };
  sim.money -= cost;
  sim.recordMoney("upkeep", -cost);
  sim.exterminationDueDay = sim.clock.day + 1;
  // Remember exactly which rooms were billed, so an overnight-escalated wing is
  // NOT swept up for the price of today's smaller count. Transient by design: a
  // save taken mid-booking loses this and resolution falls back to clearing all
  // infested rooms (the dueDay itself persists, so the treatment still lands).
  sim.exterminationRoomIds = ids;
  sim.emit(
    `🧹 Exterminator booked for ${rooms} infested room(s): $${cost.toLocaleString()} charged. The rooms clear tomorrow.`,
    "money",
  );
  return { ok: true, cost, rooms };
}

/** Land a booked exterminator's treatment once its day arrives, clearing the
 *  rooms it was billed for (those still `infested`) back to a rentable `empty`.
 *  A room bulldozed or burned before resolution is simply not found (no refund).
 *  After a mid-booking save the billed set is gone, so it clears every infested
 *  room. No-op when nothing is en route. */
export function resolveExtermination(sim: Simulation): void {
  if (sim.exterminationDueDay === undefined || sim.clock.day < sim.exterminationDueDay) return;
  sim.exterminationDueDay = undefined;
  const billed = sim.exterminationRoomIds;
  sim.exterminationRoomIds = undefined;
  const billedSet = billed ? new Set(billed) : null;
  let cleared = 0;
  for (const u of sim.tower.units) {
    if (!isHotelKind(u.kind) || u.state !== "infested") continue;
    if (billedSet && !billedSet.has(u.id)) continue; // escalated after booking: not paid for
    u.state = "empty";
    u.satisfaction = 1;
    u.occupants = 0;
    u.dirtyDays = undefined;
    cleared++;
  }
  if (cleared > 0) {
    sim.emit(`🧹 The exterminator cleared ${cleared} infested room(s). They can be rented again.`, "good");
  }
}

/** True when there aren't enough working spaces for one-per-suite (the VIP
 *  and suite guests drive, canon "need a parking spot per suite"). */
export function suiteParkingShort(sim: Simulation): boolean {
  const d = sim.parkingDemand();
  return d.suites > 0 && sim.tower.functionalParkingSpots() < d.suites;
}

/** True when the tower is 3★+ and lacks enough parking for its office workforce
 * (each parking space serves ~24 workers), offices then demand parking.
 * Suites reserve their one-space-each FIRST (canon), so a lot full of suite
 * cars gives the offices nothing. */
export function officeParkingShort(sim: Simulation): boolean {
  if (sim.star < FACILITIES.parking.minStar) return false;
  const d = sim.parkingDemand();
  // Only ramp-chained spaces count (canon), and suites reserve theirs first,
  // clamp at 0 so a suite-heavy lot leaves offices "0 spaces", never a
  // negative that would read as short even with no office workers (officePop 0).
  const forOffices = Math.max(0, sim.tower.functionalParkingSpots() - d.suites);
  return forOffices * PARKING_WORKERS_PER_SPACE < d.officePop;
}

/**
 * Fraction of WORKING parking spaces holding a car right now (0..1), the
 * garage's display model, shared by the renderer and the inspector. Office
 * workers' cars fill the lot through weekday working hours; suite guests'
 * cars stand overnight. Dead (unchained) spaces never show cars, a car
 * couldn't have gotten there.
 */
export function parkingUsage(sim: Simulation, spots: number = sim.tower.functionalParkingSpots()): number {
  if (spots === 0) return 0;
  // Below parking's unlock star nothing demands the lot (see parkingDemand),
  // so nothing parks in it either: an imported or forged sub-3★ tower that
  // carries spaces must not draw suite cars while every demand surface reads
  // zero. Legitimate towers never hit this (spaces require 3★ to build and the
  // star never decreases).
  if (sim.star < FACILITIES.parking.minStar) return 0;
  const h = sim.clock.hour;
  const d = sim.parkingDemand();
  const officeCars = !sim.clock.isWeekend && h >= 8 && h < 18 ? d.offices : 0;
  let suiteCars = 0;
  if (h >= 19 || h < 8) {
    for (const u of sim.tower.units) if (u.kind === "hotelSuite" && u.state === "asleep") suiteCars++;
  }
  return Math.min(1, (officeCars + suiteCars) / spots);
}

export function nudgeServiceShortfalls(sim: Simulation): void {
  const wasteShort = sim.star >= 3 && !sim.recyclingDemandMet();
  if (wasteShort && !sim.wasteNudged) {
    const pop = sim.tower.totalPopulation();
    const need = Math.ceil(pop / RECYCLING_POP_PER_CENTER);
    sim.emit(
      `♻️ Garbage is piling up: ${pop.toLocaleString()} population needs ${need} Recycling Center${need === 1 ? "" : "s"} (you have ${sim.recyclingCenters()}). 4★ requires demand met.`,
      "info",
    );
  }
  sim.wasteNudged = wasteShort;

  const suiteShort = sim.star >= 3 && sim.suiteParkingShort();
  if (suiteShort && !sim.suiteParkingNudged) {
    const d = sim.parkingDemand();
    sim.emit(
      `🚗 Hotel suites need a working parking space each: ${d.suites} suite${d.suites === 1 ? "" : "s"}, ${sim.tower.functionalParkingSpots()} space(s) chained to a ramp.`,
      "info",
    );
  }
  sim.suiteParkingNudged = suiteShort;
}

/** Once-per-day, edge-triggered log nudge when a floor with tenant space has
 *  no route from the lobby within two rides (invisible otherwise). That covers
 *  both a floor needing 3+ rides and, in Classic, a floor whose only two-ride
 *  path leans on an express transfer at a plain floor (inadmissible under the
 *  lobby-transfer rule, so no route forms). Uses the wide `rentable` scope:
 *  empty units on such a floor can never move in (see the two-ride gate in
 *  {@link attemptMoveIns}), and with no tenant there is no other symptom, so
 *  the advisory is the only tell. Log-only (never a toast); de-duped by a
 *  latch so it can't repeat while the condition persists. */
export function nudgeStranded(sim: Simulation): void {
  const stranded = sim.strandedFloors("rentable").length > 0;
  if (stranded && !sim.strandedNudged) {
    // "info", not "bad": the UI toasts every good/bad log entry, and this
    // advisory is meant to be log-only (a quiet bulletin line, not a toast).
    sim.emit(
      "A floor with tenant space has no route from the lobby within two rides. Nobody will move in or visit. Check it in the inspector.",
      "info",
    );
  }
  sim.strandedNudged = stranded; // re-arms only after the condition clears
}

/** Once-per-day, edge-triggered log nudge when an operational metro station has
 *  no passenger transport reaching its platform (the station's middle story,
 *  `floor + 1`, per {@link isMetroPlatformServed}). A staff-only service
 *  elevator does NOT count: it never carries commuters, so a platform reached
 *  only by one is still orphaned here. Such a metro draws no commuters at all
 *  (every trip through it null-routes and the spawn side pushes no options for
 *  it), so without this advisory the player has no tell that their expensive
 *  metro is inert. Log-only (never a toast), latched like {@link nudgeStranded}
 *  so it cannot repeat while the condition persists. */
export function nudgeMetroPlatform(sim: Simulation): void {
  const orphaned = sim.tower.units.some(
    (u) => u.kind === "metro" && isOperational(u) && !isMetroPlatformServed(sim.tower, u),
  );
  if (orphaned && !sim.metroPlatformNudged) {
    sim.emit(METRO_PLATFORM_CUTOFF_MSG, "info");
  }
  sim.metroPlatformNudged = orphaned; // re-arms only after the condition clears
}

/**
 * Above-ground floors that are served (connected) but NOT ≤2-ride reachable,
 * "stranded". Two scopes, each with one meaning:
 *  - `"leased"` (default): floors carrying a real tenant. They earn rating
 *    credit but draw no visitors. The stats modal reads this one.
 *  - `"rentable"`: also floors whose tenant-capable units are operational
 *    but untenanted (empty, or a dirty hotel room). Nothing there will ever
 *    move in, so the daily advisory must cover them too (an empty condo slab
 *    past the second transfer would otherwise stall silently).
 * BFS-bearing, call only on modal-open or once/day, NEVER in {@link stats}
 * or the tick loop.
 */
export function strandedFloors(sim: Simulation, scope: "leased" | "rentable" = "leased"): number[] {
  // Collect candidate floors first, so the ≤2-ride BFS runs once PER FLOOR,
  // not once per tenant unit (many units share a floor).
  const candidates = new Set<number>();
  for (const u of sim.tower.units) {
    if (!sim.isStrandedCandidate(u, scope)) continue;
    if (!sim.tower.isFloorServed(u.floor)) continue; // "not connected" is a separate, inspector-reported state
    candidates.add(u.floor);
  }
  const out: number[] = [];
  for (const floor of candidates) if (!sim.floorReachable(floor)) out.push(floor);
  return out.sort((a, b) => a - b);
}

/** Whether a unit puts its floor in scope for {@link strandedFloors}.
 *  `rentable` widens `leased` with any OPERATIONAL tenant-capable unit, so
 *  empty space and a dirty hotel room (rentable again once housekeeping
 *  cleans it) both count; a gutted/burning/under-construction shell can't
 *  take a tenant, so it never qualifies on its own. */
export function isStrandedCandidate(_sim: Simulation, u: Unit, scope: "leased" | "rentable"): boolean {
  if (isTenantFloorUnit(u)) return true;
  if (scope !== "rentable") return false;
  return u.floor >= 2 && isOperational(u) && (FACILITIES[u.kind].population > 0 || isHotelKind(u.kind));
}

/** Per-sim reachability verdict cache for {@link floorReachable}, keyed by
 *  `tower.revision` (the same key Crowd's adjacency graph and Tower.stopsOf
 *  memoize on: every structural/stop change bumps it, and the ≤2-ride verdict
 *  is a pure function of that structure). A WeakMap so a discarded sim never
 *  pins its cache. */
const reachMemos = new WeakMap<Simulation, { revision: number; verdicts: Map<number, boolean> }>();

/**
 * True when a commuter can actually reach `floor` from the ground lobby in ≤2
 * transport rides (the {@link Crowd.route} cap, which in Classic also refuses
 * an express transfer away from a lobby floor). A floor can be
 * {@link Tower.isFloorServed} yet return false here, connected, but with no
 * admissible two-ride route, so no commuter ever spawns for it. The bounded
 * (≤2-ride) BFS runs at most once per floor per `tower.revision`: the verdict
 * is memoized (like Tower.stopsOf) because the editor card's access row now
 * reads it on the ~6 Hz editor pump, which must never pay a fresh routing BFS
 * per repaint. Callers with their own per-pass memo (attemptMoveIns) simply
 * hit this one.
 */
export function floorReachable(sim: Simulation, floor: number): boolean {
  if (floor === 1) return true;
  let memo = reachMemos.get(sim);
  if (!memo || memo.revision !== sim.tower.revision) {
    memo = { revision: sim.tower.revision, verdicts: new Map() };
    reachMemos.set(sim, memo);
  }
  let hit = memo.verdicts.get(floor);
  if (hit === undefined) {
    // Pure reachability probe: this discards the route and only asks whether the
    // floor is routable, so it must NOT draw the crowd rng that route()'s
    // shaft-balancing consumes (this runs on the ~6 Hz editor repaint pump; a
    // draw here would let UI timing perturb the seeded crowd stream on a banked
    // tower).
    hit = sim.crowd.reachable(sim.tower, 1, floor);
    memo.verdicts.set(floor, hit);
  }
  return hit;
}

/** Like {@link hasAny} but only counts a facility that is finished and intact
 * (not under construction, not on fire). Used by the rating/TOWER gates. */
export function hasOperational(sim: Simulation, kind: FacilityKind): boolean {
  return sim.countOperational(kind) > 0;
}

/** Count of operational (finished, not-on-fire) units of a kind. */
export function countOperational(sim: Simulation, kind: FacilityKind): number {
  let n = 0;
  for (const u of sim.tower.units) {
    if (u.kind === kind && isOperational(u)) n++;
  }
  return n;
}

/** Send a staff member (housekeeper) over the staff network, see
 *  {@link Crowd.spawnStaff}. Exposed on the context so the economy subsystem
 *  can dispatch crews without owning the crowd. */
export function spawnStaffTrip(sim: Simulation, from: number, to: number, destX: number, cleanUnitId: number, cleanMinutes: number, fromX?: number): "sent" | "full" | "no-route" {
  return sim.crowd.spawnStaff(sim.tower, from, to, destX, cleanUnitId, cleanMinutes, fromX);
}
