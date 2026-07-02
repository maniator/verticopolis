import type { Tower } from "./Tower";
import { isElevatorKind, isStaffOnlyTransport, transportCarCapacity } from "./facilities";

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
   */
  update(tower: Tower, dt: number, rush: number, staffCalls?: ReadonlyMap<number, number>): void {
    this.pruneRemovedShafts(tower);
    this.accumulateWaiting(tower, dt, rush);
    // Staff-only shafts answer the REAL calls of staff currently traveling
    // (passed in from the crowd each tick) instead of the aggregate
    // tenant-demand estimate — no phantom passenger service. The mutable copy
    // (boarding decrements it below) is made lazily on the first staff shaft,
    // so towers without one pay nothing.
    let staffDemand: Map<number, number> | null = null;
    for (const t of tower.transports) {
      if (!isElevatorKind(t.kind)) continue;
      const demand = isStaffOnlyTransport(t.kind)
        ? (staffDemand ??= new Map(staffCalls ?? []))
        : this.waiting;
      const stops = tower.stopsOf(t);
      if (stops.length === 0) continue;
      // Idle cars rest at the lowest LOBBY the shaft serves (the ground/sky lobby),
      // not merely its lowest stop — review F27.
      const lobbySet = new Set(tower.lobbyFloors());
      const idleFloor = stops.find((s) => lobbySet.has(s)) ?? stops[0];

      let dwell = this.carDwell.get(t.id);
      if (!dwell || dwell.length !== t.cars) {
        dwell = new Array(t.cars).fill(0);
        this.carDwell.set(t.id, dwell);
      }
      if (!t.carLoad || t.carLoad.length !== t.cars) t.carLoad = new Array(t.cars).fill(0);
      const cap = transportCarCapacity(t.kind);

      const v = dt * 0.4; // floors travelled this step
      // Floors another car in this shaft is already heading to this tick, so the
      // cars spread out to distinct calls instead of bunching on the same floor
      // (review F17).
      const claimed = new Set<number>();
      for (let i = 0; i < t.cars; i++) {
        if (dwell[i] > 0) {
          dwell[i] = Math.max(0, dwell[i] - dt);
          continue;
        }
        let pos = t.carPositions[i];
        let dir = t.carDir[i] || 1;

        let target = this.nextDemandStop(stops, pos, dir, demand, claimed);
        if (target === null) {
          dir = -dir; // nothing ahead — turn around
          target = this.nextDemandStop(stops, pos, dir, demand, claimed);
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
          dwell[i] = 1.2; // pause to load / unload
          // Some riders alight, then waiting passengers board up to capacity.
          t.carLoad[i] = Math.max(0, t.carLoad[i] - Math.ceil(t.carLoad[i] * 0.45));
          const w = demand.get(target) ?? 0;
          const board = Math.max(0, Math.min(cap - t.carLoad[i], w));
          if (board > 0) {
            t.carLoad[i] += board;
            demand.set(target, Math.max(0, w - board));
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

  /** Nearest stop strictly ahead (in `dir`) that has a real call waiting. */
  private nextDemandStop(stops: number[], pos: number, dir: number, demand: Map<number, number>, claimed?: Set<number>): number | null {
    let best: number | null = null;
    let bestDist = Infinity;
    for (const fl of stops) {
      if (dir > 0 && fl <= pos + 0.05) continue;
      if (dir < 0 && fl >= pos - 0.05) continue;
      if (claimed?.has(fl)) continue; // another car is already handling this call
      if ((demand.get(fl) ?? 0) < 1) continue;
      const dist = Math.abs(fl - pos);
      if (dist < bestDist) {
        bestDist = dist;
        best = fl;
      }
    }
    return best;
  }
}
