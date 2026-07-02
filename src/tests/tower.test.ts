import { describe, it, expect, beforeEach } from "vitest";
import { Tower } from "../engine/Tower";
import { GRID } from "../engine/facilities";
import type { Transport } from "../engine/types";

describe("Tower placement", () => {
  let tower: Tower;
  beforeEach(() => {
    tower = new Tower();
  });

  it("requires the first build to be on the ground floor", () => {
    expect(tower.canPlace("lobby", 5, 10).ok).toBe(false);
    expect(tower.canPlace("lobby", 1, 10).ok).toBe(true);
  });

  it("places a lobby and indexes occupancy", () => {
    const res = tower.place("lobby", 1, 10);
    expect(res.ok).toBe(true);
    expect(tower.unitAt(1, 10)?.kind).toBe("lobby");
    expect(tower.unitAt(1, 11)).toBeUndefined();
  });

  it("rejects overlapping placement", () => {
    tower.place("lobby", 1, 10);
    expect(tower.canPlace("lobby", 1, 10).ok).toBe(false);
  });

  it("rejects rooms without a floor underneath the whole span", () => {
    // Build a ground strip, then a single floor tile on level 2.
    for (let i = 0; i < 20; i++) tower.place("lobby", 1, i);
    tower.place("floor", 2, 0);
    // Office needs 9 contiguous floor tiles.
    expect(tower.canPlace("office", 2, 0).ok).toBe(false);
    for (let i = 1; i < 12; i++) tower.place("floor", 2, i);
    expect(tower.canPlace("office", 2, 0).ok).toBe(true);
  });

  it("treats lobbies as transit-only — no rooms on a lobby concourse", () => {
    for (let i = 0; i < 20; i++) tower.place("lobby", 1, i);
    // The ground lobby cannot host a shop/office, exactly like the original.
    expect(tower.canPlace("fastFood", 1, 0).ok).toBe(false);
    expect(tower.canPlace("office", 1, 0).ok).toBe(false);
    // The same column on a plain floor above accepts rooms.
    for (let i = 0; i < 20; i++) tower.place("floor", 2, i);
    expect(tower.canPlace("office", 2, 0).ok).toBe(true);
    // A sky lobby is likewise transit-only.
    for (let i = 0; i < 20; i++) {
      const u = tower.roomAt(2, i);
      void u;
    }
    for (let i = 0; i < 20; i++) tower.place("floor", 3, i);
    for (let i = 0; i < 20; i++) {
      tower.removeUnit(tower.unitAt(3, i)!.id);
      tower.place("lobby", 3, i);
    }
    expect(tower.canPlace("office", 3, 0).ok).toBe(false);
  });

  it("restricts lobbies to the ground floor and every 15th floor", () => {
    for (let i = 0; i < 20; i++) tower.place("lobby", 1, i);
    for (let f = 2; f <= 14; f++) for (let i = 0; i < 20; i++) tower.place("floor", f, i);
    // Floor 15 is a valid sky-lobby floor (and empty, supported by floor 14).
    expect(tower.canPlace("lobby", 15, 0).ok).toBe(true);
    // Arbitrary floors are not.
    expect(tower.canPlace("lobby", 5, 0).ok).toBe(false);
    expect(tower.canPlace("lobby", 16, 0).ok).toBe(false);
  });

  it("keeps floors connected to existing structure", () => {
    for (let i = 0; i < 5; i++) tower.place("lobby", 1, i);
    // Floating floor far away is unsupported.
    expect(tower.canPlace("floor", 1, 100).ok).toBe(false);
    // Adjacent extension is fine.
    expect(tower.canPlace("floor", 1, 5).ok).toBe(true);
    // Stacking above is fine.
    expect(tower.canPlace("floor", 2, 0).ok).toBe(true);
  });

  it("rejects hanging floors above ground — every tile must sit on the story below", () => {
    for (let i = 0; i < 20; i++) tower.place("lobby", 1, i);
    for (let i = 0; i < 20; i++) tower.place("floor", 2, i);
    // Extending floor 2 sideways past the end of the ground floor would hang
    // in midair, even though it touches existing floor-2 structure.
    expect(tower.canPlace("floor", 2, 20).ok).toBe(false);
    // Floor 3 directly above floor 2 is fine…
    expect(tower.place("floor", 3, 19).ok).toBe(true);
    // …but chaining sideways off it past floor 2's edge is not.
    expect(tower.canPlace("floor", 3, 20).ok).toBe(false);
    // A floor can't hang beneath existing structure with nothing below either:
    // widen the ground first, then floor 2 above it becomes buildable.
    expect(tower.place("floor", 1, 20).ok).toBe(true);
    expect(tower.canPlace("floor", 2, 20).ok).toBe(true);
  });

  it("lets a lobby upgrade a plain floor in place (sky-lobby conversion)", () => {
    for (let i = 0; i < 20; i++) tower.place("lobby", 1, i);
    for (let f = 2; f <= 16; f++) for (let i = 0; i < 20; i++) tower.place("floor", f, i);
    // Floor 16 sits on 15, so the plain floor-15 tile can't be sold — but a
    // sky lobby may replace it atomically, never passing through midair.
    expect(tower.removalReason(tower.unitAt(15, 0)!.id)).toBeDefined();
    const r = tower.place("lobby", 15, 0);
    expect(r.ok).toBe(true);
    expect(tower.unitAt(15, 0)?.kind).toBe("lobby");
    expect(tower.hasStructure(15, 0)).toBe(true);
    // Upgrades never target non-lobby floors, existing lobbies, or room tiles.
    expect(tower.canPlace("lobby", 5, 0).ok).toBe(false);
    expect(tower.canPlace("lobby", 15, 0).ok).toBe(false); // already a lobby
    expect(tower.place("office", 15, 5).ok).toBe(true);
    expect(tower.canPlace("lobby", 15, 5).ok).toBe(false); // room in the way
  });

  it("won't let a supporting floor be removed from under the story above", () => {
    for (let i = 0; i < 5; i++) tower.place("lobby", 1, i);
    const mid = tower.place("floor", 2, 0);
    tower.place("floor", 3, 0);
    // The lobby holds up floor 2, and floor 2 holds up floor 3.
    expect(tower.removalReason(tower.unitAt(1, 0)!.id)).toBeDefined();
    expect(tower.removalReason(mid.unitId!)).toBeDefined();
    // The top floor holds nothing and may go; then floor 2 is free too.
    expect(tower.removalReason(tower.unitAt(3, 0)!.id)).toBeUndefined();
    tower.removeUnit(tower.unitAt(3, 0)!.id);
    expect(tower.removalReason(mid.unitId!)).toBeUndefined();
    // A basement tile hangs in the earth, not off the ground floor — removing
    // B1 under the lobby stays legal.
    tower.place("floor", 0, 0);
    expect(tower.removalReason(tower.unitAt(0, 0)!.id)).toBeUndefined();
  });

  it("enforces the buildable bounds", () => {
    tower.place("lobby", 1, 0);
    expect(tower.canPlace("floor", GRID.maxFloor + 1, 0).ok).toBe(false);
    expect(tower.canPlace("floor", GRID.minFloor - 1, 0).ok).toBe(false);
    expect(tower.canPlace("office", 1, GRID.width - 2).ok).toBe(false);
  });

  it("requires every story of a multi-floor facility", () => {
    for (let i = 0; i < 30; i++) tower.place("lobby", 1, i);
    // Cinema is two stories: floors 2 AND 3 must exist as structure.
    for (let i = 0; i < 30; i++) tower.place("floor", 2, i);
    expect(tower.canPlace("cinema", 2, 0).ok).toBe(false); // floor 3 missing
    for (let i = 0; i < 30; i++) tower.place("floor", 3, i);
    expect(tower.canPlace("cinema", 2, 0).ok).toBe(true);
    const r = tower.place("cinema", 2, 0);
    expect(r.ok).toBe(true);
    // It occupies both floors, blocking a room directly above it.
    expect(tower.roomAt(2, 1)?.id).toBe(r.unitId);
    expect(tower.roomAt(3, 1)?.id).toBe(r.unitId);
  });

  it("restricts basement facilities to underground floors", () => {
    for (let i = 0; i < 40; i++) tower.place("lobby", 1, i);
    // Basements use continuous numbering: floor 0 = B1, -1 = B2. Build them
    // from the ground down so each connects to the structure above.
    for (let f = 0; f >= -2; f--) for (let i = 0; i < 40; i++) tower.place("floor", f, i);
    // Parking on the ground floor is rejected…
    expect(tower.canPlace("parking", 1, 0).ok).toBe(false);
    // …but allowed in the basement (B1 = floor 0).
    expect(tower.canPlace("parking", 0, 0).ok).toBe(true);
    // The metro spans THREE whole basement floors (full lot width).
    for (let i = 40; i < GRID.width; i++) for (let f = 0; f >= -2; f--) tower.place("floor", f, i);
    expect(tower.canPlace("metro", -2, 0).ok).toBe(true); // spans -2/-1/0
    expect(tower.canPlace("metro", 0, 0).ok).toBe(false); // would cross above ground
    expect(tower.canPlace("metro", 1, 0).ok).toBe(false);
  });

  it("keeps the ground floor (level 1) as a lobby-only concourse", () => {
    // Even a plain (non-lobby) floor tile on level 1 rejects rooms — the whole
    // ground floor is the entrance concourse, never a room floor.
    for (let i = 0; i < 20; i++) tower.place("floor", 1, i);
    expect(tower.canPlace("office", 1, 0).ok).toBe(false);
    expect(tower.canPlace("shop", 1, 0).ok).toBe(false);
    // A two-story facility starting on the ground floor is rejected too.
    for (let i = 0; i < 20; i++) tower.place("floor", 2, i);
    expect(tower.canPlace("cinema", 1, 0).ok).toBe(false);
    // Rooms are fine one floor up.
    expect(tower.canPlace("office", 2, 0).ok).toBe(true);
  });

  it("allows only commercial/service facilities underground", () => {
    for (let i = 0; i < 40; i++) tower.place("lobby", 1, i);
    for (let f = 0; f >= -1; f--) for (let i = 0; i < 40; i++) tower.place("floor", f, i);
    // Offices, condos and hotels need daylight — blocked in the basement…
    expect(tower.canPlace("office", 0, 0).ok).toBe(false);
    expect(tower.canPlace("condo", 0, 0).ok).toBe(false);
    expect(tower.canPlace("hotelSingle", 0, 0).ok).toBe(false);
    // …but shops and fast food are welcome down there.
    expect(tower.canPlace("shop", 0, 0).ok).toBe(true);
    expect(tower.canPlace("fastFood", 0, 0).ok).toBe(true);
  });
});

describe("Tower transport", () => {
  let tower: Tower;
  beforeEach(() => {
    tower = new Tower();
    for (let i = 0; i < 40; i++) tower.place("lobby", 1, i);
    // Transports may only run through built floors, so raise structure first.
    for (let f = 2; f <= 30; f++) for (let i = 0; i < 40; i++) tower.place("floor", f, i);
  });

  it("rejects a shaft that runs outside the built structure", () => {
    // Floor 50 has no structure → an elevator reaching it is invalid.
    expect(tower.placeTransport("elevatorStandard", 4, 1, 50).ok).toBe(false);
    // A floating stair on bare floors above the build is rejected too.
    const t2 = new Tower();
    for (let i = 0; i < 10; i++) t2.place("lobby", 1, i);
    expect(t2.placeTransport("elevatorStandard", 4, 1, 10).ok).toBe(false);
  });

  it("places an elevator and allocates cars", () => {
    const res = tower.placeTransport("elevatorStandard", 4, 1, 20);
    expect(res.ok).toBe(true);
    const t = tower.transports[0];
    expect(t.cars).toBeGreaterThan(0);
    expect(t.carPositions.length).toBe(t.cars);
  });

  it("limits stairs to a single floor span", () => {
    expect(tower.placeTransport("stairs", 8, 1, 5).ok).toBe(false);
    expect(tower.placeTransport("stairs", 8, 1, 2).ok).toBe(true);
  });

  it("prevents overlapping shafts", () => {
    tower.placeTransport("elevatorStandard", 4, 1, 10);
    expect(tower.placeTransport("elevatorStandard", 4, 1, 10).ok).toBe(false);
    expect(tower.placeTransport("elevatorStandard", 12, 1, 10).ok).toBe(true);
  });

  it("computes floor reachability through linked transports", () => {
    // Elevator from ground to 15, then another from 15 to 30.
    tower.placeTransport("elevatorStandard", 4, 1, 15);
    expect(tower.isFloorServed(10)).toBe(true);
    expect(tower.isFloorServed(25)).toBe(false);
    tower.placeTransport("elevatorStandard", 12, 15, 30);
    expect(tower.isFloorServed(25)).toBe(true);
    // A disconnected floor stays unserved.
    expect(tower.isFloorServed(50)).toBe(false);
  });
});

describe("Express elevator sky-lobby stops", () => {
  const W = 20;

  /** A shaft-ready tower: ground lobby, floors 2..top, with `lobbyFloors` laid as
   *  (sky) lobbies instead of plain floors. */
  function tower(top: number, lobbyFloors: number[] = []): Tower {
    const t = new Tower();
    for (let x = 0; x < W; x++) t.place("lobby", 1, x);
    for (let f = 2; f <= top; f++) {
      const kind = lobbyFloors.includes(f) ? "lobby" : "floor";
      for (let x = 0; x < W; x++) t.place(kind, f, x);
    }
    return t;
  }
  /** Turn an existing plain-floor story into a sky lobby (clear it, lay lobby). */
  function makeSkyLobby(t: Tower, floor: number): void {
    for (let x = 0; x < W; x++) {
      const u = t.unitAt(floor, x);
      if (u) t.removeUnit(u.id);
    }
    for (let x = 0; x < W; x++) t.place("lobby", floor, x);
  }
  function express(t: Tower, bottom: number, top: number): Transport {
    const r = t.placeTransport("elevatorExpress", 2, bottom, top);
    return t.transports.find((x) => x.id === r.transportId)!;
  }

  it("a freshly placed express stops at its endpoints and existing sky lobbies only", () => {
    const t = tower(30, [15]);
    const ex = express(t, 1, 30);
    expect(t.stopsAt(ex, 1)).toBe(true); // bottom endpoint
    expect(t.stopsAt(ex, 30)).toBe(true); // top endpoint
    expect(t.stopsAt(ex, 15)).toBe(true); // sky lobby
    expect(t.stopsAt(ex, 10)).toBe(false); // ordinary floor is skipped
    expect(t.stopsAt(ex, 20)).toBe(false);
  });

  it("serves a sky lobby built AFTER the express (build order doesn't matter)", () => {
    const t = tower(30); // floor 15 is a plain floor for now
    const ex = express(t, 1, 30);
    expect(t.stopsAt(ex, 15)).toBe(false); // not a lobby yet → skipped
    makeSkyLobby(t, 15);
    expect(t.stopsAt(ex, 15)).toBe(true); // the express now serves the new sky lobby
  });

  it("stops serving a sky lobby once it is bulldozed", () => {
    const t = tower(30, [15]);
    const ex = express(t, 1, 30);
    expect(t.stopsAt(ex, 15)).toBe(true);
    for (let x = 0; x < W; x++) {
      const u = t.unitAt(15, x);
      if (u) t.removeUnit(u.id);
    }
    expect(t.floorHasLobby(15)).toBe(false);
    expect(t.stopsAt(ex, 15)).toBe(false); // no longer a lobby → skipped again
  });

  it("only re-syncs the changed floor, preserving manual stops elsewhere", () => {
    const t = tower(30); // all plain floors between endpoints
    const ex = express(t, 1, 30);
    t.setStop(ex.id, 10, true); // player forces a stop at a non-lobby floor
    expect(t.stopsAt(ex, 10)).toBe(true);
    makeSkyLobby(t, 15); // build a sky lobby elsewhere
    expect(t.stopsAt(ex, 15)).toBe(true); // new lobby served
    expect(t.stopsAt(ex, 10)).toBe(true); // manual stop untouched
  });

  it("leaves non-express elevators alone", () => {
    const t = tower(30);
    const r = t.placeTransport("elevatorStandard", 2, 1, 30);
    const std = t.transports.find((x) => x.id === r.transportId)!;
    makeSkyLobby(t, 15);
    // A standard elevator stops everywhere; the sync must not add skips to it.
    expect(std.skipFloors ?? []).toEqual([]);
    expect(t.stopsAt(std, 10)).toBe(true);
  });

  it("only touches expresses that actually span the changed floor", () => {
    const t = tower(30);
    const low = express(t, 1, 12); // does NOT span floor 15
    makeSkyLobby(t, 15);
    expect((low.skipFloors ?? []).includes(15)).toBe(false); // untouched (out of range)
  });

  it("preserves manual stops on other floors when a sky lobby is REMOVED", () => {
    // Mirror of the "manual stops preserved" test — this time the trigger is a
    // lobby *removal*. Only the floor whose lobby-ness flipped is touched.
    const t = tower(30, [15]);
    const ex = express(t, 1, 30);
    t.setStop(ex.id, 20, true); // player forces a stop at a non-lobby floor
    // Bulldoze the sky lobby at 15.
    for (let x = 0; x < W; x++) {
      const u = t.unitAt(15, x);
      if (u) t.removeUnit(u.id);
    }
    expect(t.stopsAt(ex, 15)).toBe(false); // 15 no longer served
    expect(t.stopsAt(ex, 20)).toBe(true); // manual stop still honoured
  });

  it("never adds an endpoint to skipFloors on a lobby flip AT the endpoint", () => {
    // A sky lobby laid at (and later removed from) an express's top endpoint
    // must never be added to skipFloors — endpoints are always stops.
    const t = tower(30);
    const ex = express(t, 5, 15); // top endpoint is exactly at 15
    makeSkyLobby(t, 15);
    expect((ex.skipFloors ?? []).includes(15)).toBe(false);
    expect(t.stopsAt(ex, 15)).toBe(true);
    // Remove the lobby at the endpoint. It must remain a stop, not become a skip.
    for (let x = 0; x < W; x++) {
      const u = t.unitAt(15, x);
      if (u) t.removeUnit(u.id);
    }
    expect((ex.skipFloors ?? []).includes(15)).toBe(false);
    expect(t.stopsAt(ex, 15)).toBe(true);
  });

  it("resize: shrinking a bottom endpoint onto a skipped floor drops the skip", () => {
    // A common build-order gap the sync must close: resize shrinks bottom from
    // 1 to 3; 3 was previously in skipFloors (non-lobby), so without a sync the
    // new endpoint would refuse to stop and disconnect the shaft.
    const t = tower(30, [15]);
    const ex = express(t, 1, 30); // seeds skipFloors 2..14, 16..29
    expect((ex.skipFloors ?? []).includes(3)).toBe(true);
    const r = t.resizeTransport(ex.id, 3, 30);
    expect(r.ok).toBe(true);
    expect((ex.skipFloors ?? []).includes(3)).toBe(false);
    expect(t.stopsAt(ex, 3)).toBe(true); // new endpoint now stops
  });

  it("resize: growing an express doesn't turn it into a local elevator", () => {
    // Place an express spanning only 1..12 (skipFloors = [2..11]), build a sky
    // lobby at 15, then drag the top up to 30. Non-lobby floors above 12 must
    // become new skips — not free stops.
    const t = tower(30, [15]);
    const ex = express(t, 1, 12);
    const r = t.resizeTransport(ex.id, 1, 30);
    expect(r.ok).toBe(true);
    // Sky lobby served, ordinary floors above the old span are skipped.
    expect(t.stopsAt(ex, 15)).toBe(true);
    expect(t.stopsAt(ex, 20)).toBe(false);
    expect(t.stopsAt(ex, 25)).toBe(false);
    // Old top endpoint (12), no longer an endpoint, is now a plain in-span
    // non-lobby floor — its previous stop status is preserved (it was NOT in
    // skipFloors, so it stays as a stop). That's fine: the invariant only asks
    // that newly-in-span non-lobby floors get skipped.
  });

  it("resize: shrinking prunes skipFloors that fall outside the new span", () => {
    // Otherwise the model carries ghost skips: skipsCount inflates, and
    // render signatures churn on floors the shaft no longer touches.
    const t = tower(30, [15]);
    const ex = express(t, 1, 30); // seeds skipFloors 2..14, 16..29
    expect((ex.skipFloors ?? []).some((f) => f >= 20)).toBe(true);
    const r = t.resizeTransport(ex.id, 1, 16);
    expect(r.ok).toBe(true);
    // Every remaining skip is strictly inside (newBottom, newTop) = (1, 16).
    for (const f of ex.skipFloors ?? []) {
      expect(f).toBeGreaterThan(1);
      expect(f).toBeLessThan(16);
    }
    // And the newly-shrunk endpoint is not skipped.
    expect(t.stopsAt(ex, 16)).toBe(true);
  });

  it("resize preserves manual stops the player set inside the old span", () => {
    const t = tower(30, [15]);
    const ex = express(t, 1, 12); // skipFloors seeded 2..11
    t.setStop(ex.id, 8, true); // player wants a stop at 8
    expect((ex.skipFloors ?? []).includes(8)).toBe(false);
    // Grow the express upward.
    t.resizeTransport(ex.id, 1, 30);
    // Player's stop at 8 (in the OLD span) is untouched.
    expect((ex.skipFloors ?? []).includes(8)).toBe(false);
    expect(t.stopsAt(ex, 8)).toBe(true);
  });

  it("setStop refuses to skip an endpoint (they must always stop)", () => {
    // Guard against the shaft disconnecting from itself — a player toggling the
    // bottom or top off must be a no-op, matching the UI copy ("top and bottom
    // stay connected") and the assumption the express-sync logic makes. The
    // return value stays `true` (the request was valid), consistent with the
    // rest of setStop.
    const t = tower(30);
    const ex = express(t, 1, 30);
    expect(t.setStop(ex.id, 1, false)).toBe(true);
    expect(t.setStop(ex.id, 30, false)).toBe(true);
    expect(t.stopsAt(ex, 1)).toBe(true);
    expect(t.stopsAt(ex, 30)).toBe(true);
    expect((ex.skipFloors ?? []).includes(1)).toBe(false);
    expect((ex.skipFloors ?? []).includes(30)).toBe(false);
  });

  it("reindex preserves a player's explicit skip of a sky lobby", () => {
    // A player who deliberately set setStop(id, 15, false) on a sky-lobby floor
    // expects that skip to survive save/load — reindex must not blanket-resync.
    const t = tower(30, [15]);
    const ex = express(t, 1, 30);
    t.setStop(ex.id, 15, false); // player says "skip this sky lobby"
    expect(t.stopsAt(ex, 15)).toBe(false);
    t.reindex();
    expect(t.stopsAt(ex, 15)).toBe(false); // still skipped after load
  });
});
