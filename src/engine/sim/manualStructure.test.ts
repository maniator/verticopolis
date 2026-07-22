import { describe, it, expect } from "vitest";
import { Simulation } from "../Simulation";
import { GRID } from "../facilities";

/**
 * Modern "manual structure" build option (gdd-modern-expansion): when on, the
 * game never auto-lays or bills the floor/lobby substrate under a placement.
 * A room dropped where its floor is missing refuses instead of the game
 * auto-laying that floor. Default off (the shipped auto behavior). Modern-only:
 * Classic ignores the flag entirely, so Classic building stays byte-identical.
 */

const C = Math.floor(GRID.width / 2);

/** Found a tower and lay a ground lobby strip across [C, C+w). */
function foundedWithLobby(manual: boolean, w = 12): Simulation {
  const sim = Simulation.newGame(1, "modern", "realWorld", manual);
  sim.money = 1_000_000_000;
  for (let i = 0; i < w; i++) {
    const r = sim.build("lobby", 1, C + i);
    expect(r.ok, `lobby @ ${C + i}: ${r.reason ?? ""}`).toBe(true);
  }
  return sim;
}

describe("Modern manual structure", () => {
  it("refuses a room whose floor is not laid (no auto-floor), then places it once the floor exists", () => {
    const sim = foundedWithLobby(true);
    // Floor 2 has no floor tiles yet, so the office refuses instead of
    // auto-laying its own floor.
    const noFloor = sim.build("office", 2, C);
    expect(noFloor.ok).toBe(false);
    expect(noFloor.reason).toContain("Lay the floor under it first");

    // Lay the floor by hand (it rests on the lobby below), then the office lands.
    for (let i = 0; i < 9; i++) {
      const f = sim.build("floor", 2, C + i);
      expect(f.ok, `floor @ ${C + i}: ${f.reason ?? ""}`).toBe(true);
    }
    const office = sim.build("office", 2, C);
    expect(office.ok, office.reason).toBe(true);
  });

  it("charges a room only its own cost in manual mode (no auto-substrate billing)", () => {
    const sim = foundedWithLobby(true);
    for (let i = 0; i < 9; i++) expect(sim.build("floor", 2, C + i).ok).toBe(true);
    const before = sim.money;
    expect(sim.build("office", 2, C).ok).toBe(true);
    // Exactly the office price, no bridged floor tiles folded in.
    expect(before - sim.money).toBe(sim.canBuild("office", 2, C).cost);
  });

  it("auto mode (the default) still auto-lays the floor under a room", () => {
    const auto = foundedWithLobby(false);
    // Same drop with manual OFF: the room lays its own floor and lands.
    const office = auto.build("office", 2, C);
    expect(office.ok, office.reason).toBe(true);
    expect(auto.manualStructure).toBe(false);
  });

  it("refuses a detached structural tile in manual mode (no auto-bridge)", () => {
    const sim = foundedWithLobby(true);
    // A lobby tile with a gap to the strip does not auto-bridge; it refuses
    // specifically because it is not connected (not for some other reason).
    const detached = sim.build("lobby", 1, C + 20);
    expect(detached.ok).toBe(false);
    expect(detached.reason).toContain("connect");
  });

  it("is Modern-only: a Classic tower ignores the flag and stays auto", () => {
    const classic = Simulation.newGame(1, "classic", "realWorld", true);
    expect(classic.manualStructure).toBe(false);
  });
});

describe("manual structure persistence", () => {
  it("round-trips through serialize/deserialize", () => {
    const sim = Simulation.newGame(1, "modern", "realWorld", true);
    expect(sim.manualStructure).toBe(true);
    const restored = Simulation.deserialize(sim.serialize());
    expect(restored.manualStructure).toBe(true);
  });

  it("a save without the field loads as auto (no migration)", () => {
    const save = Simulation.newGame(1, "modern", "realWorld", true).serialize();
    delete (save as { manualStructure?: unknown }).manualStructure;
    expect(Simulation.deserialize(save).manualStructure).toBe(false);
  });
});
