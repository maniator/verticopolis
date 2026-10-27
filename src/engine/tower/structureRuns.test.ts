import { describe, expect, it } from "vitest";
import { ALL_KINDS } from "../facilities";
import { Simulation } from "../Simulation";
import type { Tower } from "../Tower";
import type { FacilityKind, Unit } from "../types";
import { structureRuns, type StructureRun } from "./rooms";
import { isStructural } from "./towerTopology";
import { ensureStarterLobby, layTile, MID, placeUnit } from "../../tests/fixtures/towerFixtures";

/** Only what `structureRuns` reads: the unit list and the revision. */
function towerOf(units: Unit[], revision = 0): Tower {
  return { units, revision } as unknown as Tower;
}

let nextId = 1;
function tile(kind: FacilityKind, floor: number, x: number, width = 1): Unit {
  return { id: nextId++, kind, floor, x, width } as Unit;
}

/** Every structure tile as "floor:x:kind:width", expanded from runs. */
function expand(runs: readonly StructureRun[]): string[] {
  const out: string[] = [];
  for (const r of runs) for (let i = 0; i < r.count; i++) out.push(`${r.floor}:${r.x + i * r.width}:${r.kind}:${r.width}`);
  return out;
}

function tilesOf(units: readonly Unit[]): string[] {
  return units.filter((u) => isStructural(u.kind)).map((u) => `${u.floor}:${u.x}:${u.kind}:${u.width}`);
}

describe("structureRuns", () => {
  it("buckets exactly the floor and lobby kinds, the ones `roomUnits` leaves out", () => {
    for (const kind of ALL_KINDS) expect(isStructural(kind), kind).toBe(kind === "floor" || kind === "lobby");
  });

  it("is empty for a tower with no structure, and skips rooms", () => {
    expect(structureRuns(towerOf([]))).toEqual([]);
    expect(structureRuns(towerOf([tile("office", 2, 10, 9)]))).toEqual([]);
  });

  it("orders runs by floor and then x, whatever order the units are in", () => {
    const units = [tile("floor", 3, 12), tile("floor", -2, 5), tile("floor", 3, 10), tile("floor", 3, 11), tile("lobby", 1, 0), tile("floor", -2, 4)];
    expect(structureRuns(towerOf(units))).toEqual([
      { floor: -2, kind: "floor", x: 4, width: 1, count: 2 },
      { floor: 1, kind: "lobby", x: 0, width: 1, count: 1 },
      { floor: 3, kind: "floor", x: 10, width: 1, count: 3 },
    ]);
  });

  it("ends a run at a gap, a change of kind and a change of width", () => {
    const units = [
      tile("lobby", 1, 0),
      tile("lobby", 1, 1),
      tile("floor", 1, 2), // kind changes
      tile("floor", 1, 3),
      tile("floor", 1, 5), // gap at 4
      tile("floor", 1, 6, 2), // width changes
      tile("floor", 1, 8, 2),
      tile("floor", 1, 11, 2), // a gap of one tile between width-2 tiles
    ];
    const runs = structureRuns(towerOf(units));
    expect(runs).toEqual([
      { floor: 1, kind: "lobby", x: 0, width: 1, count: 2 },
      { floor: 1, kind: "floor", x: 2, width: 1, count: 2 },
      { floor: 1, kind: "floor", x: 5, width: 1, count: 1 },
      { floor: 1, kind: "floor", x: 6, width: 2, count: 2 },
      { floor: 1, kind: "floor", x: 11, width: 2, count: 1 },
    ]);
    expect(expand(runs).sort()).toEqual(tilesOf(units).sort());
  });

  it("hands out frozen runs in a frozen list, so no caller can corrupt the shared cache", () => {
    const runs = structureRuns(towerOf([tile("floor", 1, 0), tile("floor", 2, 0)]));
    expect(Object.isFrozen(runs)).toBe(true);
    expect(runs.every((r) => Object.isFrozen(r))).toBe(true);
  });

  it("covers every structure tile of a real tower exactly once, in maximal runs", () => {
    const sim = Simulation.newGame(7, "classic");
    sim.money = 1e9;
    ensureStarterLobby(sim);
    // Laid right to left with a gap, so the units are out of x order.
    for (let x = MID + 10; x >= MID - 10; x--) if (x !== MID) layTile(sim, "floor", 2, x);
    placeUnit(sim, "office", 2, MID + 1); // a room on the floor tiles, which stay structure
    const runs = structureRuns(sim.tower);
    expect(expand(runs).sort()).toEqual(tilesOf(sim.tower.units).sort());
    for (const r of runs) for (let i = 0; i < r.count; i++) expect(sim.tower.structureKindAt(r.floor, r.x + i * r.width)).toBe(r.kind);
    for (let i = 1; i < runs.length; i++) {
      const [a, b] = [runs[i - 1], runs[i]];
      expect(a.floor < b.floor || (a.floor === b.floor && a.x + a.count * a.width <= b.x), `runs ${i - 1} and ${i} in order`).toBe(true);
      const joins = a.floor === b.floor && a.kind === b.kind && a.width === b.width && a.x + a.count * a.width === b.x;
      expect(joins, `runs ${i - 1} and ${i} would join`).toBe(false);
    }
    expect(runs.filter((r) => r.floor === 2).map((r) => [r.x, r.count])).toEqual([
      [MID - 10, 10],
      [MID + 1, 10],
    ]);
  });

  it("returns the cached list until the tower changes, then picks up a build and a bulldoze", () => {
    const sim = Simulation.newGame(7, "classic");
    sim.money = 1e9;
    ensureStarterLobby(sim);
    // One tick first: on the parity project the Rust host attaches at the
    // first tick and sets the tower's revision to the engine's own count.
    sim.tick(1);
    const [first, revision] = [structureRuns(sim.tower), sim.tower.revision];
    for (let i = 0; i < 5; i++) sim.tick(1);
    expect(sim.tower.revision, "nothing built or removed while ticking").toBe(revision);
    expect(structureRuns(sim.tower)).toBe(first);

    layTile(sim, "floor", 2, MID);
    const afterBuild = structureRuns(sim.tower);
    expect(afterBuild).not.toBe(first);
    expect(afterBuild[afterBuild.length - 1]).toEqual({ floor: 2, kind: "floor", x: MID, width: 1, count: 1 });

    const id = sim.tower.unitAt(2, MID)?.id as number;
    sim.tower.removeUnit(id);
    expect(structureRuns(sim.tower)).toEqual(first);
  });

  it("rebuilds when a bulldoze and a build between two reads keep the unit count", () => {
    const sim = Simulation.newGame(7, "classic");
    sim.money = 1e9;
    ensureStarterLobby(sim);
    layTile(sim, "floor", 2, MID);
    const [first, count] = [structureRuns(sim.tower), sim.tower.units.length];
    sim.tower.removeUnit(sim.tower.unitAt(2, MID)?.id as number);
    layTile(sim, "floor", 2, MID + 3);
    expect(sim.tower.units.length, "only the revision tells the two towers apart").toBe(count);
    const after = structureRuns(sim.tower);
    expect(after).not.toBe(first);
    expect(after.filter((r) => r.floor === 2)).toEqual([{ floor: 2, kind: "floor", x: MID + 3, width: 1, count: 1 }]);
  });

  it("rebuilds when the same tower's unit array is replaced", () => {
    const sim = Simulation.newGame(7, "classic");
    ensureStarterLobby(sim);
    const before = structureRuns(sim.tower);
    expect(before.length, "the starter lobby is one run across MID").toBe(1);
    const [lobby] = before;
    sim.tower.units = sim.tower.units.filter((u) => u.x !== MID);
    const after = structureRuns(sim.tower);
    expect(after).not.toBe(before);
    expect(after.map((r) => [r.x, r.count])).toEqual([
      [lobby.x, MID - lobby.x],
      [MID + 1, lobby.x + lobby.count - MID - 1],
    ]);
  });
});
