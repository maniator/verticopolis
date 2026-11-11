import { it, expect } from "vitest";
import { newSeededDraft, lay, mustBuild, placeUnit, LOT_WIDTH } from "../portKit/draftFixtures";
import { ECON } from "../../engine/econConfig";
import type { SerializedGame } from "../../shared/types";
import { PortSim, describeEngines, type Leg } from "../portKit/portSim";

/** The Classic condo price rules that need a price written mid-run, on both
 *  engines. Moved from condoModes.integration.test.ts, which wrote `condo.rent`
 *  on the TypeScript engine's live unit; the engine's tooling-only `setUnitRent`
 *  makes the same write here, with no reload to snap the price onto the
 *  ladder first. */

const C = Math.floor(LOT_WIDTH / 2);
/** The most hours a sale or a buy-back is given to happen. */
const MAX_HOURS = 24 * 40;

/** A served floor-2 Classic tower (seed 3) with one condo at C + 4, finished
 *  and open for sale, and the condo's id. `priced` builds it through the
 *  command, which stamps the ladder's asking price; otherwise it is placed
 *  and opened unpriced. */
function servedCondo(leg: Leg, priced: boolean): { sim: PortSim; id: number } {
  const draft = newSeededDraft(3, "classic");
  draft.money = 1e9;
  draft.star = 1; // no random fire/bomb events to perturb the run
  lay(draft, "lobby", 1);
  lay(draft, "floor", 2);
  mustBuild(draft, "elevatorStandard", C, 1, 2);
  let id: number;
  if (priced) {
    expect(draft.build("condo", 2, C + 4).ok).toBe(true);
    id = draft.tower.units.find(
      (u) => u.kind === "condo" && u.floor === 2 && u.x === C + 4,
    )!.id;
  } else {
    const condo = placeUnit(draft, "condo", 2, C + 4);
    condo.state = "empty";
    id = condo.id;
  }
  draft.tower.units.find((u) => u.id === id)!.satisfaction = 1;
  const sim = new PortSim(leg, draft);
  expect(tickUntil(sim, () => condoIn(sim, id).state !== "construction")).toBe(
    true,
  );
  // The topology the price scenarios rely on: the engine serves the condo.
  expect(sim.unitCard(id).served, "the condo is served").toBe(1);
  expect(sim.unitCard(id).reachable, "the condo is reachable").toBe(1);
  return { sim, id };
}

/** The condo as the engine's own save holds it, with no load in between to
 *  snap an unpriced or off-ladder price. */
function condoIn(sim: PortSim, id: number): SerializedGame["units"][number] {
  return (JSON.parse(sim.save()) as SerializedGame).units.find(
    (u) => u.id === id,
  )!;
}

/** Tick hours until a predicate holds (or give up): RNG-driven move-ins resolve without a fixed count. */
function tickUntil(sim: PortSim, pred: () => boolean): boolean {
  for (let i = 0; i < MAX_HOURS && !pred(); i++) sim.tick(60);
  return pred();
}

describeEngines("Classic condo prices written mid-run", (leg: Leg) => {
  it("re-lists a bought-back condo in the current band, dropping a legacy out-of-band price", () => {
    const { sim, id } = servedCondo(leg, true);
    expect(tickUntil(sim, () => condoIn(sim, id).everOccupied === true)).toBe(
      true,
    );
    sim.setUnitRent(id, 240_000); // a legacy sold price above the current $200k max
    for (const t of sim.state.tower.transports)
      expect(sim.demolish(t.id)).toBe(true);
    sim.setMoney(1e9);
    const before = sim.state.money;
    expect(tickUntil(sim, () => condoIn(sim, id).everOccupied !== true)).toBe(
      true,
    );
    // Buy-back still charged the historical price it sold for ...
    expect(before - sim.state.money).toBe(240_000);
    // ... but the returned-to-market asking price is clamped into the current band.
    expect(condoIn(sim, id).rent).toBe(200_000);
  });

  it("stamps the asking price on sale so buy-back survives a later default change", () => {
    const { sim, id } = servedCondo(leg, false);
    sim.setUnitRent(id, null); // the load snapped the placed condo onto the ladder; unprice it again
    expect(condoIn(sim, id).rent).toBeUndefined();
    expect(tickUntil(sim, () => condoIn(sim, id).everOccupied === true)).toBe(
      true,
    );
    // The sale records its asking price on the unit, so the price no longer
    // depends on the kind default (which a future build could move).
    expect(condoIn(sim, id).rent).toBe(ECON.rent.condo.default);
  });
});
