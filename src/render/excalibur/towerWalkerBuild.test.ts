import { describe, it, expect, vi } from "vitest";
import * as ex from "excalibur";
import { buildWalkers, PASSERS_BUDGET, PASSERS_PER_RUN_CAP } from "./towerWalkerBuild";
import { ELEVATOR_LANDING_TILES, SHOP_FRONT_TILES } from "./towerCrowdLayout";

/**
 * Construction of the decorative passers-by (#2091). This path allocates
 * `ex.Actor`s and reads the tower layout, but bakes no `ex.Canvas` of its own
 * (it hands out the already-baked `engine.personGfx`), so it runs under
 * happy-dom. The catalog comes from the test fallback, so `mode` picks the
 * Classic or Modern rule.
 */

const TILE = 11;
const gfx = () => ({ width: 9, height: 25 }) as ex.Graphic;

function eng(mode: "classic" | "modern", over: { transports?: any[]; units?: any[] } = {}): any {
  return {
    engine: { add: vi.fn() },
    walkers: [],
    people: { get: vi.fn((_key: number) => gfx()) },
    worldX: (tile: number) => tile * TILE,
    worldYTop: (floor: number) => -floor * 36,
    sim: { mode, tower: { revision: 1, units: over.units ?? [], transports: over.transports ?? [] } },
  };
}

/** One bare corridor lot per tile from `x0` up to (not including) `x1`. */
function corridor(floor: number, x0: number, x1: number, kind = "floor") {
  const out = [];
  for (let x = x0; x < x1; x++) out.push({ kind, floor, x, width: 1 });
  return out;
}

/** The tile span a walker may pace over, rounded out to whole tiles. */
const tiles = (w: { x0w: number; x1w: number }) => [Math.floor(w.x0w / TILE), Math.floor(w.x1w / TILE)];

describe("which towers get decorative passers-by", () => {
  it("builds none in Classic, even on a long corridor", () => {
    const e = eng("classic", { units: corridor(3, 0, 100) });
    buildWalkers(e);
    expect(e.walkers).toEqual([]);
    expect(e.engine.add).not.toHaveBeenCalled();
  });

  it("builds them in a Modern corridor", () => {
    const e = eng("modern", { units: corridor(3, 0, 100) });
    buildWalkers(e);
    expect(e.walkers.length).toBe(PASSERS_PER_RUN_CAP);
    for (const w of e.walkers) expect(w.floor).toBe(3);
  });

  it("puts none in a lobby, however long", () => {
    const e = eng("modern", { units: corridor(1, 0, 100, "lobby") });
    buildWalkers(e);
    expect(e.walkers).toEqual([]);
  });

  it("puts none on a stair or escalator", () => {
    const e = eng("modern", {
      transports: [
        { id: 1, kind: "stairs", x: 10, width: 8, bottom: 4, top: 5 },
        { id: 2, kind: "escalator", x: 40, width: 8, bottom: 4, top: 5 },
      ],
    });
    buildWalkers(e);
    expect(e.walkers).toEqual([]);
  });
});

describe("passers-by keep off the lots where a player reads traffic", () => {
  it("stays clear of an elevator landing on every floor the shaft serves", () => {
    const shaft = { id: 1, kind: "elevatorStandard", x: 50, width: 4, bottom: 2, top: 4 };
    const e = eng("modern", { units: [...corridor(2, 0, 110), ...corridor(4, 0, 110)], transports: [shaft] });
    buildWalkers(e);
    expect(new Set(e.walkers.map((w: any) => w.floor))).toEqual(new Set([2, 4]));
    const clear0 = shaft.x - ELEVATOR_LANDING_TILES;
    const clear1 = shaft.x + shaft.width - 1 + ELEVATOR_LANDING_TILES;
    for (const w of e.walkers) {
      const [a, b] = tiles(w);
      expect(b < clear0 || a > clear1, `walker paces ${a}..${b}, landing is ${clear0}..${clear1}`).toBe(true);
    }
  });

  it("stays clear of a shop's front", () => {
    const shop = { kind: "shop", floor: 3, x: 40, width: 12 };
    const e = eng("modern", { units: [...corridor(3, 0, 40), shop, ...corridor(3, 52, 100)] });
    buildWalkers(e);
    expect(e.walkers.length).toBeGreaterThan(0);
    for (const w of e.walkers) {
      const [a, b] = tiles(w);
      expect(b < shop.x - SHOP_FRONT_TILES || a > shop.x + shop.width - 1 + SHOP_FRONT_TILES).toBe(true);
    }
  });

  it("skips the upper story of a multi-floor facility", () => {
    // A cinema spans two floors, so the corridor lots on its upper story sit on
    // its mid-line.
    const cinema = { kind: "cinema", floor: 5, x: 0, width: 31 };
    const e = eng("modern", { units: [cinema, ...corridor(6, 0, 31)] });
    buildWalkers(e);
    expect(e.walkers).toEqual([]);
  });
});

describe("how many passers-by a corridor gets", () => {
  it("is 0.07 per tile, capped at four per run", () => {
    const count = (w: number) => {
      const e = eng("modern", { units: corridor(3, 0, w) });
      buildWalkers(e);
      return e.walkers.length;
    };
    expect([count(14), count(15), count(29), count(43), count(100)]).toEqual([0, 1, 2, 3, PASSERS_PER_RUN_CAP]);
  });

  it("never paces a figure past the ends of its run", () => {
    const e = eng("modern", { units: corridor(3, 20, 60) });
    buildWalkers(e);
    for (const w of e.walkers) {
      expect(w.x0w).toBeGreaterThanOrEqual(20 * TILE);
      expect(w.x1w).toBeLessThanOrEqual(60 * TILE);
      expect(w.x1w).toBeGreaterThan(w.x0w);
    }
  });

  it("stops at the tower budget", () => {
    const units = [];
    for (let f = 2; f < 2 + 60; f++) units.push(...corridor(f, 0, 100));
    const e = eng("modern", { units });
    buildWalkers(e);
    expect(e.walkers.length).toBe(PASSERS_BUDGET);
  });

  it("ranks a run's figures so the first ones show before the floor fills", () => {
    const e = eng("modern", { units: corridor(3, 0, 100) });
    buildWalkers(e);
    const ranks = e.walkers.map((w: any) => w.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    for (const r of ranks) expect(r > 0 && r < 1).toBe(true);
  });
});
