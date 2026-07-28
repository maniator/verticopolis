import type { Tower } from "../Tower";
import type { Crowd } from "../Crowd";
import { segId, segAt, segmentsOf } from "../tower/segments";
import { adjacency, passengerPath } from "./routing";

/**
 * Segment-aware reachability probes over the pedestrian routing graph (#647).
 *
 * All three answer "can this part of the tower reach the ground lobby?" but at
 * different granularities and with different rules:
 *   - {@link positionReachable}: does the SEGMENT at (floor, x) route to the
 *     lobby under the live per-mode router (Classic applies the walk budget)?
 *     The tenant move-in / commuter-spawn gate.
 *   - {@link floorReachableFromLobby}: does ANY segment on the floor route to
 *     the lobby? The floor-level gate the economy and daily advisories read.
 *   - {@link segmentConnected}: is the segment in the same TRANSPORT-connected
 *     component as the lobby, ignoring the walk budget? Mirrors
 *     `Tower.isFloorServed` at segment granularity, so the satisfaction "served"
 *     signal can tell a stranded segment from a merely-far one.
 *
 * On a gap-free floor there is one segment, so each of these equals the old
 * floor-level answer, keeping a contiguous tower byte-identical.
 */

/** The ground lobby's segments (floor 1), the sources every reach query floods
 *  from. Floor 1 is where visitors enter, so every one of its runs is a valid
 *  start, even a disconnected island (people walk in off the street anywhere on
 *  the ground concourse). A bare floor 1 falls back to a single lone segment. */
function lobbySegs(tower: Tower): number[] {
  const runs = segmentsOf(tower, 1);
  return runs.length > 0 ? runs.map(([start]) => segId(1, start)) : [segId(1, 0)];
}

/** Does `targetSeg` route to the ground lobby under the live per-mode router
 *  (walk budget included in Classic)? True as soon as one lobby source reaches
 *  it. */
function segReachable(crowd: Crowd, tower: Tower, targetSeg: number): boolean {
  for (const s1 of lobbySegs(tower)) {
    if (passengerPath(crowd, tower, s1, targetSeg) !== null) return true;
  }
  return false;
}

/** Router-reachability of the segment at `(floor, x)` from the lobby. */
export function positionReachable(crowd: Crowd, tower: Tower, floor: number, x: number): boolean {
  return segReachable(crowd, tower, segAt(tower, floor, x));
}

/** Router-reachability of ANY segment on `floor` from the lobby (floor-level). */
export function floorReachableFromLobby(crowd: Crowd, tower: Tower, floor: number): boolean {
  if (floor === 1) return true;
  for (const [start] of segmentsOf(tower, floor)) {
    if (segReachable(crowd, tower, segId(floor, start))) return true;
  }
  return false;
}

/** The set of segments transport-connected to the ground lobby, ignoring the
 *  walk budget (a plain flood over the passenger graph). Cached on the crowd by
 *  {@link Tower.revision}, the way {@link adjacency} is, so a per-unit check is
 *  an O(1) set lookup. */
function connectedSet(crowd: Crowd, tower: Tower): Set<number> {
  if (crowd.segServed && crowd.segServedRev === tower.revision) return crowd.segServed;
  const adj = adjacency(crowd, tower);
  const seen = new Set<number>();
  const frontier: number[] = [];
  for (const s1 of lobbySegs(tower)) {
    if (!seen.has(s1)) {
      seen.add(s1);
      frontier.push(s1);
    }
  }
  while (frontier.length) {
    const s = frontier.pop()!;
    for (const e of adj.get(s) ?? []) {
      if (!seen.has(e.f)) {
        seen.add(e.f);
        frontier.push(e.f);
      }
    }
  }
  crowd.segServed = seen;
  crowd.segServedRev = tower.revision;
  return seen;
}

/** Is the segment at `(floor, x)` in the lobby's transport-connected component
 *  (walk budget ignored)? The segment-granular version of `isFloorServed`. */
export function segmentConnected(crowd: Crowd, tower: Tower, floor: number, x: number): boolean {
  return connectedSet(crowd, tower).has(segAt(tower, floor, x));
}
