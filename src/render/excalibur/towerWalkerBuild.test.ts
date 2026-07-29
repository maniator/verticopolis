import { describe, it, expect, vi } from "vitest";
import * as ex from "excalibur";
import { Tower } from "../../engine/Tower";
import { landingSegs, segAt } from "../../engine/tower/segments";
import { buildWalkers, landingTile } from "./towerWalkerBuild";

/**
 * Construction of the ambient walker population. This path allocates `ex.Actor`s
 * and reads the tower layout, but bakes no `ex.Canvas` of its own (it hands out
 * the already-baked `engine.personGfx`), so unlike `syncMotion` it runs fine
 * under happy-dom.
 *
 * What matters here is the POSITION each figure reports for the reachability
 * gate, since `updateMotion` next door can only be as right as the spot it is
 * handed. The gating itself is pinned in `towerCrowd.test.ts`.
 */

const gfx = () => ({ width: 9, height: 25 }) as ex.Graphic;

/** A fake engine with a tower built from an explicit set of structural tiles. */
function eng(over: { tiles?: string[]; transports?: any[]; units?: any[] } = {}): any {
  const structure = new Set(over.tiles ?? []);
  return {
    engine: { add: vi.fn() },
    walkers: [],
    personGfx: [gfx(), gfx(), gfx()],
    worldX: (tile: number) => tile * 11,
    worldYTop: (floor: number) => -floor * 36,
    sim: {
      tower: {
        revision: 1,
        units: over.units ?? [],
        transports: over.transports ?? [],
        hasStructure: (f: number, x: number) => structure.has(`${f}:${x}`),
      },
    },
  };
}

const stairs = (o: Record<string, unknown> = {}) => ({ id: 1, kind: "stairs", x: 10, width: 8, bottom: 15, top: 16, ...o });

describe("climbers report the tile their flight actually lands on (#665)", () => {
  it("skips footprint columns that hang over a gap", () => {
    // A transport only needs SOME tile under its footprint to be structural, so
    // on a gap-split floor a stair may legally sit with its leftmost columns
    // over the void. Reporting `t.x` there would probe a tile on no run at all,
    // and the gate would hide the climbers on a perfectly usable flight.
    const e = eng({
      tiles: ["15:15", "15:16", "15:17", "16:15", "16:16", "16:17"],
      transports: [stairs()], // x 10..17, but only 15..17 are real
    });
    buildWalkers(e);
    expect(e.walkers.length).toBeGreaterThan(0);
    for (const w of e.walkers) {
      expect(w.tileX).toBe(15);
      expect(w.altTileX).toBe(15);
    }
  });

  it("uses the flight's own tile when the whole footprint is structural", () => {
    const tiles: string[] = [];
    for (let x = 10; x < 18; x++) tiles.push(`15:${x}`, `16:${x}`);
    const e = eng({ tiles, transports: [stairs()] });
    buildWalkers(e);
    expect(e.walkers[0].tileX).toBe(10);
  });

  it("carries both landings, and they can differ per floor", () => {
    // The two ends need not land on the same column: the bottom floor's run may
    // start further right than the top's.
    const e = eng({
      tiles: ["15:16", "15:17", "16:11", "16:12", "16:13"],
      transports: [stairs()],
    });
    buildWalkers(e);
    const w = e.walkers[0];
    expect(w.floor).toBe(15);
    expect(w.tileX).toBe(16);
    expect(w.altFloor).toBe(16);
    expect(w.altTileX).toBe(11);
  });

  it("falls back to the flight's tile when no column is structural", () => {
    // Same fallback the router's `landingSeg` takes, so the two never disagree.
    const e = eng({ tiles: [], transports: [stairs()] });
    buildWalkers(e);
    expect(e.walkers[0].tileX).toBe(10);
    expect(e.walkers[0].altTileX).toBe(10);
  });

  it("only builds climbers for stairs and escalators", () => {
    const e = eng({
      tiles: ["15:10", "16:10"],
      transports: [stairs({ id: 2, kind: "elevatorStandard" })],
    });
    buildWalkers(e);
    expect(e.walkers).toEqual([]);
  });
});

describe("landingTile agrees with the router's landingSegs (#674)", () => {
  // `landingTile` is a second copy of the router's rule living in the render
  // layer. The fixtures above check it against hand-written tile sets, which
  // cannot catch the two drifting apart. These run BOTH against a real `Tower`
  // and assert they resolve to the same segment, so a change to either one is a
  // red test rather than a visual regression nobody notices.
  //
  // This matters for #662, now fixed: the router's rule became `landingSegs`,
  // returning EVERY run an overlapping footprint straddles (not just the first).
  // `landingTile` still reports the first structural column, and that stays
  // correct because the fix links all straddled runs into one connected component
  // (all reachable or all stranded together), so the leftmost run `landingTile`
  // picks is `landingSegs[0]` and is reachable exactly when the flight is usable.
  // The parity below pins `segAt(landingTile) === landingSegs[0]`.

  /** Lobby across floor 1, floor tiles on 2 only from `gapEnd`, stair at x=10. */
  function splitTower(gapEnd: number): Tower {
    const tower = new Tower();
    for (let x = 6; x < 30; x++) tower.place("lobby", 1, x);
    for (let x = gapEnd; x < 26; x++) tower.place("floor", 2, x);
    tower.placeTransport("stairs", 10, 1, 2);
    return tower;
  }

  const parity = (tower: Tower) => {
    const t = tower.transports[0];
    expect(t, "the fixture must actually place a stair").toBeTruthy();
    for (const floor of [t.bottom, t.top]) {
      expect(
        segAt(tower, floor, landingTile(tower, t, floor)),
        `landingTile disagrees with landingSegs[0] on floor ${floor}`,
      ).toBe(landingSegs(tower, t, floor)[0]);
    }
    return t;
  };

  it("agrees when the flight overhangs a gap", () => {
    // The stair's footprint is 10..17 but floor 2 only exists from 15, which
    // placement allows (only SOME tile under the footprint must be structural).
    const tower = splitTower(15);
    expect(tower.hasStructure(2, 10)).toBe(false);
    expect(tower.hasStructure(2, 15)).toBe(true);
    const t = parity(tower);
    // And prove the naive probe really would have differed, so this test cannot
    // pass by the scenario quietly ceasing to be a divergence.
    expect(segAt(tower, 2, t.x)).not.toBe(landingSegs(tower, t, 2)[0]);
    expect(landingTile(tower, t, 2)).toBe(15);
  });

  it("agrees when the whole footprint is structural", () => {
    const tower = splitTower(10);
    parity(tower);
    expect(landingTile(tower, tower.transports[0], 2)).toBe(10);
  });

  it("agrees when the footprint straddles TWO runs, which is the #662 shape", () => {
    // This is the case that makes the parity assertion earn its place. Within a
    // single run any column resolves to the same segment, so picking a different
    // tile there is not a divergence. Two runs under one footprint is where the
    // choice of column becomes a choice of SEGMENT, and it is exactly the shape
    // #662 is about: `landingSegs` now links every straddled run, and `landingTile`
    // stays pinned to the leftmost one (`landingSegs[0]`), which the fix keeps
    // reachable exactly when the flight is usable.
    const tower = new Tower();
    for (let x = 6; x < 30; x++) tower.place("lobby", 1, x);
    for (let x = 10; x < 12; x++) tower.place("floor", 2, x); // run A, under the footprint
    for (let x = 15; x < 26; x++) tower.place("floor", 2, x); // run B, also under it
    tower.placeTransport("stairs", 10, 1, 2);
    // Two genuinely distinct segments sit under the 10..17 span.
    expect(segAt(tower, 2, 10)).not.toBe(segAt(tower, 2, 15));
    parity(tower);
  });

  it("cannot be asked about a flight with no structural column, because placement refuses one", () => {
    // Both sides carry a `t.x` fallback for a fully unstructured footprint, and
    // both are unreachable in a real tower: `validateTransport` requires SOME
    // tile under the span. Pinning the refusal says why the fallback stays
    // defensive, so nobody reads the fake-fixture case above as a live path.
    const tower = new Tower();
    for (let x = 6; x < 30; x++) tower.place("lobby", 1, x);
    for (let x = 20; x < 26; x++) tower.place("floor", 2, x); // clear of the 10..17 span
    expect(tower.placeTransport("stairs", 10, 1, 2).ok).toBe(false);
    expect(tower.transports).toEqual([]);
  });
});

describe("floor and lobby figures stand on one spot", () => {
  it("repeats the run origin as both endpoints", () => {
    // Every non-climber reports the same spot twice, which is what lets the gate
    // charge them a single reachability probe.
    const units = [];
    for (let x = 4; x < 40; x++) units.push({ kind: "lobby", floor: 3, x, width: 1 });
    const e = eng({ units });
    buildWalkers(e);
    expect(e.walkers.length).toBeGreaterThan(0);
    for (const w of e.walkers) {
      expect(w.altFloor).toBe(w.floor);
      expect(w.altTileX).toBe(w.tileX);
      expect(w.tileX).toBe(4); // the run's origin tile
    }
  });
});
