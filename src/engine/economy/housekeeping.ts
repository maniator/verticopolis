import type { SimContext } from "../SimContext";
import { isOperational } from "../types";
import { isHotelKind } from "../facilities";
import type { HousekeepingShift } from "../gameRules";

/** Maids a single Housekeeping unit fields (canon: the 1994 unit staffs 6, each
 *  working a separate floor). A unit's throughput is EMERGENT: how many rooms
 *  its maids actually turn over depends on travel time over the staff network
 *  plus the per-room cleaning dwell, not on a fixed per-day quota. */
export const HK_MAIDS_PER_UNIT = 6;
/** Game-minutes a maid spends cleaning inside a room before it turns over.
 *  Tuned against the canon anchor of ~19 rooms per maid per shift on a compact,
 *  well-connected hotel: the Classic 12:00-17:00 window is 300 minutes, and
 *  ~19 cycles of (travel + dwell) fit when the full cycle averages ~15 minutes,
 *  so with typical service-elevator travel the pure dwell lands here. */
export const HK_CLEAN_MINUTES = 8;
/** Rooms one maid nominally turns over per day (the canon anchor), for
 *  READOUTS only: real throughput emerges from travel + dwell, so coverage
 *  figures derived from this are estimates, not guarantees. */
export const HK_NOMINAL_ROOMS_PER_MAID = 19;
/** Consecutive days a hotel room may sit `dirty` before cockroaches take hold.
 *  Mirrors the 1994 "left dirty more than 3 days" rule. On the INFEST_DAYS-th
 *  daily checkout still dirty, the room turns `infested` and can no longer be
 *  cleaned. */
export const INFEST_DAYS = 3;

/** Shift fallback for bare test contexts without a rule-set: the legacy (and
 *  Modern) 08:00-19:00 day with the standard 30-minute no-new-room tail. Real
 *  sims read {@link GameRules.housekeepingShift} (Classic: canon 12:00-17:00
 *  with the 16:30 cutoff). */
const FALLBACK_SHIFT: HousekeepingShift = { start: 8, end: 19, cutoff: 18.5 };

/**
 * Hotel housekeeping dispatch, pulled out of {@link EconomySystem} into a friend
 * module that owns the transient shift ledger. All of this state is transient by
 * design (never serialized): assignments re-derive from dispatch, so both a
 * mid-day save load and a crew built at noon join the current shift.
 * {@link EconomySystem} drives it: `beforeCheckout` and `resetShift` bracket the
 * morning checkout, and `dispatch` / `onResult` run through the day shift.
 *
 * The maid model (housekeeping-overhaul GDD, epic 2): each unit fields
 * {@link HK_MAIDS_PER_UNIT} maids, at most one of a unit's maids works any given
 * floor at a time (canon: 6 maids fan out one-per-floor), each dispatched maid
 * walks the staff network (service elevators and stairs, never escalators or
 * passenger elevators), dwells {@link HK_CLEAN_MINUTES} in the room, and the
 * room turns over when the dwell COMPLETES. A freed maid immediately takes the
 * next room (event-driven via {@link onResult}), so throughput is whatever
 * travel + dwell allows inside the shift window, with no per-day quota.
 */
export class Housekeeping {
  constructor(private readonly sim: SimContext) {}

  /** Dirty-room unit id → its assignment (which crew sent the maid, and the
   *  floor she is working, captured at dispatch so a room bulldozed mid-trip
   *  still releases the right floor slot). Mutate only via {@link assignRoom} /
   *  {@link releaseAssignment} so the per-crew ledgers stay consistent. */
  private hkAssignedRoom = new Map<number, { crewId: number; floor: number }>();
  /** Crew unit id → maids it currently has out (≤ {@link HK_MAIDS_PER_UNIT}). */
  private hkMaidsOut = new Map<number, number>();
  /** Crew unit id → floors its maids are currently working (one maid per floor
   *  per crew, canon). */
  private hkFloorsBusy = new Map<number, Set<number>>();
  /** Rooms turned over so far today (reported at the next checkout). */
  private hkCleanedToday = 0;
  /** Day the "can't reach" nudge last fired, so it warns once per day. */
  private hkNudgedDay = -1;

  /** Emit yesterday's shift report and breed overnight cockroaches, before this
   *  morning's checkouts mark their rooms dirty (so a hotel whose housekeeping
   *  kept up yesterday never seeds an infestation). */
  beforeCheckout(): void {
    // Yesterday's shift report, before today's ledger resets. A room still
    // dirty NOW survived the whole previous shift, so the leftover count is the
    // honest "your housekeeping is losing" figure (the fix is more crews or
    // better staff transport, and the escalation message below covers the
    // terminal case).
    const leftover = this.sim.tower.units.filter((u) => isHotelKind(u.kind) && u.state === "dirty").length;
    if (this.hkCleanedToday > 0) {
      const behind = leftover > 0 ? ` ${leftover} room(s) went unserved; add crews or improve staff transport.` : "";
      this.sim.emit(`Housekeeping cleaned ${this.hkCleanedToday} hotel room(s).${behind}`, leftover > 0 ? "bad" : "info");
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
   *  despawned); assignments re-derive from today's dispatches (also how crews
   *  built mid-shift join the same day). */
  resetShift(): void {
    this.hkAssignedRoom.clear();
    this.hkMaidsOut.clear();
    this.hkFloorsBusy.clear();
  }

  /** The mode's shift window (Classic canon noon-5 / Modern 08-19), or the
   *  legacy window in bare test contexts without a rule-set. */
  private shift(): HousekeepingShift {
    return this.sim.rules?.housekeepingShift() ?? FALLBACK_SHIFT;
  }

  /** True while dispatch may start a NEW room: inside the shift and before the
   *  no-new-room cutoff (canon: 16:30 for the Classic 17:00 close). In-flight
   *  maids are unaffected; they finish the room they are on. */
  private canStartNewRoom(): boolean {
    const s = this.shift();
    const h = this.sim.clock.minuteOfDay / 60;
    return h >= s.start && h < s.cutoff;
  }

  /** Record a dispatched crew→room assignment, keeping the per-crew maid and
   *  floor ledgers in lockstep with {@link hkAssignedRoom}. */
  private assignRoom(roomId: number, crewId: number, floor: number): void {
    this.hkAssignedRoom.set(roomId, { crewId, floor });
    this.hkMaidsOut.set(crewId, (this.hkMaidsOut.get(crewId) ?? 0) + 1);
    let floors = this.hkFloorsBusy.get(crewId);
    if (!floors) this.hkFloorsBusy.set(crewId, (floors = new Set()));
    floors.add(floor);
  }

  /** Drop a room's assignment (job finished, or a shift reset), freeing the
   *  maid and her floor slot. Safe to call for an unassigned room. */
  private releaseAssignment(roomId: number): { crewId: number; floor: number } | undefined {
    const a = this.hkAssignedRoom.get(roomId);
    if (!a) return undefined;
    this.hkAssignedRoom.delete(roomId);
    const left = (this.hkMaidsOut.get(a.crewId) ?? 0) - 1;
    if (left > 0) this.hkMaidsOut.set(a.crewId, left);
    else this.hkMaidsOut.delete(a.crewId);
    this.hkFloorsBusy.get(a.crewId)?.delete(a.floor);
    return a;
  }

  /**
   * Send maids to dirty rooms. Called each hour through the day shift AND
   * whenever a maid frees up ({@link onResult}), so freed maids cycle at their
   * natural travel + dwell rate instead of waiting for the next hour. A room is
   * cleaned only when its maid finishes the in-room cleaning dwell (the crowd
   * walks/rides her over the staff network: service elevators and stairs, never
   * escalators or passenger elevators), exactly like the original where you
   * watch the staff work the hotel floors. Rooms with no staff-connected crew
   * stay dirty and the player is told why, once a day.
   */
  dispatch(): void {
    if (!this.canStartNewRoom()) return;
    const tower = this.sim.tower;
    // Operational crews only: a burning or still-under-construction
    // housekeeping room has no staff to send.
    const crews = tower.units.filter((u) => u.kind === "housekeeping" && isOperational(u));
    if (crews.length === 0) return;
    let unreachable = 0;
    for (const room of tower.units) {
      if (!isHotelKind(room.kind) || room.state !== "dirty") continue;
      if (this.hkAssignedRoom.has(room.id)) continue; // a maid is already on it
      let reachable = false;
      let transient = false; // busy maids / pool limits: retries will get there
      let noRoute = false;
      for (const crew of crews) {
        if (!tower.staffConnected(crew.floor, room.floor)) continue;
        reachable = true;
        if ((this.hkMaidsOut.get(crew.id) ?? 0) >= HK_MAIDS_PER_UNIT) {
          transient = true; // all 6 out; they cycle back within minutes
          continue;
        }
        if (this.hkFloorsBusy.get(crew.id)?.has(room.floor)) {
          transient = true; // canon: one maid per floor per unit at a time
          continue;
        }
        // An absent hook (bare test contexts without a crowd) is a transient
        // condition, not a broken staff network: never report it as
        // unreachable.
        const sent =
          this.sim.spawnStaffTrip?.(crew.floor, room.floor, room.x + room.width / 2, room.id, HK_CLEAN_MINUTES) ??
          "full";
        if (sent === "full") {
          transient = true; // staff pool at cap: retry when a maid frees up
          break;
        }
        if (sent === "no-route") {
          noRoute = true; // shouldn't happen while connected: try another crew
          continue;
        }
        this.assignRoom(room.id, crew.id, room.floor);
        break;
      }
      if (this.hkAssignedRoom.has(room.id)) continue;
      // "Unreachable" covers both no staff-connected crew at all AND the
      // belt-and-suspenders case where a connected crew failed to route (a
      // reachability/routing drift): either way the player must be told
      // rather than dispatch retrying silently forever.
      if (!reachable || (noRoute && !transient)) unreachable++;
    }
    if (unreachable > 0 && this.hkNudgedDay !== this.sim.clock.day) {
      this.hkNudgedDay = this.sim.clock.day;
      this.sim.emit(
        `🧹 Housekeeping can't reach ${unreachable} dirty room(s). Staff travel by service elevator or stairs, not escalators or passenger elevators.`,
        "bad",
      );
    }
  }

  /**
   * A dispatched maid finished. A completed cleaning dwell turns the room
   * over; a failed trip (gave up, shaft bulldozed mid-ride) or a wasted one
   * (the room burned down or was sold while she rode) just frees her. Either
   * way the maid and her floor slot are released, and dispatch runs again so
   * she moves straight on to the next dirty room (event-driven cycling: this
   * is what makes throughput travel-plus-dwell-limited instead of quota-bound).
   */
  onResult(roomId: number, ok: boolean): void {
    const had = this.releaseAssignment(roomId);
    const room = this.sim.tower.getUnit(roomId);
    if (ok && room?.state === "dirty") {
      room.state = "empty";
      room.satisfaction = 1;
      room.dirtyDays = undefined; // clock reset: a re-dirtied room starts fresh
      this.hkCleanedToday++;
    }
    // Cycle the freed maid onto her next room (no-op outside the shift or past
    // the no-new-room cutoff; the hourly dispatch already covers fresh hours).
    if (had) this.dispatch();
  }

  /** A full cockroach infestation creeps into the adjacent room along the hotel
   * run (canon). Canon rule matched here: only an `infested` room is a spread
   * source. A merely `dirty` room does NOT spread (leaving one dirty overnight is
   * a housekeeping backlog, not an outbreak, so a tower with zero infested rooms
   * never raises this alarm). An infested source soils an adjacent occupied or
   * empty neighbor (turning it `dirty`), so an untreated infestation keeps eating
   * the wing until the source is cleared (bulldoze, or Modern's exterminator).
   *
   * NOTE: softening the occupied-neighbor case so spread never robs a completed
   * stay of its revenue is deferred (a naive "empty-only" target breaks
   * propagation, since spread runs each morning while last night's guests are
   * still `asleep`). Tracked in the housekeeping-overhaul GDD. */
  private spreadCockroaches(): void {
    const sources = this.sim.tower.units.filter((u) => isHotelKind(u.kind) && u.state === "infested");
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
      this.sim.emit(
        `🪳 Cockroaches spread from infested rooms into ${spread} more room${spread > 1 ? "s" : ""}. Clear the infested source.`,
        "bad",
      );
    }
  }
}
