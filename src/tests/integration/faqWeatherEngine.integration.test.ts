import { expect, it } from "vitest";
import { newSeededDraft, LOT_WIDTH } from "../portKit/draftFixtures";
import type { WeatherKind } from "../../shared/types";
import { PortSim, describeEngines, type Leg, type Draft } from "../portKit/portSim";

/**
 * FAQ Cluster B's rain case on both engines: rain depresses commercial income
 * against a clear day. The other FAQ cases stay in
 * `faqComplete.integration.test.ts`; `lay` mirrors that file's copy.
 *
 * No save carries the weather (a load recomputes it from the day), so the
 * original's `sim.weather = weather` becomes `PortSim.setWeather` after the
 * engine loads the draft. The run crosses no day boundary, so the weather
 * stays as set.
 */

const W = LOT_WIDTH;
const C = Math.floor(W / 2);

function lay(sim: Draft, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

describeEngines("Events & amounts (FAQ Cluster B)", (leg: Leg) => {
  it("rain depresses commercial income vs a clear day", () => {
    function dayIncome(weather: WeatherKind): number {
      const draft = newSeededDraft(7);
      draft.money = 1e12;
      draft.star = 3;
      lay(draft, "lobby", 1);
      lay(draft, "floor", 2);
      expect(draft.buildTransport("elevatorStandard", C, 1, 2).ok, "elevator built").toBe(true);
      const r = draft.tower.place("fastFood", 2, 0);
      expect(r.ok, `fast food placed: ${r.reason}`).toBe(true);
      draft.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
      // Occupied offices give the venue a demand pool to serve (income is
      // demand-driven), so there is real income for rain to depress. Identical in
      // both weather runs, so only the rain multiplier differs.
      for (const x of [20, 32, 44]) {
        const o = draft.tower.place("office", 2, x);
        expect(o.ok, o.reason).toBe(true);
        draft.tower.units.find((u) => u.id === o.unitId)!.state = "occupied";
      }
      const sim = new PortSim(leg, draft);
      sim.setWeather(weather); // stays fixed within the day (no day boundary crossed)
      // A name the engine does not know is refused on both legs. It runs after
      // the real set, so a refusal that wrote anything would change the income.
      expect(() => sim.setWeather("snow" as WeatherKind)).toThrow(/refused snow/);
      const before = sim.state.money;
      const day = sim.state.clock.day;
      for (let i = 0; i < 10; i++) sim.tick(60); // 07:00→17:00, fast food open
      // The day's roll resets the weather at midnight; the run must not reach it.
      expect(sim.state.clock.day, "the run stayed within the day").toBe(day);
      return sim.state.money - before;
    }
    const clear = dayIncome("clear");
    expect(clear, "a clear day earns something for rain to depress").toBeGreaterThan(0);
    expect(dayIncome("rain")).toBeLessThan(clear);
  });

  it("a setup after setWeather throws, since its reload would drop the weather", () => {
    const draft = newSeededDraft(7);
    lay(draft, "lobby", 1);
    const sim = new PortSim(leg, draft);
    sim.setWeather("rain");
    expect(() => sim.setup(() => undefined)).toThrow(/drop an earlier setCustomersIn or setWeather/);
  });
});
