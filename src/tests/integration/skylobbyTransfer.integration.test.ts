import { describe, it, expect } from "vitest";
import { Tower } from "../../engine/Tower";
import { Crowd } from "../../engine/Crowd";
import { CLASSIC_RULES, MODERN_RULES } from "../../engine/gameRules";
import type { FacilityKind, GameMode } from "../../engine/types";

/**
 * Express transfers route at any express STOP, both modes (#509 parity). The
 * former Classic "express transfer needs a lobby" gate (#396, shipped from web
 * guides) was disproven in the Wine harness: the 1994 original completes an
 * express<->local transfer at a NON-lobby floor (the express terminus), so a
 * test office reachable only that way rents out. The gate is removed. Express
 * stops are still lobby-locked EXCEPT a shaft's endpoints (bottom and top always
 * stop), so a plain-floor express transfer is only possible at an endpoint, and
 * now it routes like any other shared stop.
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

describe("express transfers route at any express stop (#509 parity)", () => {
  /** Express 1..20 (endpoint 20 is a PLAIN floor, no lobby anywhere between)
   *  plus a local bank 20..25: the only path to 25 transfers off the express
   *  at the non-lobby floor 20. */
  function nonLobbyHubTower(mode: GameMode) {
    const tower = baseTower(mode, 25);
    const express = shaftOk(tower, "elevatorExpress", 4, 1, 20);
    const local = shaftOk(tower, "elevatorStandard", 10, 20, 25);
    return { tower, express, local };
  }

  it("an express-to-local transfer at a plain (non-lobby) express endpoint routes in BOTH modes (#509)", () => {
    for (const mode of ["classic", "modern"] as const) {
      const { tower, express, local } = nonLobbyHubTower(mode);
      const crowd = new Crowd();
      // Floor 20 is the express endpoint (a plain floor), where the local bank
      // begins. The 1994 original transfers here, so we do too, in both modes.
      const r = crowd.route(tower, 1, 25);
      expect(r, `mode ${mode}`).not.toBeNull();
      expect(r!.shafts).toEqual([express, local]);
      expect(r!.floors).toContain(20); // transfers at the plain express endpoint
    }
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

  it("Classic: a two-ride route through a plain express endpoint is found (no strand)", () => {
    // Express 1..20 AND a parallel local 1..20 both stop at the plain floor 20,
    // where a second local carries on to 25. With no express gate, floor 25 is
    // reachable in two rides; the fewest-edges search takes the first-listed
    // shaft off floor 1 (the express, placed first) then the upper local.
    const tower = baseTower("classic", 25);
    const express = shaftOk(tower, "elevatorExpress", 4, 1, 20);
    shaftOk(tower, "elevatorStandard", 10, 1, 20);
    const localHigh = shaftOk(tower, "elevatorStandard", 16, 20, 25);
    const crowd = new Crowd();
    const r = crowd.route(tower, 1, 25);
    expect(r).not.toBeNull();
    expect(r!.shafts).toEqual([express, localHigh]);
    expect(r!.floors).toContain(20);
  });

  it("a stairs-to-express transfer at a plain floor routes in BOTH modes (either leg)", () => {
    // Express 1..20 with its endpoint on the plain floor 20, stairs 20..21:
    // reaching 21 needs express then a stair flight. With no gate, the transfer
    // is admissible in both modes (a single stair flight is within Classic's
    // walk budget).
    for (const rules of [CLASSIC_RULES, MODERN_RULES]) {
      const tower = baseTower("classic", 25);
      tower.rules = rules;
      shaftOk(tower, "elevatorExpress", 4, 1, 20);
      shaftOk(tower, "stairs", 10, 20, 21);
      const crowd = new Crowd();
      expect(crowd.route(tower, 1, 21), rules.mode).not.toBeNull();
    }
  });

  it("an express-to-express transfer at a plain shared endpoint routes in BOTH modes", () => {
    // Two spines meeting at the plain floor 20 (express stops are lobby-locked
    // EXCEPT endpoints, so a shared plain floor is only possible endpoint to
    // endpoint). With no gate, switching spines there routes in both modes.
    for (const rules of [CLASSIC_RULES, MODERN_RULES]) {
      const tower = baseTower("classic", 35);
      tower.rules = rules;
      shaftOk(tower, "elevatorExpress", 4, 1, 20);
      shaftOk(tower, "elevatorExpress", 10, 20, 35);
      const crowd = new Crowd();
      expect(crowd.route(tower, 1, 35), rules.mode).not.toBeNull();
    }
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

  it("the pure reachability probe agrees with route in both modes (no rng, no divergence)", () => {
    // crowd.reachable backs floorReachable (the ~6 Hz editor probe) and must
    // agree with route(): with no express gate, the plain-endpoint transfer is
    // reachable in both modes.
    for (const mode of ["classic", "modern"] as const) {
      const { tower } = nonLobbyHubTower(mode);
      const c = new Crowd();
      expect(c.route(tower, 1, 25), mode).not.toBeNull();
      expect(c.reachable(tower, 1, 25), mode).toBe(true); // probe agrees
    }
    // The probe draws no rng: a repeated reachability check leaves the stream
    // exactly where an untouched crowd's does.
    const { tower } = nonLobbyHubTower("classic");
    const probe = new Crowd(4242);
    const untouched = new Crowd(4242);
    expect(probe.reachable(tower, 1, 20)).toBe(true);
    expect(probe.rng.int(0, 1_000_000)).toBe(untouched.rng.int(0, 1_000_000));
  });

  it("adding a sky lobby does not change an already-reachable express transfer", () => {
    // Under the old gate this transfer was refused until floor 15 became a sky
    // lobby. With the gate gone it routes with 15 plain, and still routes after
    // 15 is committed as a sky lobby (the adjacency cache refreshes on the
    // revision bump either way).
    const tower = baseTower("classic", 30, []);
    shaftOk(tower, "elevatorExpress", 4, 1, 15);
    shaftOk(tower, "elevatorStandard", 10, 15, 25);
    const crowd = new Crowd();
    expect(crowd.route(tower, 1, 25)).not.toBeNull(); // floor 15 plain: already routes
    for (let x = 0; x < TOWER_W; x++) {
      const u = tower.unitAt(15, x);
      if (u && u.kind === "floor") tower.removeUnit(u.id);
    }
    for (let x = 0; x < TOWER_W; x++) placeOk(tower, "lobby", 15, x);
    expect(crowd.route(tower, 1, 25)).not.toBeNull(); // still routes with the lobby
  });
});
