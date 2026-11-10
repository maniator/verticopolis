/** Test reads for the Map's Eval and Pricing views (#343 S8). */
import { EVAL_TIERS, RENT_TIERS, RoomTiers, roomTierShape, type EvalTier, type RentTier } from "../../simport/roomTiers";

const SHAPE = roomTierShape(
  JSON.stringify({ records: { roomTier: ["id", "floor", "x", "evalTier", "rentTier"] }, evalTiers: EVAL_TIERS, rentTiers: RENT_TIERS }),
)!;

/** A read with one row per `[id, eval, rent]`, each room's anchor at
 *  `anchor(id)` (floor 2 and x equal to the id unless given). */
export function tiersOf(
  rows: ReadonlyArray<readonly [number, EvalTier, RentTier]>,
  anchor: (id: number) => readonly [number, number] = (id) => [2, id],
): RoomTiers {
  const rec = new Float64Array(rows.length * 5);
  rows.forEach(([id, evalTier, rentTier], i) => rec.set([id, ...anchor(id), EVAL_TIERS.indexOf(evalTier), RENT_TIERS.indexOf(rentTier)], i * 5));
  return new RoomTiers(rec, SHAPE);
}
