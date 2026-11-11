import { expect, it } from "vitest";
import { newSeededDraft, LOT_WIDTH } from "../portKit/draftFixtures";
import type { FacilityKind } from "../../shared/types";
import { PortSim, describeEngines, type Leg, type Draft } from "../portKit/portSim";

/**
 * The commercial-venue inspector's cosmetic invariant on both engines: the
 * patronage and profit tallies are render-only, so clearing them every hour
 * changes no money and no pending income. The other inspector cases stay in
 * `simulation.integration.test.ts`; `builtTower` and `buildOne` mirror that
 * file's copies (change both together).
 *
 * The original cleared the four fields on a TypeScript instance; here
 * `PortSim.clearRetailTallies` clears them on the engine.
 */

const X0 = Math.floor(LOT_WIDTH / 2) - 20;

/** Floor 2 over [X0, X0 + 40), linked to the ground by one elevator. */
function builtTower(seed: number): Draft {
  const sim = newSeededDraft(seed);
  for (let i = 0; i < 40; i++) sim.tower.place("floor", 2, X0 + i);
  expect(sim.buildTransport("elevatorStandard", X0, 1, 2).ok, "elevator built").toBe(true);
  return sim;
}

/** Build one `kind` on floor 2 at `x`. Star 3 unlocks the shop, then the star
 *  drops back to 1 so no random fire or bomb can gut a venue mid-run. */
function buildOne(sim: Draft, kind: FacilityKind, x: number): number {
  sim.money = 1e12;
  sim.star = 3;
  const r = sim.build(kind, 2, x);
  expect(r.ok, `${kind} built: ${r.reason}`).toBe(true);
  const u = sim.tower.unitAt(2, x);
  expect(u, `${kind} at ${x}`).toBeDefined();
  sim.star = 1;
  return u!.id;
}

/** Whether any unit holds one of the four retail tallies. */
function anyTally(sim: PortSim): boolean {
  return sim.state.tower.units.some(
    (u) => u.patronageToday !== undefined || u.patronageYest !== undefined || u.profitToday !== undefined || u.profitYest !== undefined,
  );
}

describeEngines("Commercial-venue inspector: patronage/profit accumulation, rollover, save shape", (leg: Leg) => {
  it("cosmetic invariant: money + pendingIncome unchanged when patronage/profit are read only from render", () => {
    // Two towers, identical seed and script. One runs on the shipped code
    // (accumulators active); the other has its accumulators forcibly cleared
    // every hour. If any economy path READ the accumulators, this would drift.
    const drive = (clearEveryHour: boolean) => {
      const draft = builtTower(11);
      buildOne(draft, "office", X0);
      const shop = buildOne(draft, "shop", X0 + 12);
      const sim = new PortSim(leg, draft);
      const startMoney = sim.state.money;
      let clearLeftATally = false;
      for (let i = 0; i < 24 * 7; i++) {
        sim.tick(60);
        if (clearEveryHour) sim.clearRetailTallies();
        // Both runs read the engine each hour, so they differ only by the clears.
        const tallied = anyTally(sim);
        if (clearEveryHour) clearLeftATally ||= tallied; // checked after each hourly clear
      }
      const units = sim.state.tower.units;
      const shopPatronageYest = units.find((u) => u.id === shop)?.patronageYest ?? 0;
      // The hourly clears empty today's fields before each midnight, so the
      // cleared run never holds a yesterday tally. Clear once after the full
      // week here, where the shop holds one, to pin the yesterday fields too.
      let clearAfterWeekLeftATally = false;
      if (!clearEveryHour) {
        sim.clearRetailTallies();
        clearAfterWeekLeftATally = anyTally(sim);
      }
      return {
        money: sim.state.money,
        earned: sim.state.money - startMoney,
        pending: units.map((u) => u.pendingIncome ?? 0),
        shopPatronageYest,
        clearLeftATally,
        clearAfterWeekLeftATally,
      };
    };
    const withAccum = drive(false);
    const cleared = drive(true);
    // The run that keeps the tallies really earned and tallied, so the
    // equalities below compare two runs with something to drift.
    expect(withAccum.earned, "the tower earned money over the week").toBeGreaterThan(0);
    expect(withAccum.shopPatronageYest, "the shop tallied a day's patronage").toBeGreaterThan(0);
    expect(cleared.clearLeftATally, "every hourly clear left no tally behind").toBe(false);
    expect(withAccum.clearAfterWeekLeftATally, "a clear after a full week, yesterday's tallies included, left none").toBe(false);
    expect(cleared.money).toBe(withAccum.money);
    expect(cleared.pending).toEqual(withAccum.pending);
  });
});
