import { ECON, PRICED_KINDS } from "./econConfig";

/**
 * The Classic/Modern pricing split's SHAPE layer (gdd-classic-modern-pricing-
 * roadmap §1-2): the canon rent ladders, the {@link PriceOptions} union the
 * rule-sets return from `priceOptions(kind)`, and the pure helpers every
 * consumer snaps and anchors through. Extracted from `gameRules.ts` (which
 * re-exports the public surface, so import paths are unchanged) purely for
 * file size; the mode DECISION (which shape a mode returns) stays on the
 * rule-set objects in gameRules.ts.
 */
// ---- The Classic/Modern pricing split (gdd-classic-modern-pricing-roadmap §1-2) --

/** One rung of the Classic 4-level rent ladder. `level` doubles as the 1994
 *  TDT rent-class byte (0 Very Low … 3 High; byte 4 is the No Rate sentinel,
 *  carried by the ladder shape itself, not a fifth rung). */
export interface PriceRung {
  readonly level: 0 | 1 | 2 | 3;
  readonly label: "Very Low" | "Low" | "Average" | "High";
  readonly value: number;
}

/**
 * What a mode offers the player for pricing a rentable kind. The consumers
 * (editor, batch dialog, price choke point) switch on the SHAPE of this value,
 * never on the mode string, per the rule-set law above:
 *   - `ladder`: the Classic discrete 4-rung dropdown plus the No Rate
 *     off-market sentinel (`noRate: true` says the mode offers that state);
 *   - `band`: Modern's continuous `{min, default, max, step}` range,
 *     driving the existing stepper/range editors.
 * Both shapes are frozen module-level singletons, so reading them on a
 * per-unit path allocates nothing.
 */
export type PriceOptions =
  | { readonly shape: "ladder"; readonly rungs: readonly PriceRung[]; readonly noRate: true }
  | {
      readonly shape: "band";
      readonly band: { readonly default: number; readonly min: number; readonly max: number; readonly step: number };
    };

/**
 * The Classic canon rent ladders, dollars per kind in rung order
 * (Very Low / Low / Average / High).
 *
 * Provenance (record honestly, GDD §2 / epics AR5). The rent-class STRUCTURE
 * (one 4-level dropdown plus No Rate, TDT byte 0-4) comes from the
 * reverse-engineered TDT docs (docs/canon/tdt-format.md §4) and is CONFIRMED to
 * round-trip into the retail 1994 game: a tower carrying these rungs loads and
 * renders correctly under the Wine harness (tools/simtower/, #575 read
 * 2026-07-22). The per-quarter CADENCE is now primary-confirmed: the official
 * manual, read directly off the disc (Italian full text + English OCR), states
 * a quarter is 3 in-game days, a year is 4 quarters, and the Finance window
 * reports per quarter (figures x100). The DOLLAR VALUES are a separate matter.
 * They originated in the Relentless Optimizer fan reference; the 2026-07-22
 * #575 source sweep established that RO, the GameFAQs FAQ lineage (BStuart
 * ~1995 -> Aristotle47 -> furdude2 -> kiwizoid), and the Fandom wiki are ONE
 * lineage, NOT independent (RO admits consulting the FAQ walkthroughs; the
 * lineage roots in the game's own README/help plus BStuart's direct play, and
 * BStuart notes the manual's own figures are wrong). Per the owner's PR #574
 * ruling a single lineage is not corroboration, so the value tiers stay
 * provisional. Two genuinely independent anchors were found: the official
 * manual (confirms the structure and cadence but is SILENT on the dollar
 * tables) and patcoston.com (outside the lineage; independently gives office
 * 2k/5k/10k and condo $150k sale / $80k build). Hotels have only the single
 * lineage. The retail game IS the definitive value source, but a headless
 * per-class dollar read was not achievable in this pass (an imported tower's
 * tenants never instantiate, so a facility info window divides by zero; an
 * all-vacant fixture crashes on load; a genuinely game-populated tower needs
 * interactive in-game building over many in-game days). Remaining gap (#575,
 * still open): an independent dollar read of the hotel ladders and the condo
 * minimum. If a primary source ever contradicts these, re-open the pricing
 * GDD's Decision 2 and the cadence spec's ruling. Classic uses the FULL canon
 * values by the owner's call of 2026-07-08.
 */
const CLASSIC_RENT_LADDERS: Readonly<Partial<Record<string, readonly [number, number, number, number]>>> = {
  // Office, quarterly. HARD confidence: matches our band anchors; the quarterly
  // cadence is primary-confirmed (manual); patcoston.com independently gives
  // 2k/5k/10k, so the low three rungs have a second source outside the lineage.
  // The High 15k rung and the exact 4-value shape are still lineage-only.
  office: [2_000, 5_000, 10_000, 15_000],
  // Condo, one-time sale (locked after it sells). MED confidence: patcoston.com
  // independently confirms the $150k sale against the $80k build cost, outside
  // the FAQ lineage. The 40k-vs-50k minimum stays unresolved (lineage-only); 50k
  // until verified. Classic MAY list below the $80k build cost (canon firesale);
  // Modern keeps its break-even floor.
  condo: [50_000, 100_000, 150_000, 200_000],
  // Hotel single, nightly. SOFT confidence: single lineage only (BStuart FAQ ->
  // RO -> Fandom, established as one lineage, not independent; #575). The manual
  // is silent on the dollar tables and the headless harness could not read them,
  // so this ladder (500-1500-2k-3k nightly) is the standing #575 gap.
  hotelSingle: [500, 1_500, 2_000, 3_000],
  // Hotel double, nightly. SOFT confidence, single-lineage only
  // (800-2k-3k-4500; see the single's note; #575).
  hotelDouble: [800, 2_000, 3_000, 4_500],
  // Hotel suite, nightly. SOFT confidence, single-lineage only
  // (1500-4k-6k-9k; see the single's note; #575).
  hotelSuite: [1_500, 4_000, 6_000, 9_000],
};

const RUNG_LABELS = ["Very Low", "Low", "Average", "High"] as const;

/** Frozen per-kind Classic ladder options, built once at module load so
 *  per-unit reads (demand, satisfaction anchors, editors) never allocate.
 *  Consumed by the rule-sets in gameRules.ts (the one mode decision point). */
export const CLASSIC_PRICE_OPTIONS: Readonly<Record<string, PriceOptions>> = Object.freeze(
  Object.fromEntries(
    PRICED_KINDS.map((kind) => {
      const values = CLASSIC_RENT_LADDERS[kind];
      if (!values) throw new Error(`Classic rent ladder missing for priced kind ${kind}`);
      const rungs = Object.freeze(
        values.map((value, i) =>
          Object.freeze({ level: i as 0 | 1 | 2 | 3, label: RUNG_LABELS[i], value }),
        ),
      ) as readonly PriceRung[];
      return [kind, Object.freeze({ shape: "ladder" as const, rungs, noRate: true as const })];
    }),
  ),
);

/** Frozen per-kind Modern band options; the band object IS the live ECON
 *  entry, so a tuning change can never desync the two. Consumed by the
 *  rule-sets in gameRules.ts. */
export const MODERN_PRICE_OPTIONS: Readonly<Record<string, PriceOptions>> = Object.freeze(
  Object.fromEntries(PRICED_KINDS.map((kind) => [kind, Object.freeze({ shape: "band" as const, band: ECON.rent[kind] })])),
);

/** The neutral price anchor of a shape: the Average rung on a ladder, the band
 *  default on a band. Income, demand, and satisfaction ratios key off this, so
 *  Classic re-anchors onto canon Average exactly as 1994 did (epics FR5). */
export function priceNeutral(opts: PriceOptions): number {
  return opts.shape === "ladder" ? opts.rungs[2].value : opts.band.default;
}

/**
 * Snap a value to the nearest rung of a ladder, ties rounding UP (the ratified
 * NFR3 rule, uniform for every caller: load migration, the price choke point,
 * batch writes). Non-finite input lands on Average (the neutral rung), and any
 * out-of-band value inherently clamps to the end rungs, so nothing off-ladder
 * or non-finite can survive a snap.
 */
export function snapToLadder(rungs: readonly PriceRung[], value: number): number {
  if (!Number.isFinite(value)) return rungs[2].value;
  let best = rungs[0].value;
  let bestDist = Infinity;
  for (const r of rungs) {
    const d = Math.abs(value - r.value);
    // `<=` so an exact tie prefers the LATER (higher) rung: ties round up.
    if (d <= bestDist) {
      bestDist = d;
      best = r.value;
    }
  }
  return best;
}

/** The rung a value sits on (nearest, ties up), for readouts that name the
 *  level (the picker's selection, the locked sold-condo rung, announce copy). */
export function ladderRungFor(rungs: readonly PriceRung[], value: number): PriceRung {
  const snapped = snapToLadder(rungs, value);
  return rungs.find((r) => r.value === snapped) ?? rungs[2];
}
