import { describe, it, expect } from "vitest";
import { inflateSync } from "fflate";
import splitTowerFile from "../fixtures/split-tower.vctower?raw";
import { Tower } from "../../engine/Tower";
import { Crowd } from "../../engine/Crowd";
import { Simulation } from "../../engine/Simulation";
import { dominantGripe, reachesLobby } from "../../engine/sim/gripe";
import { VACATE_REASON_TEXT } from "../../engine/types";
import type { SerializedGame } from "../../engine/types";

/**
 * Contiguous-floor-SEGMENT pedestrian pathfinding (#647).
 *
 * A person walks only within an unbroken run of floor/lobby tiles on one floor.
 * A gap between two runs is a real void: a transport on the far side of a gap
 * does NOT serve this side just because it "stops on the floor". These tests pin
 * that a stranded segment cannot route to the lobby (and its tenant reads the
 * distinct "no transportation" cause), that a gap-free floor still routes exactly
 * as before, and that no rendered person ever interpolates across a gap.
 */

/** Decode the `.vctower` container synchronously (no DecompressionStream). */
function decodeVctower(text: string): SerializedGame {
  const b64 = text.slice(text.indexOf("\n") + 1).trim();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(inflateSync(bytes))) as SerializedGame;
}

describe("segment routing: hand-built towers", () => {
  /**
   * A tower whose floor 2 is SPLIT into a left run (x 0..19) and a right run
   * (x 30..49) with an open gap between them. A stairway reaches the RIGHT run
   * from the ground lobby; a short elevator links the LEFT run of floors 2 and 3
   * but has no path back to the lobby (you cannot cross the gap on floor 2). So
   * the whole LEFT column (floor 2 left, floor 3) is stranded.
   */
  function splitFloorTower(): Tower {
    const tower = new Tower();
    for (let x = 0; x < 50; x++) expect(tower.place("lobby", 1, x).ok).toBe(true); // contiguous ground lobby
    for (let x = 0; x < 20; x++) expect(tower.place("floor", 2, x).ok).toBe(true); // floor 2 LEFT
    for (let x = 30; x < 50; x++) expect(tower.place("floor", 2, x).ok).toBe(true); // floor 2 RIGHT (gap 20..29)
    for (let x = 0; x < 20; x++) expect(tower.place("floor", 3, x).ok).toBe(true); // floor 3 LEFT only
    // Stairway lobby -> floor 2 RIGHT (width 8, lands at x40..47, inside the right run).
    expect(tower.placeTransport("stairs", 40, 1, 2).ok).toBe(true);
    // Elevator floor 2 LEFT <-> floor 3 LEFT (width 4, at x4..7, inside the left run).
    expect(tower.placeTransport("elevatorStandard", 4, 2, 3).ok).toBe(true);
    return tower;
  }

  it("STRANDED ORIGIN: a segment with no path to the lobby routes nowhere", () => {
    const tower = splitFloorTower();
    const crowd = new Crowd();
    // The RIGHT run of floor 2 reaches the lobby by the stair.
    expect(crowd.positionReachable(tower, 2, 40)).toBe(true);
    expect(crowd.route(tower, 2, 1, 40, 25)).not.toBeNull();
    // The LEFT run of floor 2, and floor 3 above it, are cut off: no route out.
    expect(crowd.positionReachable(tower, 2, 4)).toBe(false);
    expect(crowd.positionReachable(tower, 3, 4)).toBe(false);
    expect(crowd.route(tower, 2, 1, 4, 25)).toBeNull();
    expect(crowd.route(tower, 1, 3, 25, 4)).toBeNull();
    // Structural connectivity agrees (the satisfaction-side signal).
    expect(crowd.segmentConnected(tower, 2, 40)).toBe(true);
    expect(crowd.segmentConnected(tower, 2, 4)).toBe(false);
    expect(crowd.segmentConnected(tower, 3, 4)).toBe(false);
  });

  it("FALSE NEIGHBOR: a stair on the OTHER segment of the floor cannot be boarded", () => {
    const tower = splitFloorTower();
    const crowd = new Crowd();
    // A stair DOES stop on floor 2, but it sits on the right run. A person on the
    // left run cannot reach it across the gap, so the floor is not reachable from
    // the left even though a transport "stops on the floor".
    expect(crowd.reachable(tower, 1, 2, 25, 40)).toBe(true); // right run: yes
    expect(crowd.reachable(tower, 1, 2, 25, 4)).toBe(false); // left run: no
    // floor-level reachability is true (SOME segment reaches the lobby)...
    expect(crowd.floorReachable(tower, 2)).toBe(true);
    // ...while floor 3 (reachable only through the stranded left elevator) is not.
    expect(crowd.floorReachable(tower, 3)).toBe(false);
  });

  it("CONNECTED GUARD: a normal contiguous floor with a stair still routes, no strand", () => {
    const tower = new Tower();
    for (let x = 0; x < 50; x++) expect(tower.place("lobby", 1, x).ok).toBe(true);
    for (let x = 0; x < 50; x++) expect(tower.place("floor", 2, x).ok).toBe(true); // gap-free
    expect(tower.placeTransport("stairs", 10, 1, 2).ok).toBe(true);
    const crowd = new Crowd();
    // A gap-free floor is one segment, so any x on it reaches the lobby and the
    // trivial same-floor walk still resolves, exactly as before segments.
    expect(crowd.route(tower, 1, 2, 5, 45)).not.toBeNull();
    expect(crowd.positionReachable(tower, 2, 5)).toBe(true);
    expect(crowd.positionReachable(tower, 2, 45)).toBe(true);
    expect(crowd.segmentConnected(tower, 2, 45)).toBe(true);
    expect(crowd.route(tower, 2, 2, 5, 5)).toEqual({ floors: [2], shafts: [] });
  });
});

describe("segment routing: split-tower.vctower fixture", () => {
  /** Ground lobby is contiguous [167..208]; floors 2..50 split into a LEFT run
   *  [167..184] and a RIGHT run [193..208] with a gap at 185..192. Stairs on the
   *  RIGHT reach floors 0..15; the LEFT elevator (floors 15..45) is stranded
   *  because floor 15 is itself split, so its two halves never meet. */
  const GAP_LO = 185;
  const GAP_HI = 192;

  function load(): Simulation {
    return Simulation.deserialize(decodeVctower(splitTowerFile));
  }

  it("a LEFT-run tenant is stranded while a RIGHT-run tenant on the same floor is reachable", () => {
    const sim = load();
    const strandedOffice = sim.tower.units.find((u) => u.kind === "office" && u.floor === 10 && u.x === 167);
    const reachableCondo = sim.tower.units.find((u) => u.kind === "condo" && u.floor === 10 && u.x === 193);
    expect(strandedOffice, "fixture LEFT office @f10 x167").toBeDefined();
    expect(reachableCondo, "fixture RIGHT condo @f10 x193").toBeDefined();
    // The floor as a whole IS connected to the lobby (its right half is), so the
    // old floor-level check would call the left office reachable. It is not.
    expect(sim.tower.isFloorServed(10)).toBe(true);
    expect(sim.positionReachable(10, reachableCondo!.x)).toBe(true);
    expect(sim.positionReachable(10, strandedOffice!.x)).toBe(false);
    expect(reachesLobby(sim, reachableCondo!)).toBe(true);
    expect(reachesLobby(sim, strandedOffice!)).toBe(false);
  });

  it("the stranded tenant's departure cause is the distinct 'no transportation'", () => {
    const sim = load();
    const strandedOffice = sim.tower.units.find((u) => u.kind === "office" && u.floor === 10 && u.x === 167)!;
    // served=false (its own segment is off the network) but the FLOOR is served,
    // so the cause is noTransport, not the generic "access" (a dead floor).
    expect(dominantGripe(sim, strandedOffice, false, 0)).toBe("noTransport");
    expect(VACATE_REASON_TEXT.noTransport).toMatch(/transportation/i);
  });

  it("everything above the split floor is unreachable (the gap is not a bridge)", () => {
    const sim = load();
    // Floor 20 sits above the split floor 15; the left elevator serves it but
    // cannot itself reach the lobby, so no part of floor 20 is reachable.
    expect(sim.floorReachable(20)).toBe(false);
    expect(sim.crowd.route(sim.tower, 1, 20)).toBeNull();
  });

  it("no rendered person ever interpolates across the gap", () => {
    const sim = load();
    // Drive several game-hours so the crowd spawns and moves.
    for (let i = 0; i < 6 * 4; i++) sim.tick(15);
    for (const p of sim.crowd.people) {
      if (p.floor < 2) continue; // ground/basement floors are contiguous
      const col = Math.round(p.x);
      expect(col < GAP_LO || col > GAP_HI, `person ${p.id} at floor ${p.floor} x${p.x} is in the gap`).toBe(true);
    }
  });
});
