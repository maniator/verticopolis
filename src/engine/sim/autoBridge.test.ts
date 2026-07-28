import { describe, it, expect } from "vitest";
import { Simulation } from "../Simulation";
import { GRID, FACILITIES } from "../facilities";

/**
 * "Bridge floors between rooms" (autoBridge). Default on (the shipped auto-bridge
 * behavior). When off, a placement still ALWAYS auto-lays the floor UNDER its own
 * footprint (players are never forced to place floors by hand), but the game
 * never fills the gap BETWEEN a placement and its neighbor, so separate sections
 * stay genuinely disconnected. Modern surfaces it as a founding default (the New
 * Tower "no bridging" option) plus a mid-game Settings toggle; Classic is forced
 * on and can't flip it. Eligibility is a GameRules decision (bridgingToggleable).
 */

const C = Math.floor(GRID.width / 2);

/** Found a Modern tower with a wide ground lobby strip across [C, C+w). */
function foundedWithLobby(w = 24, startUnbridged = false): Simulation {
  const sim = Simulation.newGame(1, "modern", "realWorld", startUnbridged);
  sim.money = 1_000_000_000;
  for (let i = 0; i < w; i++) {
    const r = sim.build("lobby", 1, C + i);
    expect(r.ok, `lobby @ ${C + i}: ${r.reason ?? ""}`).toBe(true);
  }
  return sim;
}

describe("autoBridge defaults and eligibility", () => {
  it("defaults on for a fresh Modern tower; Classic is forced on and can't toggle", () => {
    expect(Simulation.newGame(1, "modern", "realWorld").autoBridge).toBe(true);
    const classic = Simulation.newGame(1, "classic", "realWorld");
    expect(classic.autoBridge).toBe(true);
    expect(classic.rules.bridgingToggleable()).toBe(false);
    // Classic can't turn it off: the toggle is a no-op and bridging stays on.
    expect(classic.toggleAutoBridge()).toBe(true);
    expect(classic.autoBridge).toBe(true);
    // A Classic founding ignores the "start unbridged" flag entirely.
    expect(Simulation.newGame(1, "classic", "realWorld", true).autoBridge).toBe(true);
  });

  it("Modern is toggle-eligible, and founding with the no-bridging option starts it off", () => {
    const modern = Simulation.newGame(1, "modern", "realWorld");
    expect(modern.rules.bridgingToggleable()).toBe(true);
    expect(modern.toggleAutoBridge()).toBe(false); // flips off
    expect(modern.toggleAutoBridge()).toBe(true); // and back on
    // Founded with "don't bridge floors between rooms" checked.
    expect(Simulation.newGame(1, "modern", "realWorld", true).autoBridge).toBe(false);
  });
});

describe("rooms always auto-lay the floor beneath them", () => {
  it("places a room over a missing floor even with bridging OFF (never forced manual)", () => {
    const sim = foundedWithLobby(24, true); // founded unbridged
    expect(sim.autoBridge).toBe(false);
    // Floor 2 has no floor tiles yet; the office must still land, laying its own.
    const office = sim.build("office", 2, C);
    expect(office.ok, office.reason).toBe(true);
    for (let i = 0; i < 9; i++) {
      expect(sim.tower.structure.has(sim.tower.key(2, C + i))).toBe(true);
    }
  });
});

describe("bridging between placements", () => {
  it("bridges the floor-2 gap between two offices when ON (the default)", () => {
    const sim = foundedWithLobby();
    expect(sim.build("office", 2, C).ok).toBe(true);
    // Second office to the right, leaving a 3-tile gap on floor 2 between the
    // first office's floor (ends at C+8) and this footprint (starts at C+12).
    const gapKey = sim.tower.key(2, C + 9);
    expect(sim.tower.structure.has(gapKey)).toBe(false);
    const quote = sim.canBuild("office", 2, C + 12);
    expect(sim.build("office", 2, C + 12).ok).toBe(true);
    expect(sim.tower.structure.has(gapKey)).toBe(true); // gap bridged
    expect(quote.cost).toBe(FACILITIES.office.cost + (9 + 3) * FACILITIES.floor.cost);
  });

  it("leaves the gap open when OFF, but still floors under the room", () => {
    const sim = foundedWithLobby();
    expect(sim.build("office", 2, C).ok).toBe(true);
    sim.autoBridge = false;
    const gapKey = sim.tower.key(2, C + 9);
    const footKey = sim.tower.key(2, C + 12);
    const quote = sim.canBuild("office", 2, C + 12);
    expect(sim.build("office", 2, C + 12).ok).toBe(true);
    expect(sim.tower.structure.has(footKey)).toBe(true); // own floor laid
    expect(sim.tower.structure.has(gapKey)).toBe(false); // gap left open
    expect(quote.cost).toBe(FACILITIES.office.cost + 9 * FACILITIES.floor.cost); // no bridge run billed
  });

  it("refuses a detached structural tile when OFF, but bridges (rescues) it when ON", () => {
    const off = foundedWithLobby(12);
    off.autoBridge = false;
    const refused = off.build("lobby", 1, C + 20);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain("connect");

    const on = foundedWithLobby(12);
    const landed = on.build("lobby", 1, C + 20);
    expect(landed.ok, landed.reason).toBe(true);
    expect(on.tower.structure.has(on.tower.key(1, C + 15))).toBe(true); // gap filled with lobby
  });
});

describe("autoBridge persistence and migration", () => {
  it("a default (on) tower writes no field and round-trips as on", () => {
    const save = Simulation.newGame(1, "modern", "realWorld").serialize();
    expect("autoBridge" in save).toBe(false); // byte-identical to before the option
    expect(Simulation.deserialize(save).autoBridge).toBe(true);
  });

  it("an off tower persists the field and round-trips as off", () => {
    const sim = Simulation.newGame(1, "modern", "realWorld");
    sim.autoBridge = false;
    const save = sim.serialize();
    expect(save.autoBridge).toBe(false);
    expect(Simulation.deserialize(save).autoBridge).toBe(false);
  });

  it("migrates a legacy manual-structure Modern save to bridging off", () => {
    const save = Simulation.newGame(1, "modern", "realWorld").serialize();
    delete (save as { autoBridge?: boolean }).autoBridge; // legacy save had no autoBridge
    (save as { manualStructure?: boolean }).manualStructure = true;
    expect(Simulation.deserialize(save).autoBridge).toBe(false);
  });

  it("clamps a forged off value back to on for a Classic save", () => {
    const save = Simulation.newGame(1, "classic", "realWorld").serialize();
    (save as { autoBridge?: boolean }).autoBridge = false;
    (save as { manualStructure?: boolean }).manualStructure = true;
    expect(Simulation.deserialize(save).autoBridge).toBe(true);
  });
});
