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
 * Provenance (record honestly, GDD §2 / epics AR5): the rent-class STRUCTURE
 * (one 4-level dropdown plus No Rate, TDT byte 0-4) comes from the
 * reverse-engineered TDT docs (docs/canon/tdt-format.md §4). The DOLLAR tables
 * come from the Relentless Optimizer fan reference, a SINGLE source (the
 * archive.org SimTower manual was unfetchable); verify each table against the
 * manual if it becomes readable. Classic uses the FULL canon values by the
 * owner's call of 2026-07-08.
 */
const CLASSIC_RENT_LADDERS: Readonly<Partial<Record<string, readonly [number, number, number, number]>>> = {
  // Office, quarterly. HARD confidence: matches our band anchors; 2k/10k
  // corroborated. (Relentless Optimizer; verify against the manual if readable.)
  office: [2_000, 5_000, 10_000, 15_000],
  // Condo, one-time sale (locked after it sells). MED confidence: a 40k-vs-50k
  // minimum stays unresolved; 50k until verified. Classic MAY list below the
  // $80k build cost (canon firesale); Modern keeps its break-even floor.
  // (Relentless Optimizer; verify against the manual if readable.)
  condo: [50_000, 100_000, 150_000, 200_000],
  // Hotel single, nightly. SOFT confidence, single-source, ~10x our old band;
  // accepted per GDD §2. (Relentless Optimizer; verify against the manual if
  // readable.)
  hotelSingle: [500, 1_500, 2_000, 3_000],
  // Hotel double, nightly. SOFT confidence, single-source.
  // (Relentless Optimizer; verify against the manual if readable.)
  hotelDouble: [800, 2_000, 3_000, 4_500],
  // Hotel suite, nightly. SOFT confidence, single-source.
  // (Relentless Optimizer; verify against the manual if readable.)
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
