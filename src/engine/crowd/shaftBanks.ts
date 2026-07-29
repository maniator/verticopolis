import type { Tower } from "../Tower";
import type { Transport } from "../types";
import { landingSegs } from "../tower/segments";
import type { Crowd } from "../Crowd";
import type { Route } from "./person";

/**
 * Equivalent-shaft banking for the crowd router, pulled out of `routing.ts` as
 * friend functions that take the {@link Crowd} instance. `bfsRoute` picks the
 * PATH; this decides WHICH physical shaft of a bank of equals carries each leg,
 * so identical trips do not all funnel onto one shaft while its siblings sit idle.
 */

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
 * "Equivalent" is the SAME transport kind landing on the SAME two SEGMENTS as the
 * leg. Matching on kind means this never swaps a rider's transport MODE (an
 * elevator leg stays an elevator, a service-elevator leg a service elevator, a
 * stair leg a stair), so the staff service-first routing preference survives and
 * pool spans/caps are untouched. Matching on the landing SEGMENTS (not raw floors)
 * means two wings of a split floor bank separately, so a rider is never re-picked
 * onto a wing it cannot reach.
 *
 * The banks are precomputed once per {@link Tower.revision} by {@link shaftBanks}
 * and looked up in O(1) here, so a routed leg costs a Map lookup plus (only when
 * a real bank exists) one rng draw, never a per-trip rescan of every transport.
 */
export function balanceShafts(crowd: Crowd, tower: Tower, r: Route): Route {
  const banks = shaftBanks(crowd, tower);
  for (let i = 0; i < r.shafts.length; i++) {
    const chosen = tower.getTransport(r.shafts[i]);
    if (!chosen) continue;
    // `chosen`'s landing run-sets ARE the rider's current and target runs, so
    // every sibling in this bank shares both. Byte-identical on a gap-free floor,
    // where a landing run-set is a single segment bijective with the floor (bank
    // == floor bank). A shaft straddling a gap has a two-run set, so it only banks
    // with an identically-straddling sibling, never a single-run shaft (#662).
    const from = landingSegs(tower, chosen, r.floors[i]);
    const to = landingSegs(tower, chosen, r.floors[i + 1]);
    const bank = banks.get(bankKey(chosen.kind, from, to));
    // No bank, or a lone shaft: nothing to balance, so draw nothing and keep the
    // exact rng stream. The chosen shaft is always a member when a bank exists.
    if (!bank || bank.length <= 1) continue;
    r.shafts[i] = bank[crowd.rng.int(0, bank.length - 1)];
  }
  return r;
}

/** The bank key for one directed leg: the transport kind plus the boarding and
 *  alighting LANDING RUN-SETS, so equivalent shafts (same kind, same run-sets)
 *  collide while two wings serving one floor pair from disjoint runs do not, and a
 *  gap-straddling shaft (a two-run set) never banks with a single-run shaft. The
 *  run ids are pre-sorted by {@link landingSegs}, so the joined key is canonical.
 *  On a gap-free floor each set is one id, so the key equals the old floor-keyed
 *  string (byte-identical banks). */
function bankKey(kind: Transport["kind"], fromSegs: number[], toSegs: number[]): string {
  return `${kind}:${fromSegs.join(",")}:${toSegs.join(",")}`;
}

/**
 * The equivalent-shaft banks, keyed "kind:fromSeg:toSeg" → shaft ids in STABLE
 * ascending order (so a given rng draw maps to the same shaft run-to-run).
 *
 * Built once per {@link Tower.revision} and cached on the crowd, the way the
 * stop-graph is: it only changes when the tower's transports change. Every
 * directed stop pair contributes its id to that pair's bank under the pair's
 * LANDING SEGMENTS, so {@link balanceShafts} answers each leg with one Map lookup
 * and two shafts serving one floor pair from disjoint runs never share a bank.
 * The key is kind-partitioned, so one shared cache serves both the passenger and
 * the staff route paths without mixing a service elevator into a passenger bank.
 */
export function shaftBanks(crowd: Crowd, tower: Tower): Map<string, number[]> {
  if (crowd.shaftBanks && crowd.shaftBanksRev === tower.revision) return crowd.shaftBanks;
  const banks = new Map<string, number[]>();
  for (const t of tower.transports) {
    const stops = tower.stopsOf(t);
    for (const from of stops) {
      for (const to of stops) {
        if (to === from) continue;
        // Bank by the LANDING RUN-SETS the shaft attaches to on each stop floor,
        // so two wings of a split floor never share a bank and a gap-straddling
        // shaft banks only with an identical straddler (byte-identical on a gap-free
        // floor, where every shaft lands on the floor's one segment).
        const key = bankKey(t.kind, landingSegs(tower, t, from), landingSegs(tower, t, to));
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
