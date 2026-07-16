import { describe, it, expect } from "vitest";
import { Tower } from "../../engine/Tower";
import { Crowd } from "../../engine/Crowd";
import { adjacency, bfsRoute } from "../../engine/crowd/routing";

/**
 * Elevator dispatch shaft fairness (issue #303).
 *
 * When a bank of equivalent parallel shafts serves the same floor pair, the BFS
 * that finds a route picks the fewest-transfer PATH, but its edge-order tie-break
 * would always name the same shaft. Identical trips then funnel onto one shaft of
 * the bank while its siblings idle. `crowd.route` now spreads each ride leg across
 * the equivalent shafts using the seeded crowd rng, so the load balances while the
 * stream stays deterministic and reproducible.
 */
describe("Elevator dispatch: shaft fairness across an equivalent bank", () => {
  /** A ground lobby, floors 1..10, and `shafts` equivalent standard elevators
   *  (identical span, distinct columns) forming a bank. */
  function towerWithBank(shafts: number): { tower: Tower; ids: number[] } {
    const tower = new Tower();
    for (let x = 0; x < 40; x++) tower.place("lobby", 1, x);
    for (let f = 2; f <= 10; f++) for (let x = 0; x < 40; x++) tower.place("floor", f, x);
    const ids: number[] = [];
    for (let s = 0; s < shafts; s++) {
      const t = tower.placeTransport("elevatorStandard", 4 + s * 4, 1, 10);
      expect(t.ok, `bank shaft ${s}: ${t.reason ?? ""}`).toBe(true);
      expect(t.transportId).toBeDefined();
      ids.push(t.transportId!);
    }
    return { tower, ids };
  }

  /** The shaft each of `trips` identical 1->8 routes is assigned to. */
  function assignments(crowd: Crowd, tower: Tower, trips: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < trips; i++) {
      const r = crowd.route(tower, 1, 8);
      expect(r).not.toBeNull();
      expect(r!.shafts).toHaveLength(1);
      out.push(r!.shafts[0]);
    }
    return out;
  }

  it("spreads identical trips across both shafts of a two-shaft bank", () => {
    const { tower, ids } = towerWithBank(2);
    const crowd = new Crowd(1234);
    const TRIPS = 200;
    const picks = assignments(crowd, tower, TRIPS);

    const counts = new Map<number, number>();
    for (const id of picks) counts.set(id, (counts.get(id) ?? 0) + 1);

    // Both shafts of the bank must carry a real share of the load, not one
    // saturated while its sibling idles. A generous floor (>= 20% each) proves
    // the spread without asserting a brittle exact split.
    expect(counts.size).toBe(2);
    for (const id of ids) {
      expect(counts.get(id) ?? 0).toBeGreaterThan(TRIPS * 0.2);
    }
  });

  it("is deterministic run-to-run: the same seed yields the same assignment stream", () => {
    const a = towerWithBank(2);
    const b = towerWithBank(2);
    const picksA = assignments(new Crowd(99), a.tower, 150);
    const picksB = assignments(new Crowd(99), b.tower, 150);
    // Same seed, same tower shape, same shaft ids -> byte-identical assignments.
    expect(picksA).toEqual(picksB);
  });

  it("spreads across every shaft of a three-shaft bank", () => {
    const { tower, ids } = towerWithBank(3);
    const picks = assignments(new Crowd(7), tower, 300);
    const used = new Set(picks);
    // Every shaft of the bank is exercised, none left permanently idle.
    for (const id of ids) expect(used.has(id)).toBe(true);
  });

  it("draws nothing for a single shaft, so a bank-free tower keeps its exact rng stream", () => {
    const { tower } = towerWithBank(1);
    // Two crowds share a seed; one routes (no bank -> no draw), the other does
    // not. Their next draw must match, proving routing burned no rng.
    const routed = new Crowd(555);
    const untouched = new Crowd(555);
    routed.route(tower, 1, 8);
    expect(routed.rng.int(0, 1_000_000)).toBe(untouched.rng.int(0, 1_000_000));
  });

  it("the reachability probe draws no rng even on a banked tower (pure structural query)", () => {
    // `crowd.reachable` backs `floorReachable`, which runs on the editor's ~6 Hz
    // repaint pump. It must stay pure so UI timing never perturbs the seeded
    // crowd stream, even when a bank exists (where `route` WOULD draw). Two
    // seed-equal crowds: one probes the bank, one does not; their next draw must
    // match.
    const { tower } = towerWithBank(2);
    const probed = new Crowd(2024);
    const untouched = new Crowd(2024);
    expect(probed.reachable(tower, 1, 8)).toBe(true);
    expect(probed.rng.int(0, 1_000_000)).toBe(untouched.rng.int(0, 1_000_000));
  });

  it("mutation check: without balancing the raw BFS funnels every trip onto one shaft", () => {
    // The pre-fix behavior, reproduced by calling bfsRoute directly on the
    // adjacency graph: the edge-order tie-break names the SAME shaft every time,
    // so the fairness assertion above would fail against this funneling. This is
    // the bug issue #303 describes, and the guard that the spread is real.
    const { tower } = towerWithBank(2);
    const crowd = new Crowd(1234);
    const graph = adjacency(crowd, tower);
    const raw = new Set<number>();
    for (let i = 0; i < 50; i++) raw.add(bfsRoute(graph, 1, 8, 2)!.shafts[0]);
    expect(raw.size).toBe(1);
  });
});
