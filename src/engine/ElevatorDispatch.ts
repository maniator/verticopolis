import type { Tower } from "./Tower";
import type { ElevatorCalls } from "./Crowd";
import { isElevatorKind, isStaffOnlyTransport, transportCarCapacity } from "./facilities";

/** Car travel speed in floors per game-minute. Exported so the crowd's
 *  patience budget can be derived from it and never drift (see Crowd's
 *  RIDE_SECONDS_PER_FLOOR). */
export const CAR_FLOORS_PER_MINUTE = 0.8;

/** How long a car pauses at a stop to load/unload, in game-minutes. */
const DWELL_MINUTES = 0.8;

/**
 * Demand-driven elevator dispatch — a simplified SCAN controller, lifted out of
 * {@link Simulation} so the lift logic can be tested on its own. It owns two
 * transient pieces of state (per-car dwell timers and a per-floor waiting
 * estimate) and mutates each transport's `carPositions` / `carDir` / `carLoad`
 * in place each tick. Nothing here touches money, ratings or the DOM, so it is
 * pure and deterministic given a {@link Tower} and the rush multiplier.
 */
export class ElevatorDispatch {
  /** Transient per-car dwell timers (not serialized; rebuilt on demand). */
  private carDwell = new Map<number, number[]>();
  /** Waiting passengers per floor — builds up over time, cleared as cars call. */
  private waiting = new Map<number, number>();

  /** Current waiting estimate at a floor (for inspection / tests). */
  waitingAt(floor: number): number {
    return this.waiting.get(floor) ?? 0;
  }

  /** Drop per-car dwell timers for shafts that no longer exist, so a bulldozed
   * elevator can't leak its transient state for the rest of the session. */
  private pruneRemovedShafts(tower: Tower): void {
    if (this.carDwell.size === 0) return;
    const live = new Set(tower.transports.map((t) => t.id));
    for (const id of this.carDwell.keys()) if (!live.has(id)) this.carDwell.delete(id);
  }

  /**
   * Move each elevator car like a real lift: it continues in its current
   * direction to the next floor that has waiting passengers, dwells briefly to
   * load, then carries on — reversing when there is nothing more ahead. Cars
   * therefore congregate where demand is, instead of bouncing at random.
   * Stairs/escalators have no cars (their walkers are drawn directly), so they
   * are skipped here. `rush` is the time-of-day demand multiplier.
   *
   * `crowdCalls` carries the drawn crowd's live calls (see Crowd.elevatorCalls):
   * hall calls count as demand even when the statistical estimate rounds to
   * zero, so cars stop for the people the player can actually see; cab calls
   * are per-car forced stops — a rider can only alight from their own car, so
   * these are served by that car regardless of what the other cars claim.
   */
  update(tower: Tower, dt: number, rush: number, crowdCalls?: ElevatorCalls): void {
    this.accumulate(tower, dt, rush);
    this.moveCars(tower, dt, crowdCalls);
  }

  /** Advance the statistical demand model by a span of time. Split out from
   *  {@link moveCars} because this scans the whole unit list — it must run once
   *  per outer sim step, not once per fine-grained car sub-step. */
  accumulate(tower: Tower, dt: number, rush: number): void {
    this.pruneRemovedShafts(tower);
    this.accumulateWaiting(tower, dt, rush);
  }

  /** Move the cars by a (short) time slice against the current demand. */
  moveCars(tower: Tower, dt: number, crowdCalls?: ElevatorCalls): void {
    const demand = this.waiting;
    // Idle cars rest at the lowest LOBBY the shaft serves (the ground/sky lobby),
    // not merely its lowest stop — review F27.
    const lobbySet = new Set(tower.lobbyFloors());
    for (const t of tower.transports) {
      if (!isElevatorKind(t.kind)) continue;
      // Staff-only shafts answer ONLY the real calls of staff currently
      // traveling — never the aggregate tenant-demand estimate, so a service
      // elevator does no phantom passenger service.
      const staffOnly = isStaffOnlyTransport(t.kind);
      const hall = crowdCalls?.hall.get(t.id);
      const cabs = crowdCalls?.cab.get(t.id);
      const stops = tower.stopsOf(t);
      if (stops.length === 0) continue;
      const idleFloor = stops.find((s) => lobbySet.has(s)) ?? stops[0];

      let dwell = this.carDwell.get(t.id);
      if (!dwell || dwell.length !== t.cars) {
        dwell = new Array(t.cars).fill(0);
        this.carDwell.set(t.id, dwell);
      }
      if (!t.carLoad || t.carLoad.length !== t.cars) t.carLoad = new Array(t.cars).fill(0);
      const cap = transportCarCapacity(t.kind);

      // One merged hall-call set per shaft: the floors where real routed
      // people stand waiting, plus — on passenger shafts — the statistical
      // estimate.
      const calls = new Set<number>();
      for (const fl of stops) {
        if ((hall?.get(fl) ?? 0) >= 1) calls.add(fl);
        else if (!staffOnly && (demand.get(fl) ?? 0) >= 1) calls.add(fl);
      }
      // Floors another car in this shaft is already heading to this tick, so the
      // cars spread out to distinct calls instead of bunching on the same floor
      // (review F17).
      const claimed = new Set<number>();
      for (let i = 0; i < t.cars; i++) {
        // Serve out any remaining dwell first; if it expires mid-step the car
        // moves for the remainder, so throughput doesn't depend on how the
        // outer step happens to be chunked.
        let carDt = dt;
        if (dwell[i] > 0) {
          const pause = Math.min(dwell[i], carDt);
          dwell[i] -= pause;
          carDt -= pause;
          if (carDt <= 0) {
            // Still dwelling — claim the floor so the shaft's other cars
            // don't converge on the same call meanwhile.
            claimed.add(Math.round(t.carPositions[i]));
            continue;
          }
        }
        const v = carDt * CAR_FLOORS_PER_MINUTE; // floors traveled this step
        let pos = t.carPositions[i];
        let dir = t.carDir[i] || 1;

        // This car's own riders' destinations. They are NOT subject to
        // `claimed`: another car "handling" the floor can serve its hall call
        // but can never deliver THIS car's passengers.
        const cab = cabs?.get(i);
        let target = this.nextDemandStop(stops, pos, dir, calls, claimed, cab);
        if (target === null) {
          dir = -dir; // nothing ahead — turn around
          target = this.nextDemandStop(stops, pos, dir, calls, claimed, cab);
        }
        if (target !== null) claimed.add(target); // reserve this call for this car
        if (target === null) {
          // Nobody waiting: return to the lobby and stop dead rather than pacing.
          target = idleFloor;
          if (Math.abs(pos - target) < 0.05) {
            t.carDir[i] = 0;
            t.carLoad[i] = 0; // everyone's stepped off
            continue;
          }
        }

        if (Math.abs(target - pos) <= v) {
          pos = target;
          dwell[i] = DWELL_MINUTES; // pause to load / unload
          // Some riders alight, then waiting passengers board up to capacity.
          // Staff shafts carry only their real callers (the hall count) — the
          // statistical tenant queue never boards a service car.
          t.carLoad[i] = Math.max(0, t.carLoad[i] - Math.ceil(t.carLoad[i] * 0.45));
          const w = staffOnly ? (hall?.get(target) ?? 0) : (demand.get(target) ?? 0);
          const board = Math.max(0, Math.min(cap - t.carLoad[i], w));
          if (board > 0) {
            t.carLoad[i] += board;
            if (!staffOnly) demand.set(target, Math.max(0, w - board));
          }
          if (pos >= t.top) dir = -1;
          else if (pos <= t.bottom) dir = 1;
        } else {
          dir = target > pos ? 1 : -1;
          pos += dir * v;
        }
        t.carPositions[i] = Math.max(t.bottom, Math.min(t.top, pos));
        t.carDir[i] = dir;
      }
    }
  }

  /**
   * Accumulate waiting passengers per floor: only people who are actually
   * present generate trips, and they trickle in faster during the rush. Calls
   * fade if no car ever comes. Cars therefore sit idle when nobody's about
   * (an empty tower, the dead of night) and bustle when it's busy.
   */
  private accumulateWaiting(tower: Tower, dt: number, rush: number): void {
    for (const [fl, n] of this.waiting) {
      const v = n - dt * 0.03;
      if (v <= 0) this.waiting.delete(fl);
      else this.waiting.set(fl, v);
    }
    for (const u of tower.units) {
      if (u.occupants <= 0 || !tower.isFloorServed(u.floor)) continue;
      this.waiting.set(u.floor, Math.min(25, (this.waiting.get(u.floor) ?? 0) + u.occupants * rush * dt * 0.012));
    }
    const pop = tower.totalPopulation();
    if (pop > 0) {
      for (const fl of tower.lobbyFloors()) {
        this.waiting.set(fl, Math.min(25, (this.waiting.get(fl) ?? 0) + pop * rush * dt * 0.0015));
      }
    }
  }

  /** Nearest stop strictly ahead (in `dir`) with a live call: a claimable hall
   * call, or one of this car's own cab stops (never blocked by `claimed`). */
  private nextDemandStop(
    stops: number[],
    pos: number,
    dir: number,
    calls: Set<number>,
    claimed?: Set<number>,
    cab?: Set<number>,
  ): number | null {
    let best: number | null = null;
    let bestDist = Infinity;
    for (const fl of stops) {
      if (dir > 0 && fl <= pos + 0.05) continue;
      if (dir < 0 && fl >= pos - 0.05) continue;
      if (!cab?.has(fl)) {
        if (claimed?.has(fl)) continue; // another car is already handling this call
        if (!calls.has(fl)) continue;
      }
      const dist = Math.abs(fl - pos);
      if (dist < bestDist) {
        bestDist = dist;
        best = fl;
      }
    }
    return best;
  }
}
