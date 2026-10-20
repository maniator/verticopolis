import { describe, expect, it } from "vitest";
import { DetailError, requireDetail, tsCheckpointDetail } from "./checkpointDetail";
import { digest } from "./canonical";
import { stateView } from "../../engine/conformanceView";
import { startTsEngine } from "./scenario";
import { Simulation } from "../../engine/Simulation";

describe("checkpoint detail", () => {
  it("reads the game without changing it", () => {
    const sim = new Simulation(7, "classic");
    const before = digest(stateView(sim));
    const first = tsCheckpointDetail(sim);
    expect(digest(stateView(sim))).toBe(before);
    expect(tsCheckpointDetail(sim)).toEqual(first);
    expect(Object.keys(first.save).length).toBeGreaterThan(5);
    expect(first.money).toBe(sim.money);
  });

  it("is provided by the TypeScript scenario engine and follows a tick", () => {
    const e = startTsEngine({ newGame: { seed: 3, mode: "classic" } });
    const a = e.detail!();
    e.tick(60);
    const b = e.detail!();
    expect(b.save.minutes).not.toBe(a.save.minutes);
  });

  it("turns a missing or failing detail into a DetailError", () => {
    expect(() => requireDetail({})).toThrow(DetailError);
    expect(() => requireDetail({ detail: () => { throw new Error("boom"); } })).toThrow(/boom/);
    expect(() => requireDetail({ detail: () => { throw new Error("boom"); } })).toThrow(DetailError);
  });
});
