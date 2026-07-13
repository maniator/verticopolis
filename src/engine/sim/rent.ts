import type { Simulation } from "../Simulation";

import { rentOf, rentConfig } from "../econConfig";

import type { FacilityKind, Unit } from "../types";

import { clampRent, storeRent, BatchTarget, BatchRentOptions, BatchRentResult } from "./constants";

/** Batch rent pricing for the Simulation, as friend functions taking the
 * instance. Extracted from `Simulation.ts`; the class keeps thin delegations. */

/** How a unit's chosen price shifts demand: 1 at the going rate, higher when
 *  it undercuts, lower when it gouges (clamped). 1 for un-priced kinds. */
export function demandFactor(_sim: Simulation, u: Unit): number {
  const cfg = rentConfig(u.kind);
  if (!cfg) return 1;
  // Off-market: zero demand, so the $0 price never reads as an irresistible
  // bargain (ratio 0 would otherwise clamp to the 1.6 maximum). Defensive
  // partner to the `noRate` skip in attemptMoveIns.
  if (u.noRate) return 0;
  const ratio = rentOf(u) / cfg.default;
  return Math.max(0.15, Math.min(1.6, 2 - ratio));
}

/** Set one unit's price to a clamped target, honoring the condo-sold gate.
 *  The single choke point for every price write (nudge and batch), so the
 *  band clamp and the "can't reprice a sold condo" rule live in one place.
 *  Returns the new price, or null if the unit isn't repriceable. */
export function priceUnit(_sim: Simulation, u: Unit, target: number): number | null {
  const cfg = rentConfig(u.kind);
  if (!cfg) return null;
  if (!Number.isFinite(target)) return null; // guard NaN/Infinity from any caller
  if (u.kind === "condo" && u.everOccupied) return null; // already sold
  const clamped = clampRent(cfg, target);
  storeRent(u, cfg, clamped);
  // Any explicit reprice puts the unit back on the market, so an imported
  // No-Rate unit is never a permanent $0 trap.
  u.noRate = undefined;
  return clamped;
}

/** Nudge a unit's price one step within its band, offices/hotels any time,
 *  condos only while unsold. Returns the new price, or null if not adjustable. */
export function adjustRent(sim: Simulation, id: number, dir: 1 | -1): number | null {
  const u = sim.tower.getUnit(id);
  if (!u) return null;
  const cfg = rentConfig(u.kind);
  if (!cfg) return null;
  return sim.priceUnit(u, rentOf(u) + dir * cfg.step);
}

/**
 * Set the price of EVERY unit of one priced kind at once. `target` is an exact
 * price or "default" (clears the per-unit override). With `onlyDefaultPriced`,
 * units the player has hand-tuned are left alone. Sold condos are always
 * skipped. `preview` computes the result without mutating; `apply` writes it,
 * both run the same core, so what you preview is exactly what commits. Returns
 * null for a non-priced kind. Pure (no RNG / clock) and save-safe (writes only
 * the existing `Unit.rent`). */
export function previewRentBatch(sim: Simulation, kind: FacilityKind, target: BatchTarget, opts: BatchRentOptions = {}): BatchRentResult | null {
  return sim.computeBatch(kind, target, opts, false);
}

export function applyRentBatch(sim: Simulation, kind: FacilityKind, target: BatchTarget, opts: BatchRentOptions = {}): BatchRentResult | null {
  return sim.computeBatch(kind, target, opts, true);
}

export function computeBatch(sim: Simulation, 
  kind: FacilityKind,
  target: BatchTarget,
  opts: BatchRentOptions,
  mutate: boolean,
): BatchRentResult | null {
  const cfg = rentConfig(kind);
  if (!cfg) return null; // not a priced kind
  if (target !== "default" && !Number.isFinite(target)) return null; // guard NaN/Infinity
  const onlyDefault = opts.onlyDefaultPriced ?? false;
  const r: BatchRentResult = {
    matched: 0,
    eligible: 0,
    changed: 0,
    skippedSold: 0,
    skippedCustom: 0,
    customOverwritten: 0,
    clampedLow: 0,
    clampedHigh: 0,
  };
  for (const u of sim.tower.units) {
    if (u.kind !== kind) continue;
    r.matched++;
    if (u.kind === "condo" && u.everOccupied) {
      r.skippedSold++;
      continue;
    }
    // Treat an override equal to the kind default as default-priced too, so a
    // legacy save (or older adjustRent) that stored the default explicitly isn't
    // mis-counted as custom.
    if (onlyDefault && u.rent !== undefined && u.rent !== cfg.default) {
      r.skippedCustom++;
      continue;
    }
    r.eligible++;
    // With the protect toggle off, a custom-priced unit here is about to be
    // overwritten, count it so the preview can warn (skippedCustom only counts
    // the toggle-ON case where they're left alone).
    if (u.rent !== undefined && u.rent !== cfg.default) r.customOverwritten++;
    const before = rentOf(u);
    if (target === "default") {
      if (before !== cfg.default) r.changed++;
      if (mutate) {
        u.rent = undefined; // clear the override → falls back to default
        // An explicit reprice returns a No-Rate unit to the market. Scoped to
        // the actually-repriced branch (skipped sold/custom units already
        // continued above), matching priceUnit, so a skip keeps its flag.
        u.noRate = undefined;
      }
    } else {
      if (target < cfg.min) r.clampedLow++;
      else if (target > cfg.max) r.clampedHigh++;
      const clamped = clampRent(cfg, target);
      if (before !== clamped) r.changed++;
      if (mutate) {
        storeRent(u, cfg, clamped);
        u.noRate = undefined; // same explicit-reprice clear as the default branch
      }
    }
  }
  return r;
}
