import { describe, it, expect } from "vitest";
import { CLASSIC_RULES, MODERN_RULES, makeRules, householdPrice } from "./gameRules";
import { FACILITIES, GRID } from "./facilities";
import { ECON } from "./econConfig";
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
