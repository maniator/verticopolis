import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { EventSystem } from "../../engine/EventSystem";
import { Tower } from "../../engine/Tower";
import { Clock } from "../../engine/Clock";
import { RNG } from "../../engine/rng";
import type { FacilityKind, WeatherKind } from "../../engine/types";

/** A mutable SimContext-shaped holder for driving EventSystem in isolation. */
function makeCtx(tower: Tower, star: number, money = 1_000_000) {
  return {
    tower,
    clock: new Clock(0),
    rng: new RNG(1),
    money,
    star,
    log: [] as string[],
    emit(text: string) {
      this.log.push(text);
    },
    hasAny: (kind: FacilityKind) => tower.units.some((u) => u.kind === kind),
    hasOperational: (kind: FacilityKind) =>
      tower.units.some((u) => u.kind === kind && u.state !== "construction" && u.state !== "fire"),
    floorLabel: (floor: number) => (floor >= 1 ? `floor ${floor}` : `B${1 - floor}`),
  };
}

/** A small tower with a built, occupiable floor 2 (for placing a service). */
function withFloor2(): Tower {
  const tower = new Tower();
  for (let x = 0; x < 12; x++) tower.place("lobby", 1, x);
  for (let x = 0; x < 12; x++) tower.place("floor", 2, x);
  return tower;
}

describe("Weather", () => {
  it("is deterministic per day and never touches the gameplay RNG", () => {
    expect(Simulation.weatherFor(42)).toBe(Simulation.weatherFor(42));
    // Two fresh games advanced identically stay in lock-step (proof the daily
    // weather hash didn't perturb any seeded outcome).
    const a = Simulation.newGame(123);
    const b = Simulation.newGame(123);
    for (let i = 0; i < 50; i++) {
      a.tick(60);
      b.tick(60);
    }
    expect(a.money).toBe(b.money);
    expect(a.population).toBe(b.population);
  });

  it("is mostly clear with some cloud and rain across the year", () => {
    const counts: Record<WeatherKind, number> = { clear: 0, cloudy: 0, rain: 0 };
    for (let d = 0; d < 720; d++) counts[Simulation.weatherFor(d)]++;
    expect(counts.clear).toBeGreaterThan(counts.cloudy + counts.rain); // clear dominates
    expect(counts.cloudy).toBeGreaterThan(0);
    expect(counts.rain).toBeGreaterThan(0);
  });
});

describe("Seasonal & visitor events", () => {
  function runDays(events: EventSystem, ctx: { clock: Clock }, days: number) {
    for (let d = 0; d < days; d++) {
      ctx.clock = new Clock(d * 1440);
      events.maybeRandomEvent();
    }
  }

  it("a thief steals from a tower with no security", () => {
    const ctx = makeCtx(new Tower(), 2);
    const events = new EventSystem(ctx, 7);
    runDays(events, ctx, 800);
    expect(ctx.log.some((m) => m.includes("made off"))).toBe(true);
    expect(ctx.money).toBeLessThan(1_000_000);
  });

  it("security catches thieves — none ever get away", () => {
    const tower = withFloor2();
    tower.place("security", 2, 0);
    const ctx = makeCtx(tower, 2);
    const events = new EventSystem(ctx, 7);
    runDays(events, ctx, 800);
    expect(ctx.log.some((m) => m.includes("caught a thief"))).toBe(true);
    expect(ctx.log.some((m) => m.includes("made off"))).toBe(false);
  });

  it("Santa visits a 3★ tower once over the holidays", () => {
    const ctx = makeCtx(new Tower(), 3);
    const events = new EventSystem(ctx, 7);
    runDays(events, ctx, 360); // one full year
    expect(ctx.log.filter((m) => m.includes("Santa")).length).toBe(1);
  });

  it("Santa skips a low-rated tower", () => {
    const ctx = makeCtx(new Tower(), 2); // below 3★
    const events = new EventSystem(ctx, 7);
    runDays(events, ctx, 360);
    expect(ctx.log.some((m) => m.includes("Santa"))).toBe(false);
  });

  it("persists Santa's once-a-year guard across save/load", () => {
    const ctx = makeCtx(new Tower(), 3);
    const events = new EventSystem(ctx, 7);
    runDays(events, ctx, 360); // Santa visits once this year
    expect(ctx.log.filter((m) => m.includes("Santa")).length).toBe(1);

    // Save → load into a fresh system (different seed), replay the same year's
    // holidays: the restored guard must keep Santa from visiting again.
    const saved = events.saveState();
    const ctx2 = makeCtx(new Tower(), 3);
    const events2 = new EventSystem(ctx2, 999);
    events2.loadState(saved);
    for (let d = 340; d < 360; d++) {
      ctx2.clock = new Clock(d * 1440);
      events2.maybeRandomEvent();
    }
    expect(ctx2.log.some((m) => m.includes("Santa"))).toBe(false);
  });
});

describe("Fires", () => {
  /** A tower with a flammable room, optionally defended by security + medical. */
  function fireTower(defended: boolean): Tower {
    const tower = new Tower();
    const W = 20;
    for (let x = 0; x < W; x++) tower.place("lobby", 1, x);
    // Floor 2 carries only the (optional) stations, so no office ever sits next
    // to one — keeps ignitions isolated (no spread) for a clean frequency count.
    for (let x = 0; x < W; x++) tower.place("floor", 2, x);
    if (defended) {
      tower.place("security", 2, 0);
      tower.place("medical", 2, 10);
    }
    // A large pool of ISOLATED offices (one per floor, so a fire can't spread and
    // depletion stays slow). Fires now destroy rooms permanently (gutted), so the
    // count must be read over a horizon short enough that neither tower burns out.
    for (let f = 3; f <= 42; f++) {
      for (let x = 0; x < W; x++) tower.place("floor", f, x);
      tower.place("office", f, 0);
    }
    return tower;
  }

  function runDays(events: EventSystem, ctx: { clock: Clock }, days: number) {
    for (let d = 0; d < days; d++) {
      ctx.clock = new Clock(d * 1440);
      events.maybeRandomEvent();
    }
  }

  it("fire-defense facilities make fires markedly rarer", () => {
    // Use a 3★ context: fires roll (≥2★) and the fixture can place Security +
    // Medical, but bomb threats (≥4★) stay out so this measures fire ignition
    // alone, not unrelated emergency behavior.
    const bare = makeCtx(fireTower(false), 3);
    const defended = makeCtx(fireTower(true), 3);
    runDays(new EventSystem(bare, 7), bare, 500);
    runDays(new EventSystem(defended, 7), defended, 500);
    const bareFires = bare.log.filter((m) => m.includes("Fire broke out")).length;
    const defendedFires = defended.log.filter((m) => m.includes("Fire broke out")).length;
    expect(bareFires).toBeGreaterThan(0);
    expect(defendedFires).toBeLessThan(bareFires);
  });

  it("scales the fire-rescue cost with the tower's rating", () => {
    const firstFireCost = (star: number): number | null => {
      const ctx = makeCtx(fireTower(false), star);
      const events = new EventSystem(ctx, 7);
      for (let d = 0; d < 8000; d++) {
        ctx.clock = new Clock(d * 1440);
        events.maybeRandomEvent();
        if (events.pending?.kind === "fireRescue") return events.pending.cost;
      }
      return null;
    };
    // Affordable while small, up to the original's $500k for a 5★ tower.
    expect(firstFireCost(2)).toBe(150_000);
    expect(firstFireCost(5)).toBe(500_000);
  });
});
