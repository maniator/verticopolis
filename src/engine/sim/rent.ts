import type { Simulation } from "../Simulation";

import { rentOf, rentConfig } from "../econConfig";
import { ladderRungFor, priceNeutral, snapToLadder } from "../gameRules";

import type { FacilityKind, Unit } from "../types";

import { clampRent, storeRent, BatchTarget, BatchRentOptions, BatchRentResult } from "./constants";

/** Batch rent pricing for the Simulation, as friend functions taking the
 * instance. Extracted from `Simulation.ts`; the class keeps thin delegations. */

/** How a unit's chosen price shifts demand: 1 at the going rate, higher when
 *  it undercuts, lower when it gouges (clamped). 1 for un-priced kinds. The
 *  going rate is the mode's neutral anchor ({@link priceNeutral}): the band
 *  default in Modern, the canon Average rung in Classic, so Classic demand
 *  re-anchors onto the 1994 ladder exactly (epics FR5). */
export function demandFactor(sim: Simulation, u: Unit): number {
  const opts = sim.rules.priceOptions(u.kind);
  if (!opts) return 1;
  // Off-market: zero demand, so the $0 price never reads as an irresistible
  // bargain (ratio 0 would otherwise clamp to the 1.6 maximum). Defensive
  // partner to the `noRate` skip in attemptMoveIns.
  if (u.noRate) return 0;
  const ratio = rentOf(u) / priceNeutral(opts);
  return Math.max(0.15, Math.min(1.6, 2 - ratio));
}

/** Set one unit's price to a target, honoring the condo-sold gate. The single
 *  choke point for every price write (picker, nudge, and batch), so the
 *  mode-shape rule (snap to a canon rung on a ladder, clamp into the band
 *  otherwise) and the "can't reprice a sold condo" rule live in one place.
 *  Returns the new price, or null if the unit isn't repriceable. */
export function priceUnit(sim: Simulation, u: Unit, target: number): number | null {
  const cfg = rentConfig(u.kind);
  const opts = sim.rules.priceOptions(u.kind);
  if (!cfg || !opts) return null;
  if (!Number.isFinite(target)) return null; // guard NaN/Infinity from any caller
  if (u.kind === "condo" && u.everOccupied) return null; // already sold
  const applied = opts.shape === "ladder" ? snapToLadder(opts.rungs, target) : clampRent(cfg, target);
  storeRent(u, cfg, applied);
  // Any explicit reprice puts the unit back on the market, so an imported
  // No-Rate unit is never a permanent $0 trap.
  u.noRate = undefined;
  return applied;
}

/**
 * Take a unit off the market ("No Rate", the 1994 dropdown's fifth entry): it
 * charges nothing AND accepts no move-ins, one inseparable state. Setting it
 * on an occupied unit never evicts: the tenant stays, pays nothing, and still
 * counts in the rating census (canon, the cheap-rent lever endpoint). Only a
 * mode whose price shape carries the No Rate sentinel may set it (seam law:
 * Modern's engine never holds the state), and a sold condo is price-locked.
 * Returns true when the unit is now off-market.
 */
export function setNoRate(sim: Simulation, id: number): boolean {
  const u = sim.tower.getUnit(id);
  if (!u) return false;
  const opts = sim.rules.priceOptions(u.kind);
  if (!opts || opts.shape !== "ladder" || !opts.noRate) return false;
  if (u.kind === "condo" && u.everOccupied) return false; // sold: price-locked
  u.noRate = true;
  return true;
}

/** Nudge a unit's price one step, offices/hotels any time, condos only while
 *  unsold: one band step in Modern, one rung up or down the ladder in Classic
 *  (so any residual nudge caller stays on the canon rungs). Returns the new
 *  price, or null if not adjustable. */
export function adjustRent(sim: Simulation, id: number, dir: 1 | -1): number | null {
  const u = sim.tower.getUnit(id);
  if (!u) return null;
  const cfg = rentConfig(u.kind);
  const opts = sim.rules.priceOptions(u.kind);
  if (!cfg || !opts) return null;
  if (opts.shape === "ladder") {
    const idx = ladderRungFor(opts.rungs, rentOf(u)).level;
    const next = opts.rungs[Math.max(0, Math.min(opts.rungs.length - 1, idx + dir))];
    return sim.priceUnit(u, next.value);
  }
  return sim.priceUnit(u, rentOf(u) + dir * cfg.step);
}

/**
 * Set the price of EVERY unit of one priced kind at once. `target` is an exact
 * price, "default" (back to the neutral anchor: the band default, or the
 * Classic Average rung), or "noRate" (off the market; ladder modes only, per
 * the seam law). With `onlyDefaultPriced`, units off the neutral anchor are
 * left alone. Sold condos are always skipped. `preview` computes the result
 * without mutating; `apply` writes it, both run the same core, so what you
 * preview is exactly what commits. Returns null for a non-priced kind. Pure
 * (no RNG / clock) and save-safe (writes only `Unit.rent` / `Unit.noRate`). */
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
  const shape = sim.rules.priceOptions(kind);
  if (!cfg || !shape) return null; // not a priced kind
  const ladder = shape.shape === "ladder" ? shape : null;
  // "noRate" is a ladder-only target (seam law: Modern never holds the state);
  // numeric targets guard NaN/Infinity as before.
  if (target === "noRate" && !ladder) return null;
  if (target !== "default" && target !== "noRate" && !Number.isFinite(target)) return null;
  const neutral = priceNeutral(shape);
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
    // "Still on the default" means the EFFECTIVE price IS the neutral anchor.
    // Compare through the same fallback rentOf applies (an absent override
    // reads the band default), so a ladder kind whose Average differs from
    // the band default (Classic condos/hotels) never counts an unset,
    // off-ladder unit as "on Average"; and never off-market (a No Rate unit
    // charges nothing, so it is not on the anchor).
    const neutralPriced = !u.noRate && (u.rent ?? cfg.default) === neutral;
    if (onlyDefault && !neutralPriced) {
      r.skippedCustom++;
      continue;
    }
    r.eligible++;
    if (target === "noRate") {
      // Off the market: occupied units keep their tenants (pay nothing, still
      // counted); vacant ones stop accepting move-ins. The stored rent is left
      // in place but nothing reads it while off-market (rentOf charges $0, and
      // a later reprice applies its caller's explicit target, not this value).
      if (!u.noRate) r.changed++;
      if (mutate) u.noRate = true;
      continue;
    }
    // With the protect toggle off, a custom-priced unit here is about to be
    // overwritten, count it so the preview can warn (skippedCustom only counts
    // the toggle-ON case where they're left alone).
    if (!neutralPriced && !u.noRate) r.customOverwritten++;
    const before = rentOf(u);
    let value: number;
    if (target === "default") {
      value = neutral;
    } else if (ladder) {
      // A rung target applies exactly; anything off-ladder (a forged caller)
      // snaps, and a rung can never clamp, so the clamp counters stay 0.
      value = snapToLadder(ladder.rungs, target);
    } else {
      if (target < cfg.min) r.clampedLow++;
      else if (target > cfg.max) r.clampedHigh++;
      value = clampRent(cfg, target);
    }
    if (before !== value) r.changed++;
    if (mutate) {
      storeRent(u, cfg, value);
      u.noRate = undefined; // an explicit reprice returns a No-Rate unit to the market
    }
  }
  return r;
}
