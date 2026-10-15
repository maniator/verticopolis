import type { FacilityKind } from "../engine/types";

/**
 * The small-hours window that changes a home's look, shared by the room art,
 * the web's re-bake signature (`excalibur/roomSignature.ts`) and the sprite
 * atlas (`atlas/catalog.ts`, `atlas/lookup.ts`). One source of truth, so a kind
 * that draws differently late at night also re-bakes when the hour crosses
 * into or out of the window.
 */

/** Kinds whose art changes after 23:00 and before 06:00: the condo (its
 *  asleep scrim and its residents) and the two rentals, which share the
 *  condo's draw (`residentialRentalSprites.ts`) and its hidden-residents rule. */
export const LATE_NIGHT_KINDS: ReadonlySet<FacilityKind> = new Set<FacilityKind>(["condo", "rentalStudio", "rentalApartment"]);

/** True from 23:00 up to (not including) 06:00. */
export function isLateHour(hour: number): boolean {
  return hour >= 23 || hour < 6;
}
