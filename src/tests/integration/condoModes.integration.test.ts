import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { ECON, rentOf } from "../../engine/econConfig";
import { FACILITIES, GRID, residentCount } from "../../engine/facilities";
import type { GameMode, Unit } from "../../engine/types";

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

describe("No-Rate units stay off-market (no move-in, no sale, $0)", () => {
  it("an empty No-Rate condo never sells and earns nothing over a long run", () => {
    const sim = Simulation.newGame(3, "classic");
    const condo = servedCondo(sim);
    condo.noRate = true; // off the market (imported class 4)
    const before = sim.money;
    // Far past the ~40 in-game hours a normal served condo takes to sell.
    for (let i = 0; i < 24 * 80; i++) sim.tick(60);
    expect(condo.everOccupied).toBe(false); // no buyer seated at $0
    expect(condo.state).toBe("empty");
    expect(condo.rent).toBeUndefined(); // no $0 sale stamped a magic rent
    expect(rentOf(condo)).toBe(0);
    expect(sim.log.some((e) => /sold/.test(e.text))).toBe(false); // never sold
    expect(sim.money).toBeLessThanOrEqual(before); // gained no income (only overhead)
  });

  it("an empty No-Rate office never leases", () => {
    const sim = Simulation.newGame(3, "classic");
    sim.money = 1e9;
    sim.star = 1;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.buildTransport("elevatorStandard", C, 1, 2);
    const r = sim.tower.place("office", 2, C + 4);
    const office = sim.tower.units.find((u) => u.id === r.unitId)!;
    office.state = "empty";
    office.satisfaction = 1;
    office.noRate = true;
    for (let i = 0; i < 24 * 40; i++) sim.tick(60);
    expect(office.everOccupied).toBe(false); // never leased
    expect(office.state).toBe("empty");
    expect(rentOf(office)).toBe(0);
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

  it("re-lists a bought-back condo in the current band, dropping a legacy out-of-band price", () => {
    const sim = Simulation.newGame(3, "classic");
    const condo = servedCondo(sim);
    tickUntil(sim, () => condo.everOccupied);
    condo.rent = 240_000; // a legacy sold price above the current $200k max
    sim.money = 1e9;
    const before = sim.money;
    for (const t of [...sim.tower.transports]) sim.tower.removeTransport(t.id);
    expect(tickUntil(sim, () => !condo.everOccupied)).toBe(true);
    // Buy-back still charged the historical price it sold for …
    expect(before - sim.money).toBe(240_000);
    // … but the returned-to-market asking price is clamped into the current band.
    expect(rentOf(condo)).toBe(200_000);
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

describe("Save hardening at the trust boundary", () => {
  it("coerces a forged non-boolean everOccupied to false (no phantom sold condo)", () => {
    const sim = Simulation.newGame(3, "classic");
    servedCondo(sim);
    const raw = sim.serialize();
    // A hand-edited save with a truthy non-boolean sold flag.
    for (const u of raw.units) if (u.kind === "condo") (u as { everOccupied: unknown }).everOccupied = "yes";
    const reloaded = Simulation.deserialize(raw);
    const rc = reloaded.tower.units.find((u) => u.kind === "condo")!;
    expect(rc.everOccupied).toBe(false); // strictly boolean, not truthy
  });

  it("re-enters a legacy dead condo (everOccupied+empty) into the market on load", () => {
    // A save from before the buy-back change: an owner left, `vacate()` set the
    // unit empty but kept everOccupied true. It must not reload as permanently
    // off-market.
    const sim = Simulation.newGame(3, "classic");
    const condo = servedCondo(sim);
    const raw = sim.serialize();
    for (const u of raw.units) {
      if (u.kind === "condo") {
        u.everOccupied = true;
        u.state = "empty";
      }
    }
    const reloaded = Simulation.deserialize(raw);
    const rc = reloaded.tower.units.find((u) => u.kind === "condo")!;
    expect(rc.everOccupied).toBe(false); // normalized → can re-sell
    void condo;
  });

  it("does not treat a not-yet-built (construction) unit as sold on load", () => {
    const sim = Simulation.newGame(3, "classic");
    servedCondo(sim);
    const raw = sim.serialize();
    for (const u of raw.units) {
      if (u.kind === "condo") {
        u.everOccupied = true;
        u.state = "construction"; // forged: sold-but-still-building is impossible
      }
    }
    const reloaded = Simulation.deserialize(raw);
    const rc = reloaded.tower.units.find((u) => u.kind === "condo")!;
    expect(rc.everOccupied).toBe(false); // can still sell once built
  });

  it("keeps a hotel room's everOccupied when a miserable guest leaves (runtime vacate path)", () => {
    // A chronically unserved hotel room loses its guest via vacate() (the F25
    // branch). everOccupied is the "ever booked" marker for hotels and must
    // survive that, unlike an office/condo returning to market.
    const sim = Simulation.newGame(3, "classic");
    sim.money = 1e9;
    sim.star = 1; // no random events
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2); // no transport → unserved, so satisfaction bottoms out
    const r = sim.tower.place("hotelSingle", 2, C);
    const room = sim.tower.units.find((u) => u.id === r.unitId)!;
    room.state = "asleep";
    room.everOccupied = true;
    room.satisfaction = 0.05;
    // Cast defeats TS control-flow narrowing from the `state = "asleep"` above —
    // sim.tick mutates it, but the compiler can't see that.
    for (let i = 0; i < 24 && (room.state as string) !== "empty"; i++) sim.tick(60);
    expect(room.state as string).toBe("empty"); // the guest left …
    expect(room.everOccupied).toBe(true); // … but "ever booked" is preserved
  });

  it("keeps a hotel room's everOccupied through an empty (between-guests) round-trip", () => {
    // Hotels legitimately sit `empty` between guests while staying "ever booked";
    // the lease/sale normalization must NOT reset them the way it resets an
    // empty office/condo.
    const sim = Simulation.newGame(3, "classic");
    sim.money = 1e9;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    const r = sim.tower.place("hotelSingle", 2, C);
    const room = sim.tower.units.find((u) => u.id === r.unitId)!;
    room.state = "empty";
    room.everOccupied = true;
    const reloaded = Simulation.deserialize(sim.serialize());
    expect(reloaded.tower.units.find((u) => u.kind === "hotelSingle")!.everOccupied).toBe(true);
  });

  it("backfills a corrupt pre-fork save (invalid mode string) as legacy for condo pricing", () => {
    const sim = Simulation.newGame(3, "classic");
    const condo = servedCondo(sim);
    tickUntil(sim, () => condo.everOccupied);
    const raw = sim.serialize();
    (raw as { mode?: unknown }).mode = "garbage"; // corrupt, not a valid GameMode
    for (const u of raw.units) if (u.kind === "condo") delete (u as { rent?: unknown }).rent;
    const reloaded = Simulation.deserialize(raw);
    expect(reloaded.mode).toBe("classic"); // invalid mode resolves to classic …
    const rc = reloaded.tower.units.find((u) => u.kind === "condo" && u.everOccupied)!;
    // … migration treats it as legacy (the old $120k default, not the new
    // $160k), and the Classic snap-on-load then lands that on the nearest
    // canon rung ($100,000), the ratified uniform migration (NFR3).
    expect(rentOf(rc)).toBe(100_000);
  });

  it("clears a stale household on a not-sold condo on load", () => {
    const sim = Simulation.newGame(3, "modern");
    servedCondo(sim);
    const raw = sim.serialize();
    // Forge a household onto an EMPTY (not-sold) condo, as a hand-edited or
    // legacy save might.
    for (const u of raw.units) {
      if (u.kind === "condo") {
        u.state = "empty";
        u.everOccupied = false;
        u.residents = 5;
      }
    }
    const reloaded = Simulation.deserialize(raw);
    const rc = reloaded.tower.units.find((u) => u.kind === "condo")!;
    expect(rc.residents).toBeUndefined(); // no stale household leaks into the census/UI
  });

  it("stamps the asking price on sale so buy-back survives a later default change", () => {
    const sim = Simulation.newGame(3, "classic");
    const condo = servedCondo(sim);
    tickUntil(sim, () => condo.everOccupied);
    // The sale records its asking price on the unit, so rentOf no longer depends
    // on the kind default (which a future build could move).
    expect(condo.rent).toBe(ECON.rent.condo.default);
  });

  it("backfills a legacy sold condo's price to the pre-re-anchor default", () => {
    // A pre-mode save (no `mode`) whose sold condo omitted `rent` sold at the OLD
    // $120k default; its buy-back must mirror that, not pick up the new $160k.
    const sim = Simulation.newGame(3, "classic");
    const condo = servedCondo(sim);
    tickUntil(sim, () => condo.everOccupied);
    const raw = sim.serialize();
    delete (raw as { mode?: unknown }).mode;
    for (const u of raw.units) if (u.kind === "condo") delete (u as { rent?: unknown }).rent;
    const reloaded = Simulation.deserialize(raw);
    const rc = reloaded.tower.units.find((u) => u.kind === "condo" && u.everOccupied)!;
    // The backfill lands on the old $120k default; the Classic snap-on-load
    // then takes it to the nearest canon rung (ties round up; $100,000). The
    // one-time buy-back shift is the accepted NFR3 migration cost.
    expect(rentOf(rc)).toBe(100_000);
  });

  it("bounds a forged sold-condo price so buy-back can't drain money without limit", () => {
    const sim = Simulation.newGame(3, "classic");
    const condo = servedCondo(sim);
    tickUntil(sim, () => condo.everOccupied);
    const raw = sim.serialize();
    for (const u of raw.units) if (u.kind === "condo") u.rent = 1e9; // absurd forged price
    const reloaded = Simulation.deserialize(raw);
    const rc = reloaded.tower.units.find((u) => u.kind === "condo" && u.everOccupied)!;
    // Clamped to the widest-ever ceiling ($240k) first, then snapped onto the
    // Classic ladder: nothing off-ladder (let alone 1e9) survives a load.
    expect(rentOf(rc)).toBe(200_000);
  });

  it("snaps a Classic condo's legacy out-of-band price onto the ladder, sold or not", () => {
    const sim = Simulation.newGame(3, "classic");
    const a = servedCondo(sim);
    const b = sim.tower.place("condo", 2, C + 24);
    const sold = sim.tower.units.find((u) => u.id === b.unitId)!;
    // a: unsold, priced at the OLD max ($240k, above the new $200k ceiling).
    a.rent = 240_000;
    a.everOccupied = false;
    // sold: an owned (occupied) condo carrying a historical out-of-band price —
    // must be kept so its buy-back mirrors what it actually sold for.
    sold.rent = 240_000;
    sold.everOccupied = true;
    sold.state = "occupied";
    const reloaded = Simulation.deserialize(sim.serialize());
    const ra = reloaded.tower.units.find((u) => u.id === a.id)!;
    const rsold = reloaded.tower.units.find((u) => u.id === sold.id)!;
    // Classic snap-on-load is uniform (NFR3, no intent-guessing): the unsold
    // AND the sold price land on the nearest canon rung. The sold condo's
    // buy-back now mirrors the snapped rung, the accepted one-time shift.
    expect(rentOf(ra)).toBe(200_000);
    expect(rentOf(rsold)).toBe(200_000);
  });

  it("Modern load clamps an unsold condo into the band and keeps a sold price untouched", () => {
    const sim = Simulation.newGame(3, "modern");
    const a = servedCondo(sim);
    const b = sim.tower.place("condo", 2, C + 24);
    const sold = sim.tower.units.find((u) => u.id === b.unitId)!;
    // a: unsold, priced at the OLD max ($240k, above the new $200k ceiling).
    a.rent = 240_000;
    a.everOccupied = false;
    // sold: an owned condo carrying a historical out-of-band price, kept so
    // its buy-back mirrors what it actually sold for (Modern is untouched by
    // the Classic snap).
    sold.rent = 240_000;
    sold.everOccupied = true;
    sold.state = "occupied";
    const reloaded = Simulation.deserialize(sim.serialize());
    const ra = reloaded.tower.units.find((u) => u.id === a.id)!;
    const rsold = reloaded.tower.units.find((u) => u.id === sold.id)!;
    expect(rentOf(ra)).toBe(200_000); // unsold clamped down to the band max
    expect(rentOf(rsold)).toBe(240_000); // sold left untouched
  });
});
