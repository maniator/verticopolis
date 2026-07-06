import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { ECON, rentOf } from "../engine/econConfig";
import { FACILITIES, GRID, residentCount } from "../engine/facilities";
import type { GameMode, Unit } from "../engine/types";
import { buildStatsHtml } from "../ui/statsHtml";

/**
 * Condo rule-sets: the Classic price/buy-back parity fixes (all towers) and the
 * Modern "variant households" feature, plus the immutable per-tower mode that
 * gates it. Companion to the office-noise condo tests in faqComplete.
 */

const W = GRID.width;
const C = Math.floor(W / 2);

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = 0; x < W; x++) sim.tower.place(kind, floor, x);
}

/** A single, served, not-yet-sold condo on floor 2 — ready to sell on a tick. */
function servedCondo(sim: Simulation): Unit {
  sim.money = 1e9;
  sim.star = 1; // no random fire/bomb events to perturb the run
  lay(sim, "lobby", 1);
  lay(sim, "floor", 2);
  sim.buildTransport("elevatorStandard", C, 1, 2);
  const r = sim.tower.place("condo", 2, C + 4);
  const condo = sim.tower.units.find((u) => u.id === r.unitId)!;
  condo.state = "empty"; // skip the construction phase
  condo.satisfaction = 1;
  return condo;
}

/** Tick hours until a predicate holds (or we give up), so RNG-driven move-ins
 *  and evictions can resolve without hard-coding a tick count. */
function tickUntil(sim: Simulation, pred: () => boolean, maxHours = 24 * 40): boolean {
  for (let i = 0; i < maxHours && !pred(); i++) sim.tick(60);
  return pred();
}

function foundedMode(sim: Simulation): GameMode {
  return sim.mode;
}

describe("Condo price band (Classic canon, all towers)", () => {
  it("anchors to construction-cost multiples: 1x floor, 2x default, 2.5x max", () => {
    const cost = FACILITIES.condo.cost;
    expect(cost).toBe(80_000);
    const band = ECON.rent.condo;
    expect(band.min).toBe(cost); // 1x — break-even, never below build cost
    expect(band.default).toBe(cost * 2); // 2x — the original's default
    expect(band.max).toBe(cost * 2.5); // 2.5x — the original's ceiling
  });
});

describe("Classic mode condos", () => {
  it("sell to a flat family of 3 at the asking price, no variant household", () => {
    const sim = Simulation.newGame(3, "classic");
    const condo = servedCondo(sim);
    expect(tickUntil(sim, () => condo.everOccupied)).toBe(true);
    expect(condo.residents).toBeUndefined();
    expect(residentCount(condo)).toBe(3);
    // Sold at the flat asking price — the log names no household.
    expect(sim.log.some((e) => /sold for \$160,000\.$/.test(e.text))).toBe(true);
    expect(sim.log.some((e) => /household of/.test(e.text))).toBe(false);
  });

  it("counts exactly 3 population per sold condo", () => {
    const sim = Simulation.newGame(3, "classic");
    const condo = servedCondo(sim);
    tickUntil(sim, () => condo.everOccupied);
    // One condo, plus nothing else that houses people.
    expect(sim.tower.totalPopulation()).toBe(3);
  });
});

describe("Modern mode condos — variant households", () => {
  it("draw a 2-5 person household on sale and count its real size", () => {
    const sim = Simulation.newGame(3, "modern");
    const condo = servedCondo(sim);
    expect(tickUntil(sim, () => condo.everOccupied)).toBe(true);
    expect(condo.residents).toBeGreaterThanOrEqual(2);
    expect(condo.residents).toBeLessThanOrEqual(5);
    // The census counts the actual household, not a flat 3.
    expect(residentCount(condo)).toBe(condo.residents);
    expect(sim.tower.totalPopulation()).toBe(condo.residents);
  });

  it("scale the sale price by household size relative to the classic 3", () => {
    const sim = Simulation.newGame(7, "modern");
    const condo = servedCondo(sim);
    tickUntil(sim, () => condo.everOccupied);
    const base = ECON.rent.condo.default;
    const expected = Math.round((base * condo.residents!) / 3);
    const m = sim.log.find((e) => /sold to a household of (\d+) for \$([\d,]+)/.test(e.text))!;
    const [, size, price] = /household of (\d+) for \$([\d,]+)/.exec(m.text)!;
    expect(Number(size)).toBe(condo.residents);
    expect(Number(price.replace(/,/g, ""))).toBe(expected);
  });
});

describe("residentCount seam", () => {
  it("honors a household only on condos, ignoring a forged value elsewhere", () => {
    // A forged `residents` on an office must not inflate its head count.
    const office = { kind: "office", residents: 99 } as unknown as Unit;
    expect(residentCount(office)).toBe(FACILITIES.office.population);
    // A condo without a household reads the flat catalog population.
    const plain = { kind: "condo" } as unknown as Unit;
    expect(residentCount(plain)).toBe(3);
    // A condo with a household reads it.
    const family = { kind: "condo", residents: 5 } as unknown as Unit;
    expect(residentCount(family)).toBe(5);
  });
});

describe("Buy-back on an evicted owner (Classic canon, all towers)", () => {
  it("charges the sale price back and returns the unit to the market", () => {
    const sim = Simulation.newGame(5, "classic");
    const condo = servedCondo(sim);
    tickUntil(sim, () => condo.everOccupied);
    const soldFor = rentOf(condo); // flat asking price in Classic
    const before = sim.money;
    // Cut the floor off from the lobby so the owner is starved of access and,
    // after the notice window, leaves for good.
    for (const t of [...sim.tower.transports]) sim.tower.removeTransport(t.id);
    expect(tickUntil(sim, () => condo.state === "empty" && !condo.everOccupied)).toBe(true);
    // Repurchased at full price: funds drop by exactly the sale price.
    expect(before - sim.money).toBe(soldFor);
    // Back on the market — resettable and re-sellable.
    expect(condo.everOccupied).toBe(false);
    expect(condo.residents).toBeUndefined();
    expect(sim.log.some((e) => /owner left .*bought it back for/.test(e.text))).toBe(true);
  });

  it("mirrors the size-scaled price in Modern", () => {
    const sim = Simulation.newGame(7, "modern");
    const condo = servedCondo(sim);
    tickUntil(sim, () => condo.everOccupied);
    const size = condo.residents!;
    const expected = Math.round((rentOf(condo) * size) / 3);
    const before = sim.money;
    for (const t of [...sim.tower.transports]) sim.tower.removeTransport(t.id);
    expect(tickUntil(sim, () => !condo.everOccupied)).toBe(true);
    expect(before - sim.money).toBe(expected);
  });
});

describe("Household churn sensitivity", () => {
  it("drains a bigger unserved household faster than a smaller one", () => {
    const sim = Simulation.newGame(1, "modern");
    sim.money = 1e9;
    sim.star = 1;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2); // floor 2 has NO transport → unserved
    const mk = (x: number, residents: number): Unit => {
      const r = sim.tower.place("condo", 2, x);
      const u = sim.tower.units.find((h) => h.id === r.unitId)!;
      u.state = "occupied";
      u.everOccupied = true;
      u.residents = residents;
      u.satisfaction = 1;
      return u;
    };
    const big = mk(C + 4, 5);
    const small = mk(C + 24, 2);
    sim.tick(60); // one hour of the unserved drain
    // Same starting satisfaction, same neglect — the 5-person family suffers more.
    expect(big.satisfaction).toBeLessThan(small.satisfaction);
  });
});

describe("Mode is founded once and persists", () => {
  it("round-trips through serialize/deserialize", () => {
    const modern = Simulation.newGame(2, "modern");
    expect(foundedMode(modern)).toBe("modern");
    const reloaded = Simulation.deserialize(modern.serialize());
    expect(reloaded.mode).toBe("modern");
  });

  it("defaults a pre-mode (legacy) save to classic", () => {
    const sim = Simulation.newGame(2, "modern");
    const raw = sim.serialize();
    delete (raw as { mode?: unknown }).mode; // simulate a save written before the fork
    expect(Simulation.deserialize(raw).mode).toBe("classic");
  });

  it("preserves a household across reload and clamps a forged one", () => {
    const sim = Simulation.newGame(7, "modern");
    const condo = servedCondo(sim);
    tickUntil(sim, () => condo.everOccupied);
    const size = condo.residents!;
    const reloaded = Simulation.deserialize(sim.serialize());
    const rc = reloaded.tower.units.find((u) => u.kind === "condo" && u.everOccupied)!;
    expect(rc.residents).toBe(size);

    // A forged out-of-range household is clamped into the real generator band
    // (2..5), never left to blow up the population census.
    const raw = sim.serialize();
    for (const u of raw.units) if (u.kind === "condo") u.residents = 9999;
    const hardened = Simulation.deserialize(raw);
    const hc = hardened.tower.units.find((u) => u.kind === "condo")!;
    expect(hc.residents).toBeLessThanOrEqual(5);
    expect(hc.residents).toBeGreaterThanOrEqual(2);
  });

  it("strips a forged household from a Classic save (census stays canon)", () => {
    const sim = Simulation.newGame(3, "classic");
    const condo = servedCondo(sim);
    tickUntil(sim, () => condo.everOccupied);
    const raw = sim.serialize();
    // Someone hand-edits a Classic save to smuggle in a variable household.
    for (const u of raw.units) if (u.kind === "condo") u.residents = 5;
    const reloaded = Simulation.deserialize(raw);
    const rc = reloaded.tower.units.find((u) => u.kind === "condo" && u.everOccupied)!;
    // Classic condos MUST stay flat 3s — the forged household is dropped.
    expect(rc.residents).toBeUndefined();
    expect(reloaded.tower.totalPopulation()).toBe(3);
  });
});

describe("Not-present households never ghost the readout (gutted/empty)", () => {
  it("excludes a gutted sold condo from both population and the Households section", () => {
    const sim = Simulation.newGame(3, "modern");
    const condo = servedCondo(sim);
    tickUntil(sim, () => condo.everOccupied);
    expect(sim.tower.totalPopulation()).toBe(condo.residents);
    expect(buildStatsHtml(sim)).toContain("People housed");
    // A fire guts the only sold condo: it stops being present.
    condo.state = "gutted";
    // Population drops it (isPresent false) …
    expect(sim.tower.totalPopulation()).toBe(0);
    // … and the Households readout drops it too — no ghost family, back to the
    // empty-state placeholder rather than a stale "People housed".
    expect(buildStatsHtml(sim)).toContain("No condos sold yet");
  });
});

describe("Stats panel — Households section (Modern only)", () => {
  it("shows a Households section on a Modern tower, and not on a Classic one", () => {
    const modern = Simulation.newGame(3, "modern");
    const mc = servedCondo(modern);
    tickUntil(modern, () => mc.everOccupied);
    const modernHtml = buildStatsHtml(modern);
    expect(modernHtml).toContain("Households");
    expect(modernHtml).toMatch(/Avg household/);

    const classic = Simulation.newGame(3, "classic");
    const cc = servedCondo(classic);
    tickUntil(classic, () => cc.everOccupied);
    expect(buildStatsHtml(classic)).not.toContain("Households");
  });
});
