import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { CLASSIC_RULES, MODERN_RULES } from "../../engine/gameRules";
import { LOBBY_FAR_CAP, LOBBY_VERY_FAR_CAP } from "../../engine/sim/constants";

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

/** Place `n` occupied offices on a reachable low floor so commercial venues have
 *  a real demand pool to serve (commercial income is demand-driven now: a venue
 *  in an empty tower earns nothing). Spread clear of the measured venue at x=40
 *  and the shaft columns. Identical across compared runs, so the office pool
 *  cancels and only the venue's own penalty (W3 distance, rain, ...) differs. */
function addDemand(sim: Simulation, floor = 2, n = 4): void {
  for (let i = 0; i < n; i++) {
    const r = sim.tower.place("office", floor, 100 + i * 12);
    expect(r.ok, r.reason).toBe(true);
    unit(sim, r.unitId).state = "occupied";
  }
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
      addDemand(sim);
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
      addDemand(sim);
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
      addDemand(sim);
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

describe("W-new: graduated lobby-distance penalty (#394, edges derived from the lobby ladder)", () => {
  it("leaves the deepest mid-block floor of a complete lobby ladder penalty-free (Classic)", () => {
    // Distance 7 (= floor(lobbyInterval / 2)) is the farthest any floor can sit
    // from a lobby when every legal slot is built, so it MUST carry no penalty:
    // correct play is fully rewarded, not merely spared eviction. (Seed picked
    // so no random event interrupts the 40-hour run.)
    const sim = Simulation.newGame(9, "classic");
    servedTower(sim, 8);
    const midBlock = unit(sim, sim.tower.place("office", 8, 40).unitId); // 7 floors from the ground lobby
    midBlock.state = "occupied";
    midBlock.satisfaction = 1;
    for (let i = 0; i < 40; i++) sim.tick(60);
    expect(midBlock.satisfaction).toBeGreaterThan(0.9); // no cap, no erosion
    expect(midBlock.state).toBe("occupied");
  });

  it("caps a far-from-lobby tenant at the far ceiling without evicting it, near tenant untouched (Classic)", () => {
    const sim = Simulation.newGame(7, "classic");
    servedTower(sim, 10);
    const near = unit(sim, sim.tower.place("office", 2, 40).unitId); // 1 floor from the ground lobby
    const far = unit(sim, sim.tower.place("office", 9, 40).unitId); // 8 floors up: the far band (a skipped sky lobby)
    for (const u of [near, far]) {
      u.state = "occupied";
      u.satisfaction = 1;
    }
    for (let i = 0; i < 40; i++) sim.tick(60);
    // The far office settles at the far ceiling and never leaves; the near one is untouched.
    expect(far.satisfaction).toBeLessThanOrEqual(LOBBY_FAR_CAP + 1e-9);
    expect(far.satisfaction).toBeGreaterThan(LOBBY_FAR_CAP - 0.05); // recovers up to the cap, no erosion
    expect(far.state).toBe("occupied"); // caps, does not kill
    expect(near.satisfaction).toBeGreaterThan(0.9);
  });

  it("erodes a very-far office to a notice, attributed to lobbyFar (Classic)", () => {
    const sim = Simulation.newGame(8, "classic");
    servedTower(sim, 14);
    const office = unit(sim, sim.tower.place("office", 13, 40).unitId); // 12 floors up: past even a skipped-lobby cap
    office.state = "occupied";
    office.satisfaction = 0.1; // already near the floor; the gentle erosion carries it out
    for (let i = 0; i < 40; i++) sim.tick(60); // inside the notice window, so it stays "vacating"
    expect(office.state).toBe("vacating");
    expect(office.vacateReason).toBe("lobbyFar");
  });

  it("holds a very-far tenant below the very-far ceiling (Classic)", () => {
    const sim = Simulation.newGame(11, "classic");
    servedTower(sim, 14);
    const office = unit(sim, sim.tower.place("office", 13, 40).unitId); // very far (distance 12)
    office.state = "occupied";
    office.satisfaction = 1;
    for (let i = 0; i < 5; i++) sim.tick(60); // a few hours: snapped under the ceiling, still here
    expect(office.satisfaction).toBeLessThanOrEqual(LOBBY_VERY_FAR_CAP + 1e-9);
    expect(office.state).toBe("occupied");
  });

  it("a sky lobby beside the floor cancels the penalty", () => {
    // Build the tower with floor 15 laid as a sky LOBBY (not a plain floor), the
    // way the player founds one, so it registers as a lobby anchor.
    const withSky = Simulation.newGame(12, "classic");
    withSky.money = 1e12;
    withSky.star = 5;
    lay(withSky, "lobby", 1);
    for (let f = 2; f <= 20; f++) lay(withSky, f === 15 ? "lobby" : "floor", f);
    withSky.buildTransport("elevatorStandard", 3, 1, 20);
    // Floor 16 sits 1 floor from the sky lobby (and 15 from the ground): the sky
    // lobby is the nearer anchor, so the distance penalty never fires.
    const nearSky = unit(withSky, withSky.tower.place("office", 16, 40).unitId);
    expect(withSky.tower.nearestLobbyFloorDistance(16)).toBe(1); // precondition: the sky lobby anchors it
    nearSky.state = "occupied";
    nearSky.satisfaction = 1;
    for (let i = 0; i < 20; i++) withSky.tick(60);
    expect(nearSky.satisfaction).toBeGreaterThan(0.9); // no lobby-distance penalty at all
    expect(nearSky.state).toBe("occupied");
  });

  it("Modern is gentler than Classic at the same very-far distance", () => {
    // Same floor (distance 12) and starting satisfaction in both modes: Classic
    // erodes (heading out), Modern's continuous curve barely erodes at this
    // distance (net-positive drift), so the Modern tenant settles at a higher
    // plateau while the Classic one keeps sliding.
    const run = (mode: "classic" | "modern") => {
      const sim = Simulation.newGame(13, mode);
      servedTower(sim, 14);
      const office = unit(sim, sim.tower.place("office", 13, 40).unitId); // distance 12
      office.state = "occupied";
      office.satisfaction = 1;
      for (let i = 0; i < 40; i++) sim.tick(60);
      return office;
    };
    const classic = run("classic");
    const modern = run("modern");
    expect(modern.satisfaction).toBeGreaterThan(classic.satisfaction); // Modern is gentler
    expect(modern.satisfaction).toBeLessThan(1); // but still capped, not fully content
    expect(modern.state).toBe("occupied"); // and not evicting at this distance
  });

  it("applies to condos: a very-far condo gives notice, attributed to lobbyFar (Classic)", () => {
    const sim = Simulation.newGame(21, "classic");
    servedTower(sim, 14);
    const condo = unit(sim, sim.tower.place("condo", 13, 40).unitId); // distance 12: very far
    condo.state = "occupied";
    condo.satisfaction = 0.1;
    for (let i = 0; i < 40; i++) sim.tick(60);
    expect(condo.state).toBe("vacating");
    expect(condo.vacateReason).toBe("lobbyFar");
  });

  it("applies to hotels: a very-far hotel room is capped at the very-far ceiling (Classic)", () => {
    const sim = Simulation.newGame(22, "classic");
    servedTower(sim, 14);
    const hotel = unit(sim, sim.tower.place("hotelSingle", 13, 40).unitId); // distance 12: very far
    hotel.state = "occupied";
    hotel.satisfaction = 1;
    for (let i = 0; i < 5; i++) sim.tick(60);
    // The distance ceiling applies to hotels too (they were previously untouched
    // by any lobby-distance pressure), snapping them under the very-far cap.
    expect(hotel.satisfaction).toBeLessThanOrEqual(LOBBY_VERY_FAR_CAP + 1e-9);
  });

  it("advice is always followable: every capped floor either has a buildable nearer slot or reads as top-block geometry", () => {
    // The property behind the #394 recalibration: for EVERY floor the tower can
    // hold, a firing lobby-distance drain must come with advice the placement
    // rules can actually honor. With every legal slot built, no floor between
    // two lobbies may feel any drain at all; only the short block above the
    // highest buildable slot may cap, and there the slot lookup must return
    // null (neutral copy) and the drain must never evict, in BOTH rule-sets.
    const sim = Simulation.newGame(31, "classic");
    sim.money = 1e12;
    sim.star = 5;
    const laySpan = (s: Simulation, kind: "floor" | "lobby", floor: number): void => {
      for (let x = MID; x < MID + 40; x++) s.tower.place(kind, floor, x);
    };
    laySpan(sim, "lobby", 1);
    for (let f = 2; f <= GRID.maxFloor; f++) {
      laySpan(sim, f % GRID.lobbyInterval === 0 ? "lobby" : "floor", f);
    }
    const highestSlot = Math.floor(GRID.maxFloor / GRID.lobbyInterval) * GRID.lobbyInterval;
    for (let f = 1; f <= GRID.maxFloor; f++) {
      const dist = sim.tower.nearestLobbyFloorDistance(f);
      const slot = sim.tower.nearestBuildableLobbySlot(f);
      for (const rules of [CLASSIC_RULES, MODERN_RULES]) {
        const drain = rules.lobbyDistanceDrain(dist);
        if (drain.cap >= 1) continue; // no penalty, nothing to advise
        // Every slot is built, so the only legal capped floors are the top block.
        expect(f, `floor ${f} caps but sits between two built lobbies`).toBeGreaterThan(highestSlot);
        expect(slot, `floor ${f}: advice would name a slot but none is buildable`).toBeNull();
        expect(drain.erosion, `floor ${f}: top-block geometry must cap, never evict`).toBe(0);
      }
    }
    // And with a genuinely skipped slot, every capped floor names that exact slot.
    const gap = Simulation.newGame(32, "classic");
    gap.money = 1e12;
    gap.star = 5;
    laySpan(gap, "lobby", 1);
    for (let f = 2; f <= 45; f++) {
      // Slot 30 is deliberately skipped; 15 and 45 are built.
      laySpan(gap, f !== 30 && f % GRID.lobbyInterval === 0 ? "lobby" : "floor", f);
    }
    let cappedFloors = 0;
    for (let f = 2; f <= 45; f++) {
      const drain = gap.rules.lobbyDistanceDrain(gap.tower.nearestLobbyFloorDistance(f));
      if (drain.cap >= 1) continue;
      cappedFloors++;
      expect(gap.tower.nearestBuildableLobbySlot(f), `floor ${f} should name the skipped slot`).toBe(30);
    }
    expect(cappedFloors).toBeGreaterThan(0); // the skipped slot genuinely bites
  });
});
