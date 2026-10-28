import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { setSaveText } from "../wasmhost/stepGate";
import { createAppHistory } from "./appHistory";

describe("createAppHistory", () => {
  it("takes an undo step as the host's own save text when it offers one", () => {
    const sim = Simulation.newGame(1);
    const enginePort = new TsEngine(sim);
    const serialize = vi.spyOn(enginePort, "serialize");
    const hist = createAppHistory({ enginePort, sim, ui: { toast: () => {} } });
    setSaveText(sim, () => "HOSTED TEXT");
    hist.capture("build");
    expect(serialize).not.toHaveBeenCalled();
    setSaveText(sim, null);
    hist.capture("build");
    expect(serialize).toHaveBeenCalledOnce();
  });
});
