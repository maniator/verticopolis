import type { Tower } from "../Tower";
import type { Transport } from "../types";
import { isStaffOnlyTransport, isStaffTransportKind, isElevatorKind, WALKWAY_WILLINGNESS } from "../facilities";
import type { Crowd } from "../Crowd";
import { STRESS_WAIT } from "./person";
import type { Route, ElevatorCalls, ElevatorQueueView, QueueLanding } from "./person";

/**
 * Transport routing for the crowd, pulled out of `Crowd.ts` as friend functions
 * that take the {@link Crowd} instance. They read and cache the adjacency graphs
 * on the crowd (`adj`/`adjRev`, `staffAdj`/`staffAdjRev`) and, for elevator
 * calls, scan `crowd.people`. Behavior is unchanged; the class keeps thin
 * `route` / `staffRoute` / `elevatorCalls` methods that delegate here.
 */

type AdjGraph = Map<number, { f: number; shaft: number; walkKind?: "stairs" | "escalator" }[]>;

/**
 * The floor → one-ride-reachable-floors graph, built from elevator stops.
 * It only changes when the tower's transports change, so we cache it by
 * {@link Tower.revision} and rebuild lazily instead of on every spawn.
 */
export function adjacency(crowd: Crowd, tower: Tower): AdjGraph {
  if (crowd.adj && crowd.adjRev === tower.revision) return crowd.adj;
  // Staff-only transports (service elevators) carry no tenants or visitors:
  // that's the whole point of building one.
  crowd.adj = buildAdjacency(tower, tower.transports, (t) => !isStaffOnlyTransport(t.kind));
  crowd.adjRev = tower.revision;
  return crowd.adj;
}

/** The staff stop-graph: service elevators plus walkable links (stairs and
 *  escalators), never the passenger elevators. Housekeepers route over
 *  this, using the SAME kind predicate as Tower.staffConnected so routing
 *  and reachability can never disagree. Staff-only elevators are listed
 *  first so equal-leg route ties break toward RIDING the service elevator
 *  rather than climbing stairs: housekeepers ride, and the player sees the
 *  shaft they built actually working. */
export function staffAdjacency(crowd: Crowd, tower: Tower): AdjGraph {
  if (crowd.staffAdj && crowd.staffAdjRev === tower.revision) return crowd.staffAdj;
  const serviceFirst = [...tower.transports].sort(
    (a, b) => Number(isStaffOnlyTransport(b.kind)) - Number(isStaffOnlyTransport(a.kind)),
  );
  crowd.staffAdj = buildAdjacency(tower, serviceFirst, (t) => isStaffTransportKind(t.kind));
  crowd.staffAdjRev = tower.revision;
  return crowd.staffAdj;
}

export function buildAdjacency(
  tower: Tower,
  transports: readonly Transport[],
  include: (t: Transport) => boolean,
): AdjGraph {
  const adj: AdjGraph = new Map();
  for (const t of transports) {
    if (!include(t)) continue;
    // Elevators carry riders in cars; stairs/escalators are walked (a
    // "climbing" leg, no car). Both are real routing edges now, so short
    // hops travel on foot and BFS still prefers a single long elevator ride
    // (one transfer) over many stair flights for tall trips.
    const stops = tower.stopsOf(t);
    // A stair/escalator flight is a WALK, not a car ride: the Classic router
    // (bfsRouteWalkBudget) charges walks against a separate contiguous-walk
    // budget (WALKWAY_WILLINGNESS), not a ride. Tag the edge so the BFS
    // classifies it without a per-hop transport lookup.
    const walkKind = t.kind === "stairs" || t.kind === "escalator" ? t.kind : undefined;
    for (const a of stops) {
      let list = adj.get(a);
      if (!list) adj.set(a, (list = []));
      for (const b of stops) if (b !== a) list.push({ f: b, shaft: t.id, walkKind });
    }
  }
  return adj;
}

/**
 * The chosen fewest-transfer passenger PATH, before any shaft balancing.
 *
 * BOTH modes have uncapped reachability now: the 1994 original routes through
 * arbitrarily many transfers (harness-verified to 6+, #503), so neither mode
 * refuses a connected path. The only routing difference is the #384 walkway
 * budget: Classic applies it (a stair/escalator run refuses past the willingness
 * threshold), Modern does not yet (its walkway/transfer discomfort is the
 * satisfaction-side comfort penalty, tracked in #502, not a routing refusal).
 * Neither mode gates express transfers to lobbies any more (#509). The rule
 * object decides via {@link GameRules.walkwayWillingnessApplies}, never the mode
 * string.
 *
 * Shared by {@link route} (which then balances the shaft, drawing rng) and
 * {@link reachable} (which only asks whether a path exists, no rng), so the two
 * can never diverge on which router applies.
 */
function passengerPath(crowd: Crowd, tower: Tower, from: number, to: number): Route | null {
  const adj = adjacency(crowd, tower);
  return tower.rules.walkwayWillingnessApplies()
    ? bfsRouteWalkBudget(adj, from, to)
    : bfsRoute(adj, from, to);
}

export function route(crowd: Crowd, tower: Tower, from: number, to: number): Route | null {
  // The chosen PATH is fixed; balanceShafts only re-picks WHICH physical shaft
  // of an equivalent bank carries each leg, so the route itself is untouched.
  const r = passengerPath(crowd, tower, from, to);
  return r && balanceShafts(crowd, tower, r);
}

/**
 * Spread each ride leg across its bank of equivalent parallel shafts.
 *
 * {@link bfsRoute} finds the fewest-transfer PATH, but its edge-order tie-break
 * names the SAME shaft every time a floor pair is served by several equivalent
 * shafts, so identical trips funnel onto one shaft of a bank while its siblings
 * sit idle (the landing queue there piles up and the drawn crowd makes it
 * obvious). This keeps the path bfsRoute chose and only re-picks WHICH physical
 * shaft of an equivalent bank carries each leg, drawing from the seeded crowd
 * rng so the spread is deterministic and reproducible, never build-order
 * biased. A leg with no sibling shaft draws nothing, so a tower without a bank
 * keeps its exact rng stream (the zero-draw gate).
 *
 * "Equivalent" is the SAME transport kind stopping at both the leg's boarding
 * and alighting floors. Matching on kind means this never swaps a rider's
 * transport MODE: an elevator leg stays an elevator, a service-elevator leg
 * stays a service elevator, a stair leg stays a stair. So the staff service-first
 * routing preference bfsRoute expresses (service elevators win route ties over
 * stairs) survives intact, and pool spans/caps are untouched: this only decides
 * which shaft within a bank of equals answers the trip.
 *
 * The banks are precomputed once per {@link Tower.revision} by {@link shaftBanks}
 * and looked up in O(1) here, so a routed leg costs a Map lookup plus (only when
 * a real bank exists) one rng draw, never a per-trip rescan of every transport.
 */
function balanceShafts(crowd: Crowd, tower: Tower, r: Route): Route {
  const banks = shaftBanks(crowd, tower);
  for (let i = 0; i < r.shafts.length; i++) {
    const chosen = tower.getTransport(r.shafts[i]);
    if (!chosen) continue;
    const bank = banks.get(bankKey(chosen.kind, r.floors[i], r.floors[i + 1]));
    // No bank, or a lone shaft: nothing to balance, so draw nothing and keep the
    // exact rng stream. The chosen shaft is always a member when a bank exists.
    if (!bank || bank.length <= 1) continue;
    r.shafts[i] = bank[crowd.rng.int(0, bank.length - 1)];
  }
  return r;
}

/** The bank key for one directed leg: the transport kind plus the boarding and
 *  alighting floors, so equivalent shafts (same kind, both floors) collide. */
function bankKey(kind: Transport["kind"], from: number, to: number): string {
  return `${kind}:${from}:${to}`;
}

/**
 * The equivalent-shaft banks, keyed "kind:from:to" → shaft ids in STABLE
 * ascending order (so a given rng draw maps to the same shaft run-to-run).
 *
 * Built once per {@link Tower.revision} and cached on the crowd, the way
 * {@link adjacency} caches the stop-graph: it only changes when the tower's
 * transports change. Every directed stop pair of every transport contributes
 * its id to that pair's bank, so {@link balanceShafts} answers each leg with a
 * single Map lookup. Keeping the key kind-partitioned means one shared cache
 * serves both the passenger and the staff route paths without ever mixing a
 * service elevator into a passenger bank (or a stair into an elevator one).
 */
export function shaftBanks(crowd: Crowd, tower: Tower): Map<string, number[]> {
  if (crowd.shaftBanks && crowd.shaftBanksRev === tower.revision) return crowd.shaftBanks;
  const banks = new Map<string, number[]>();
  for (const t of tower.transports) {
    const stops = tower.stopsOf(t);
    for (const from of stops) {
      for (const to of stops) {
        if (to === from) continue;
        const key = bankKey(t.kind, from, to);
        let bank = banks.get(key);
        if (!bank) banks.set(key, (bank = []));
        bank.push(t.id);
      }
    }
  }
  for (const bank of banks.values()) bank.sort((a, b) => a - b);
  crowd.shaftBanks = banks;
  crowd.shaftBanksRev = tower.revision;
  return banks;
}

/** Pure reachability probe: does a fewest-transfer passenger route exist at
 *  all, without committing a rider to a shaft? Reachability is a structural
 *  question, so unlike {@link route} it draws NO rng (route/staffRoute draw to
 *  spread trips across an equivalent bank). floorReachable's memoized probe
 *  runs on the editor's ~6 Hz repaint pump; routing there through the balancing
 *  path would let UI timing perturb the seeded crowd stream on a banked tower,
 *  so a probe that never rides must never draw. It runs the SAME
 *  {@link passengerPath} route() does (the same per-mode router), so a floor
 *  route() would refuse never reads as reachable here. */
export function reachable(crowd: Crowd, tower: Tower, from: number, to: number): boolean {
  return passengerPath(crowd, tower, from, to) !== null;
}

/** Route over the STAFF network (service elevators / stairs).
 *  Like passenger routing now, the staff search is UNCAPPED and applies no walk
 *  budget (the BFS `seen` set terminates it), so it agrees with what
 *  Tower.staffConnected calls reachable: both walk the same
 *  isStaffTransportKind/stopsOf graph. (Parallel implementations: if they
 *  ever drift, spawnStaff reports "no-route" so dispatch can surface it
 *  instead of retrying silently.) */
export function staffRoute(crowd: Crowd, tower: Tower, from: number, to: number): Route | null {
  const r = bfsRoute(staffAdjacency(crowd, tower), from, to);
  return r && balanceShafts(crowd, tower, r);
}

/** NOTE: edge ORDER is a contract: within a BFS level the first-listed
 *  edge wins (seen is marked on enqueue), which is how staffAdjacency's
 *  service-first ordering expresses the routing preference. Don't replace
 *  this with a priority frontier or Set-deduped adjacency without keeping
 *  that tie-break. */
export function bfsRoute(adj: AdjGraph, from: number, to: number): Route | null {
  if (from === to) return { floors: [from], shafts: [] };
  const prev = new Map<number, { f: number; shaft: number }>();
  const seen = new Set<number>([from]);
  let frontier = [from];
  // Uncapped: the `seen` set (marked on enqueue) terminates the search on a
  // finite graph. Both callers (Modern passengers and staff) route through any
  // connected path, matching the 1994 original's uncapped reachability (#503).
  while (frontier.length) {
    const next: number[] = [];
    for (const f of frontier) {
      for (const edge of adj.get(f) ?? []) {
        if (seen.has(edge.f)) continue;
        seen.add(edge.f);
        prev.set(edge.f, { f, shaft: edge.shaft });
        if (edge.f === to) {
          // Reconstruct.
          const floors = [to];
          const shafts: number[] = [];
          let cur = to;
          while (cur !== from) {
            const p = prev.get(cur)!;
            floors.push(p.f);
            shafts.push(p.shaft);
            cur = p.f;
          }
          floors.reverse();
          shafts.reverse();
          return { floors, shafts };
        }
        next.push(edge.f);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * The CLASSIC passenger router: a fewest-transfer route with the #384 walkway
 * budget and, per the 1994 original, NO ride cap and NO express-transfer lobby
 * gate. Reachability is uncapped (harness-verified to 6+ transfers, #503) and an
 * express transfer is admissible wherever the express stops, not only at (sky)
 * lobbies (#509); both were web-guide artifacts the harness disproved. The only
 * per-path budget is the contiguous-walk budget (see the body). Pure graph
 * admissibility: no RNG, deterministic for a given tower.
 */
export function bfsRouteWalkBudget(adj: AdjGraph, from: number, to: number): Route | null {
  if (from === to) return { floors: [from], shafts: [] };
  // Fewest-EDGES BFS (each edge is one level), so a single elevator ride still
  // beats many stair flights and edge order still breaks ties toward the
  // first-listed shaft. Classic reachability is UNCAPPED: the 1994 original
  // routes a commute through arbitrarily many elevator transfers as long as a
  // connected path exists (verified in the Wine harness to 6+ transfers, #503),
  // so rides are not counted or capped. There is also NO express-transfer gate:
  // the original transfers off an express wherever the express stops, not only
  // at (sky) lobbies (#509), and express edges only ever exist at express stops
  // anyway. The one budget that rides ALONG the path is the contiguous-walk
  // budget (#384, parity GDD §8): a stair/escalator RUN may cross at most
  // WALKWAY_WILLINGNESS[kind] flights (the stricter threshold governing a mixed
  // run), reset to zero on any elevator ride. Search state is (floor, walkRun,
  // runCap): every elevator arrival collapses to (floor, 0, NO_CAP), so despite
  // the uncapped rides the state space stays bounded (floors x walkRun 0..7 x
  // runCap in {NO_CAP, 4, 7}) and the search is O(V+E) with a small constant.
  const NO_CAP = Infinity; // runCap sentinel: no walk flight taken yet on the current run
  interface St { floor: number; walkRun: number; runCap: number }
  const key = (s: St) => `${s.floor}:${s.walkRun}:${s.runCap}`;
  const origin: St = { floor: from, walkRun: 0, runCap: NO_CAP };
  const originKey = key(origin);
  const prev = new Map<string, { key: string; floor: number; shaft: number }>();
  const seen = new Set<string>([originKey]);

  let frontier: St[] = [origin];
  while (frontier.length) {
    const next: St[] = [];
    for (const s of frontier) {
      const sk = key(s); // hoisted out of the edge loop: one key string per state, not per edge (hot path)
      for (const edge of adj.get(s.floor) ?? []) {
        let ns: St;
        if (edge.walkKind) {
          // Walk leg: charge the contiguous-walk budget, not a ride. The
          // WALKWAY_WILLINGNESS type guarantees a finite limit for the two walk
          // kinds; the isFinite guard fails CLOSED (refuse the flight) if a
          // future walk kind is ever tagged without a willingness entry, so an
          // undefined limit can never make walkRun grow unbounded and hang here.
          const cap = Math.min(s.runCap, WALKWAY_WILLINGNESS[edge.walkKind]);
          if (!Number.isFinite(cap) || s.walkRun + 1 > cap) continue; // over the walk budget for this run
          ns = { floor: edge.f, walkRun: s.walkRun + 1, runCap: cap };
        } else {
          // Elevator ride: reset the walk run. No ride cap (Classic parity, #503).
          ns = { floor: edge.f, walkRun: 0, runCap: NO_CAP };
        }
        const nk = key(ns);
        if (seen.has(nk)) continue;
        seen.add(nk);
        prev.set(nk, { key: sk, floor: s.floor, shaft: edge.shaft });
        if (edge.f === to) {
          const floors = [to];
          const shafts: number[] = [];
          let cur = nk;
          while (cur !== originKey) {
            const p = prev.get(cur)!;
            floors.push(p.floor);
            shafts.push(p.shaft);
            cur = p.key;
          }
          floors.reverse();
          shafts.reverse();
          return { floors, shafts };
        }
        next.push(ns);
      }
    }
    frontier = next;
  }
  return null;
}

/** Live elevator calls from real people (tenants AND staff), for the
 *  dispatch. Two kinds, exactly like a real lift: `hall` (shaftId → floor →
 *  waiter count, the landing button) and `cab` (shaftId → carIndex → floors
 *  a rider aboard that car needs, the buttons inside the cab). Without
 *  these the drawn commuters exist only in the statistical demand model's
 *  blind spot: cars glide past waiters, and a rider is hauled around until
 *  they despawn because their floor is never this particular car's stop.
 *  Cab stops must be per-car: a rider can only alight from the car they're
 *  in, so their floor being "handled" by some other car delivers nothing.
 *  Staff walking toward a staff-only shaft already raise a hall call so the
 *  car pre-positions instead of retreating to idle just before they arrive
 *  (a walk toward stairs/escalators never calls a car). */
export function elevatorCalls(crowd: Crowd, tower: Tower): ElevatorCalls {
  const hall = new Map<number, Map<number, number>>();
  const cab = new Map<number, Map<number, Set<number>>>();
  const bump = (shaftId: number, floor: number) => {
    let floors = hall.get(shaftId);
    if (!floors) hall.set(shaftId, (floors = new Map()));
    floors.set(floor, (floors.get(floor) ?? 0) + 1);
  };
  for (const p of crowd.people) {
    if (p.shaftId == null) continue;
    if (p.state === "waiting") {
      bump(p.shaftId, p.floor);
    } else if (p.state === "riding" && p.carIndex != null) {
      // Guard the leg lookup: a state-machine hiccup must not leak an
      // undefined floor into the dispatch's call set.
      const dest = p.floors[p.leg + 1];
      if (dest === undefined) continue;
      let cars = cab.get(p.shaftId);
      if (!cars) cab.set(p.shaftId, (cars = new Map()));
      let floors = cars.get(p.carIndex);
      if (!floors) cars.set(p.carIndex, (floors = new Set()));
      floors.add(dest);
    } else if (p.staff && p.state === "toShaft") {
      const shaft = tower.getTransport(p.shaftId);
      if (shaft && isStaffOnlyTransport(shaft.kind)) bump(p.shaftId, p.floor);
    }
  }
  return { hall, cab };
}

/**
 * Read-only elevator queue + per-car occupancy projection for the render
 * layer, a sibling to {@link elevatorCalls}. Where `elevatorCalls` feeds the
 * dispatch, this derives, per shaft landing, the waiter count and a bounded
 * wait-tier, and per car the boarded count, reconciled with `landings` onto
 * one drawn population. `boarded` has no in-repo render consumer yet (only
 * tests read it today); wiring a render surface to it is a later story.
 *
 * It is a pure VIEW of state the crowd already tracks (the same `waiting` people
 * `elevatorCalls` counts, and each car's drawn occupancy `crowd.carRiders`), so
 * it re-simulates no boarding. It walks `crowd.people` once and the shaft list
 * once; {@link Crowd.queueView} memoizes the result on the (step, revision) key
 * and the sim loop primes it once per outer step, so the scan lands in the sim
 * step and no render frame or car sub-step re-derives it, honoring the "one scan
 * per outer step" rule. It stays a distinct pass from `elevatorCalls` rather
 * than folded into it because `elevatorCalls` is re-run fresh every car sub-step
 * to track mid-step boarding, while this snapshot must stay stable across the
 * step.
 *
 * Both halves count ONE population, the drawn crowd. `landings` counts the
 * routed `crowd.people` waiting at each landing, and `boarded` reads
 * `crowd.carRiders`, the drawn per-car occupancy the motion step maintains as
 * those same figures board and alight. So a waiter boarding moves one figure
 * from a landing into a car: the leftover line is the same individuals, now
 * shorter. This deliberately does NOT read the dispatch's statistical
 * `t.carLoad`, an aggregate-demand count unrelated to the drawn figures.
 * Reconciled in E6-S7 (GH #314): both halves already count the drawn crowd.
 */
export function elevatorQueueView(crowd: Crowd, tower: Tower): ElevatorQueueView {
  const landings = new Map<number, Map<number, QueueLanding>>();
  for (const p of crowd.people) {
    if (p.state !== "waiting" || p.shaftId == null) continue;
    const shaft = tower.getTransport(p.shaftId);
    if (!shaft) continue;
    // Only elevator landings hold a waiting line: a stair/escalator leg is
    // walked ("climbing"), never "waiting", so a waiter's shaft should already
    // be an elevator. Gate defensively so a mis-set shaftId can never surface a
    // stair/escalator as an elevator queue (mirrors the boarded loop's gate).
    if (!isElevatorKind(shaft.kind)) continue;
    // Staff-only shafts (service elevators) show ONLY staff waiters: a service
    // elevator carries no tenants, so a stray tenant is never queued there.
    if (isStaffOnlyTransport(shaft.kind) && !p.staff) continue;
    // Express skip-stops draw a blank shaft band and no queue: never surface a
    // landing on a floor this shaft does not stop at.
    if (!tower.stopsAt(shaft, p.floor)) continue;
    let floors = landings.get(p.shaftId);
    if (!floors) landings.set(p.shaftId, (floors = new Map()));
    let landing = floors.get(p.floor);
    if (!landing) floors.set(p.floor, (landing = { count: 0, tier: 0 }));
    landing.count++;
    const tier = waitTier(p.wait);
    if (tier > landing.tier) landing.tier = tier;
  }
  const boarded = new Map<number, Map<number, number>>();
  for (const t of tower.transports) {
    if (!isElevatorKind(t.kind)) continue;
    // Boarded is the DRAWN per-car occupancy: the same routed figures the
    // landings count, now aboard. crowd.carRiders keys "shaftId:carIndex" and
    // the motion step increments it on board / decrements it on alight, so it
    // tracks exactly the people the crowd renders, not the dispatch's
    // statistical carLoad. Iterate the shaft's real car count so a fresh or
    // just-resized shaft still reports one entry per car, an empty car for any
    // slot with no riders yet.
    const cars = new Map<number, number>();
    for (let i = 0; i < t.cars; i++) cars.set(i, crowd.carRiders.get(`${t.id}:${i}`) ?? 0);
    boarded.set(t.id, cars);
  }
  return { landings, boarded };
}

/** Bounded wait-tier for a landing waiter: tier 2 once the wait crosses the
 *  fed-up threshold {@link STRESS_WAIT}, tier 1 at half of it, else tier 0.
 *  Matches the three moods the render layer tints waiters by. */
function waitTier(wait: number): 0 | 1 | 2 {
  if (wait >= STRESS_WAIT) return 2;
  if (wait >= STRESS_WAIT / 2) return 1;
  return 0;
}
