import { describe, expect, it } from "vitest";
import * as ex from "excalibur";
import { newRenderSim, newViewReader } from "../../game/portAccess";
import { pickEntityAt } from "../../render/excalibur/towerInputCamera";
import type { TowerEngine } from "../../render/excalibur/TowerEngine";
import { FLOOR, TILE } from "../../render/scale";
import { look, newEngine, noEngine } from "../portKit/rustEngine";

/**
 * The renderer's room pick on the Rust engine's tile index: every story of a
 * tall room resolves, with no render actor. The pick's pixel math over a
 * hand-built index is unit-tested in
 * `src/render/excalibur/towerInputCamera.test.ts`.
 */

describe.skipIf(noEngine)("picking rooms on the engine's tile index", () => {
  it("resolves a room and every story of a two-story cinema, and bare structure around them", () => {
    const engine = newEngine(1, "classic");
    const sim = look(engine);
    sim.money = 1e9;
    for (let x = 100; x < 150; x++) {
      expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
      expect(sim.tower.place("floor", 2, x).ok).toBe(true);
      expect(sim.tower.place("floor", 3, x).ok).toBe(true);
    }
    const cinema = sim.tower.place("cinema", 2, 100);
    const office = sim.tower.place("office", 2, 140);
    expect([cinema.ok, office.ok]).toEqual([true, true]);
    const reader = newViewReader(engine);
    reader.update();
    const renderSim = newRenderSim(engine, reader);
    const e = { transportActors: new Map(), sim: renderSim } as unknown as TowerEngine;
    const at = (tile: number, floor: number) => pickEntityAt(e, ex.vec((tile + 0.5) * TILE, -(floor - 0.5) * FLOOR));
    expect(at(141, 2)).toEqual({ type: "unit", id: office.unitId, kind: "office", cell: { floor: 2, x: 141 } });
    expect(at(110, 2)).toEqual({ type: "unit", id: cinema.unitId, kind: "cinema", cell: { floor: 2, x: 110 } });
    expect(at(110, 3)).toEqual({ type: "unit", id: cinema.unitId, kind: "cinema", cell: { floor: 3, x: 110 } }); // upper story
    expect(at(141, 3)!.kind).toBe("floor"); // bare structure above the office
    expect(at(141, 1)!.kind).toBe("lobby");
    expect(at(50, 20)).toBeNull(); // open sky
  });
});
