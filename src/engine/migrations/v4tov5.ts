/**
 * v4 → v5 save migration: widen legacy 3-wide elevator shafts to the canon
 * 4-tile footprint. Extracted from `saveMigration.ts`; see that file's
 * `migrateSave` for how the hop and the every-load heal are chained.
 */
import { FACILITIES, GRID, POOLED_CAPS, isElevatorKind, isFacilityKind } from "../facilities";
import type { SerializedGame, Transport } from "../types";

/** v4 → v5 hop: stamp the version and run the shaft widening once. The same
 *  widening also re-runs on every v5 load (see `migrateSave`) so a
 *  boxed-in shaft can heal later; the hop exists so the ladder stays gapless. */
export function upgradeV4toV5(data: SerializedGame): SerializedGame {
  return widenLegacyElevatorShafts({ ...data, version: 5 });
}

/**
 * Re-fit each ELEVATOR shaft stored narrower than its canon width (the pre-v5
 * 3-wide standard elevator) at the canon footprint. Grow in place: keep x and
 * grow right, else shift left one column at a time up to the width delta (grow
 * left / split growth). Every candidate keeps the original columns inside the
 * new footprint, so the engine's structure rule (some built tile per served
 * floor, `Tower.shaftHasStructureAt`) keeps holding. A candidate is taken only
 * when it stays on-lot and overlaps no other shaft on any shared floor
 * (transports overlay rooms, so rooms never block a widen). A shaft boxed in on
 * both sides keeps its legacy width: the loader trusts stored widths, so a
 * kept-legacy shaft loads exactly as it was saved (arch precedent: E1b room
 * widths) until a later load finds the space freed and heals it.
 *
 * Idempotent by construction: at-canon shafts are skipped and a keep-legacy
 * outcome re-derives identically, so this is safe to run on every load.
 *
 * Walkways (stairs/escalators) are deliberately untouched: pre-E1b 4-wide
 * flights doubling to 8 is a different, riskier re-fit (exact-footprint stacking
 * rule) tracked separately in the backlog.
 */
export function widenLegacyElevatorShafts(data: SerializedGame): SerializedGame {
  const stamped: SerializedGame = { ...data };
  if (!Array.isArray(data.transports)) return stamped;
  // A legit tower can never exceed the pooled build caps (24 shafts + 64
  // walkway links), and the widen's fit check is quadratic, so a forged flood
  // of transports skips the widening outright rather than hanging the load.
  // The loader caps the same flood right after this, so a legitimate shaft
  // buried in forged padding heals on the NEXT load of the then-capped save.
  if (data.transports.length > POOLED_CAPS.reduce((sum, pool) => sum + pool.cap, 0)) return stamped;
  // Live footprints, updated as shafts widen so later decisions see earlier
  // ones. Each footprint is built with the SAME coercion `Simulation.deserialize`
  // applies afterward (finite-or-fallback, floor clamps, on-lot x clamp), so a
  // "fits" verdict here holds against the geometry the loader actually produces:
  // a garbled sibling (NaN x resurrected at 0, an inverted floor range rewritten
  // to a 1-floor band) blocks a widen at its POST-coercion position instead of
  // being invisible. Entries the loader drops outright (null / unknown kind) get
  // a null footprint and block nothing, matching the load exactly.
  interface Fp {
    x: number;
    w: number;
    bottom: number;
    top: number;
  }
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const fps: (Fp | null)[] = data.transports.map((t) => {
    if (t == null || typeof t !== "object" || !isFacilityKind(t.kind)) return null;
    const catalogW = FACILITIES[t.kind].width;
    const bottom = Math.max(GRID.minFloor, Math.min(GRID.maxFloor - 1, Math.round(num(t.bottom, 1))));
    const top = Math.max(bottom + 1, Math.min(GRID.maxFloor, Math.round(num(t.top, bottom + 1))));
    const w0 = Math.round(num(t.width, catalogW));
    // Same bound as the loader: a stored width above the catalog is always
    // forged (canon widths only ever grew), so it clamps down rather than
    // letting one corrupt entry shadow a huge span of the lot.
    const w = w0 > 0 ? Math.min(w0, catalogW) : catalogW;
    const x = Math.max(0, Math.min(GRID.width - w, Math.round(num(t.x, 0))));
    return { x, w, bottom, top };
  });
  // Inclusive floor ranges: a shaft whose top is another's bottom shares that
  // floor, which the engine treats as an overlap for elevators.
  const collides = (a: Fp, b: Fp): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.bottom <= b.top && b.bottom <= a.top;
  const fits = (self: number, cand: Fp): boolean => {
    if (cand.x < 0 || cand.x + cand.w > GRID.width) return false;
    for (let i = 0; i < fps.length; i++) {
      const other = fps[i];
      if (i === self || !other) continue;
      if (collides(cand, other)) return false;
    }
    return true;
  };
  const out: Transport[] = data.transports.map((t, i) => {
    const fp = fps[i];
    if (!fp || !isFacilityKind(t.kind) || !isElevatorKind(t.kind)) return t;
    const canonW = FACILITIES[t.kind].width;
    if (fp.w >= canonW) return t;
    for (let shift = 0; shift <= canonW - fp.w; shift++) {
      const cand: Fp = { ...fp, x: fp.x - shift, w: canonW };
      if (fits(i, cand)) {
        fps[i] = cand; // later shafts must respect the widened footprint
        return { ...t, x: cand.x, width: canonW };
      }
    }
    return t; // boxed in: keep the legacy footprint, never relocate a shaft
  });
  return { ...stamped, transports: out };
}
