import { hasBusinessHours, isOpenAt } from "../../engine/facilities";
import type { UnitView } from "../../simport/view";
import { LATE_NIGHT_KINDS, isLateHour } from "../lateNight";

/** The scene inputs a settled room's bake reads beyond the unit itself. */
export interface RoomSigScene {
  hour: number;
  lit: boolean;
  /** This unit is missing from the tower's functional-parking set. Only a
   *  settled parking space reads it (see {@link isDeadParking}). */
  unchained: boolean;
  /** 0..1, the garage display fraction. */
  parkingUse: number;
  /** 0..1, the recycling display fraction. */
  recycleFill: number;
}

/** A parking space draws the red X when no ramp chain reaches it. Only a
 *  SETTLED space counts: a mid-build (or burning) space is left out of the
 *  functional set for other reasons and is not a connectivity fault. */
export function isDeadParking(u: UnitView, unchained: boolean): boolean {
  return u.kind === "parking" && u.state !== "construction" && u.state !== "fire" && unchained;
}

/**
 * The re-bake signature of a room: a settled room repaints exactly when this
 * string changes, so it must capture every input the room sprite draws from.
 * The reconcile records it for burning and mid-build rooms too; only a
 * settled room's repaint check reads it.
 * That includes the hour-dependent bits, a commercial unit's open/closed
 * shutter and a home's late-night "asleep" look, otherwise a shop baked closed
 * at dawn would wrongly stay shuttered all day until the next lighting flip.
 * The late-night bit keys on every kind in `LATE_NIGHT_KINDS` (the condo and
 * both rentals, which share its draw), so a rental baked in the evening drops
 * its residents at 23:00 and gets them back at 06:00.
 */
export function roomSignature(u: UnitView, s: RoomSigScene): string {
  let open = "";
  if (hasBusinessHours(u.kind)) open = isOpenAt(u.kind, s.hour) ? "o" : "c";
  const lateNight = LATE_NIGHT_KINDS.has(u.kind) && isLateHour(s.hour) ? "s" : "";
  const dead = isDeadParking(u, s.unchained) ? "x" : "";
  // Hour-bucketed live-display bits: how full the garage is (cars) and how
  // full the recycling centers are (garbage pile). The scene reconcile
  // (`towerReconcile.syncScene`) runs on the hour, so these advance at the
  // same cadence as open/lateNight.
  let liveBits = "";
  if (u.kind === "parking") liveBits = `:p${Math.round(s.parkingUse * 6)}`;
  else if (u.kind === "recycling") liveBits = `:r${Math.round(s.recycleFill * 8)}`;
  // Include `outForMeal` in the key: the room art reads visible occupants
  // via `visibleOccupants(u)` (occupants minus outForMeal), so it must
  // re-raster when the visible dip changes even though canonical
  // `u.occupants` did not. Without this, an office bakes at t=0 with six
  // workers and would keep rendering six through the whole meal peak.
  // `subtype` is in the key because retail variants draw differently and the
  // inspector's "Change variety" action swaps it at runtime; without it the
  // reroll would not repaint until another signature bit flips.
  return `${u.state}:${s.lit ? 1 : 0}:${u.width}:${u.occupants}:${u.outForMeal ?? 0}:${u.subtype ?? ""}:${open}${lateNight}${dead}${liveBits}`;
}
