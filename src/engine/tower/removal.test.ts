import { describe, expect, it } from "vitest";
import { Simulation } from "../Simulation";
import type { Tower } from "../Tower";
import { INVALID_REQUEST } from "../request";
import { BRUSH_TILE_LIMIT, type BrushKind, type BrushResult } from "../sim/brush";
import { MAX_BRUSH_TILES } from "../../simport/request";
import { removeUnits, withLobbyUpgrades } from "./removal";

/**
 * The one-pass removals and the brush's lobby batch end exactly as the
 * one-by-one edits they replace: the same list, indexes, express stops,
 * wedding hall flag, save and events, and the revision those edits reach
 * (one more after a brush whose lobby took a floor tile's place).
 * `engine-rs/src/tower_removal_tests.rs` holds the same cases for Rust.
 */

/** A lobby on floor 1, plain floor on 2 to 14 over columns 150 to 209 and
 *  on 15 to 31 over 150 to 199, an express shaft from 1 to 31 and sky lobby
 *  runs on 15 and 30. The same tower every call. */
function tower(): Simulation {
  const sim = Simulation.newGame(7, "classic");
  sim.money = 1e9;
  sim.star = 3;
  for (let x = 150; x < 210; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let floor = 2; floor <= 31; floor++) {
    const end = floor < 15 ? 210 : 200;
    for (let x = 150; x < end; x++) expect(sim.tower.place("floor", floor, x).ok).toBe(true);
  }
  expect(sim.buildTransport("elevatorExpress", 152, 1, 31).ok).toBe(true);
  for (const floor of [15, 30]) for (let x = 160; x < 164; x++) expect(sim.build("lobby", floor, x).ok).toBe(true);
  sim.drainGameplayEvents();
  return sim;
}

/** Floor from 32 to 99 over columns 150 to 165 and the wedding hall on the
 *  roof (floor 100, the only floor it may stand on). Answers the hall's id. */
function weddingHall(sim: Simulation): number {
  sim.star = 5;
  for (let floor = 32; floor < 100; floor++) {
    for (let x = 150; x < 166; x++) expect(sim.tower.place("floor", floor, x).ok).toBe(true);
  }
  const hall = sim.build("weddingHall", 100, 150);
  expect(hall.ok, hall.reason).toBe(true);
  expect(sim.tower.builtWeddingHall).toBe(true);
  sim.drainGameplayEvents();
  return sim.tower.rooms.get(sim.tower.key(100, 150))!;
}

/** The id at `floor`, `x`: structure first, then a room. */
function idAt(t: Tower, floor: number, x: number): number {
  const id = t.structure.get(t.key(floor, x)) ?? t.rooms.get(t.key(floor, x));
  if (id === undefined) throw new Error(`nothing at ${floor}, ${x}`);
  return id;
}

/** Every unit's index entry points at it, and no other entry exists. */
function expectIndexed(t: Tower): void {
  expect(t.byId.size).toBe(t.units.length);
  for (const u of t.units) expect(t.byId.get(u.id)).toBe(u);
}

const save = (sim: Simulation) => JSON.stringify(sim.serialize());
const events = (sim: Simulation) => JSON.parse(JSON.stringify(sim.drainGameplayEvents())) as unknown;

/** `paintBrush` as the port ran it before the brush moved into the engine:
 *  the same passes, one `build` at a time, with no batch. */
function oneByOne(sim: Simulation, kind: BrushKind, floor: number, tiles: readonly number[]): BrushResult {
  let placed = 0;
  let reason: string | undefined;
  let progress = true;
  while (progress) {
    progress = false;
    for (const tx of tiles) {
      const existing = sim.tower.structureKindAt(floor, tx);
      if (existing === kind || (existing !== undefined && kind !== "lobby")) continue;
      const r = sim.build(kind, floor, tx);
      if (r.ok) {
        placed++;
        progress = true;
      } else {
        reason = r.reason;
      }
    }
  }
  return reason === undefined ? { placed } : { placed, reason };
}

describe("removing units together", () => {
  it("ends as removing them one by one", () => {
    const batch = tower();
    const single = tower();
    expect(batch.build("office", 2, 180).ok && single.build("office", 2, 180).ok).toBe(true);
    const hall = weddingHall(batch);
    expect(weddingHall(single)).toBe(hall);
    const t = batch.tower;
    // Both sky lobbies lose every tile, interleaved, and 30 loses its last
    // first; an unknown id and a repeat remove nothing.
    const ids = [
      idAt(t, 15, 161),
      idAt(t, 30, 160),
      idAt(t, 2, 180),
      idAt(t, 15, 160),
      999_999,
      idAt(t, 30, 161),
      idAt(t, 15, 163),
      idAt(t, 2, 180),
      idAt(t, 30, 199),
      idAt(t, 30, 163),
      idAt(t, 30, 162),
      hall,
      idAt(t, 15, 162),
      idAt(t, 1, 209),
    ];
    const express = t.transports[0].id;
    expect(t.stopsOf(t.transports[0])).toEqual(expect.arrayContaining([15, 30]));

    const gone = removeUnits(batch.tower, ids);
    const expected: number[] = [];
    for (const id of ids) {
      const u = single.tower.removeUnit(id);
      if (u) expected.push(u.id);
    }
    expect(gone.map((u) => u.id)).toEqual(expected);
    expect(gone, "the unknown and repeated ids remove nothing").toHaveLength(12);
    expect(save(batch)).toBe(save(single));
    expect(batch.tower.revision).toBe(single.tower.revision);
    expect(batch.tower.builtWeddingHall).toBe(false);
    expect(single.tower.builtWeddingHall).toBe(false);
    expectIndexed(batch.tower);
    const stops = batch.tower.stopsOf(batch.tower.transportById(express)!);
    expect(stops, "the express no longer stops at 15 or 30").not.toContain(15);
    expect(stops).not.toContain(30);
    expect(events(batch)).toEqual(events(single));
  });

  it("removes one by id and nothing for an id it does not hold", () => {
    const sim = tower();
    const first = sim.tower.units[0].id;
    const rev = sim.tower.revision;
    expect(sim.tower.removeUnit(first)?.id).toBe(first);
    expect(sim.tower.removeUnit(first)).toBeUndefined();
    expect(removeUnits(sim.tower, [])).toEqual([]);
    expect(sim.tower.revision).toBe(rev + 1);
    expectIndexed(sim.tower);
  });
});

describe("the engine's brush", () => {
  it("ends a lobby brush as laying its tiles one by one", () => {
    // Upgrades of plain floor (198, 199, 165, 170), a lobby on a bare tile
    // (205, whose bridge from 199 lays 200 to 204, so 200 is then skipped), a
    // repeated column, and a tile with nothing under it (212), refused every
    // pass.
    const tiles = [198, 205, 199, 165, 200, 199, 212, 170];
    const brush = tower();
    const single = tower();
    const got = brush.paintBrush("lobby", 15, tiles);
    expect(got).toEqual(oneByOne(single, "lobby", 15, tiles));
    expect(got.placed, "198, 205 (its bridge lays 200 to 204), 199, 165 and 170").toBe(5);
    expect(got.reason).toBeDefined();
    expect(save(brush)).toBe(save(single));
    expect(brush.tower.revision, "the move to the end bumps the revision once").toBe(single.tower.revision + 1);
    expectIndexed(brush.tower);
    expect(events(brush)).toEqual(events(single));
    // A brush that upgrades nothing leaves the list as it laid it.
    const again = brush.paintBrush("lobby", 15, tiles);
    expect(again).toEqual(oneByOne(single, "lobby", 15, tiles));
    expect(again.placed).toBe(0);
    expect(save(brush)).toBe(save(single));
    expect(brush.tower.revision).toBe(single.tower.revision + 1);
    expectIndexed(brush.tower);
  });

  it("ends a floor brush as laying its tiles one by one", () => {
    // In the basement a tile stands on its neighbor: only 150 and 151 hang
    // under the lobby at first, so the tiles to their left are refused and
    // tried again (the bridge lays some of them). Nothing takes a floor
    // tile's place, so the revision matches.
    const tiles = [147, 148, 149, 150, 151, 150];
    const brush = tower();
    const single = tower();
    const got = brush.paintBrush("floor", 0, tiles);
    expect(got).toEqual(oneByOne(single, "floor", 0, tiles));
    expect(got.placed, "the bridges lay the other two").toBe(3);
    expect(got.reason, "a tile was refused on the first pass").toBeDefined();
    const laid = Array.from({ length: 20 }, (_, i) => 140 + i).filter((x) => brush.tower.structureKindAt(0, x) !== undefined);
    expect(laid).toEqual([147, 148, 149, 150, 151]);
    expect(save(brush)).toBe(save(single));
    expect(brush.tower.revision).toBe(single.tower.revision);
    expectIndexed(brush.tower);
    expect(events(brush)).toEqual(events(single));
  });

  it("lays nothing for a malformed brush", () => {
    const sim = tower();
    const before = save(sim);
    const rev = sim.tower.revision;
    const invalid = { placed: 0, reason: INVALID_REQUEST };
    const many = Array.from({ length: BRUSH_TILE_LIMIT + 1 }, (_, i) => 150 + i);
    const call = (kind: unknown, floor: unknown, tiles: unknown) =>
      sim.paintBrush(kind as BrushKind, floor as number, tiles as number[]);
    for (const kind of ["office", "", "Floor", undefined, 1]) expect(call(kind, 15, [180]), String(kind)).toEqual(invalid);
    for (const floor of [15.5, Number.NaN, Infinity, 2 ** 53, "15", null]) expect(call("lobby", floor, [180]), String(floor)).toEqual(invalid);
    // eslint-disable-next-line no-sparse-arrays
    for (const tiles of [many, [180.5], [Number.NaN], ["180"], [null], [, 180], null, "180", { length: 1, 0: 180 }]) {
      expect(call("lobby", 15, tiles), JSON.stringify(tiles)).toEqual(invalid);
    }
    expect(save(sim)).toBe(before);
    expect(sim.tower.revision).toBe(rev);
    // At the limit the brush runs: every tile hangs under the ground lobby.
    expect(sim.paintBrush("floor", 0, many.slice(0, BRUSH_TILE_LIMIT))).toEqual({ placed: BRUSH_TILE_LIMIT });
  });

  it("joins a brush inside a brush to the outer batch", () => {
    const brush = tower();
    const single = tower();
    const rev = brush.tower.revision;
    // Floor 15, then 30, then 15 again: each change of floor reads that
    // floor's positions afresh.
    const [a, b, c] = withLobbyUpgrades(brush.tower, () => [
      brush.paintBrush("lobby", 15, [198, 199]),
      brush.paintBrush("lobby", 30, [170]),
      brush.paintBrush("lobby", 15, [165]),
    ]);
    expect(a).toEqual(oneByOne(single, "lobby", 15, [198, 199]));
    expect(b).toEqual(oneByOne(single, "lobby", 30, [170]));
    expect(c).toEqual(oneByOne(single, "lobby", 15, [165]));
    expect(a.placed + b.placed + c.placed).toBe(4);
    expect(save(brush)).toBe(save(single));
    expect(brush.tower.revision, "one move for every brush").toBe(single.tower.revision + 1);
    expect(brush.tower.revision).toBe(rev + 4 * 2 + 1);
    expectIndexed(brush.tower);
    expect(events(brush)).toEqual(events(single));
  });

  it("still moves every unit placed when a removal runs inside it", () => {
    // Removing two tiles near the start of the list shifts the lobby already
    // laid on 198 two places nearer the start, before the slot 199 takes; the
    // next upgrade reads the positions again and the list ends as one by one.
    const brush = tower();
    const single = tower();
    const early = [idAt(brush.tower, 2, 150), idAt(brush.tower, 2, 151)];
    expect(early).toEqual([idAt(single.tower, 2, 150), idAt(single.tower, 2, 151)]);
    withLobbyUpgrades(brush.tower, () => {
      expect(brush.paintBrush("lobby", 15, [198]).placed).toBe(1);
      expect(removeUnits(brush.tower, early).map((u) => u.id)).toEqual(early);
      expect(brush.paintBrush("lobby", 15, [199]).placed).toBe(1);
    });
    oneByOne(single, "lobby", 15, [198]);
    for (const id of early) expect(single.tower.removeUnit(id)?.id).toBe(id);
    oneByOne(single, "lobby", 15, [199]);
    expect(save(brush)).toBe(save(single));
    expect(brush.tower.revision).toBe(single.tower.revision + 1);
    expectIndexed(brush.tower);
  });

  it("still moves a unit placed that stands before where it looks", () => {
    // A list edit the batch does not see (none happens in the engine) moves
    // the lobby one place nearer the start than the batch knows; the move
    // reads the rest of the list and still puts it last.
    const sim = tower();
    const units = sim.tower.units;
    const n = units.length;
    withLobbyUpgrades(sim.tower, () => {
      expect(sim.paintBrush("lobby", 15, [198]).placed).toBe(1);
      units.push(units.shift()!);
    });
    expect(units.length).toBe(n);
    expect(units[units.length - 1].id).toBe(sim.tower.structure.get(sim.tower.key(15, 198)));
    expect(new Set(units).size).toBe(n);
    expectIndexed(sim.tower);
  });

  it("carries as many tiles as the port lets through", () => {
    expect(BRUSH_TILE_LIMIT).toBe(MAX_BRUSH_TILES);
  });
});
