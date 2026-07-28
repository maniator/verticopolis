import { describe, it, expect, vi } from "vitest";
import * as ex from "excalibur";
import { buildWalkers } from "./towerWalkerBuild";

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
