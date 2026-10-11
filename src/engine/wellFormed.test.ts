import { describe, expect, it } from "vitest";
import { Simulation } from "./Simulation";
import { wellFormed } from "./wellFormed";

const HIGH = "\ud83c";
const LOW = "\udfe2";
const PAIR = HIGH + LOW;

describe("wellFormed", () => {
  it("replaces each lone half of a surrogate pair with U+FFFD and keeps pairs", () => {
    expect(wellFormed("Sky " + HIGH)).toBe("Sky \uFFFD");
    expect(wellFormed(LOW + " Sky")).toBe("\uFFFD Sky");
    expect(wellFormed(PAIR)).toBe(PAIR);
    expect(wellFormed(HIGH + PAIR)).toBe("\uFFFD" + PAIR);
    expect(wellFormed(LOW + HIGH)).toBe("\uFFFD\uFFFD");
    expect(wellFormed("plain, caf\u00e9, \uFFFF")).toBe("plain, caf\u00e9, \uFFFF");
    expect(wellFormed("")).toBe("");
  });

  it("agrees with String.prototype.toWellFormed where the runtime has it", () => {
    const native = (String.prototype as { toWellFormed?: (this: string) => string }).toWellFormed;
    if (!native) return;
    const units = [HIGH, LOW, "a", "\u0000", "\uFFFD", PAIR];
    for (let n = 0; n < 2000; n++) {
      let s = "";
      for (let k = (n * 7) % 9; k > 0; k--) s += units[(n * 31 + k * 17) % units.length];
      expect(wellFormed(s), JSON.stringify(s)).toBe(native.call(s));
    }
  });
});

/** A game with one lobby tile, so there is a unit to label. */
function withLobby(): Simulation {
  const sim = new Simulation(1);
  expect(sim.build("lobby", 1, 170).ok).toBe(true);
  return sim;
}

describe("half emoji in tower text (#936)", () => {
  it("a loaded save carries U+FFFD in the tower name and unit labels", () => {
    const save = withLobby().serialize();
    save.towerName = "Sky " + HIGH;
    const raw = JSON.parse(JSON.stringify(save)) as { units: { label?: string }[] };
    expect(raw.units.length).toBeGreaterThan(0);
    raw.units[0]!.label = "Lobby " + LOW;
    const sim = Simulation.deserialize(raw as unknown as typeof save);
    expect(sim.tower.towerName).toBe("Sky \uFFFD");
    expect(sim.tower.units[0]!.label).toBe("Lobby \uFFFD");
  });

});
