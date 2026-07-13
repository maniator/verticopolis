/**
 * Save-format version migrations.
 *
 * Extracted from Simulation so the (growing) migration surface lives in one
 * discoverable, independently-testable place. Everything here is a PURE function
 * on `SerializedGame` (no DOM, no class state), run by `Simulation.deserialize`
 * via {@link migrateSave}. Each `upgradeVNtoVN1` is a standalone step and
 * `migrateSave` just chains them.
 *
 * This file is the dispatcher. The two heaviest steps live in cohesive siblings
 * and are re-exported here so every existing `import { … } from "./saveMigration"`
 * keeps working unchanged:
 *   - `migrations/v1tov2.ts`: the segment-parity reflow (`reflowV1toV2`) and its
 *     validity guards (`upgradeV1toV2`, `migrationLooksValid`,
 *     `floatingStructureCount`).
 *   - `migrations/v4tov5.ts`: the elevator-shaft widening (`upgradeV4toV5`,
 *     `widenLegacyElevatorShafts`).
 */
import { isGameMode } from "./types";
import type { SerializedGame } from "./types";
import { upgradeV1toV2 } from "./migrations/v1tov2";
import { upgradeV4toV5, widenLegacyElevatorShafts } from "./migrations/v4tov5";
import { upgradeV5toV6 } from "./migrations/v5tov6";

export { upgradeV1toV2, migrationLooksValid, floatingStructureCount, reflowV1toV2 } from "./migrations/v1tov2";
export { upgradeV4toV5, widenLegacyElevatorShafts } from "./migrations/v4tov5";
export { upgradeV5toV6, expandLegacyPartyHalls } from "./migrations/v5tov6";

/**
 * Current save-format version. `serialize()` always stamps this; `deserialize()`
 * routes every save through {@link migrateSave} first, so the field is read on
 * load — not merely written — and a future format bump has exactly one place to
 * grow.
 */
export const SAVE_VERSION = 6;

/**
 * The condo sale price BEFORE this build re-anchored the band (old default 2×
 * cost was $120k, now $160k). A pre-mode save's SOLD condo that omitted `rent`
 * sold at this price, so we backfill it on load (see {@link migrateSave}) — the
 * buy-back must mirror what the unit actually sold for, not the new default.
 */
const LEGACY_CONDO_DEFAULT_PRICE = 120_000;

/**
 * Save-format migration seam. Runs before the field-level coercion in
 * `Simulation.deserialize`. Beyond normalizing `version`, it backfills the
 * pre-re-anchor condo sale price for legacy saves so an old tower's buy-back
 * still mirrors its historical sale price, then chains the versioned upgrades.
 */
/** The oldest schema version this migrator understands. A save with no valid
 *  `version` field predates versioning entirely, so it is treated as this — the
 *  OLDEST schema — not the current one: defaulting a versionless save to the
 *  latest would skip every upgrade step (e.g. the v1→v2 reflow) for exactly the
 *  legacy towers that need it. Unknown/garbled versions run migrations
 *  deterministically from the bottom. */
const OLDEST_SAVE_VERSION = 1;

export function migrateSave(data: SerializedGame): SerializedGame {
  // A missing/garbled version is normalized to the OLDEST schema (not the
  // current one) so the upgrade chain runs from the bottom for legacy saves.
  // "Valid" means a whole number ≥ the oldest schema: a non-integer (1.5),
  // zero, negative, NaN, or missing value is treated as legacy so it still runs
  // the v1→v2 reflow rather than silently skipping it. deserialize()'s coercion
  // still hardens every value afterward.
  const valid = Number.isInteger(data.version) && (data.version as number) >= OLDEST_SAVE_VERSION;
  const version = valid ? data.version : OLDEST_SAVE_VERSION;
  let migrated: SerializedGame = data.version === version ? data : { ...data, version };
  // A save with no VALID `mode` predates the condo work (or is corrupt) — the same
  // condition under which deserialize() falls back to Classic, so migration must
  // agree (an invalid mode string must be treated as legacy here too, else the
  // save loads Classic yet skips this backfill). A SOLD condo (owned, not an
  // empty/dead shell) that omitted `rent` sold at the OLD default — stamp it so
  // its buy-back mirrors that historical price instead of picking up the new,
  // higher default via rentOf(). Only touch that exact shape; never re-price a
  // condo that already carries a rent, or an unsold/dead one.
  if (!isGameMode(migrated.mode) && Array.isArray(migrated.units)) {
    migrated = {
      ...migrated,
      // A missing `state` reads as "empty" (the deserialize fallback a sparse v3
      // save relies on), so an omitted state can never be mistaken for a sold shell.
      units: migrated.units.map((u) =>
        u &&
        u.kind === "condo" &&
        u.everOccupied === true &&
        u.rent === undefined &&
        (u.state ?? "empty") !== "empty" &&
        u.state !== "gutted" &&
        u.state !== "construction"
          ? { ...u, rent: LEGACY_CONDO_DEFAULT_PRICE }
          : u,
      ),
    };
  }
  // v1 → v2: re-lay each floor's rooms at their canon (post-E1b) widths (the
  // segment-parity reflow). Runs for any v1 save; new saves stamp v2 and skip it.
  if (migrated.version === 1) migrated = upgradeV1toV2(migrated);
  // v2 → v3: v3 marks the sparse-unit format: new writes may omit unit fields
  // that sit at the loader defaults (see serializeUnit in Simulation.ts). Old
  // saves are already the full shape, so the hop only re-stamps the version;
  // deserialize's fallback table reads both shapes identically.
  if (migrated.version === 2) migrated = upgradeV2toV3(migrated);
  // v3 → v4: this release adds the transient meal-overlay / associated-census
  // seam, but HUD population and ratingPopulation stay on the canonical room
  // census. The `outForMeal` overlay is never serialized and resets to 0 on
  // load, so there is no saved field to backfill and the hop only re-stamps the
  // version. The step exists so the version ladder stays gapless, a future
  // v4-shaped field has one obvious place to land, and a v3 save loads as v4
  // instead of tripping the "newer than this build" best-effort path.
  if (migrated.version === 3) migrated = upgradeV3toV4(migrated);
  // v4 → v5: widen legacy 3-wide elevator shafts to the canon 4-tile footprint
  // (the standard elevator went back to the service elevator's width). Per-shaft
  // with a keep-legacy fallback, mirroring the v1→v2 reflow's rule that a
  // migration may never scramble or lose a tower.
  if (migrated.version === 4) migrated = upgradeV4toV5(migrated);
  // v5 → v6: grow every one-story party hall into the two-story room canon (and
  // the TDT format's 29/30 top/bottom halves) always intended. In place where
  // the story above is clear; nearest two-story slot when it is boxed in; a
  // last-resort drop (logged) when the tower has no room. Runs once per hop; a
  // v6 hall already owns a clear upper story (placement blocks the floor above
  // it), so there is nothing to re-run on later loads.
  if (migrated.version === 5) migrated = upgradeV5toV6(migrated);
  // A v6 save may still carry a kept-legacy shaft (boxed in when it migrated).
  // Re-run the widening on every load: it is idempotent (an at-canon shaft is
  // skipped; a still-boxed one keeps legacy again), so a shaft heals to canon
  // on the first load after the player demolishes whatever boxed it in, instead
  // of being frozen narrow forever by the one-shot version hop.
  if (migrated.version === 6) migrated = widenLegacyElevatorShafts(migrated);
  // A save from a newer build (version > SAVE_VERSION) can't be downgraded, so
  // it loads best-effort — the coercion below guards it — rather than throwing
  // away the player's tower.
  return migrated;
}

export function upgradeV3toV4(data: SerializedGame): SerializedGame {
  // Additive/no-op data-wise: the meal-customer census reads a transient overlay
  // (`Unit.outForMeal`) that is never persisted, so a v3 save is already a valid
  // v4 save. Only the stamp changes; deserialize's field coercion reads both
  // shapes identically.
  return { ...data, version: 4 };
}

export function upgradeV2toV3(data: SerializedGame): SerializedGame {
  return { ...data, version: 3 };
}

