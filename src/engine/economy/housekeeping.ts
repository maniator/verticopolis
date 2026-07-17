import type { SimContext } from "../SimContext";
import { isOperational } from "../types";
import { isHotelKind } from "../facilities";

/** Rooms one housekeeping crew can turn over per day. Exported so the coverage
 *  readout (`sim/services.ts`) can size demand against it instead of duplicating
 *  the number. */
export const HK_ROOMS_PER_CREW = 20;
/** Housekeepers a single crew keeps in transit at once (jobs queue behind). */
const HK_MAX_IN_FLIGHT = 4;
/** Consecutive days a hotel room may sit `dirty` before cockroaches take hold.
 *  Mirrors the 1994 "left dirty more than 3 days" rule. On the INFEST_DAYS-th
 *  daily checkout still dirty, the room turns `infested` and can no longer be
 *  cleaned. */
export const INFEST_DAYS = 3;

/**
 * Hotel housekeeping dispatch, pulled out of {@link EconomySystem} into a friend
 * module that owns the daily shift ledger. All of this state is transient by
 * design (never serialized): crews re-seed with a full day's capacity on the
 * first dispatch that sees them, so both a mid-day save load and a crew built at
 * noon join the current shift. {@link EconomySystem} drives it: `beforeCheckout`
 * and `resetShift` bracket the morning checkout, and `dispatch` / `onResult` run
 * hourly through the day shift.
 */
export class Housekeeping {
  constructor(private readonly sim: SimContext) {}

  /** Crew unit id → rooms it can still take on today. */
  private hkCapacity = new Map<number, number>();
  /** Dirty-room unit id → crew unit id handling it (avoids double dispatch).
   *  Mutate only via {@link assignRoom} / {@link releaseAssignment} so the
   *  per-crew in-flight counter stays consistent. */
  private hkAssignedRoom = new Map<number, number>();
  /** Crew unit id → housekeepers it currently has en route, maintained in
   *  lockstep with {@link hkAssignedRoom}. */
  private hkInFlightByCrew = new Map<number, number>();
  /** Rooms turned over so far today (reported at the next checkout). */
  private hkCleanedToday = 0;
  /** Day the "can't reach" nudge last fired, so it warns once per day. */
  private hkNudgedDay = -1;
  /** Day the "at capacity" nudge last fired, so it warns once per day. */
  private hkStarvedDay = -1;

  /** Emit yesterday's shift report and breed overnight cockroaches, before this
   *  morning's checkouts mark their rooms dirty (so a hotel whose housekeeping
   *  kept up yesterday never seeds an infestation). */
  beforeCheckout(): void {
    // Yesterday's shift report, before today's ledger resets.
    if (this.hkCleanedToday > 0) {
      this.sim.emit(`Housekeeping cleaned ${this.hkCleanedToday} hotel room(s).`, "info");
    }
    this.hkCleanedToday = 0;
    // Age the dirty-day clock and turn rooms neglected past the limit into full
    // infestations FIRST, so a freshly-infested room is a spread source this same
    // morning (it can no longer be cleaned, only exterminated or bulldozed).
    this.escalateInfestations();
    // Cockroaches breed in rooms left dirty overnight; spread BEFORE this
    // morning's checkouts go dirty, so a hotel whose housekeeping kept up
    // yesterday never seeds an infestation (and a tower with NO housekeeping
    // is the worst case, not immune).
    this.spreadCockroaches();
  }

  /** Advance the per-room dirty-day clock at the daily boundary. A hotel room
   *  still `dirty` after {@link INFEST_DAYS} running days becomes `infested`:
   *  housekeeping's dispatch only ever targets `dirty`, so an infested room is
   *  automatically out of its reach from here on. Recovery is mode-specific and
   *  handled elsewhere (Classic bulldoze-only; Modern paid exterminator). */
  private escalateInfestations(): void {
    let infested = 0;
    for (const u of this.sim.tower.units) {
      if (u.state !== "dirty" || !isHotelKind(u.kind)) continue;
      const days = (u.dirtyDays ?? 0) + 1;
      if (days >= INFEST_DAYS) {
        u.state = "infested";
        u.occupants = 0;
        u.dirtyDays = undefined; // the clock's job is done; the room is now terminal-dirty
        infested++;
      } else {
        u.dirtyDays = days;
      }
    }
    if (infested > 0) {
      // Point at the mode-correct fix so the toast is actionable: Modern towers
      // can call an exterminator, Classic towers can only bulldoze and rebuild.
      const fix = this.sim.rules?.infestationRecovery()
        ? "Call an exterminator, or bulldoze and rebuild."
        : "Bulldoze and rebuild to clear them.";
      this.sim.emit(
        `🪳 ${infested} neglected room(s) became cockroach-infested and can no longer be cleaned. ${fix}`,
        "bad",
      );
    }
  }

  /** Fresh shift: yesterday's ledger is dropped (its travelers have long since
   *  despawned); each crew re-seeds with full capacity on the first dispatch
   *  below (also how crews built mid-shift join the same day). */
  resetShift(): void {
    this.hkCapacity.clear();
    this.hkAssignedRoom.clear();
    this.hkInFlightByCrew.clear();
  }

  /** Housekeepers a crew currently has en route. */
  private hkInFlight(crewId: number): number {
    return this.hkInFlightByCrew.get(crewId) ?? 0;
  }

  /** Record a dispatched crew→room assignment, keeping the in-flight counter in
   *  lockstep with {@link hkAssignedRoom}. */
  private assignRoom(roomId: number, crewId: number): void {
    this.hkAssignedRoom.set(roomId, crewId);
    this.hkInFlightByCrew.set(crewId, (this.hkInFlightByCrew.get(crewId) ?? 0) + 1);
  }

  /** Drop a room's assignment (arrival, or a shift reset), decrementing its
   *  crew's in-flight counter. Safe to call for an unassigned room. */
  private releaseAssignment(roomId: number): void {
    const crewId = this.hkAssignedRoom.get(roomId);
    if (crewId === undefined) return;
    this.hkAssignedRoom.delete(roomId);
    const left = (this.hkInFlightByCrew.get(crewId) ?? 0) - 1;
    if (left > 0) this.hkInFlightByCrew.set(crewId, left);
    else this.hkInFlightByCrew.delete(crewId);
  }

  /**
   * Send housekeepers to dirty rooms. Called each hour through the day shift:
   * a room is cleaned only when its housekeeper ARRIVES (the crowd walks/rides
   * them over the staff network: service elevators, stairs and escalators,
   * never the passenger elevators), exactly like the original where you watch
   * the staff work the hotel floors. Rooms with no staff-connected crew stay
   * dirty and the player is told why, once a day.
   */
  dispatch(): void {
    const tower = this.sim.tower;
    // Operational crews only: a burning or still-under-construction
    // housekeeping room has no staff to send.
    const crews = tower.units.filter((u) => u.kind === "housekeeping" && isOperational(u));
    if (crews.length === 0) return;
    for (const crew of crews) {
      if (!this.hkCapacity.has(crew.id)) this.hkCapacity.set(crew.id, HK_ROOMS_PER_CREW);
    }
    let unreachable = 0;
    let starved = 0;
    for (const room of tower.units) {
      if (!isHotelKind(room.kind) || room.state !== "dirty") continue;
      if (this.hkAssignedRoom.has(room.id)) continue; // someone's already on it
      let reachable = false;
      let transient = false; // in-flight/pool limits: retries will get there
      let outOfCapacity = false; // a crew's DAILY quota is spent
      let noRoute = false;
      for (const crew of crews) {
        if (!tower.staffConnected(crew.floor, room.floor)) continue;
        reachable = true;
        const left = this.hkCapacity.get(crew.id) ?? 0;
        if (left <= 0) {
          outOfCapacity = true;
          continue;
        }
        if (this.hkInFlight(crew.id) >= HK_MAX_IN_FLIGHT) {
          transient = true;
          continue;
        }
        // An absent hook (bare test contexts without a crowd) is a transient
        // condition, not a broken staff network: never report it as
        // unreachable.
        const sent = this.sim.spawnStaffTrip?.(crew.floor, room.floor, room.x + room.width / 2, room.id) ?? "full";
        if (sent === "full") {
          transient = true; // staff pool at cap: retry next hour
          break;
        }
        if (sent === "no-route") {
          noRoute = true; // shouldn't happen while connected: try another crew
          continue;
        }
        this.assignRoom(room.id, crew.id);
        this.hkCapacity.set(crew.id, left - 1);
        break;
      }
      if (this.hkAssignedRoom.has(room.id)) continue;
      // "Unreachable" covers both no staff-connected crew at all AND the
      // belt-and-suspenders case where a connected crew failed to route (a
      // reachability/routing drift): either way the player must be told
      // rather than dispatch retrying silently forever. Drift outranks the
      // capacity message: "build another" is no fix for a broken network.
      if (!reachable || (noRoute && !transient)) unreachable++;
      // Every connected crew has spent its daily quota: the hotel has outgrown
      // its housekeeping. Without this message the only symptom is the daily
      // cockroach alert, which reads as a bug when a unit already exists.
      else if (outOfCapacity && !transient) starved++;
    }
    if (unreachable > 0 && this.hkNudgedDay !== this.sim.clock.day) {
      this.hkNudgedDay = this.sim.clock.day;
      this.sim.emit(
        `🧹 Housekeeping can't reach ${unreachable} dirty room(s). Staff travel by service elevator, stairs or escalator, not passenger elevators.`,
        "bad",
      );
    }
    if (starved > 0 && this.hkStarvedDay !== this.sim.clock.day) {
      this.hkStarvedDay = this.sim.clock.day;
      this.sim.emit(
        `🧹 Housekeeping is at capacity. ${starved} dirty room(s) must wait until tomorrow. One Housekeeping unit cleans ~${HK_ROOMS_PER_CREW} rooms a day; build another.`,
        "bad",
      );
    }
  }

  /**
   * A dispatched housekeeper finished. Only an arrival that actually turns the
   * room over consumes the crew's capacity: a failed trip (gave up, shaft
   * bulldozed mid-ride) or a wasted one (the room burned down or was sold
   * while they rode) refunds it so a later dispatch can retry real work.
   */
  onResult(roomId: number, ok: boolean): void {
    const crewId = this.hkAssignedRoom.get(roomId);
    this.releaseAssignment(roomId);
    const room = this.sim.tower.getUnit(roomId);
    if (ok && room?.state === "dirty") {
      room.state = "empty";
      room.satisfaction = 1;
      room.dirtyDays = undefined; // clock reset: a re-dirtied room starts fresh
      this.hkCleanedToday++;
    } else if (crewId !== undefined) {
      this.hkCapacity.set(crewId, (this.hkCapacity.get(crewId) ?? 0) + 1);
    }
  }

  /** Rooms left dirty breed cockroaches that creep into the adjacent room along
   * the hotel run (canon): under-provision housekeeping and the infestation
   * spreads, soiling clean/occupied neighbors until you scale up cleaning. Both
   * `dirty` and full `infested` rooms are spread sources, so an untreated
   * infestation keeps eating the wing until it is cleaned, exterminated, or
   * bulldozed. */
  private spreadCockroaches(): void {
    const sources = this.sim.tower.units.filter(
      (u) => isHotelKind(u.kind) && (u.state === "dirty" || u.state === "infested"),
    );
    if (sources.length === 0) return;
    let spread = 0;
    for (const u of sources) {
      // Check BOTH neighbors; a non-hotel room on one side shouldn't block
      // infestation of a hotel room on the other.
      for (const neighbor of [
        this.sim.tower.roomAt(u.floor, u.x + u.width),
        this.sim.tower.roomAt(u.floor, u.x - 1),
      ]) {
        if (neighbor && isHotelKind(neighbor.kind) && (neighbor.state === "asleep" || neighbor.state === "empty")) {
          neighbor.state = "dirty";
          neighbor.occupants = 0;
          spread++;
        }
      }
    }
    if (spread > 0) {
      this.sim.emit(`🪳 Cockroaches spread from unserviced rooms into ${spread} more. Add housekeeping!`, "bad");
    }
  }
}
