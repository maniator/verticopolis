import { describe, it, expect } from "vitest";
import { html } from "lit-html";
import { Simulation } from "../../engine/Simulation";
import { computeDemandMap } from "../../engine/sim/demand";
import { ECON } from "../../engine/econConfig";
import { GRID, FACILITIES } from "../../engine/facilities";
import type { GameMode, Unit } from "../../engine/types";
import { facilityDiagnostics } from "../../game/facilityDiagnostics";
import { renderToFragment } from "../../ui/testing/litTestUtils";

/**
 * The commercial demand-pools model (gdd/arch-commercial-demand-pools-2026-07-15):
 * a per-origin census budget split across the reachable venues by capacity,
 * `min(1, pool / reachableCapacity)` in place of the old tower-wide appeal
 * scalar. These pin the core properties the design promises: conservation,
 * cross-venue cannibalization, stranded-origin coverage, the appeal cap, and the
 * Classic/Modern floor.
 */

const C = Math.floor(GRID.width / 2);
const OFFICE_POP = FACILITIES.office.population; // census head count per occupied office
const PC = ECON.demandPerCapita;

function expectOk<T extends { ok: boolean; reason?: string }>(r: T): T {
  expect(r.ok, r.reason).toBe(true);
  return r;
}

/** Lay a full floor of `kind`, building outward from the center (the
 *  connectivity order) and skipping tiles the new-game seed already laid as this
 *  kind (re-placing would fail "Structure already here"). */
function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  const put = (x: number): void => {
    if (sim.tower.structureKindAt(floor, x) === kind) return;
    expectOk(sim.tower.place(kind, floor, x));
  };
  for (let x = C; x < GRID.width; x++) put(x);
  for (let x = C - 1; x >= 0; x--) put(x);
}

/** Place an occupied unit and return it. */
function occupied(sim: Simulation, kind: Unit["kind"], floor: number, x: number): Unit {
  const r = expectOk(sim.tower.place(kind, floor, x));
  const u = sim.tower.units.find((it) => it.id === r.unitId);
  expect(u, `no unit for ${kind}`).toBeDefined();
  u!.state = "occupied";
  return u!;
}

/** A served floor-2 tower (lobby, floor 2, an elevator spanning 1..2) so every
 *  floor-2 unit draws visitors. */
function servedTower(seed = 1, mode: GameMode = "classic"): Simulation {
  const sim = Simulation.newGame(seed, mode);
  sim.money = 1e12;
  sim.star = 5;
  lay(sim, "lobby", 1);
  lay(sim, "floor", 2);
  expectOk(sim.buildTransport("elevatorStandard", C, 1, 2));
  return sim;
}

describe("commercial demand pools", () => {
  it("conserves the demand pool across venues (sum of delivered demand equals the origin budgets)", () => {
    const sim = servedTower();
    const offices = 4;
    for (let i = 0; i < offices; i++) occupied(sim, "office", 2, 20 + i * 12);
    occupied(sim, "shop", 2, C + 20); // one reachable venue, uncapped by 4 offices

    const map = computeDemandMap(sim);
    const pool = offices * OFFICE_POP * ECON.mealPopulationWeights.office * PC; // no metro/recycling => M_tower = 1
    const delivered = [...map.deliveredByUnit.values()].reduce((a, b) => a + b, 0);
    // Uncapped (share < 1), so every demand dollar is delivered: conservation.
    expect(delivered).toBeCloseTo(pool, 6);
  });

  it("cannibalizes: a second identical reachable venue halves the first's fraction", () => {
    const one = servedTower();
    for (let i = 0; i < 4; i++) occupied(one, "office", 2, 20 + i * 12);
    const shopA = occupied(one, "shop", 2, C + 20);
    const frac1 = computeDemandMap(one).fractionByUnit.get(shopA.id)!;

    const two = servedTower();
    for (let i = 0; i < 4; i++) occupied(two, "office", 2, 20 + i * 12);
    const shopB = occupied(two, "shop", 2, C + 20);
    occupied(two, "shop", 2, C + 40); // identical second shop shares the same origins
    const frac2 = computeDemandMap(two).fractionByUnit.get(shopB.id)!;

    expect(frac2).toBeCloseTo(frac1 / 2, 6);
  });

  it("caps a venue's fraction at 1 when demand exceeds its capacity", () => {
    const sim = servedTower();
    // A large office block (packed left of the center shaft): pool far exceeds
    // the single shop's daily capacity.
    for (let i = 0; i < 20; i++) occupied(sim, "office", 2, i * 9);
    const shop = occupied(sim, "shop", 2, C + 20);
    const pool = 20 * OFFICE_POP * ECON.mealPopulationWeights.office * PC;
    expect(pool).toBeGreaterThan(ECON.dailyTrafficIncome.shop); // precondition: over-demanded
    expect(computeDemandMap(sim).fractionByUnit.get(shop.id)).toBe(1);
  });

  it("counts reachable venues per origin, and zeroes a stranded origin's coverage", () => {
    const sim = servedTower();
    lay(sim, "floor", 3); // built but no shaft reaches it: served floor 2 only
    const reached = occupied(sim, "office", 2, 20); // on the served floor
    const stranded = occupied(sim, "office", 3, 20); // on the unreachable floor
    occupied(sim, "shop", 2, C + 20);
    expect(sim.tower.isFloorServed(3)).toBe(false); // precondition: floor 3 is stranded

    const map = computeDemandMap(sim);
    expect(map.reachableVenuesByOrigin.get(reached.id)).toBe(1); // one reachable venue
    expect(map.reachableVenuesByOrigin.get(stranded.id)).toBe(0); // reaches nothing
  });

  it("counts an asleep hotel guest as a demand origin (not just occupied offices/condos)", () => {
    const sim = servedTower();
    const hotel = occupied(sim, "hotelSingle", 2, 20);
    hotel.state = "asleep"; // a guest-occupied hotel room sits asleep, never "occupied"
    const shop = occupied(sim, "shop", 2, C + 20);

    const map = computeDemandMap(sim);
    expect(map.reachableVenuesByOrigin.get(hotel.id)).toBe(1); // the hotel is a live origin
    expect(map.fractionByUnit.get(shop.id)!).toBeGreaterThan(0); // its guests feed the shop
  });

  it("applies the mode floor: Classic starves an empty tower's venue, Modern keeps a street-trade baseline", () => {
    const classic = servedTower(1, "classic");
    const cShop = occupied(classic, "shop", 2, C + 20); // no offices: zero demand pool
    expect(computeDemandMap(classic).fractionByUnit.get(cShop.id)).toBe(0);

    const modern = servedTower(1, "modern");
    const mShop = occupied(modern, "shop", 2, C + 20);
    expect(computeDemandMap(modern).fractionByUnit.get(mShop.id)).toBe(ECON.demandFloorModern);
  });

  it("surfaces the venue's real local-demand share in the rendered inspector card (Phase B)", () => {
    const sim = servedTower();
    for (let i = 0; i < 4; i++) occupied(sim, "office", 2, 20 + i * 12);
    const shop = occupied(sim, "shop", 2, C + 20);
    const pct = Math.round((sim.demandMap().fractionByUnit.get(shop.id) ?? 0) * 100);
    expect(pct).toBeGreaterThan(0); // precondition: the offices give the shop real demand
    const text = renderToFragment(html`<div>${facilityDiagnostics(sim, shop)}</div>`).textContent ?? "";
    expect(text).toContain(`Local demand: ${pct}% of capacity.`);
  });

  it("earns the plain min(1, share) below the cap in both modes, so the split stays conservative (Phase C)", () => {
    // The per-venue fraction is the identity `min(1, share)` below the cap in
    // BOTH modes (only the small-tower floor differs today, Classic 0 vs Modern
    // demandFloorModern; per-capita is shared, a Modern retune is reserved for
    // calibration). A curve that lifted the fraction above the identity would let
    // total delivered demand exceed the pool as venues are added, breaking
    // conservation and inverting the flagship cannibalization property; this pins
    // that both modes stay on the conservative identity.
    const build = (mode: GameMode) => {
      const sim = servedTower(1, mode);
      for (let i = 0; i < 7; i++) occupied(sim, "office", 2, 20 + i * 12);
      const shop = occupied(sim, "shop", 2, C + 20);
      return { map: computeDemandMap(sim), shopId: shop.id };
    };
    const classic = build("classic");
    const modern = build("modern");
    const share = classic.map.share;
    // Precondition: pin the identity band `floor < share < 1`. Above the Modern
    // floor (so `max(floor, ...)` is not what lifts Modern's fraction here, the
    // test genuinely exercises `min(1, share)`) and below the cap (so the shape
    // matters, not the clamp).
    expect(share).toBeGreaterThan(ECON.demandFloorModern);
    expect(share).toBeLessThan(1);
    expect(modern.map.share).toBeCloseTo(share, 6); // share is mode-independent (pool and capacity are the same)
    const cFrac = classic.map.fractionByUnit.get(classic.shopId)!;
    const mFrac = modern.map.fractionByUnit.get(modern.shopId)!;
    expect(cFrac).toBeCloseTo(Math.min(1, share), 6); // Classic: plain min(1, share)
    expect(mFrac).toBeCloseTo(Math.min(1, share), 6); // Modern: same identity (its floor is far below this share)
  });

  it("exposes the raw uncapped share even when the earned fraction is capped at 1 (Phase C)", () => {
    const sim = servedTower(1, "classic");
    for (let i = 0; i < 20; i++) occupied(sim, "office", 2, i * 9); // over-demanded: pool exceeds the shop's capacity
    const shop = occupied(sim, "shop", 2, C + 20);
    const map = computeDemandMap(sim);
    expect(map.fractionByUnit.get(shop.id)).toBe(1); // the fraction is capped
    expect(map.share).toBeGreaterThan(1); // but the raw pressure (an under-served area) is still visible
  });
});
