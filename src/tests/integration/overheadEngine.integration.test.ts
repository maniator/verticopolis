import { it, expect } from "vitest";
import { newSeededDraft, lay, LOT_WIDTH } from "../portKit/draftFixtures";
import { catalogFacility } from "../../catalog/catalogTypes";
import { catalogFor } from "../catalogFixture";
import type { GameMode } from "../../shared/types";
import { PortSim, describeEngines, type Leg } from "../portKit/portSim";

/** The Modern carrying costs (operating overhead and the condo hold-tax), on
 *  both engines. Moved from modernEconomy.integration.test.ts and
 *  economyDepth.integration.test.ts, where they ran on the sampled v1 model;
 *  the engine runs the hourly model only, and one month of ticks from day 0
 *  still crosses exactly one month boundary. Kept apart from those files so
 *  their plain tests keep the WASM parity runs. Each block keeps the month
 *  length its source file used. */

const C = Math.floor(LOT_WIDTH / 2);
const MONTH_30_DAYS = 60 * 24 * 30;
const MONTH_31_DAYS = 60 * 24 * 31;
/** The Modern economy the engine publishes: the overhead per leasable unit
 *  and the condo hold-tax rate. */
const MODERN = catalogFor("modern");

/** The asking price of an unpriced condo: the Modern band default. */
function unpricedCondoAsk(): number {
  const rent = catalogFacility(MODERN, "condo").rent;
  if (rent?.shape !== "band") throw new Error("the Modern condo is priced on a band");
  return rent.default;
}

describeEngines(
  "operating overhead + condo hold-tax are Modern-only",
  (leg: Leg) => {
    /** Money spent over one month by a tower holding one vacant office and one
     *  unsold condo on an UNSERVED floor (no elevator), so nobody moves in and the
     *  condo can't sell: the ONLY money movement is the overhead + hold-tax sinks. */
    function monthlyDrain(mode: GameMode): number {
      const draft = newSeededDraft(4, mode);
      draft.money = 1_000_000;
      draft.star = 1;
      lay(draft, "lobby", 1);
      lay(draft, "floor", 2); // deliberately NO elevator to floor 2 → unserved
      draft.tower.place("office", 2, C); // held, vacant → overhead candidate, earns nothing
      draft.tower.place("condo", 2, C + 10); // unsold, unreachable → hold-tax candidate, never sells
      const sim = new PortSim(leg, draft);
      const before = sim.state.money;
      sim.tick(MONTH_30_DAYS); // crosses exactly one month boundary → payMaintenance once
      return before - sim.state.money;
    }

    it("Classic charges no overhead and no condo hold-tax (only canon maintenance)", () => {
      // Classic still pays canon service maintenance if any, but there are no
      // service rooms here, so a held vacant office + unsold condo cost NOTHING.
      expect(monthlyDrain("classic")).toBe(0);
    });

    it("Modern charges the exact overhead + condo tax (a real carrying cost)", () => {
      // Two overhead-bearing units (vacant office + unsold condo) + the condo
      // hold-tax on its asking price. Asserting the EXACT figure (not just > 0)
      // catches a sign/tuning error in either sink.
      const overhead = 2 * MODERN.economy.overheadPerUnitMonthly;
      const condoTax = Math.ceil(
        unpricedCondoAsk() * MODERN.economy.condoHoldTaxRate,
      );
      expect(monthlyDrain("modern")).toBe(overhead + condoTax);
    });
  },
);

describeEngines(
  "Economy depth #4: operating overhead, on both engines",
  (leg: Leg) => {
    it("charges overhead on vacant/unserved space (pure carrying cost)", () => {
      // Operating overhead is a Modern-only "deeper economy" sink (Classic is 0).
      const draft = newSeededDraft(1, "modern");
      draft.money = 1e9;
      draft.star = 1; // keep events off
      lay(draft, "lobby", 1);
      lay(draft, "floor", 2);
      // 5 empty offices, NO elevator → unserved → they stay vacant (no move-in),
      // no rent (quarterly + occupancy), no cars/services → overhead is the only cost.
      for (let i = 0; i < 5; i++) draft.tower.place("office", 2, i * 9);
      const sim = new PortSim(leg, draft);
      const before = sim.state.money;
      sim.tick(MONTH_31_DAYS); // crosses one month boundary → payMaintenance once
      expect(before - sim.state.money).toBe(
        5 * MODERN.economy.overheadPerUnitMonthly,
      );
    });

    it("a unit under construction pays no overhead", () => {
      const draft = newSeededDraft(2);
      draft.money = 1e9;
      draft.star = 1;
      lay(draft, "lobby", 1);
      lay(draft, "floor", 2);
      const r = draft.tower.place("office", 2, 0);
      draft.tower.units.find((u) => u.id === r.unitId)!.state = "construction";
      const sim = new PortSim(leg, draft);
      const before = sim.state.money;
      sim.tick(MONTH_31_DAYS);
      expect(before - sim.state.money).toBe(0); // mid-build → no overhead
    });
  },
);

describeEngines("operating overhead consumes no RNG (F3)", (leg: Leg) => {
  it("the shared stream is untouched by it", () => {
    // Two seed-identical towers with no cinema, commercial or events (star 1):
    // nothing in the tick touches the RNG. The only difference is that A holds
    // overhead-bearing (empty, unserved) offices and B is bare. If overhead
    // consumed RNG, A's stream would diverge; it must not. Moved from
    // economyDepth.integration.test.ts with the v1 model dropped; the RNG
    // position is read from the engine's save.
    const build = (withOverhead: boolean): number => {
      const draft = newSeededDraft(123);
      draft.money = 1e9;
      draft.star = 1;
      lay(draft, "lobby", 1);
      lay(draft, "floor", 2);
      if (withOverhead)
        for (let i = 0; i < 10; i++) draft.tower.place("office", 2, i * 9);
      const sim = new PortSim(leg, draft);
      for (let m = 0; m < 3; m++) sim.tick(MONTH_31_DAYS); // 3 monthly maintenance runs
      return sim.state.rng.seed;
    };
    expect(build(true)).toBe(build(false)); // identical stream position: overhead is RNG-free
  });
});
