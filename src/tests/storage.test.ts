import { describe, it, expect, beforeEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import { SaveGame } from "../storage/SaveGame";
import { FACILITIES, GRID } from "../engine/facilities";

describe("SaveGame", () => {
  beforeEach(() => localStorage.clear());

  function sampleGame(): Simulation {
    const sim = Simulation.newGame(42);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let i = 0; i < 12; i++) sim.tower.place("floor", 2, x0 + i);
    sim.buildTransport("elevatorStandard", x0, 1, 2);
    sim.build("office", 2, x0);
    sim.money = 1234567;
    sim.tick(60 * 5);
    return sim;
  }

  it("persists the pending VIP inspection day across save/load", () => {
    const sim = sampleGame();
    // Simulate a Wedding Hall having scheduled the VIP a few days out.
    (sim as unknown as { vipVisitDay: number }).vipVisitDay = sim.clock.day + 3;
    const expected = (sim as unknown as { vipVisitDay: number }).vipVisitDay;
    const loaded = Simulation.deserialize(sim.serialize());
    expect((loaded as unknown as { vipVisitDay: number }).vipVisitDay).toBe(expected);
  });

  it("coerces non-finite unit fields from a tampered save to safe values", () => {
    const sim = sampleGame();
    const data = sim.serialize();
    // Simulate a hand-edited / foreign save with a poisoned satisfaction field.
    (data.units[0] as { satisfaction: unknown }).satisfaction = undefined;
    (data.units[0] as { occupants: unknown }).occupants = NaN;
    const loaded = Simulation.deserialize(data);
    const u = loaded.tower.units[0];
    expect(Number.isFinite(u.satisfaction)).toBe(true);
    expect(u.satisfaction).toBeGreaterThanOrEqual(0);
    expect(u.satisfaction).toBeLessThanOrEqual(1);
    expect(Number.isFinite(u.occupants)).toBe(true);
  });

  it("coerces forged unit state/label strings from a tampered save", () => {
    const sim = sampleGame();
    const data = sim.serialize();
    // A forged `state` would flow into UI innerHTML (inspector "Status:" line)
    // and state-machine compares; a non-string label would crash escaping.
    (data.units[0] as { state: unknown }).state = '<img src=x onerror="x">';
    (data.units[0] as { label: unknown }).label = 42;
    const loaded = Simulation.deserialize(data);
    const u = loaded.tower.units[0];
    expect(u.state).toBe("empty");
    expect(u.label).toBe(FACILITIES[u.kind].name);
  });

  it("recomputes the sky weather on load (not left stale)", () => {
    const sim = sampleGame();
    sim.tick(60 * 24 * 5); // advance a few days
    const loaded = Simulation.deserialize(sim.serialize());
    expect(loaded.weather).toBe(Simulation.weatherFor(loaded.clock.day));
    expect(loaded.weather).toBe(sim.weather);
  });

  it("round-trips through localStorage", () => {
    const sim = sampleGame();
    SaveGame.save(sim);
    expect(SaveGame.hasSave()).toBe(true);
    const loaded = SaveGame.load()!;
    expect(loaded).not.toBeNull();
    expect(loaded.money).toBe(sim.money);
    expect(loaded.clock.minutes).toBe(sim.clock.minutes);
    expect(loaded.tower.units.length).toBe(sim.tower.units.length);
    expect(loaded.tower.transports.length).toBe(sim.tower.transports.length);
  });

  it("preserves occupancy lookups after load", () => {
    const sim = sampleGame();
    SaveGame.save(sim);
    const loaded = SaveGame.load()!;
    const x0 = Math.floor(GRID.width / 2) - 20;
    expect(loaded.tower.unitAt(2, x0)).toBeDefined();
  });

  it("exports and imports JSON", () => {
    const sim = sampleGame();
    const json = SaveGame.export(sim);
    const loaded = SaveGame.import(json);
    expect(loaded.money).toBe(sim.money);
    expect(loaded.star).toBe(sim.star);
  });

  it("rejects malformed imports", () => {
    expect(() => SaveGame.import("{}")).toThrow();
    expect(() => SaveGame.import("not json")).toThrow();
  });

  it("returns null when no save exists", () => {
    expect(SaveGame.load()).toBeNull();
    expect(SaveGame.hasSave()).toBe(false);
  });

  it("round-trips serialize -> deserialize -> serialize without drift", () => {
    const sim = sampleGame();
    // The nested per-car arrays are where serialization drift hides, not the
    // scalars — so assert they're populated before trusting the round-trip.
    const t = sim.tower.transports[0];
    expect(t.carPositions.length).toBeGreaterThan(0);

    const first = sim.serialize();
    const second = Simulation.deserialize(first).serialize();
    expect(second).toEqual(first);
    // And the deep-copied car arrays survive intact, value for value.
    expect(second.transports[0].carPositions).toEqual(first.transports[0].carPositions);
  });

  it("loads a save from an unknown future version without throwing", () => {
    const sim = sampleGame();
    const data = sim.serialize();
    // A save written by a newer build must degrade gracefully, not crash.
    (data as { version: number }).version = 999;
    expect(() => Simulation.deserialize(data)).not.toThrow();
    const loaded = Simulation.deserialize(data);
    expect(loaded.money).toBe(sim.money);
    expect(loaded.tower.units.length).toBe(sim.tower.units.length);
  });

  it("drops units with an unrecognized kind on load", () => {
    const sim = sampleGame();
    const data = sim.serialize();
    const before = data.units.length;
    // Inject a bogus unit as if from a tampered/old save file.
    (data.units as any).push({ ...data.units[0], id: 99999, kind: "spaceport" });
    const loaded = SaveGame.import(JSON.stringify(data));
    expect(loaded.tower.units.length).toBe(before);
    expect(loaded.tower.units.some((u) => (u.kind as string) === "spaceport")).toBe(false);
  });
});
