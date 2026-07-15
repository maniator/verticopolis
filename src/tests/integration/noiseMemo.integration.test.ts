import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { noiseAfflictedFresh } from "../../engine/sim/satisfaction";
import { OFFICE_NOISE_TILES, HOTEL_NOISE_TILES } from "../../engine/sim/constants";
import { towerStateSig } from "../../engine/UndoHistory";
import { lay, layTile, mustBuild, placeUnit as place } from "../fixtures/towerFixtures";

/**
 * The noise memo's contract (spec-onhour-boundary-cost): `sim.noiseAfflicted`
 * is a lazy revision-keyed memo over `noiseAfflictedFresh`, so the two must
 * agree for every sensitive unit after EVERY mutation kind, unit state must
 * never be an input (the src/engine/tower/routing.ts functionalParkingSet
 * precedent), every layout mutator must bump tower.revision (the invalidation
 * edge the memo trusts), and the memo must never leak into saves or the undo
 * fingerprint. Construction helpers (lay/placeUnit/mustBuild) live in
 * ../fixtures/towerFixtures and assert their own success.
 */

/** Full-width lobby + floors 2..top, one standard elevator, rich and starred. */
function servedTower(top: number): Simulation {
  const sim = Simulation.newGame(7);
  sim.money = 1e12;
  sim.star = 5;
  lay(sim, "lobby", 1);
  for (let f = 2; f <= top; f++) lay(sim, "floor", f);
  mustBuild(sim, "elevatorStandard", 3, 1, top);
  return sim;
}

/** Every unit agrees between the memoized and fresh paths (non-sensitive
 *  kinds parity-check trivially, both paths return false for them). */
function assertParity(sim: Simulation): void {
  for (const u of sim.tower.units) {
    expect(sim.noiseAfflicted(u)).toBe(noiseAfflictedFresh(sim, u));
  }
}

describe("noise memo === fresh scan (differential)", () => {
  it("agrees across placements, demolitions, and the multi-story cinema source", () => {
    const sim = servedTower(6);
    const office = place(sim, "office", 3, 40);
    assertParity(sim);
    expect(sim.noiseAfflicted(office)).toBe(false);

    // Shared wall (distance 0): the harshest in-band case.
    const food = place(sim, "fastFood", 3, 40 + office.width);
    assertParity(sim);
    expect(sim.noiseAfflicted(office)).toBe(true);

    // Demolition heals it with no manual invalidation: removeUnit bumps
    // revision and the next query refills from the fresh scan.
    sim.tower.removeUnit(food.id);
    assertParity(sim);
    expect(sim.noiseAfflicted(office)).toBe(false);

    // The cinema is a 2-story commercial source: its UPPER story radiates on
    // that floor too (register maps both stories into rooms). An office on
    // the floor above the cinema's base, within the 11-tile band, must be
    // afflicted through the upper story.
    const cinema = place(sim, "cinema", 4, 100);
    const upstairs = place(sim, "office", 5, 100 + cinema.width + 3);
    assertParity(sim);
    expect(sim.noiseAfflicted(upstairs)).toBe(true);
    sim.tower.removeUnit(cinema.id);
    assertParity(sim);
    expect(sim.noiseAfflicted(upstairs)).toBe(false);
  });

  it("pins the band edges, the lobby shield, and the open-air gap through the memo", () => {
    const sim = servedTower(4);
    // Exact edge: the scan probes d = 0..maxTiles from the footprint edge, so
    // a source AT the band edge afflicts and one tile past it does not.
    const atEdge = place(sim, "office", 2, 40);
    place(sim, "fastFood", 2, 40 + atEdge.width + OFFICE_NOISE_TILES);
    const pastEdge = place(sim, "office", 3, 40);
    place(sim, "fastFood", 3, 40 + pastEdge.width + OFFICE_NOISE_TILES + 1);
    assertParity(sim);
    expect(sim.noiseAfflicted(atEdge)).toBe(true);
    expect(sim.noiseAfflicted(pastEdge)).toBe(false);

    // Hotel band (21) hears an office that an office band (11) would not.
    const hotel = place(sim, "hotelSingle", 4, 40);
    place(sim, "office", 4, 40 + hotel.width + HOTEL_NOISE_TILES);
    assertParity(sim);
    expect(sim.noiseAfflicted(hotel)).toBe(true);

    // Open-air gap: noise travels along built floor, so an unbuilt span
    // between source and room breaks it even inside the band.
    const sim2 = Simulation.newGame(9);
    sim2.money = 1e12;
    sim2.star = 5;
    lay(sim2, "lobby", 1);
    lay(sim2, "floor", 2);
    // No shaft: noiseAfflicted is service-independent, so this scenario only
    // needs the floor topology, not a served tower.
    // Office tiles 40..48, so the rightward scan starts at 49; the gap at
    // 52..54 breaks the run, and the fastFood at 56 sits 7 tiles out, well
    // inside the 11-tile band once the gap is floored over.
    for (let x = 40; x <= 51; x++) layTile(sim2, "floor", 3, x);
    for (let x = 55; x <= 75; x++) layTile(sim2, "floor", 3, x);
    const island = place(sim2, "office", 3, 40);
    place(sim2, "fastFood", 3, 56);
    assertParity(sim2);
    expect(sim2.noiseAfflicted(island)).toBe(false);
    // Fill the gap and the same source bites: the memo refills on the bump.
    for (let x = 52; x <= 54; x++) layTile(sim2, "floor", 3, x);
    assertParity(sim2);
    expect(sim2.noiseAfflicted(island)).toBe(true);
  });

  it("shields through a mid-floor lobby tile (legacy mixed floor via save load), and the memo agrees", () => {
    // A lobby tile between a source and a sensitive room on the same story
    // cancels the noise, and the scan breaks on it BEFORE the source check.
    // Sky-lobby canon makes that config unreachable through placement (a
    // claimed lobby floor refuses rooms), so it only arises from a pre-v1.16
    // save: build the floor solid, flip one mid-gap floor tile to a lobby in
    // the serialized units, and load it back the way such a save would.
    const build = (shield: boolean): { sim: Simulation; officeId: number } => {
      const base = Simulation.newGame(11);
      base.money = 1e12;
      base.star = 5;
      lay(base, "lobby", 1);
      for (let x = 40; x <= 75; x++) layTile(base, "floor", 2, x);
      const office = place(base, "office", 2, 40);
      // Source seven tiles past the office's right edge, well inside the band.
      const sourceX = 40 + office.width + 7;
      place(base, "fastFood", 2, sourceX);
      const shieldX = 40 + office.width + 2; // a floor tile between the two
      const save = base.serialize();
      if (shield) {
        const tile = save.units.find((u) => u.kind === "floor" && u.floor === 2 && u.x === shieldX);
        if (!tile) throw new Error("shield tile not found");
        tile.kind = "lobby";
      }
      const sim = Simulation.deserialize(save);
      return { sim, officeId: office.id };
    };

    const shielded = build(true);
    const office = shielded.sim.tower.units.find((u) => u.id === shielded.officeId);
    if (!office) throw new Error("office lost in round-trip");
    expect(shielded.sim.tower.structureKindAt(2, 40 + office.width + 2)).toBe("lobby");
    assertParity(shielded.sim);
    expect(shielded.sim.noiseAfflicted(office)).toBe(false);

    // Same layout without the interposed lobby: the source bites, proving the
    // lobby tile is what shields (not the geometry).
    const open = build(false);
    const office2 = open.sim.tower.units.find((u) => u.id === open.officeId);
    if (!office2) throw new Error("office lost in round-trip");
    assertParity(open.sim);
    expect(open.sim.noiseAfflicted(office2)).toBe(true);
  });

  it("stays state-blind: fire, gutting, and occupancy changes leave memo === fresh with no revision bump", () => {
    const sim = servedTower(3);
    const office = place(sim, "office", 2, 40);
    const food = place(sim, "fastFood", 2, 40 + office.width + 2);
    expect(sim.noiseAfflicted(office)).toBe(true);
    const rev = sim.tower.revision;

    // A gutted or emptied source still radiates by kind (canon behavior the
    // memo must preserve); none of these mutations bumps revision, and the
    // memo stays correct BECAUSE the predicate never reads state.
    for (const state of ["gutted", "fire", "empty", "occupied"] as const) {
      food.state = state;
      food.occupants = state === "occupied" ? 5 : 0;
      expect(sim.tower.revision).toBe(rev);
      assertParity(sim);
      expect(sim.noiseAfflicted(office)).toBe(true);
    }
    office.state = "vacating";
    assertParity(sim);
  });

  it("bumps tower.revision on every layout mutator (the memo's invalidation edge)", () => {
    const sim = servedTower(8);
    const t = sim.tower;
    const bumped = (label: string, fn: () => unknown): void => {
      const before = t.revision;
      fn();
      expect(t.revision, label).toBeGreaterThan(before);
    };
    // Assert the mutator actually placed and returned a real id, so a failed
    // placement fails the test on the real breach instead of silently
    // mutating id 0 through a `?? 0` fallback.
    const placeId = (kind: Parameters<typeof t.place>[0], floor: number, x: number): number => {
      const r = t.place(kind, floor, x);
      if (!r.ok || r.unitId === undefined) throw new Error(`place ${kind} at ${floor},${x} failed: ${r.reason ?? "no id"}`);
      return r.unitId;
    };
    const buildId = (kind: Parameters<typeof t.placeTransport>[0], x: number, bottom: number, top: number): number => {
      const r = t.placeTransport(kind, x, bottom, top);
      if (!r.ok || r.transportId === undefined) throw new Error(`placeTransport ${kind} at ${x} failed: ${r.reason ?? "no id"}`);
      return r.transportId;
    };

    let officeId = 0;
    bumped("place", () => (officeId = placeId("office", 2, 60)));
    bumped("removeUnit", () => t.removeUnit(officeId));
    let shaftId = 0;
    bumped("placeTransport", () => (shaftId = buildId("elevatorStandard", 30, 1, 6)));
    bumped("resizeTransport", () => t.resizeTransport(shaftId, 1, 8));
    bumped("setCars", () => t.setCars(shaftId, 3));
    bumped("setStop", () => t.setStop(shaftId, 4, false));
    bumped("clearStops", () => t.clearStops(shaftId));
    bumped("removeTransport", () => t.removeTransport(shaftId));
    let expressId = 0;
    bumped("placeTransport(express)", () => (expressId = buildId("elevatorExpress", 50, 1, 8)));
    bumped("setExpressStops", () => t.setExpressStops(expressId));
    bumped("coerceExpressStops", () => {
      // Corrupt an express stop the way a forged save would (skipFloors is
      // rewritten directly by import), then let the coercer repair it: the
      // repair is a layout change and must bump.
      const tr = t.transports.find((x) => x.id === expressId);
      if (!tr) throw new Error("express missing");
      // Corrupt an express stop the way a forged save would (import rewrites
      // skipFloors directly): un-skip an actual skipped non-lobby floor picked
      // from the current contents (not a hard-coded floor that a future stop
      // pattern might not skip), then the coercer repairs it, and the repair is
      // a layout change that must bump. Assert the corruption really changed
      // skipFloors so this can never silently degrade into a no-op.
      const lobbies = new Set(t.lobbyFloors());
      const victim = (tr.skipFloors ?? []).find((f) => !lobbies.has(f));
      if (victim === undefined) throw new Error("express had no non-lobby skipped floor to corrupt");
      const beforeLen = (tr.skipFloors ?? []).length;
      tr.skipFloors = (tr.skipFloors ?? []).filter((f) => f !== victim);
      if ((tr.skipFloors ?? []).length === beforeLen) throw new Error("express-stop corruption was a no-op");
      t.coerceExpressStops();
    });
    bumped("reindex", () => t.reindex());
  });

  it("never serializes the memo and leaves the undo fingerprint blind to cache state", () => {
    const sim = servedTower(3);
    const office = place(sim, "office", 2, 40);
    place(sim, "fastFood", 2, 40 + office.width);

    const coldSig = towerStateSig(sim.tower, sim.money);
    const coldJson = JSON.stringify(sim.serialize());
    sim.noiseAfflicted(office); // warm the memo
    expect(sim.noiseMemo.size).toBeGreaterThan(0);
    expect(towerStateSig(sim.tower, sim.money)).toBe(coldSig);
    const warmJson = JSON.stringify(sim.serialize());
    expect(warmJson).toBe(coldJson);
    expect(warmJson).not.toContain("noiseMemo");

    // A load builds a fresh Simulation: the memo starts cold and refills to
    // the same verdicts.
    const restored = Simulation.deserialize(sim.serialize());
    expect(restored.noiseMemo.size).toBe(0);
    const twin = restored.tower.units.find((u) => u.id === office.id);
    if (!twin) throw new Error("office lost in round-trip");
    expect(restored.noiseAfflicted(twin)).toBe(true);
    assertParity(restored);
  });

  it("vacateCause's farWalk/noisy fallback (callers outside the sweep) equals the explicit-flag result", () => {
    // The sweep passes the flags it already computed; a caller that omits them
    // (the 3-arg form) recomputes through the same predicates. Pin that the
    // fallback and the explicit path agree, so a future edit to either can't
    // silently drift the attribution.
    const sim = servedTower(2);
    const office = place(sim, "office", 2, 40);
    place(sim, "fastFood", 2, 40 + office.width); // noise source, no far-walk
    office.state = "occupied";

    // served=true, uncongested: the only remaining office sink is noise, so
    // both the recompute fallback and the explicit noisy=true must say "noise".
    expect(sim.vacateCause(office, true, 0)).toBe("noise");
    expect(sim.vacateCause(office, true, 0, false, true)).toBe("noise");
    // And a served office near its shaft with no source in band bottoms out
    // only via "access": the fallback recomputes farWalk=false and noisy=false
    // and agrees with the explicit false/false. (x=12 sits a few tiles from
    // the shaft at cols [3,7), well inside the 79-tile walk tolerance.)
    const quiet = place(sim, "office", 2, 12);
    expect(sim.vacateCause(quiet, true, 0)).toBe("access");
    expect(sim.vacateCause(quiet, true, 0, false, false)).toBe("access");
  });
});
