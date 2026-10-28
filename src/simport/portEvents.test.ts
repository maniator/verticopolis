import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { PortEvents } from "./portEvents";

const founded = (): TsEngine => new TsEngine(Simulation.newGame(1));

describe("PortEvents", () => {
  it("drains the engine's events as the simulation's own drain would", () => {
    const engine = founded();
    const twin = Simulation.newGame(1);
    const events = new PortEvents(engine);
    expect(events.drainGameplayEvents()).toEqual(twin.drainGameplayEvents());
    expect(events.drainGameplayEvents()).toEqual([]);
    expect(events.gameplayEventsDropped).toBe(0);
  });

  it("holds the backdrop mark until the engine swaps towers", () => {
    const engine = founded();
    const events = new PortEvents(engine);
    expect(events.gameplayEvents.discardOnHandOff).toBe(false);
    events.setBackdrop(true);
    expect(events.gameplayEvents.discardOnHandOff).toBe(true);
    expect(engine.loadSave(JSON.stringify(Simulation.newGame(2).serialize()))[0]).toBe(1);
    expect(events.gameplayEvents.discardOnHandOff).toBe(false);
    events.setBackdrop(true);
    events.setBackdrop(false);
    expect(events.gameplayEvents.discardOnHandOff).toBe(false);
  });

  it("drops the backdrop's founding at the swap, as the engine does", () => {
    const afterSwap = (backdrop: boolean) => {
      const engine = founded();
      const events = new PortEvents(engine);
      events.setBackdrop(backdrop);
      engine.loadSave(JSON.stringify(Simulation.newGame(2).serialize()));
      return events.drainGameplayEvents().map((e) => e.name);
    };
    expect(afterSwap(false)).toEqual(["tower_founded"]);
    expect(afterSwap(true)).toEqual([]);
  });
});
