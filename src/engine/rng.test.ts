import { describe, expect, it } from "vitest";
import { RNG } from "./rng";
import { Simulation } from "./Simulation";
import type { SerializedGame } from "./types";

/** A seed one draw before state 0: Mulberry32 adds 0x6d2b79f5 per draw. */
const ONE_BEFORE_ZERO = (2 ** 32 - 0x6d2b79f5) >>> 0;

const draws = (rng: RNG, n: number): number[] => Array.from({ length: n }, () => rng.next());

describe("RNG.restore (#856)", () => {
  it("a stream one draw before state 0 reaches it", () => {
    const rng = new RNG(ONE_BEFORE_ZERO);
    rng.next();
    expect(rng.seed).toBe(0);
  });

  it("a new stream seeded 0 still starts at state 1, and so does a new game", () => {
    expect(new RNG(0).seed).toBe(1);
    expect(new RNG(0).initialSeed).toBe(0);
    expect(Simulation.newGame(0, "modern").rng.seed).toBe(1);
    expect(Simulation.newGame(0, "modern").serialize().seed).toBe(1);
  });

  it("restores state 0 as 0, so the next draws are the uninterrupted stream's", () => {
    const live = new RNG(ONE_BEFORE_ZERO);
    live.next();
    const restored = new RNG(live.seed);
    restored.restore(live.seed);
    expect(restored.seed).toBe(0);
    expect(draws(restored, 4)).toEqual(draws(live, 4));
  });

  it("takes the state through >>> 0 and leaves initialSeed alone", () => {
    const rng = new RNG(5);
    rng.restore(4294967296);
    expect(rng.seed).toBe(0);
    rng.restore(-1);
    expect(rng.seed).toBe(4294967295);
    rng.restore(9.75);
    expect(rng.seed).toBe(9);
    expect(rng.initialSeed).toBe(5);
  });
});

describe("a save taken at state 0 reloads at state 0 (#856)", () => {
  const reload = (sim: Simulation): Simulation => Simulation.deserialize(JSON.parse(JSON.stringify(sim.serialize())) as SerializedGame);

  it("the main stream continues as an uninterrupted run would", () => {
    const sim = Simulation.newGame(7, "modern");
    sim.rng.restore(ONE_BEFORE_ZERO);
    sim.rng.next();
    expect(sim.serialize().seed).toBe(0);
    const loaded = reload(sim);
    expect(loaded.rng.seed).toBe(0);
    expect(loaded.rng.initialSeed).toBe(sim.rng.initialSeed);
    expect(draws(loaded.rng, 4)).toEqual(draws(sim.rng, 4));
  });

  it("the event stream continues as an uninterrupted run would", () => {
    const extra = (s: Simulation): RNG => (s.events as unknown as { extra: RNG }).extra;
    const sim = Simulation.newGame(7, "modern");
    extra(sim).restore(ONE_BEFORE_ZERO);
    extra(sim).next();
    expect(sim.serialize().events?.rngState).toBe(0);
    const loaded = reload(sim);
    expect(extra(loaded).seed).toBe(0);
    expect(draws(extra(loaded), 4)).toEqual(draws(extra(sim), 4));
  });

  it("a missing or non-number seed loads as it did before, and a number seed is restored as it is", () => {
    const save = (seed: unknown): Simulation => {
      const data = JSON.parse(JSON.stringify(Simulation.newGame(7, "modern").serialize())) as Record<string, unknown>;
      if (seed === undefined) delete data.seed;
      else data.seed = seed;
      return Simulation.deserialize(data as unknown as SerializedGame);
    };
    expect(save(undefined).rng.seed).toBe(12345);
    expect(save(null).rng.seed).toBe(1);
    expect(save("0x10").rng.seed).toBe(16);
    expect(save("abc").rng.seed).toBe(1);
    // A string is no saved state, so "0" goes through the constructor's guard.
    expect(save("0").rng.seed).toBe(1);
    expect(save(0).rng.seed).toBe(0);
    expect(save(12345.75).rng.seed).toBe(12345);
  });
});
