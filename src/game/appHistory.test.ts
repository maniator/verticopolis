import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { createAppHistory } from "./appHistory";

describe("createAppHistory", () => {
  it("steps through the port's save and follows a restore, keeping the trail", async () => {
    const enginePort = new TsEngine(Simulation.newGame(1));
    const followSwap = vi.fn();
    const hist = createAppHistory({ enginePort, ui: { toast: () => {} }, followSwap });
    const serialize = vi.spyOn(enginePort, "serialize");
    hist.capture("build");
    expect(serialize).toHaveBeenCalledOnce();
    enginePort.sim.money += 5000;
    hist.commit();
    await hist.undo();
    expect(followSwap).toHaveBeenCalledWith(true);
  });
});
