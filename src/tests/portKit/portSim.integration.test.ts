import { expect, it } from "vitest";
import { PortSim, describeEngines, draftTower, type Leg } from "./portSim";

/** The port kit's own guard: `setup` reloads the engine from its save, so it
 *  refuses once the engine has ticked, rather than silently rewind the run. */
describeEngines("PortSim.setup refuses a reload that would lose state", (leg: Leg) => {
  it("allows a setup before the first tick and throws on one after it", () => {
    const draft = draftTower(2024, "classic");
    for (let x = 0; x < 40; x++) draft.tower.place("lobby", 1, x);
    const sim = new PortSim(leg, draft);
    sim.setup(() => undefined);
    sim.tick(60);
    expect(() => sim.setup(() => undefined)).toThrow(/before the engine's first tick/);
  });
});
