import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { PortCodes, outcome } from "./portCodes";

describe("PortCodes over TsEngine", () => {
  it("passes names as the layout's codes and reads named slots", () => {
    const sim = Simulation.newGame(5, "modern");
    sim.money = 1e8;
    const e = new TsEngine(sim);
    const c = new PortCodes(e);
    expect([c.code("modes", "modern"), c.code("logKinds", "bad"), c.code("heatModes", "nope")]).toEqual([1, 2, NaN]);
    const rec = e.paintTiles(c.kind("lobby"), 1, Float64Array.of(160, 161, 162));
    expect(outcome(e, rec)).toEqual({ ok: true, delta: rec[1] });
    expect(rec[1]).toBeLessThan(0);
    expect(c.slot(rec, "paintTiles", "placed")).toBe(3);
    expect(c.slot(rec, "paintTiles", "missing")).toBeNaN();
    expect(c.slot(rec, "noSuchOp", "placed")).toBeNaN();
  });

  it("reads a refusal's reason before the next command clears it", () => {
    const e = new TsEngine(Simulation.newGame(5, "modern"));
    const c = new PortCodes(e);
    const refused = outcome(e, e.buildAt(c.kind("office"), 40, 160));
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe(e.lastReason());
    expect(typeof refused.reason).toBe("string");
    expect(outcome(e, e.buildAt(NaN, 1, 160)).ok).toBe(false);
  });
});
