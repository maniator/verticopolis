import { describe, it, expect } from "vitest";
import { newSeededGame } from "../fixtures/towerFixtures";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { isOperational } from "../../engine/types";

/** A floor-2 tower served by an elevator, with `n` occupied offices — the only
 *  flammable rooms, so `startFire()` ignites an office deterministically. */
function firePrep(seed: number, n = 1) {
  const sim = newSeededGame(seed);
  const x0 = Math.floor(GRID.width / 2) - 20;
  for (let i = 0; i < 40; i++) sim.tower.place("floor", 2, x0 + i);
  sim.buildTransport("elevatorStandard", x0, 1, 2);
  const offices = [];
  for (let i = 0; i < n; i++) sim.build("office", 2, x0 + i * 2);
  for (const u of sim.tower.units.filter((u) => u.kind === "office")) {
    u.state = "occupied";
    u.everOccupied = true;
    offices.push(u);
  }
  return { sim, offices, x0 };
}

/** Add Security + Medical AFTER a fire is burning (so they're never the ignited
 *  unit) — control = 0.5 + 0.2 + 0.3 = 1.0 ⇒ contained the next day. */
function defend(sim: Simulation, x0: number): void {
  sim.star = 4;
  sim.tower.place("security", 2, x0 + 30);
  sim.tower.place("medical", 2, x0 + 34);
}

/** Ignite an office, staff up, and run days until the blaze is out. */
function burnDown(sim: Simulation, x0: number): void {
  sim.startFire();
  defend(sim, x0);
  let guard = 0;
  while (sim.fires > 0 && guard++ < 20) sim.tick(60 * 24); // one day per tick
  expect(sim.fires).toBe(0);
}

describe("Fire aftermath — gutted shells (canon), not auto-repair", () => {
  it("a contained fire leaves a GUTTED shell, not a fresh vacant room (bug regression)", () => {
    const { sim, offices, x0 } = firePrep(11, 1);
    sim.startFire();
    expect(offices[0].state).toBe("fire");
    defend(sim, x0);
    let g = 0;
    while (sim.fires > 0 && g++ < 20) sim.tick(60 * 24);
    expect(offices[0].state).toBe("gutted"); // NOT "empty"/"occupied" — the old bug
    expect(offices[0].occupants).toBe(0);
    expect(offices[0].everOccupied).toBe(false);
  });

  it("a gutted room never re-leases or earns over time", () => {
    const { sim, offices, x0 } = firePrep(11, 1);
    burnDown(sim, x0);
    expect(offices[0].state).toBe("gutted");
    for (let d = 0; d < 40; d++) sim.tick(60 * 24); // ~6 weeks
    expect(offices[0].state).toBe("gutted"); // still a shell — never silently re-let
    expect(offices[0].occupants).toBe(0);
  });

  it("containment charges no repair fee (the room is destroyed instead)", () => {
    const { sim, x0 } = firePrep(11, 1);
    sim.startFire();
    defend(sim, x0);
    const before = sim.money;
    sim.tick(60 * 24); // one day → contained (control 1.0)
    expect(sim.fires).toBe(0);
    // Only ordinary daily upkeep is spent — the old ~30%-of-cost repair fee
    // (≈ $12k for an office) is gone; the room is destroyed instead.
    expect(before - sim.money).toBeLessThan(10_000);
  });

  it("bulldozing a gutted shell refunds nothing (empty rooms still refund half)", () => {
    const { sim, offices, x0 } = firePrep(11, 1);
    burnDown(sim, x0);
    expect(offices[0].state).toBe("gutted");
    const before = sim.money;
    expect(sim.sellAt(offices[0].floor, offices[0].x)).toBe(true);
    expect(sim.money).toBe(before); // $0 salvage on a gutted shell
  });

  it("a gutted room is not operational and can't re-ignite", () => {
    const { sim, offices, x0 } = firePrep(11, 1);
    burnDown(sim, x0);
    const gutted = offices[0];
    expect(isOperational(gutted)).toBe(false);
    // Igniting again only picks flammable rooms; a gutted husk is excluded.
    for (let i = 0; i < 5; i++) sim.startFire();
    expect(gutted.state).toBe("gutted"); // never re-ignited
  });

  it("survives save/load as gutted and never re-ignites or re-lets", () => {
    const { sim, x0 } = firePrep(11, 1);
    burnDown(sim, x0);
    const json = sim.serialize();
    const loaded = Simulation.deserialize(json);
    const office = loaded.tower.units.find((u) => u.kind === "office")!;
    expect(office.state).toBe("gutted");
    expect(loaded.fires).toBe(0);
    for (let d = 0; d < 20; d++) loaded.tick(60 * 24);
    expect(office.state).toBe("gutted"); // no re-ignite, no re-lease after load
  });

  it("a gutted COMMERCIAL venue stays gutted and is never revived to earn income", () => {
    // Regression: collectTrafficIncome() force-set commercial rooms to "occupied"
    // each hour, resurrecting a gutted shop/restaurant/cinema and defeating the fix.
    const sim = newSeededGame(11);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let i = 0; i < 40; i++) sim.tower.place("floor", 2, x0 + i);
    sim.buildTransport("elevatorStandard", x0, 1, 2); // served floor
    sim.tower.place("shop", 2, 0 + x0); // the only flammable room (earns traffic income)
    const shop = sim.tower.units.find((u) => u.kind === "shop")!;
    shop.state = "occupied";
    sim.startFire();
    expect(shop.state).toBe("fire");
    defend(sim, x0);
    let g = 0;
    while (sim.fires > 0 && g++ < 20) sim.tick(60 * 24);
    expect(shop.state).toBe("gutted");
    // Run several full (open-hours) days: a gutted venue must NOT flip back to
    // "occupied" and must not earn — this assertion fails on the pre-fix code.
    for (let d = 0; d < 5; d++) sim.tick(60 * 24);
    expect(shop.state).toBe("gutted");
    expect(shop.occupants).toBe(0);
  });

  it("isOperational excludes construction, fire, and gutted", () => {
    expect(isOperational({ state: "occupied" })).toBe(true);
    expect(isOperational({ state: "empty" })).toBe(true);
    expect(isOperational({ state: "asleep" })).toBe(true);
    expect(isOperational({ state: "gutted" })).toBe(false);
    expect(isOperational({ state: "fire" })).toBe(false);
    expect(isOperational({ state: "construction" })).toBe(false);
  });
});

describe("Emergency counters — the analytics-only tallies the shell reads (#611)", () => {
  it("a fresh tower starts every emergency counter at zero", () => {
    const { sim } = firePrep(7, 1);
    expect(sim.events.counts).toEqual({ fires: 0, firesGutRooms: 0, bombs: 0 });
  });

  it("counts a fire OUTBREAK on ignition (a spread is the same fire, not a new one)", () => {
    const { sim } = firePrep(7, 1);
    sim.startFire();
    expect(sim.events.counts.fires).toBe(1);
  });

  it("counts a room gutted BY FIRE when a blaze is contained", () => {
    const { sim, x0 } = firePrep(11, 1);
    sim.startFire();
    defend(sim, x0);
    let g = 0;
    while (sim.fires > 0 && g++ < 20) sim.tick(60 * 24); // burns down to a gutted shell
    expect(sim.events.counts.firesGutRooms).toBe(1);
  });

  it("counts a bomb detonation only when it actually detonates (no Security on duty)", () => {
    const { sim } = firePrep(5, 2);
    sim.bombThreat(); // nothing to defuse it → it detonates
    expect(sim.events.counts.bombs).toBe(1);
    // The rooms the bomb gutted are BOMB losses, deliberately not tallied as fire.
    expect(sim.events.counts.firesGutRooms).toBe(0);
  });

  it("a bomb sweep with Security on duty is not counted as a detonation", () => {
    const { sim, x0 } = firePrep(5, 2);
    const guard = sim.tower.place("security", 2, x0 + 30);
    if (guard) {
      const u = sim.tower.units.find((unit) => unit.kind === "security");
      if (u) u.state = "occupied";
    }
    sim.bombThreat(); // Security sweeps: no detonation
    expect(sim.events.counts.bombs).toBe(0);
  });
});
