import type { SimContext } from "../SimContext";
import { isOperational, type Unit } from "../types";
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

/** Compact floor list for alert copy: sorted, deduped, consecutive runs
 *  folded to ranges ("12, 14–16"), so an infestation alert names WHERE instead
 *  of a bare count. En-dash in the numeric range per house style. Raw floor
 *  numbers are safe here: hotel kinds and condos can never be built in the
 *  basement (NO_BASEMENT_KINDS), so every floor is >= 1 and reads exactly as
 *  the player-facing "floor N" convention. */
export function formatFloors(floors: Iterable<number>): string {
  const sorted = [...new Set(floors)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : `${sorted[i]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

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
  /** Yesterday's shift result, latched at the morning checkout: rooms cleaned
   *  and rooms that survived the whole shift dirty. The OBSERVED throughput
   *  figures the "enough housekeeping" verdicts key on (a nominal
   *  maids-times-anchor capacity can read green while a distant wing rots;
   *  what actually went unserved cannot lie). Transient: a fresh load reads
   *  null (unknown) until the first checkout, and consumers fall back to the
   *  nominal estimate for that first morning. */
  private hkYesterday: { cleaned: number; leftover: number } | null = null;
  /** Day the "can't reach" nudge last fired, so it warns once per day. */
  private hkNudgedDay = -1;

  /** Yesterday's observed shift result, or null before the first checkout
   *  (fresh game or fresh load). Returns a copy, so no consumer can mutate
   *  the shared latch. See {@link hkYesterday}. */
  report(): { cleaned: number; leftover: number } | null {
    return this.hkYesterday ? { ...this.hkYesterday } : null;
  }

  /** Emit yesterday's shift report and breed overnight cockroaches, before this
   *  morning's checkouts mark their rooms dirty (so a hotel whose housekeeping
   *  kept up yesterday never seeds an infestation). */
  beforeCheckout(): void {
    // Yesterday's shift report, before today's ledger resets. A room still
    // dirty NOW survived the whole previous shift, so the leftover count is the
    // honest "your housekeeping is losing" figure (the fix is more crews or
    // better staff transport, and the escalation message below covers the
    // terminal case). The report fires whenever there IS a leftover, even on a
    // zero-clean day (no crews, a burned crew, every trip gave up): total
    // collapse is the day the player most needs the number, never a silent one.
    const leftover = this.sim.tower.units.filter((u) => isHotelKind(u.kind) && u.state === "dirty").length;
    if (this.hkCleanedToday > 0 || leftover > 0) {
      const behind = leftover > 0 ? ` ${leftover} room(s) went unserved; add crews or improve staff transport.` : "";
      this.sim.emit(`Housekeeping cleaned ${this.hkCleanedToday} hotel room(s).${behind}`, leftover > 0 ? "bad" : "info");
    }
    // Latch the observed figures for the coverage verdicts before the ledger
    // resets (see report()).
    this.hkYesterday = { cleaned: this.hkCleanedToday, leftover };
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
    const floors: number[] = [];
    for (const u of this.sim.tower.units) {
      if (u.state !== "dirty" || !isHotelKind(u.kind)) continue;
      const days = (u.dirtyDays ?? 0) + 1;
      if (days >= INFEST_DAYS) {
        u.state = "infested";
        u.occupants = 0;
        u.dirtyDays = undefined; // the clock's job is done; the room is now terminal-dirty
        floors.push(u.floor);
      } else {
        u.dirtyDays = days;
      }
    }
    if (floors.length > 0) {
      // Point at the mode-correct fix so the toast is actionable: Modern towers
      // can call an exterminator, Classic towers can only bulldoze and rebuild.
      // Naming the floors makes the alert locatable instead of a bare count
      // (overhaul GDD, legibility: alerts carry location).
      const fix = this.sim.rules?.infestationRecovery()
        ? "Call an exterminator, or bulldoze and rebuild."
        : "Bulldoze and rebuild to clear them.";
      this.sim.emit(
        `🪳 ${floors.length} neglected room(s) on floor(s) ${formatFloors(floors)} became cockroach-infested and can no longer be cleaned. ${fix}`,
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
    // The dispatch ORDER is the one place the modes differ (GameRules seam):
    // Classic takes dirty rooms in plain tower order and tries crews in tower
    // order (the original's opportunistic, unglamorous behavior); Modern's
    // smart triage scores each room by days-dirty urgency against travel cost
    // (floor distance to its nearest staff-connected crew) and takes the
    // highest score first, trying the NEAREST eligible crew first. Both
    // orderings are fully deterministic: scores tie-break on unit id, crews on
    // floor distance then id, and no RNG is drawn anywhere on this path.
    const triage = this.sim.rules?.housekeepingTriage() ?? null;
    let candidates = tower.units.filter(
      (u) => isHotelKind(u.kind) && u.state === "dirty" && !this.hkAssignedRoom.has(u.id),
    );
    let crewsFor = (_room: Unit): Unit[] => crews;
    if (triage) {
      // Distance and crew order depend only on the room's FLOOR, so both memo
      // by floor: a hotel floor packed with dirty rooms costs one scan and one
      // sort, not one per room (review: dispatch also reruns per drained maid
      // batch, so the per-room work should stay flat).
      const distByFloor = new Map<number, number>();
      const nearestDist = (floor: number): number => {
        let best = distByFloor.get(floor);
        if (best !== undefined) return best;
        best = Infinity;
        for (const crew of crews) {
          if (!tower.staffConnected(crew.floor, floor)) continue;
          const d = Math.abs(crew.floor - floor);
          if (d < best) best = d;
        }
        distByFloor.set(floor, best);
        return best;
      };
      const score = (room: Unit): number => {
        const d = nearestDist(room.floor);
        if (d === Infinity) return -Infinity; // unreachable: sorted last, still reported below
        return (room.dirtyDays ?? 0) * triage.perDirtyDay - d * triage.perFloor;
      };
      const scores = new Map(candidates.map((r) => [r.id, score(r)]));
      // COMPARE the scores, never subtract them: two unreachable rooms both
      // score -Infinity and a subtraction would hand the sort NaN, leaving
      // determinism to NaN falsiness instead of the explicit id tiebreak
      // (review finding; a test pins the two-unreachable ordering).
      candidates = [...candidates].sort((a, b) => {
        const sa = scores.get(a.id)!;
        const sb = scores.get(b.id)!;
        return sa === sb ? a.id - b.id : sb > sa ? 1 : -1;
      });
      const crewOrderByFloor = new Map<number, Unit[]>();
      crewsFor = (room) => {
        let order = crewOrderByFloor.get(room.floor);
        if (!order) {
          order = [...crews].sort(
            (c1, c2) => Math.abs(c1.floor - room.floor) - Math.abs(c2.floor - room.floor) || c1.id - c2.id,
          );
          crewOrderByFloor.set(room.floor, order);
        }
        return order;
      };
    }
    let unreachable = 0;
    for (const room of candidates) {
      let reachable = false;
      let transient = false; // busy maids / pool limits: retries will get there
      let noRoute = false;
      for (const crew of crewsFor(room)) {
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
          this.sim.spawnStaffTrip?.(
            crew.floor,
            room.floor,
            room.x + room.width / 2,
            room.id,
            HK_CLEAN_MINUTES,
            crew.x + crew.width / 2, // she steps out of her own station
          ) ?? "full";
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
   * way the maid and her floor slot are released. The sim loop re-runs
   * dispatch once per drained batch of results (see sim/loop.ts), so freed
   * maids cycle straight onto the next dirty room between hourly ticks
   * (event-driven cycling: this is what makes throughput
   * travel-plus-dwell-limited instead of quota-bound).
   */
  onResult(roomId: number, ok: boolean): void {
    this.releaseAssignment(roomId);
    const room = this.sim.tower.getUnit(roomId);
    if (ok && room?.state === "dirty") {
      room.state = "empty";
      room.satisfaction = 1;
      room.dirtyDays = undefined; // clock reset: a re-dirtied room starts fresh
      this.hkCleanedToday++;
    }
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
    const floors: number[] = [];
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
          floors.push(neighbor.floor);
        }
      }
    }
    if (floors.length > 0) {
      this.sim.emit(
        `🪳 Cockroaches spread from infested rooms into ${floors.length} more room${floors.length > 1 ? "s" : ""} on floor(s) ${formatFloors(floors)}. Clear the infested source.`,
        "bad",
      );
    }
  }
}
