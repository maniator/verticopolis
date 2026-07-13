import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";

/**
 * SimTower-parity pedestrian penalties (initiative epics E2):
 *  - W1 transport-too-far: a served office whose nearest reachable shaft on its
 *    floor sits beyond 79 tiles is worn down (cause: "transportFar").
 *  - W2 noise spacing: office bothered by commercial within 11 tiles; hotel/condo
 *    by office or commercial within 21; a lobby between the two cancels it.
 *  - W3 commercial-near-lobby: a shop/food venue more than 2 floors from a (sky)
 *    lobby earns half its traffic income.
 */

const W = GRID.width;
const MID = Math.floor(W / 2);

/** Lay one full-width story, spreading outward from the tower center so every
 *  tile stays connected to the starting lobby (structure can only extend from
 *  existing structure — a left-to-right sweep from x=0 would hang in mid-air). */
function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = MID; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = MID - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

/** Full-width ground lobby + floors 2..`top`, one standard elevator serving them. */
function servedTower(sim: Simulation, top: number, shaftX = 3): void {
  sim.money = 1e12;
  sim.star = 5;
  lay(sim, "lobby", 1);
  for (let f = 2; f <= top; f++) lay(sim, "floor", f);
  sim.buildTransport("elevatorStandard", shaftX, 1, top);
}

function unit(sim: Simulation, id: number | undefined) {
  const u = sim.tower.units.find((x) => x.id === id);
  if (!u) throw new Error(`placement failed (id ${id})`);
  return u;
}

describe("W1 — transport-too-far (79-tile walk penalty)", () => {
  it("erodes a served office beyond 79 tiles of a shaft while a near one stays happy", () => {
    const sim = Simulation.newGame(4);
    servedTower(sim, 2, 3); // shaft cols [3,7)
    const near = unit(sim, sim.tower.place("office", 2, 8).unitId); // ~1 tile away
    const far = unit(sim, sim.tower.place("office", 2, 260).unitId); // ~253 tiles away
    for (const u of [near, far]) {
      u.state = "occupied";
      u.satisfaction = 1;
    }
    for (let i = 0; i < 8; i++) sim.tick(60);
    expect(far.satisfaction).toBeLessThan(near.satisfaction);
    expect(near.satisfaction).toBeGreaterThan(0.9); // the near office is untouched
  });

  it("nearestTransportDistance is the horizontal gap, 0 when abutting, ∞ with no reachable shaft", () => {
    const sim = Simulation.newGame(1);
    servedTower(sim, 2, 3); // shaft cols [3,7) ⇒ right edge at 7
    const abut = unit(sim, sim.tower.place("office", 2, 7).unitId); // touches the shaft
    const gap = unit(sim, sim.tower.place("office", 2, 107).unitId); // 100 tiles right of edge
    expect(sim.tower.nearestTransportDistance(abut)).toBe(0);
    expect(sim.tower.nearestTransportDistance(gap)).toBe(100);

    // A floor with no shaft at all isn't served, so nothing counts → Infinity.
    const bare = Simulation.newGame(1);
    bare.money = 1e12;
    lay(bare, "lobby", 1);
    lay(bare, "floor", 2);
    const lonely = unit(bare, bare.tower.place("office", 2, 50).unitId);
    expect(bare.tower.nearestTransportDistance(lonely)).toBe(Infinity);
  });

  it("is a strict > 79 boundary: 79 tiles is fine, 80 bites", () => {
    // One office per tower so their width-9 footprints can't overlap at the seam.
    const at = (x: number) => {
      const sim = Simulation.newGame(6);
      servedTower(sim, 2, 3); // shaft right edge at 7 ⇒ gap = x - 7
      const o = unit(sim, sim.tower.place("office", 2, x).unitId);
      o.state = "occupied";
      o.satisfaction = 1;
      const dist = sim.tower.nearestTransportDistance(o);
      for (let i = 0; i < 8; i++) sim.tick(60);
      return { dist, sat: o.satisfaction };
    };
    const ok = at(86); // gap 79 → tolerated
    const over = at(87); // gap 80 → penalized
    expect(ok.dist).toBe(79);
    expect(over.dist).toBe(80);
    expect(ok.sat).toBeGreaterThan(0.9);
    expect(over.sat).toBeLessThan(ok.sat);
  });

  it("adding a shaft within 79 tiles stops the drain", () => {
    const sim = Simulation.newGame(7);
    servedTower(sim, 2, 3);
    const far = unit(sim, sim.tower.place("office", 2, 260).unitId);
    far.state = "occupied";
    far.satisfaction = 1;
    for (let i = 0; i < 6; i++) sim.tick(60);
    const worn = far.satisfaction;
    expect(worn).toBeLessThan(1);
    // Put a shaft right beside it, then let it recover.
    expect(sim.buildTransport("elevatorStandard", 258, 1, 2).ok).toBe(true);
    for (let i = 0; i < 6; i++) sim.tick(60);
    expect(far.satisfaction).toBeGreaterThan(worn);
  });

  it("ignores staff-only service elevators — a far office beside one still counts as far", () => {
    const sim = Simulation.newGame(5);
    servedTower(sim, 2, 3); // passenger shaft at [3,7)
    // A service elevator abuts the far office, but tenants can't ride it, so it
    // must NOT shrink the measured walk (mirrors servedFloors excluding staff shafts).
    expect(sim.buildTransport("elevatorService", 258, 1, 2).ok).toBe(true);
    const far = unit(sim, sim.tower.place("office", 2, 260).unitId);
    expect(sim.tower.nearestTransportDistance(far)).toBe(253); // to the passenger shaft, not the service one
  });

  it("attributes a bottomed-out far office's departure to transportFar", () => {
    const sim = Simulation.newGame(3);
    servedTower(sim, 2, 3);
    const far = unit(sim, sim.tower.place("office", 2, 260).unitId);
    far.state = "occupied";
    far.satisfaction = 0.2; // near the floor already
    for (let i = 0; i < 24; i++) sim.tick(60);
    expect(far.vacateReason).toBe("transportFar");
  });
});

describe("W2 — noise spacing buffers (11 / 21, lobby cancels)", () => {
  it("an office within 11 tiles of fast food erodes; one beyond the band (but near a shaft) does not", () => {
    const sim = Simulation.newGame(4);
    servedTower(sim, 2, 3);
    // A second shaft by the commercial zone so neither test office trips W1 — this
    // isolates the W2 noise effect from the W1 walk penalty.
    sim.buildTransport("elevatorStandard", 120, 1, 2); // cols [120,123)
    sim.tower.place("fastFood", 2, 100); // footprint [100,116)
    const near = unit(sim, sim.tower.place("office", 2, 90).unitId); // [90,99), gap 1 ≤ 11 → noisy
    const control = unit(sim, sim.tower.place("office", 2, 130).unitId); // gap 14 > 11 → quiet
    for (const u of [near, control]) {
      expect(sim.tower.nearestTransportDistance(u)).toBeLessThanOrEqual(79); // no W1 on either
      u.state = "occupied";
      u.satisfaction = 1;
    }
    for (let i = 0; i < 8; i++) sim.tick(60);
    expect(near.satisfaction).toBeLessThan(control.satisfaction);
    expect(control.satisfaction).toBeGreaterThan(0.9); // the quiet office is untouched
  });

  it("W1 and W2 erode a doubly-afflicted office ONCE per tick, not twice", () => {
    // An office both >79 from a shaft AND next to fast food must not drain at 2×.
    const both = () => {
      const sim = Simulation.newGame(8);
      servedTower(sim, 2, 3); // shaft far to the left
      sim.tower.place("fastFood", 2, 100);
      const o = unit(sim, sim.tower.place("office", 2, 90).unitId); // far from shaft, by food
      expect(sim.tower.nearestTransportDistance(o)).toBeGreaterThan(79);
      o.state = "occupied";
      o.satisfaction = 1;
      for (let i = 0; i < 4; i++) sim.tick(60);
      return o.satisfaction;
    };
    const onlyFar = () => {
      const sim = Simulation.newGame(8);
      servedTower(sim, 2, 3);
      const o = unit(sim, sim.tower.place("office", 2, 90).unitId); // far from shaft only
      o.state = "occupied";
      o.satisfaction = 1;
      for (let i = 0; i < 4; i++) sim.tick(60);
      return o.satisfaction;
    };
    // Same erosion tier for one cause or two → the doubly-afflicted office is no
    // worse off per tick than the walk-only one (single clamp to the cap).
    expect(both()).toBeCloseTo(onlyFar(), 5);
  });

  // The lobby-between-two-rooms noise-shield scenario (a lobby tile sitting
  // between an office and a hotel on the same story) is unreachable under
  // sky-lobby canon (spec-sky-lobby-canon): a claimed sky-lobby floor refuses
  // rooms, and an unclaimed one refuses the lobby if rooms exist. The engine
  // path that implements the shield still stands (a legacy save from before
  // v1.16 can carry such a mixed floor), but there is no new-placement flow
  // to reach it, so the scenario is now legacy-only and its coverage moves
  // to save-migration tests rather than a placement fixture.

  it("subsumes the old 1-tile office→hotel rule (adjacent still caps at the ceiling)", () => {
    const sim = Simulation.newGame(5);
    servedTower(sim, 2, 3);
    sim.tower.place("office", 2, 50);
    const adj = unit(sim, sim.tower.place("hotelDouble", 2, 59).unitId); // abuts the office
    adj.state = "asleep";
    adj.satisfaction = 1;
    for (let i = 0; i < 4; i++) sim.tick(60);
    expect(adj.satisfaction).toBeLessThanOrEqual(0.6); // capped at the annoyance ceiling
  });

  it("noise carries THROUGH a non-source room in the gap — only a lobby/open-air shields", () => {
    // office(sensitive) — office(non-source) — fastFood(source), all within 11
    // tiles. Per canon (GDD §4.1) the intervening office is transparent: the
    // sensitive office still erodes. Pins the deliberate distance-radius model
    // against a plausible-but-wrong "an intervening room blocks noise" change —
    // the lobby-buffer test above is the ONLY documented shield.
    const sim = Simulation.newGame(41);
    servedTower(sim, 2, 3); // shaft cols [3,6)
    sim.buildTransport("elevatorStandard", 120, 1, 2); // second shaft → no W1 on any office
    sim.tower.place("fastFood", 2, 100); // source, footprint [100,116)
    sim.tower.place("office", 2, 91); // NON-source office wedged in the gap, [91,100)
    const far = unit(sim, sim.tower.place("office", 2, 82).unitId); // sensitive, [82,91)
    const control = unit(sim, sim.tower.place("office", 2, 130).unitId); // gap 14 > 11 → quiet
    for (const u of [far, control]) {
      expect(sim.tower.nearestTransportDistance(u)).toBeLessThanOrEqual(79); // isolate W2 from W1
      u.state = "occupied";
      u.satisfaction = 1;
    }
    for (let i = 0; i < 8; i++) sim.tick(60);
    expect(far.satisfaction).toBeLessThan(control.satisfaction); // noise reached through the middle office
    expect(control.satisfaction).toBeGreaterThan(0.9); // the truly-distant office stays quiet
  });
});

describe("W3 — commercial must be near a lobby (2 floors)", () => {
  it("nearestLobbyFloorDistance anchors on the ground and shrinks with a sky lobby", () => {
    // Under sky-lobby canon a lobby is refused on floor 15 if the floor already
    // carries non-lobby content, so support is only laid through floor 14 here,
    // leaving floor 15 empty for the sky-lobby placement.
    const sim = Simulation.newGame(1);
    servedTower(sim, 14, 3);
    expect(sim.tower.nearestLobbyFloorDistance(3)).toBe(2); // 2 floors above ground
    expect(sim.tower.nearestLobbyFloorDistance(8)).toBe(7);
    sim.tower.place("lobby", 15, 3); // a sky lobby on floor 15 (lobby interval)
    expect(sim.tower.nearestLobbyFloorDistance(15)).toBe(0);
    expect(sim.tower.nearestLobbyFloorDistance(16)).toBe(1);
    expect(sim.tower.nearestLobbyFloorDistance(8)).toBe(7); // still closest to ground
  });

  it("a venue >2 floors from a lobby earns less than the same venue near one", () => {
    // Identical seeds/layouts; only the fast food's floor differs.
    const earn = (floor: number): number => {
      const sim = Simulation.newGame(11);
      servedTower(sim, 8, 3);
      const ff = unit(sim, sim.tower.place("fastFood", floor, 40).unitId);
      ff.state = "occupied";
      const before = sim.money;
      // Run a full day so open-hours income accrues under identical RNG order.
      for (let i = 0; i < 24; i++) sim.tick(60);
      return sim.money - before;
    };
    const near = earn(2); // 1 floor from ground lobby → full traffic
    const far = earn(8); // 7 floors, no sky lobby → half traffic
    expect(far).toBeLessThan(near);
  });

  it("exempts partyHall — it's outside the canon commercial set, so distance doesn't halve it", () => {
    // partyHall earns traffic income but is NOT in the canon W2/W3 commercial set,
    // so its far/near income gap should be ~0, unlike a fast food, which W3 halves.
    const earn = (kind: "partyHall" | "fastFood", floor: number): number => {
      const sim = Simulation.newGame(11);
      // Build to floor 9 so the two-story party hall placed at floor 8 has its
      // upper story (floor 9). The measured floors (2 and 8) are unchanged.
      servedTower(sim, 9, 3);
      const v = unit(sim, sim.tower.place(kind, floor, 40).unitId);
      v.state = "occupied";
      const before = sim.money;
      for (let i = 0; i < 24; i++) sim.tick(60);
      return sim.money - before;
    };
    const phGap = earn("partyHall", 2) - earn("partyHall", 8); // exempt → ~0
    const ffGap = earn("fastFood", 2) - earn("fastFood", 8); // penalized → real
    expect(ffGap).toBeGreaterThan(0); // W3 actually bites a canon commercial venue
    expect(Math.abs(phGap)).toBeLessThan(ffGap); // partyHall is untouched by comparison
  });

  it("a sky lobby within 2 floors restores the venue's traffic", () => {
    // Under sky-lobby canon a claimed sky-lobby floor refuses rooms, and an
    // unclaimed one refuses a lobby if rooms are on it. Sit the venue one
    // story above the sky lobby (floor 16, 1 floor from the concourse at 15)
    // so both the lobby and the venue can be built. `servedTower(15)` leaves
    // floor 15 with plain floor, so the lobby lands FIRST (its floor is bare
    // of rooms), then the venue lands on floor 16 above.
    const earn = (skyLobby: boolean): number => {
      const sim = Simulation.newGame(11);
      servedTower(sim, 14, 3);
      // Cover floor 15 with lobby tiles (the sky concourse) when the flag is
      // set, else cover it with plain floor tiles so floor 16 above has support
      // in both branches (only the substrate differs). Under sky-lobby canon
      // the two states diverge cleanly: with the concourse, the venue on floor
      // 16 is 1 story from a lobby; without it, 15 floors from the ground.
      const substrate = skyLobby ? "lobby" : "floor";
      for (let x = 0; x < 40; x++) sim.tower.place(substrate, 15, x);
      for (let x = 0; x < 40; x++) sim.tower.place("floor", 16, x); // support for the venue above
      // Extend the passenger shaft to floor 16 so the venue is transport-served
      // in both branches (the W3 test isolates lobby distance, not transport).
      sim.buildTransport("elevatorStandard", 25, 1, 16);
      const ff = unit(sim, sim.tower.place("fastFood", 16, 5).unitId); // 1 floor from the sky lobby
      ff.state = "occupied";
      const before = sim.money;
      for (let i = 0; i < 24; i++) sim.tick(60);
      return sim.money - before;
    };
    expect(earn(true)).toBeGreaterThan(earn(false));
  });
});
