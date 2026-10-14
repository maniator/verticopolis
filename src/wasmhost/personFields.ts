import type { Person } from "../engine/crowd/person";

/** The optional person fields the frame carries: set when the record has
 *  them, and otherwise left in the shape the TypeScript engine leaves them
 *  in, so a held person reads as the instance's own would. */
export const PERSON_OPTIONALS = ["originUnitId", "venueUnitId", "mealVenueId", "routine", "dwellSecondsLeft"] as const;

/** The optional person fields the TypeScript engine clears by assigning
 *  undefined (`motion.ts`: the origin unit at the lobby, the venue and the
 *  hotel-guest flag when a meal ends), so a cleared one keeps its key with
 *  no value. Every other optional field is absent until set and is never
 *  cleared, and the three flags are absent or true (no engine path writes
 *  false). A person first seen in a frame has no key for a field the frame
 *  sends as absent. */
const CLEARED_BY_ASSIGNMENT: ReadonlySet<string> = new Set(["originUnitId", "venueUnitId", "countedHotelGuest"]);

/** Clear an optional person field the frame sends as absent, the way the
 *  TypeScript engine would. */
export function clearOptional(p: Person, key: keyof Person): void {
  if (!(key in p)) return;
  if (CLEARED_BY_ASSIGNMENT.has(key)) (p as unknown as Record<string, unknown>)[key] = undefined;
  else delete (p as unknown as Record<string, unknown>)[key];
}
