import { describe, it, expect } from "vitest";
import { Simulation, ECON } from "../engine/Simulation";
import { EconomySystem } from "../engine/EconomySystem";
import { Tower } from "../engine/Tower";
import { Clock } from "../engine/Clock";
import { RNG } from "../engine/rng";
import { FACILITIES, GRID } from "../engine/facilities";
import type { FacilityKind } from "../engine/types";

/**
 * Regression tests for the BMAD-review findings fixed in this PR. Each `it` pins
 * one finding so it can't silently come back.
 */

const W = GRID.width;
const C = Math.floor(W / 2);

/** Lay structure for a floor outward from the centre, so every tile stays
 * connected to the existing tower (placement requires connection). */
function layFloor(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

/** A full-width ground lobby + floors 2..top, no transport. */
function structuredTower(seed: number, top: number, money = 100_000_000, halfWidth?: number): Simulation {
  const sim = Simulation.newGame(seed);
  sim.money = money;
  // Optionally build only a centred strip (much cheaper to tick over on the
  // wide 375-tile lot) when a test doesn't need the full width.
  const lay = (kind: "floor" | "lobby", f: number) => {
    if (halfWidth === undefined) return layFloor(sim, kind, f);
    const l = Math.max(0, C - halfWidth);
    const r = Math.min(W, C + halfWidth + 1);
    for (let x = C; x < r; x++) sim.tower.place(kind, f, x);
    for (let x = C - 1; x >= l; x--) sim.tower.place(kind, f, x);
  };
  lay("lobby", 1);
  for (let f = 2; f <= top; f++) lay("floor", f);
  return sim;
}

/** structuredTower plus a max-car standard elevator serving floors 1..top
 * (top capped at the 30-floor standard span). */
function servedTower(seed: number, top: number, money = 100_000_000): Simulation {
  const sim = structuredTower(seed, top, money);
  sim.buildTransport("elevatorStandard", W - 6, 1, Math.min(top, 30));
  sim.tower.setCars(sim.tower.transports[0].id, 8);
  return sim;
}

describe("F1 — Security is buildable at 2★ (the unwinnable deadlock is gone)", () => {
  it("organically reaches 3★ through build() + tick() with no forced star/occupancy", () => {
    const sim = servedTower(1, 11);
    // Offices on floors 2..10 (right edge left clear for the elevator), built
    // through the real build path — construction + occupancy happen in the sim.
    for (let f = 2; f <= 10; f++) {
      for (let x = 0; x + FACILITIES.office.width <= W - 8; x += FACILITIES.office.width) {
        sim.build("office", f, x);
      }
    }

    // Phase 1: tenants move in organically until population clears 3★. Star must
    // stall at 2 — Security gates 3★ and isn't built yet.
    let guard = 0;
    while (sim.population < 1000 && guard++ < 4000) sim.tick(60);
    expect(sim.population).toBeGreaterThanOrEqual(1000);
    expect(sim.star).toBe(2); // gated at 2★ without Security (the gate still holds)

    // The deadlock is broken: at 2★ Security is unlocked and buildable.
    expect(sim.isUnlocked("security")).toBe(true);
    expect(sim.build("security", 11, 0).ok).toBe(true);

    // Phase 2: once Security finishes construction the tower promotes to 3★.
    guard = 0;
    while (sim.star < 3 && guard++ < 300) sim.tick(60);
    expect(sim.star).toBe(3);
  });
});

describe("F32 — rating gates ignore facilities that aren't operational yet", () => {
  it("a Security office still under construction does not satisfy the 3★ gate", () => {
    const sim = servedTower(2, 12);
    for (let f = 2; f <= 11; f++) // leave floor 12 clear for the Security office
      for (let x = 0; x + 9 <= W; x += 9) {
        const r = sim.tower.place("office", f, x);
        if (r.ok) sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
      }
    expect(sim.population).toBeGreaterThanOrEqual(1000);
    sim.star = 2;
    expect(sim.build("security", 12, 0).ok).toBe(true); // enters a construction window
    sim.evaluateStar();
    expect(sim.star).toBe(2); // still 2★ while Security is mid-construction
    let guard = 0;
    while (!sim.hasOperational("security") && guard++ < 50) sim.tick(60);
    sim.evaluateStar();
    expect(sim.star).toBe(3);
  });
});

describe("F18 — 1994 build caps & wedding-hall accounting", () => {
  it("allows only one metro", () => {
    const sim = structuredTower(3, 6, 1_000_000_000);
    for (let fl = 0; fl >= -2; fl--) layFloor(sim, "floor", fl); // metro spans 3 basement floors
    expect(sim.tower.place("metro", -2, 0).ok).toBe(true);
    expect(sim.tower.place("metro", -2, 0).ok).toBe(false); // 2nd metro rejected
  });

  it("allows only one wedding hall and derives builtWeddingHall from what stands", () => {
    const sim = structuredTower(5, GRID.maxFloor, 1_000_000_000);
    sim.star = 5;
    expect(sim.build("weddingHall", GRID.maxFloor, C).ok).toBe(true);
    expect(sim.tower.builtWeddingHall).toBe(true);
    expect(sim.build("weddingHall", GRID.maxFloor, C + 20).ok).toBe(false); // cap 1
    sim.sellAt(GRID.maxFloor, C);
    expect(sim.tower.builtWeddingHall).toBe(false);
  });

  it("caps elevator shafts at 24, pooled across ALL three kinds (canon)", () => {
    const sim = servedTower(4, 6, 1_000_000_000); // already has 1 standard shaft
    // Unlock service (2★) and express (3★) so the pool actually sees every kind —
    // the 1994 original counts standard + service + express against ONE 24 budget.
    sim.star = 3;
    const kinds: FacilityKind[] = ["elevatorService", "elevatorExpress", "elevatorStandard"];
    let placed = 1;
    for (let i = 0; i < 40; i++) {
      if (sim.buildTransport(kinds[i % 3], i * 5, 1, 6).ok) placed++;
    }
    expect(placed).toBe(24);
    const elevators = sim.tower.transports.filter((t) => t.kind.startsWith("elevator"));
    expect(elevators.length).toBe(24);
    // The budget is genuinely shared: standard, service AND express all landed in
    // it — express is not given a pool of its own (this would have passed even if
    // the cap were per-kind, which is exactly the regression this pins).
    expect(new Set(elevators.map((t) => t.kind))).toEqual(
      new Set(["elevatorStandard", "elevatorService", "elevatorExpress"]),
    );
    // Cross-pool independence (mirror of the walkway test): with the 24-shaft
    // elevator budget spent, a stair — a SEPARATE pool — is still placeable.
    expect(sim.buildTransport("stairs", 200, 1, 2).ok).toBe(true);
  });

  it("caps stairs + escalators at 64, pooled across both kinds (canon)", () => {
    const sim = structuredTower(5, 6, 1_000_000_000);
    sim.star = 3; // escalators unlock at 3★ (stairs at 1★) — exercise both in one pool
    const kinds: FacilityKind[] = ["stairs", "escalator"];
    let placed = 0;
    // 68 fixed two-floor links, spaced 5 tiles apart (> max width 4, so none
    // overlap) and every attempt on-lot (max x = 67·5 + 4 = 339 < 375). That
    // overshoots the 64 cap, so the blocked attempts (i ≥ 64) prove the CAP
    // rejects them — not the lot edge.
    for (let i = 0; i < 68; i++) {
      if (sim.buildTransport(kinds[i % 2], i * 5, 1, 2).ok) placed++;
    }
    expect(placed).toBe(64);
    const walkways = sim.tower.transports.filter(
      (t) => t.kind === "stairs" || t.kind === "escalator",
    );
    expect(walkways.length).toBe(64);
    expect(new Set(walkways.map((t) => t.kind))).toEqual(new Set(["stairs", "escalator"]));
    // The walkway pool is separate from the elevator pool: an elevator is still
    // placeable with 64 walkways down (floors 1–2, matching the walkways, so a
    // failure here can only mean pool coupling — not a missing upper floor).
    expect(sim.buildTransport("elevatorStandard", 330, 1, 2).ok).toBe(true);
  });
});

describe("F31 — selling the Wedding Hall cancels a pending VIP inspection", () => {
  it("does not keep re-failing the inspection after the hall is gone", () => {
    const sim = structuredTower(6, GRID.maxFloor, 1_000_000_000, 30);
    sim.star = 5;
    expect(sim.build("weddingHall", GRID.maxFloor, C).ok).toBe(true);
    sim.sellAt(GRID.maxFloor, C);
    const before = sim.log.length;
    for (let i = 0; i < 20; i++) sim.tick(60 * 24); // 20 days
    const unimpressed = sim.log.slice(before).filter((e) => e.text.includes("unimpressed"));
    expect(unimpressed.length).toBe(0);
  });

  it("cancels the inspection even when the hall is removed via tower.removeUnit (UI path)", () => {
    const sim = structuredTower(10, GRID.maxFloor, 1_000_000_000, 30);
    sim.star = 5;
    expect(sim.build("weddingHall", GRID.maxFloor, C).ok).toBe(true);
    // Simulate the editor/bulldoze tool, which calls tower.removeUnit directly
    // (NOT sellAt) — the path-independent guard in checkVip must still cancel.
    const hall = sim.tower.units.find((u) => u.kind === "weddingHall")!;
    sim.tower.removeUnit(hall.id);
    const before = sim.log.length;
    for (let i = 0; i < 20; i++) sim.tick(60 * 24);
    const unimpressed = sim.log.slice(before).filter((e) => e.text.includes("unimpressed"));
    expect(unimpressed.length).toBe(0);
  });
});

describe("F7 — commercial income never exceeds its headline daily figure", () => {
  it("a shop earns at most ~its daily figure over a full day, not a multiple", () => {
    const sim = servedTower(7, 3);
    sim.star = 3; // shops unlock at 3★ (canon)
    expect(sim.build("shop", 2, 0).ok).toBe(true);
    sim.tower.units.find((u) => u.kind === "shop")!.state = "occupied"; // skip construction
    const before = sim.money;
    // Run from 07:00 to 23:00 — covers the shop's full 10:00–21:00 open span
    // without crossing midnight (which would add a maintenance charge and muddy
    // the income measurement).
    for (let i = 0; i < 16; i++) sim.tick(60);
    const earnedThatDay = sim.money - before;
    expect(earnedThatDay).toBeLessThanOrEqual(ECON.dailyTrafficIncome.shop);
    expect(earnedThatDay).toBeGreaterThan(0);
  });
});

describe("F14 — the Recycling Centre has a real effect", () => {
  function shopDayIncome(withRecycling: boolean): number {
    const tower = new Tower();
    for (let x = 0; x < 40; x++) tower.place("lobby", 1, x);
    for (let x = 0; x < 40; x++) tower.place("floor", 2, x);
    tower.placeTransport("elevatorStandard", 4, 1, 2); // floor 2 served
    tower.place("shop", 2, 0);
    tower.units.find((u) => u.kind === "shop")!.state = "occupied";
    if (withRecycling) {
      for (let x = 0; x < 40; x++) {
        tower.place("floor", 0, x);
        tower.place("floor", -1, x);
      }
      tower.place("recycling", -1, 0); // 2-floor basement facility
    }
    let money = 0;
    const ctx = {
      tower,
      clock: new Clock(12 * 60),
      rng: new RNG(1),
      get money() { return money; },
      set money(v: number) { money = v; },
      star: 5,
      emit: () => {},
      hasAny: (k: FacilityKind) => tower.units.some((u) => u.kind === k),
      hasOperational: (k: FacilityKind) =>
        tower.units.some((u) => u.kind === k && u.state !== "construction" && u.state !== "fire"),
      floorLabel: (f: number) => `${f}`,
    };
    new EconomySystem(ctx).collectTrafficIncome();
    return money;
  }

  it("lifts commercial appeal (recycling tower out-earns the bare one)", () => {
    expect(shopDayIncome(true)).toBeGreaterThan(shopDayIncome(false));
  });
});

describe("F21 — buried treasure is one-time per tile (no build/bulldoze farming)", () => {
  it("rebuilding on the same basement tiles never yields a second find", () => {
    const sim = Simulation.newGame(42);
    sim.star = 3;
    sim.money = 100_000_000;
    for (let x = 0; x < 40; x++) sim.tower.place("floor", 0, C - 20 + x);
    for (let i = 0; i < 40; i++) {
      sim.build("parking", 0, C - 20);
      sim.sellAt(0, C - 20);
    }
    const treasure = sim.log.filter((e) => e.text.toLowerCase().includes("treasure"));
    expect(treasure.length).toBeLessThanOrEqual(1);
  });

  it("persists excavation history across save/reload (no farming after a reload)", () => {
    const sim = Simulation.newGame(42);
    sim.star = 3;
    sim.money = 100_000_000;
    for (let x = 0; x < 40; x++) sim.tower.place("floor", 0, C - 20 + x);
    sim.build("parking", 0, C - 20); // marks the footprint excavated
    const reloaded = Simulation.deserialize(sim.serialize());
    reloaded.money = 100_000_000;
    const before = reloaded.log.length;
    for (let i = 0; i < 40; i++) {
      reloaded.sellAt(0, C - 20);
      reloaded.build("parking", 0, C - 20); // same tiles -> already excavated
    }
    const treasure = reloaded.log.slice(before).filter((e) => e.text.toLowerCase().includes("treasure"));
    expect(treasure.length).toBe(0); // excavation history survived the reload
  });
});

describe("F24 — hardened transport deserialization", () => {
  it("clamps a corrupt car count instead of crashing the tick loop", () => {
    const sim = servedTower(8, 6);
    const save = sim.serialize();
    (save.transports[0] as { cars: number }).cars = Number.NaN;
    const loaded = Simulation.deserialize(save);
    expect(Number.isFinite(loaded.tower.transports[0].cars)).toBe(true);
    expect(() => loaded.tick(60)).not.toThrow();
  });
});

describe("F8 — served-floor cache stays correct as transports change", () => {
  it("invalidates on add/remove (revision-keyed)", () => {
    const sim = Simulation.newGame(9);
    layFloor(sim, "floor", 2);
    expect(sim.tower.isFloorServed(2)).toBe(false);
    expect(sim.buildTransport("elevatorStandard", C, 1, 2).ok).toBe(true);
    expect(sim.tower.isFloorServed(2)).toBe(true); // cache saw the new shaft
    const t = sim.tower.transports[sim.tower.transports.length - 1];
    sim.tower.removeTransport(t.id);
    expect(sim.tower.isFloorServed(2)).toBe(false); // cache invalidated again
  });
});
