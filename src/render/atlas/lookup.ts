import { FACILITIES, hasBusinessHours, isOpenAt } from "../../engine/facilities";
import type { FacilityKind, UnitState } from "../../engine/types";
import { rand } from "../sprites/common";
import { OCCUPANT_FREE, PARKING_CAR_COLORS, RECYCLE_STEPS } from "./catalog";

/**
 * The reference reader: how a frontend maps a live unit and scene to atlas
 * frames, following the manifest's `signature.rules`. The comparison test
 * runs it against the web's own bake; a frontend in another language ports
 * these few lines.
 */

export interface LiveUnit {
  kind: FacilityKind;
  state: UnitState;
  subtype?: string;
  occupants: number;
  outForMeal?: number;
  /** Used for the parked-car color and presence roll, like the web. */
  id: number;
}

export interface LiveScene {
  hour: number;
  lit: boolean;
  /** 0..1, the web's `parkingUsage`. */
  parkingUse: number;
  /** 0..1, the web's `recyclingFill`. */
  recycleFill: number;
  /** This parking space is not chained to a ramp. */
  dead: boolean;
}

export type Lookup =
  | { animation: string }
  | { frame: string; chains: Record<string, number>; overlays: string[] };

export function lookupRoom(u: LiveUnit, s: LiveScene, variant: number): Lookup {
  if (u.state === "fire" || u.state === "construction") return { animation: `${u.state}/${u.kind}` };
  let hours = "always";
  if (hasBusinessHours(u.kind)) hours = isOpenAt(u.kind, s.hour) ? "open" : "closed";
  let late = "any";
  if (u.kind === "condo") late = s.hour >= 23 || s.hour < 6 ? "late" : "notlate";
  const stem = `room/${u.kind}/${u.state}/${u.subtype ?? "-"}/w${FACILITIES[u.kind].width}/${s.lit ? "lit" : "unlit"}/${hours}/${late}/v${variant}`;
  if (u.kind === "parking") {
    const overlays: string[] = [];
    if (s.dead) overlays.push("dead");
    else if (rand((u.id * 31) | 0) < s.parkingUse) overlays.push(`car${u.id % PARKING_CAR_COLORS}`);
    return { frame: stem, chains: {}, overlays };
  }
  if (u.kind === "recycling") {
    const fill = Math.max(0, Math.min(1, s.recycleFill));
    return { frame: stem, chains: { fill: Math.round(fill * RECYCLE_STEPS) }, overlays: [] };
  }
  if (OCCUPANT_FREE.has(u.kind)) return { frame: stem, chains: {}, overlays: [] };
  if (u.occupants <= 0) return { frame: `${stem}/away`, chains: {}, overlays: [] };
  const visible = Math.max(0, u.occupants - (u.outForMeal ?? 0));
  return { frame: `${stem}/home`, chains: { occupants: visible }, overlays: [] };
}
