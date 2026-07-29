import { describe, it, expect } from "vitest";
import {
  CLASSIC_RULES,
  MODERN_RULES,
  makeRules,
  householdPrice,
  priceNeutral,
  snapToLadder,
  ladderRungFor,
  type PriceRung,
} from "./gameRules";
import { FACILITIES, GRID } from "./facilities";
import { ECON, PRICED_KINDS } from "./econConfig";
import { RNG } from "./rng";
import {
  LOBBY_FAR_FLOORS,
  LOBBY_VERY_FAR_FLOORS,
  LOBBY_FAR_CAP,
  LOBBY_VERY_FAR_CAP,
  LOBBY_VERY_FAR_EROSION,
  UNMET_DEMAND_FLOOR,
  UNMET_DEMAND_CAP,
  UNMET_DEMAND_EVICT_FLOOR,
  SERVED_RECOVERY,
} from "./sim/constants";

/**
 * The rule-set strategy object in isolation — the one place Classic and Modern
 * diverge. Testing the policies directly (not through a full Simulation) is the
 * payoff of extracting them: each mode's behavior is a small, pure surface.
 */

const CLASSIC_3 = FACILITIES.condo.population;

describe("makeRules", () => {
  it("maps each mode to its rule-set", () => {
    expect(makeRules("classic")).toBe(CLASSIC_RULES);
    expect(makeRules("modern")).toBe(MODERN_RULES);
  });

  it("gates the escalator office-floor rule by mode", () => {
    expect(CLASSIC_RULES.allowsEscalatorOnOfficeFloors).toBe(false); // 1994 canon
    expect(MODERN_RULES.allowsEscalatorOnOfficeFloors).toBe(true);
  });

  it("selects the Classic walk-budget router by mode (#503/#509)", () => {
    // Classic uses the uncapped walk-budget router (parity: no ride cap, no
    // express lobby gate, walkway willingness applies). Modern uses the plain
    // uncapped BFS with no walk budget (its commute discomfort is the deferred
    // #502 comfort track).
    expect(CLASSIC_RULES.walkwayWillingnessApplies()).toBe(true);
    expect(MODERN_RULES.walkwayWillingnessApplies()).toBe(false);
  });

});

describe("lobby-distance band geometry (both rule-sets)", () => {
  it("derives the far edge from the lobby ladder: correct play is penalty-free", () => {
    // Lobbies are legal only on the ground and every lobbyInterval-th floor, so
    // the deepest mid-block floor of a complete ladder sits floor(interval / 2)
    // from a lobby. That distance must carry no drain in either mode, or a tower
    // with every legal lobby built would be penalized with no legal fix (the
    // v1.44.0 shipping bug). This inequality is geometry, not tuning: if it
    // fails, someone re-tuned LOBBY_FAR_FLOORS below the lobby ladder's reach.
    const midBlock = Math.floor(GRID.lobbyInterval / 2);
    expect(LOBBY_FAR_FLOORS).toBeGreaterThanOrEqual(midBlock);
    expect(CLASSIC_RULES.lobbyDistanceDrain(midBlock)).toEqual({ cap: 1, erosion: 0 });
    expect(MODERN_RULES.lobbyDistanceDrain(midBlock)).toEqual({ cap: 1, erosion: 0 });
    // The far band must be non-empty: FAR strictly below VERY_FAR, or a future
    // lobbyInterval retune (the FAR edge tracks it; VERY_FAR is hand-tuned)
    // would jump straight from no-penalty to the evicting band and collapse
    // Modern's ramp span.
    expect(LOBBY_FAR_FLOORS).toBeLessThan(LOBBY_VERY_FAR_FLOORS);
  });

  it("keeps the block above the highest buildable lobby capped at worst, never evicting", () => {
    // The top of the tower has no legal nearer slot (the next every-15 floor
    // exceeds maxFloor), so its worst distance may cap satisfaction but must
    // never carry an evicting erosion: unavoidable geometry informs, it does
    // not punish. Both modes.
    const highestSlot = Math.floor(GRID.maxFloor / GRID.lobbyInterval) * GRID.lobbyInterval;
    const worstTopDistance = GRID.maxFloor - highestSlot;
    expect(worstTopDistance).toBeLessThanOrEqual(LOBBY_VERY_FAR_FLOORS);
    expect(CLASSIC_RULES.lobbyDistanceDrain(worstTopDistance).erosion).toBe(0);
    expect(MODERN_RULES.lobbyDistanceDrain(worstTopDistance).erosion).toBe(0);
  });
});

describe("householdPrice", () => {
  it("is the base for a household-less condo and scales by size otherwise", () => {
    expect(householdPrice(160_000, undefined)).toBe(160_000);
    expect(householdPrice(160_000, 3)).toBe(160_000); // the classic 3 is parity
    expect(householdPrice(150_000, 2)).toBe(Math.round((150_000 * 2) / CLASSIC_3));
    expect(householdPrice(150_000, 5)).toBe(Math.round((150_000 * 5) / CLASSIC_3));
  });
});

describe("CLASSIC_RULES", () => {
  it("sells the flat 3 at the asking price and never touches the RNG", () => {
    const rng = new RNG(42);
    const before = rng.seed;
    const sale = CLASSIC_RULES.sellCondo(160_000, rng);
    expect(sale).toEqual({ price: 160_000, residents: undefined });
    expect(rng.seed).toBe(before); // determinism: Classic must not advance the stream
  });

  it("strips any household and never adjusts churn", () => {
    expect(CLASSIC_RULES.hasVariantHouseholds).toBe(false);
    expect(CLASSIC_RULES.coerceResidents(5)).toBeUndefined();
    expect(CLASSIC_RULES.coerceResidents(undefined)).toBeUndefined();
    expect(CLASSIC_RULES.churnMultiplier(5)).toBe(1);
    expect(CLASSIC_RULES.churnMultiplier(undefined)).toBe(1);
  });

  it("runs NONE of the Modern economy sinks (pixel-faithful late game)", () => {
    // The three non-canon mechanics (gdd-economy-depth / gdd-tenant-churn) are
    // all neutral in Classic: no overhead, no condo tax, no noise erosion.
    expect(CLASSIC_RULES.operatingOverheadPerUnit()).toBe(0);
    expect(CLASSIC_RULES.condoHoldTaxRate()).toBe(0);
    expect(CLASSIC_RULES.noiseErosionScale()).toBe(0);
  });

  it("reads the 1994 top-tier commercial ceilings; Modern keeps its tuned table (#572)", () => {
    // Classic: the period chart's top tiers (provenance on the econConfig
    // table; provisional, #575). Pinned per kind so a retune is deliberate.
    expect(CLASSIC_RULES.commercialDailyIncome("fastFood")).toBe(5_000);
    expect(CLASSIC_RULES.commercialDailyIncome("restaurant")).toBe(10_000);
    expect(CLASSIC_RULES.commercialDailyIncome("shop")).toBe(20_000);
    expect(CLASSIC_RULES.commercialDailyIncome("cinema")).toBe(10_000);
    expect(CLASSIC_RULES.commercialDailyIncome("partyHall")).toBe(20_000);
    // Modern reads the live tuned table, so the two can never share a retune
    // by accident.
    for (const kind of ["fastFood", "restaurant", "shop", "cinema", "partyHall"]) {
      expect(MODERN_RULES.commercialDailyIncome(kind)).toBe(ECON.dailyTrafficIncome[kind]);
    }
    // The Modern-only footfall venues earn in Modern only and do not exist in the
    // Classic 1994 table at all.
    for (const kind of ["foodHall", "amusements", "boutiqueBay", "nightclub", "spa", "skyBar", "aquaticCenter", "daycare"]) {
      expect(MODERN_RULES.commercialDailyIncome(kind)).toBe(ECON.dailyTrafficIncome[kind]);
      expect(ECON.dailyTrafficIncome[kind]).toBeGreaterThan(0);
      expect(ECON.classicDailyTrafficIncome[kind]).toBeUndefined();
    }
    // Kind classification is shared for every CANON venue; Modern additionally
    // carries its Modern-only venues (Food Hall, Amusements, Boutique Bay).
    const MODERN_ONLY_VENUES = ["foodHall", "amusements", "boutiqueBay", "nightclub", "spa", "skyBar", "aquaticCenter", "daycare"];
    expect(Object.keys(ECON.classicDailyTrafficIncome).sort()).toEqual(
      Object.keys(ECON.dailyTrafficIncome)
        .filter((k) => !MODERN_ONLY_VENUES.includes(k))
        .sort(),
    );
    // A non-venue kind is undefined in both modes.
    expect(CLASSIC_RULES.commercialDailyIncome("office")).toBeUndefined();
    expect(MODERN_RULES.commercialDailyIncome("office")).toBeUndefined();
  });

  it("reads lobby distance as two discrete bands: near, far (cap only), very far (cap + erosion)", () => {
    expect(CLASSIC_RULES.lobbyDistanceDrain(LOBBY_FAR_FLOORS)).toEqual({ cap: 1, erosion: 0 }); // at the edge: still near
    expect(CLASSIC_RULES.lobbyDistanceDrain(LOBBY_FAR_FLOORS + 1)).toEqual({ cap: LOBBY_FAR_CAP, erosion: 0 }); // far: ceiling only
    expect(CLASSIC_RULES.lobbyDistanceDrain(LOBBY_VERY_FAR_FLOORS + 1)).toEqual({
      cap: LOBBY_VERY_FAR_CAP,
      erosion: LOBBY_VERY_FAR_EROSION,
    }); // very far: lower ceiling and the evicting erosion
  });

  it("caps but never evicts for unmet local demand (canon: too few amenities lowers renewal only)", () => {
    // Full coverage (at or above the floor): the neutral drain, no penalty.
    expect(CLASSIC_RULES.unmetDemandDrain(1)).toEqual({ cap: 1, erosion: 0 });
    expect(CLASSIC_RULES.unmetDemandDrain(UNMET_DEMAND_FLOOR)).toEqual({ cap: 1, erosion: 0 });
    // Below the floor: a flat ceiling, but erosion 0 in every case, so it can cap
    // renewal yet never drive a tenant to a notice (like noise in Classic).
    expect(CLASSIC_RULES.unmetDemandDrain(UNMET_DEMAND_FLOOR - 0.01)).toEqual({ cap: UNMET_DEMAND_CAP, erosion: 0 });
    expect(CLASSIC_RULES.unmetDemandDrain(0)).toEqual({ cap: UNMET_DEMAND_CAP, erosion: 0 });
  });

  it("lifts every demand-pool retail kind on weekends by the literal 1994 ratios", () => {
    // Weekday is always the flat 1.0 baseline.
    expect(CLASSIC_RULES.weekendMultiplier("fastFood", false)).toBe(1);
    expect(CLASSIC_RULES.weekendMultiplier("restaurant", false)).toBe(1);
    // Weekend: the three retail kinds busier (the 1994 targets), fast food included.
    expect(CLASSIC_RULES.weekendMultiplier("fastFood", true)).toBeCloseTo(48 / 35, 6);
    expect(CLASSIC_RULES.weekendMultiplier("restaurant", true)).toBeCloseTo(48 / 35, 6);
    expect(CLASSIC_RULES.weekendMultiplier("shop", true)).toBeCloseTo(30 / 25, 6);
    // Every retail multiplier is a lift (> 1): no retail kind quiets in Classic.
    expect(CLASSIC_RULES.weekendMultiplier("fastFood", true)).toBeGreaterThan(1);
  });

  it("leaves attendance venues (cinema, party hall) at 1.0: their weekend swing is emergent (#424)", () => {
    // Cinema and party hall earn from the live-attendance fill, which the crowd
    // already spawns with a weekday/weekend rhythm, so a flat multiplier here would
    // double-count. They read 1.0 on both days.
    expect(CLASSIC_RULES.weekendMultiplier("cinema", true)).toBe(1);
    expect(CLASSIC_RULES.weekendMultiplier("cinema", false)).toBe(1);
    expect(CLASSIC_RULES.weekendMultiplier("partyHall", true)).toBe(1);
    expect(CLASSIC_RULES.weekendMultiplier("partyHall", false)).toBe(1);
  });

  it("reads 1.0 for a non-commercial kind on either day (no weekend swing)", () => {
    expect(CLASSIC_RULES.weekendMultiplier("office", true)).toBe(1);
    expect(CLASSIC_RULES.weekendMultiplier("office", false)).toBe(1);
  });

  it("thins the rainy crowd at the canon shopper magnitude (#430)", () => {
    // Classic matches the 0.5 the retail rainMult already uses, so a rainy tower
    // visibly empties and its attendance houses fill less.
    expect(CLASSIC_RULES.rainCrowdFactor()).toBe(ECON.rainCrowdFactor.classic);
    expect(CLASSIC_RULES.rainCrowdFactor()).toBe(0.5);
  });
});

describe("MODERN_RULES", () => {
  it("draws a 2-5 household and scales the sale price to it", () => {
    const rng = new RNG(7);
    const sale = MODERN_RULES.sellCondo(160_000, rng);
    expect(sale.residents).toBeGreaterThanOrEqual(2);
    expect(sale.residents).toBeLessThanOrEqual(5);
    expect(sale.price).toBe(householdPrice(160_000, sale.residents));
  });

  it("advances the RNG on a sale (variant households consume the stream)", () => {
    const rng = new RNG(7);
    const before = rng.seed;
    MODERN_RULES.sellCondo(160_000, rng);
    expect(rng.seed).not.toBe(before);
  });

  it("clamps a coerced household into the real generator band (2..5)", () => {
    expect(MODERN_RULES.coerceResidents(undefined)).toBeUndefined();
    expect(MODERN_RULES.coerceResidents(9999)).toBe(5);
    expect(MODERN_RULES.coerceResidents(1)).toBe(2); // below the band → floor
    expect(MODERN_RULES.coerceResidents(0)).toBe(2);
    expect(MODERN_RULES.coerceResidents(3.4)).toBe(3); // rounds
    expect(MODERN_RULES.coerceResidents("nonsense")).toBe(CLASSIC_3); // non-number → classic 3
  });

  it("sharpens churn for big families and softens for small, neutral at 3", () => {
    expect(MODERN_RULES.churnMultiplier(3)).toBe(1);
    expect(MODERN_RULES.churnMultiplier(5)).toBeGreaterThan(1);
    expect(MODERN_RULES.churnMultiplier(2)).toBeLessThan(1);
    expect(MODERN_RULES.churnMultiplier(undefined)).toBe(1);
  });

  it("runs the deeper-economy sinks at their tuned values", () => {
    expect(MODERN_RULES.operatingOverheadPerUnit()).toBe(ECON.overheadPerLeasableUnitMonthly);
    expect(MODERN_RULES.condoHoldTaxRate()).toBe(ECON.condoMonthlyTaxRate);
    expect(MODERN_RULES.noiseErosionScale()).toBe(1);
  });

  it("softens the rainy crowd thinning relative to Classic (#430)", () => {
    // Modern smooths: rain still thins the crowd, but less sharply, so a rainy day
    // reads as a slower tower rather than a near-empty one.
    expect(MODERN_RULES.rainCrowdFactor()).toBe(ECON.rainCrowdFactor.modern);
    expect(MODERN_RULES.rainCrowdFactor()).toBe(0.7);
    expect(MODERN_RULES.rainCrowdFactor()).toBeGreaterThan(CLASSIC_RULES.rainCrowdFactor());
  });

  it("eases lobby distance in as a smooth continuous curve, gentler than Classic at the same distance", () => {
    // No penalty up to the far edge, exactly like Classic.
    expect(MODERN_RULES.lobbyDistanceDrain(LOBBY_FAR_FLOORS)).toEqual({ cap: 1, erosion: 0 });
    // Just into the far band: the ceiling has only begun to ease down (still above
    // the Classic band's flat 0.7), and no erosion yet.
    const near = MODERN_RULES.lobbyDistanceDrain(LOBBY_FAR_FLOORS + 1);
    expect(near.cap).toBeLessThan(1);
    expect(near.cap).toBeGreaterThan(LOBBY_FAR_CAP); // gentler than Classic's discrete far cap
    expect(near.erosion).toBe(0);
    // The curve is monotonic: farther is always at least as harsh.
    const farther = MODERN_RULES.lobbyDistanceDrain(LOBBY_VERY_FAR_FLOORS + 2);
    expect(farther.cap).toBeLessThanOrEqual(near.cap);
    expect(farther.cap).toBeCloseTo(LOBBY_VERY_FAR_CAP, 6); // bottoms out at the same worst-case ceiling
    expect(farther.erosion).toBeCloseTo(LOBBY_VERY_FAR_EROSION, 6); // and the same evicting erosion
  });

  it("tightens the ceiling with the shortfall and erodes only past the evict floor for unmet demand", () => {
    // At or above the floor: the neutral drain, no penalty.
    expect(MODERN_RULES.unmetDemandDrain(1)).toEqual({ cap: 1, erosion: 0 });
    expect(MODERN_RULES.unmetDemandDrain(UNMET_DEMAND_FLOOR)).toEqual({ cap: 1, erosion: 0 });
    // Just below the floor: the ceiling begins to ease down (still above the
    // Classic flat cap), and no erosion yet (above the evict floor).
    const near = MODERN_RULES.unmetDemandDrain(UNMET_DEMAND_FLOOR - 0.05);
    expect(near.cap).toBeLessThan(1);
    expect(near.cap).toBeGreaterThan(UNMET_DEMAND_CAP);
    expect(near.erosion).toBe(0);
    // Monotonic: less coverage is at least as harsh, bottoming at the worst-case cap.
    const worst = MODERN_RULES.unmetDemandDrain(0);
    expect(worst.cap).toBeLessThanOrEqual(near.cap);
    expect(worst.cap).toBeCloseTo(UNMET_DEMAND_CAP, 6);
    // Erosion eases in below the evict floor (0 at the floor, rising toward the
    // worst case), so just inside it there is a small positive drain...
    expect(MODERN_RULES.unmetDemandDrain(UNMET_DEMAND_EVICT_FLOOR).erosion).toBe(0);
    expect(MODERN_RULES.unmetDemandDrain(UNMET_DEMAND_EVICT_FLOOR - 0.01).erosion).toBeGreaterThan(0);
    // ...and at coverage 0 (a tenant that can reach no retail at all) the erosion
    // clears the served recovery, so a chronically stranded Modern tenant nets a
    // negative drift and eventually gives notice.
    expect(MODERN_RULES.unmetDemandDrain(0).erosion).toBeGreaterThan(SERVED_RECOVERY);
    // #548 calibration boundaries, derived from the constants so a retune moves
    // the pins with it. Just inside the evict floor the drain erodes but stays
    // below the served recovery: that band caps and slows, it does not shed.
    const inside = MODERN_RULES.unmetDemandDrain(UNMET_DEMAND_EVICT_FLOOR - 0.02);
    expect(inside.erosion).toBeGreaterThan(0);
    expect(inside.erosion).toBeLessThan(SERVED_RECOVERY);
    // The genuine net-shed region opens only below the break-even coverage
    // (erosion equals recovery), which the ramp puts at evictFloor x
    // (1 - recovery/erosionMax): ~0.20 today, demand ~5x the reachable retail.
    // A tower must be heavily oversubscribed before anyone packs; an ordinary
    // mid-fill share sits nowhere near it.
    const breakEven = UNMET_DEMAND_EVICT_FLOOR * (1 - SERVED_RECOVERY / ECON.unmetDemandErosion);
    expect(breakEven).toBeGreaterThan(0.15);
    expect(breakEven).toBeLessThan(0.3);
    expect(MODERN_RULES.unmetDemandDrain(breakEven + 0.01).erosion).toBeLessThan(SERVED_RECOVERY);
    expect(MODERN_RULES.unmetDemandDrain(breakEven - 0.01).erosion).toBeGreaterThan(SERVED_RECOVERY);
  });

  it("reads a realistic weekend rhythm: fast food quiets, restaurants and shops pick up", () => {
    // Weekday is the flat 1.0 baseline, same as Classic.
    expect(MODERN_RULES.weekendMultiplier("fastFood", false)).toBe(1);
    expect(MODERN_RULES.weekendMultiplier("restaurant", false)).toBe(1);
    // Weekend: fast food drops below 1 (no office-lunch crowd) while restaurants
    // and shops rise above it. Magnitudes track the Modern tunable so this test
    // does not fossilize a provisional constant.
    expect(MODERN_RULES.weekendMultiplier("fastFood", true)).toBe(ECON.weekendTrafficMultiplier.fastFood);
    expect(MODERN_RULES.weekendMultiplier("fastFood", true)).toBeLessThan(1);
    expect(MODERN_RULES.weekendMultiplier("restaurant", true)).toBe(ECON.weekendTrafficMultiplier.restaurant);
    expect(MODERN_RULES.weekendMultiplier("restaurant", true)).toBeGreaterThan(1);
    expect(MODERN_RULES.weekendMultiplier("shop", true)).toBe(ECON.weekendTrafficMultiplier.shop);
    expect(MODERN_RULES.weekendMultiplier("shop", true)).toBeGreaterThan(1);
  });

  it("leaves attendance venues (cinema, party hall) at 1.0: their weekend swing is emergent (#424)", () => {
    expect(MODERN_RULES.weekendMultiplier("cinema", true)).toBe(1);
    expect(MODERN_RULES.weekendMultiplier("cinema", false)).toBe(1);
    expect(MODERN_RULES.weekendMultiplier("partyHall", true)).toBe(1);
    expect(MODERN_RULES.weekendMultiplier("partyHall", false)).toBe(1);
  });

  it("reads 1.0 for a non-commercial kind on either day (no weekend swing)", () => {
    // Both days for both kinds: symmetric with the Classic non-commercial check.
    expect(MODERN_RULES.weekendMultiplier("office", true)).toBe(1);
    expect(MODERN_RULES.weekendMultiplier("office", false)).toBe(1);
    expect(MODERN_RULES.weekendMultiplier("condo", true)).toBe(1);
    expect(MODERN_RULES.weekendMultiplier("condo", false)).toBe(1);
  });

  it("keeps the variant-household distribution centered on the classic mean", () => {
    // Sample the roll many times; the mean must sit at the classic 3 (the ladder
    // invariant), with every draw in-band.
    const rng = new RNG(12345);
    let sum = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const { residents } = MODERN_RULES.sellCondo(160_000, rng);
      expect(residents).toBeGreaterThanOrEqual(2);
      expect(residents).toBeLessThanOrEqual(5);
      sum += residents!;
    }
    expect(sum / N).toBeCloseTo(CLASSIC_3, 1); // mean ≈ 3.0
  });
});

describe("demographicRoutines (condo-demographic-routines, #397)", () => {
  it("Classic disables both routines: zero weights, so the spawn overlay never draws RNG", () => {
    const routines = CLASSIC_RULES.demographicRoutines();
    expect(routines.schoolRun).toBe(0);
    expect(routines.salesCall).toBe(0);
  });

  it("Classic returns the same frozen object every call (no per-pass allocation, tamper-proof)", () => {
    const a = CLASSIC_RULES.demographicRoutines();
    expect(CLASSIC_RULES.demographicRoutines()).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("Modern enables both routines at the ECON weights", () => {
    const routines = MODERN_RULES.demographicRoutines();
    expect(routines.schoolRun).toBe(ECON.demographicRoutineWeights.schoolRun);
    expect(routines.salesCall).toBe(ECON.demographicRoutineWeights.salesCall);
    expect(routines.schoolRun).toBeGreaterThan(0);
    expect(routines.salesCall).toBeGreaterThan(0);
  });
});

describe("priceOptions (the Classic/Modern pricing split, #299)", () => {
  /** The canon rung tables, pinned verbatim (GDD §0/§2, user call 2026-07-08).
   *  Dollar tables are the Relentless Optimizer reference (single-source);
   *  the rent-class structure is TDT byte 0-4. */
  const CANON: Record<string, [number, number, number, number]> = {
    office: [2_000, 5_000, 10_000, 15_000], // quarterly
    condo: [50_000, 100_000, 150_000, 200_000], // one-time sale
    hotelSingle: [500, 1_500, 2_000, 3_000], // nightly
    hotelDouble: [800, 2_000, 3_000, 4_500], // nightly
    hotelSuite: [1_500, 4_000, 6_000, 9_000], // nightly
  };

  it("Classic returns the discrete 4-rung canon ladder plus the No Rate sentinel for every priced kind", () => {
    // Modern-only priced kinds (e.g. the Fitness Club) have no 1994 rent ladder
    // and never exist in a Classic tower, so Classic offers no options for them.
    for (const kind of PRICED_KINDS.filter((k) => !FACILITIES[k].modernOnly)) {
      const opts = CLASSIC_RULES.priceOptions(kind);
      expect(opts).not.toBeNull();
      if (opts?.shape !== "ladder") throw new Error(`expected a ladder for ${kind}`);
      expect(opts.noRate).toBe(true);
      expect(opts.rungs.map((r) => r.value)).toEqual(CANON[kind]);
      expect(opts.rungs.map((r) => r.label)).toEqual(["Very Low", "Low", "Average", "High"]);
      // Rung levels double as the TDT rent-class bytes 0-3.
      expect(opts.rungs.map((r) => r.level)).toEqual([0, 1, 2, 3]);
    }
    // The Modern-only Fitness Club is priced in Modern but has no Classic option.
    expect(CLASSIC_RULES.priceOptions("fitnessClub")).toBeNull();
  });

  it("Modern returns today's continuous band unchanged (the live ECON entry)", () => {
    for (const kind of PRICED_KINDS) {
      const opts = MODERN_RULES.priceOptions(kind);
      if (opts?.shape !== "band") throw new Error(`expected a band for ${kind}`);
      expect(opts.band).toBe(ECON.rent[kind]); // identity: a retune can never desync
    }
  });

  it("returns null for a kind whose price is not player-set, in both modes", () => {
    expect(CLASSIC_RULES.priceOptions("shop")).toBeNull();
    expect(CLASSIC_RULES.priceOptions("lobby")).toBeNull();
    expect(MODERN_RULES.priceOptions("fastFood")).toBeNull();
  });

  it("returns frozen singletons, so per-unit reads allocate nothing and nobody can mutate the canon", () => {
    const a = CLASSIC_RULES.priceOptions("office");
    expect(CLASSIC_RULES.priceOptions("office")).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    if (a?.shape === "ladder") {
      expect(Object.isFrozen(a.rungs)).toBe(true);
      expect(Object.isFrozen(a.rungs[0])).toBe(true);
    }
    expect(MODERN_RULES.priceOptions("condo")).toBe(MODERN_RULES.priceOptions("condo"));
  });

  it("the neutral anchor is the Average rung (Classic) or the band default (Modern)", () => {
    expect(priceNeutral(CLASSIC_RULES.priceOptions("condo")!)).toBe(150_000);
    expect(priceNeutral(CLASSIC_RULES.priceOptions("hotelSingle")!)).toBe(2_000);
    expect(priceNeutral(MODERN_RULES.priceOptions("condo")!)).toBe(ECON.rent.condo.default);
  });

  it("Classic office Average coincides with the band default, which the satisfaction rent-gripe anchors on", () => {
    // sim/satisfaction.ts keys its office rent-over-market reads off
    // rentConfig("office").default; that is only correct in Classic because
    // the canon Average rung IS $10,000. If a retune ever moves the band
    // default off the Average rung, those reads must switch to priceNeutral.
    expect(priceNeutral(CLASSIC_RULES.priceOptions("office")!)).toBe(ECON.rent.office.default);
  });
});

describe("snapToLadder / ladderRungFor (the NFR3 snap rule)", () => {
  const rungs = (CLASSIC_RULES.priceOptions("office") as { rungs: readonly PriceRung[] }).rungs;

  it("snaps to the nearest rung, ties rounding UP", () => {
    expect(snapToLadder(rungs, 10_000)).toBe(10_000); // exact rung is itself
    expect(snapToLadder(rungs, 6_000)).toBe(5_000);
    expect(snapToLadder(rungs, 7_500)).toBe(10_000); // exact tie rounds up
    expect(snapToLadder(rungs, 3_500)).toBe(5_000); // tie 2k/5k rounds up
    expect(snapToLadder(rungs, 12_500)).toBe(15_000); // tie 10k/15k rounds up
  });

  it("bounds out-of-band and repairs non-finite values (clamp then snap)", () => {
    expect(snapToLadder(rungs, 20_000)).toBe(15_000); // the old band max lands on High
    expect(snapToLadder(rungs, -5)).toBe(2_000);
    expect(snapToLadder(rungs, 1e12)).toBe(15_000);
    // Non-finite input (NaN, ±Infinity) lands on Average, the neutral rung.
    expect(snapToLadder(rungs, NaN)).toBe(10_000);
    expect(snapToLadder(rungs, Infinity)).toBe(10_000);
    expect(snapToLadder(rungs, -Infinity)).toBe(10_000);
  });

  it("names the rung a value sits on", () => {
    expect(ladderRungFor(rungs, 15_000).label).toBe("High");
    expect(ladderRungFor(rungs, 0).label).toBe("Very Low");
    expect(ladderRungFor(rungs, 7_500).label).toBe("Average"); // tie up
  });
});
