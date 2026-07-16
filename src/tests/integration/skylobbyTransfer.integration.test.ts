import { describe, it, expect } from "vitest";
import { Tower } from "../../engine/Tower";
import { Crowd } from "../../engine/Crowd";
import { CLASSIC_RULES, MODERN_RULES } from "../../engine/gameRules";
import type { FacilityKind, GameMode } from "../../engine/types";

/**
 * Contiguous sky-lobby transfer (#396): in the 1994 game a rider switches
 * between an EXPRESS elevator and a local transport (standard elevator, stairs,
 * escalator) only through a lobby that touches both, which is what forces the
 * layered-tower architecture (express spine, sky lobbies every 15 floors, local
 * banks between them). Classic gates the crowd BFS on it via
 * GameRules.expressTransferNeedsLobby; Modern keeps the forgiving
 * transfer-at-any-shared-stop routing. v1 is the FLOOR-LEVEL rule (the shared
 * stop must be a lobby floor, ground floor 1 included); tile-level lobby-span
 * contiguity between the two shafts is a documented later refinement.
 *
 * Express stops are already locked to lobby floors EXCEPT a shaft's endpoints
 * (bottom and top always stop), so the hole this rule closes is the express
 * endpoint parked on a plain floor acting as a free transfer hub.
 */

const TOWER_W = 40;

/** Place one structure/room tile and assert it lands, surfacing the refusal
 *  reason on failure (AGENTS.md fixture-assertion rule). */
function placeOk(tower: Tower, kind: FacilityKind, floor: number, x: number): void {
  const r = tower.place(kind, floor, x);
  expect(r.ok, `place(${kind}, f${floor}, x${x}) failed: ${r.reason ?? "unknown"}`).toBe(true);
}

/** Place a transport, assert it lands, and return its shaft id. */
function shaftOk(tower: Tower, kind: FacilityKind, x: number, bottom: number, top: number): number {
  const r = tower.placeTransport(kind, x, bottom, top);
  expect(r.ok, `placeTransport(${kind}, x${x}, ${bottom}..${top}) failed: ${r.reason ?? "unknown"}`).toBe(true);
  expect(r.transportId).toBeDefined();
  return r.transportId!;
}

/** A bare tower with a full-width ground lobby, plain floors 2..top, and
 *  optional sky lobbies (legal only on every 15th floor). */
function baseTower(mode: GameMode, top: number, skyLobbies: number[] = []): Tower {
  const tower = new Tower();
  tower.rules = mode === "modern" ? MODERN_RULES : CLASSIC_RULES;
  for (let x = 0; x < TOWER_W; x++) placeOk(tower, "lobby", 1, x);
  for (let f = 2; f <= top; f++) {
    const kind: FacilityKind = skyLobbies.includes(f) ? "lobby" : "floor";
    for (let x = 0; x < TOWER_W; x++) placeOk(tower, kind, f, x);
  }
  return tower;
}

describe("express transfers are lobby-gated in Classic (#396)", () => {
  /** Express 1..20 (endpoint 20 is a PLAIN floor, no lobby anywhere between)
   *  plus a local bank 20..25: the only path to 25 transfers off the express
   *  at the non-lobby floor 20. */
  function nonLobbyHubTower(mode: GameMode) {
    const tower = baseTower(mode, 25);
    const express = shaftOk(tower, "elevatorExpress", 4, 1, 20);
    const local = shaftOk(tower, "elevatorStandard", 10, 20, 25);
    return { tower, express, local };
  }

  it("Classic: an express-to-local transfer at a plain shared stop no longer routes", () => {
    const { tower } = nonLobbyHubTower("classic");
    const crowd = new Crowd();
    // Before the gate this routed express 1->20, local 20->25 (two rides).
    // Floor 20 carries no lobby tile, so the express transfer is inadmissible
    // and the trip gives up.
    expect(crowd.route(tower, 1, 25)).toBeNull();
  });

  it("Classic: direct rides on each shaft are untouched (only the transfer is gated)", () => {
    const { tower, express, local } = nonLobbyHubTower("classic");
    const crowd = new Crowd();
    // The express endpoint itself is still a served stop: riding TO it is one
    // ride, no transfer, so the gate never fires.
    const up = crowd.route(tower, 1, 20);
    expect(up).not.toBeNull();
    expect(up!.shafts).toEqual([express]);
    // A local-only hop within the upper bank is a single ride too.
    const hop = crowd.route(tower, 20, 25);
    expect(hop).not.toBeNull();
    expect(hop!.shafts).toEqual([local]);
  });

  it("Modern: the same non-lobby shared stop still transfers (forgiving routing preserved)", () => {
    const { tower, express, local } = nonLobbyHubTower("modern");
    const crowd = new Crowd();
    const r = crowd.route(tower, 1, 25);
    expect(r).not.toBeNull();
    expect(r!.shafts).toEqual([express, local]);
    expect(r!.floors).toContain(20); // transfers at the plain floor, as before
  });

  it("Classic: an express-to-local transfer at a SKY LOBBY routes (the layered tower works)", () => {
    // Express spine 1..15 ending on the floor-15 sky lobby, local bank 15..25.
    const tower = baseTower("classic", 25, [15]);
    const express = shaftOk(tower, "elevatorExpress", 4, 1, 15);
    const local = shaftOk(tower, "elevatorStandard", 10, 15, 25);
    const crowd = new Crowd();
    const r = crowd.route(tower, 1, 25);
    expect(r).not.toBeNull();
    expect(r!.shafts).toEqual([express, local]);
    expect(r!.floors).toContain(15); // the transfer happens at the sky lobby
  });

  it("Classic: the ground lobby (floor 1) admits an express-to-local transfer", () => {
    // Express serving the high tower, local bank hugging the ground: a rider
    // descending from the express top transfers at floor 1 onto the local.
    const tower = baseTower("classic", 15);
    const express = shaftOk(tower, "elevatorExpress", 4, 1, 15);
    const local = shaftOk(tower, "elevatorStandard", 10, 1, 8);
    const crowd = new Crowd();
    const r = crowd.route(tower, 15, 5);
    expect(r).not.toBeNull();
    expect(r!.shafts).toEqual([express, local]);
    expect(r!.floors).toContain(1); // down the spine, switch at the ground lobby
  });

  it("local-to-local transfers at a plain shared stop are unaffected in BOTH modes", () => {
    for (const mode of ["classic", "modern"] as const) {
      const tower = baseTower(mode, 20);
      const lower = shaftOk(tower, "elevatorStandard", 4, 1, 10);
      const upper = shaftOk(tower, "elevatorStandard", 10, 10, 20);
      const crowd = new Crowd();
      // Floor 10 is a plain floor, but neither leg is express: the two-ride
      // transfer stays admissible everywhere, exactly as before this rule.
      const r = crowd.route(tower, 1, 18);
      expect(r, `mode ${mode}`).not.toBeNull();
      expect(r!.shafts).toEqual([lower, upper]);
      expect(r!.floors).toContain(10);
    }
  });

  it("Classic: an inadmissible express arrival does not shadow a legal local route (strand risk)", () => {
    // Express 1..20 AND a parallel local 1..20 both stop at the plain floor 20,
    // where a second local carries on to 25. The express is placed FIRST, so
    // the BFS enumerates its arrival at 20 first; if the search collapsed both
    // arrivals into one per-floor state, the gated express arrival would mark
    // 20 seen and strand floor 25 even though the all-local two-ride route is
    // perfectly legal. The state-per-arrival-class search must find it.
    const tower = baseTower("classic", 25);
    const express = shaftOk(tower, "elevatorExpress", 4, 1, 20);
    const localLow = shaftOk(tower, "elevatorStandard", 10, 1, 20);
    const localHigh = shaftOk(tower, "elevatorStandard", 16, 20, 25);
    const crowd = new Crowd();
    const r = crowd.route(tower, 1, 25);
    expect(r).not.toBeNull();
    expect(r!.shafts).toEqual([localLow, localHigh]); // rides the locals, not the express
    expect(r!.shafts).not.toContain(express);
  });

  it("Classic: a stairs-to-express transfer at a plain floor is gated too (either leg counts)", () => {
    // Express 1..20 with its endpoint on the plain floor 20, stairs 20..21:
    // reaching 21 needs express then stairs, a transfer involving an express
    // leg at a non-lobby floor. Stairs are a passenger transport, so the gate
    // must read the EDGE's express flag, not "is this an elevator pair".
    const tower = baseTower("classic", 25);
    shaftOk(tower, "elevatorExpress", 4, 1, 20);
    shaftOk(tower, "stairs", 10, 20, 21);
    const crowd = new Crowd();
    expect(crowd.route(tower, 1, 21)).toBeNull();
    // Modern keeps the forgiving transfer, pinning that only Classic gates it.
    tower.rules = MODERN_RULES;
    expect(crowd.route(tower, 1, 21)).not.toBeNull();
  });

  it("Classic: an express-to-express transfer at a plain shared endpoint is gated", () => {
    // Two spines meeting at the plain floor 20 (express stops are lobby-locked
    // EXCEPT endpoints, so a shared plain floor is only possible endpoint to
    // endpoint). Switching spines belongs at a lobby just the same.
    const tower = baseTower("classic", 35);
    shaftOk(tower, "elevatorExpress", 4, 1, 20);
    shaftOk(tower, "elevatorExpress", 10, 20, 35);
    const crowd = new Crowd();
    expect(crowd.route(tower, 1, 35)).toBeNull();
    tower.rules = MODERN_RULES;
    expect(crowd.route(tower, 1, 35)).not.toBeNull();
  });

  it("no-express tower: the gated search returns the identical route to the plain BFS", () => {
    // The gated search claims to match bfsRoute edge for edge when no express
    // shaft exists. Pin the observable half of that claim: on a local-only
    // tower, Classic (gated search) and Modern (plain BFS) return identical
    // routes, floors and shafts alike, for a spread of trips.
    const tower = baseTower("classic", 20);
    shaftOk(tower, "elevatorStandard", 4, 1, 10);
    shaftOk(tower, "elevatorStandard", 10, 10, 20);
    shaftOk(tower, "escalator", 16, 1, 2);
    const crowd = new Crowd();
    for (const [from, to] of [
      [1, 2],
      [1, 10],
      [1, 18],
      [2, 20],
      [18, 1],
      [20, 2],
    ] as const) {
      tower.rules = CLASSIC_RULES;
      const gated = crowd.route(tower, from, to);
      tower.rules = MODERN_RULES;
      const plain = crowd.route(tower, from, to);
      expect(gated, `route ${from}->${to}`).toEqual(plain);
    }
  });

  it("Classic: a sky lobby added later reopens the gated transfer (cache refreshes)", () => {
    // Same shape as the sky-lobby case, but the lobby lands AFTER a failed
    // route: placing it bumps the tower revision, the adjacency cache and the
    // gate both see the new lobby floor, and the trip routes.
    const tower = baseTower("classic", 30, []);
    shaftOk(tower, "elevatorExpress", 4, 1, 15);
    shaftOk(tower, "elevatorStandard", 10, 15, 25);
    const crowd = new Crowd();
    expect(crowd.route(tower, 1, 25)).toBeNull(); // floor 15 is still plain
    // Committing floor 15 as a sky lobby requires clearing its plain tiles
    // first (the sky-lobby-commit rule refuses a lobby over non-lobby content).
    for (let x = 0; x < TOWER_W; x++) {
      const u = tower.unitAt(15, x);
      if (u && u.kind === "floor") tower.removeUnit(u.id);
    }
    for (let x = 0; x < TOWER_W; x++) placeOk(tower, "lobby", 15, x);
    expect(crowd.route(tower, 1, 25)).not.toBeNull();
  });
});
