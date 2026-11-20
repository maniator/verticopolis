import { expect, it } from "vitest";
import { PortSim, describeEngines, draftTower, type Leg } from "./portSim";

/** The port kit's own guard: `setup` reloads the engine from its save, so it
 *  refuses once a write no save carries has been made, or once the engine
 *  has ticked, rather than silently drop the write or rewind the run. */
describeEngines("PortSim.setup refuses a reload that would lose state", (leg: Leg) => {
  function fastFood(): { sim: PortSim; id: number } {
    const draft = draftTower(2024, "classic");
    for (let x = 0; x < 40; x++) draft.tower.place("lobby", 1, x);
    for (let x = 0; x < 40; x++) draft.tower.place("floor", 2, x);
    const placed = draft.tower.place("fastFood", 2, 0);
    expect(placed.ok, placed.reason).toBe(true);
    draft.tower.units.find((u) => u.id === placed.unitId)!.state = "occupied";
    return { sim: new PortSim(leg, draft), id: placed.unitId! };
  }

  it("throws on a setup after setCustomersIn", () => {
    const { sim, id } = fastFood();
    sim.setup(() => undefined);
    sim.setCustomersIn(id, 2);
    expect(() => sim.setup(() => undefined)).toThrow(/drop an earlier setCustomersIn/);
  });

  it("throws on a setup after the first tick", () => {
    const { sim } = fastFood();
    sim.tick(60);
    expect(() => sim.setup(() => undefined)).toThrow(/before the engine's first tick/);
  });
});
