import type { SerializedGame } from "../types";

/**
 * v6 -> v7 save migration: the elevator per-shaft schedule (#305) added an
 * optional `Transport.schedule` field. It is purely additive and absent-safe: a
 * v6 save simply carries no schedule on its shafts, which `coerceSchedule`
 * (in `Simulation.deserialize`) reads as "no schedule", i.e. today's automatic
 * dispatch. So there is nothing to backfill; the hop only re-stamps the version.
 *
 * The step exists so the version ladder stays gapless (a future v6-shaped field
 * has one obvious place to land), and so a v6 save loads as v7 instead of tripping
 * the "newer than this build" best-effort path. Mirrors `upgradeV2toV3` /
 * `upgradeV3toV4`, the other additive stamp-only hops.
 */
export function upgradeV6toV7(data: SerializedGame): SerializedGame {
  return { ...data, version: 7 };
}
