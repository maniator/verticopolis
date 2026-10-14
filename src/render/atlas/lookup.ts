import { FACILITIES, hasBusinessHours, isElevatorKind, isOpenAt } from "../../engine/facilities";
import { subtypeListFor } from "../../engine/retailSubtypes";
import type { FacilityKind, UnitState } from "../../engine/types";
import { rand } from "../sprites/common";
import { LATE_NIGHT_KINDS, OCCUPANT_FREE, PARKING_CAR_COLORS, RECYCLE_STEPS, isLateHour } from "./catalog";
import { LEGACY_SHAFT_WIDTHS } from "./catalogExtras";

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
  /** The room's width in tiles. The atlas bakes catalog widths only; a room
   *  at another width (a TDT import or a legacy save keeps its original
   *  width, #731) gets its catalog-width picture and a `stretchTo`. */
  width: number;
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

/** `stretchTo`, when present, is the room's real width in tiles: its frame or
 *  animation is baked at the kind's catalog width, so compose it as usual
 *  (chains, overlays, layers, all in catalog-width coordinates), then scale
 *  the composed picture horizontally to `stretchTo` tiles, nearest neighbor
 *  from its left edge. It approximates the web game, which redraws the room
 *  at its real width. */
export type Lookup =
  | { animation: string; stretchTo?: number }
  | { frame: string; chains: Record<string, number>; overlays: string[]; stretchTo?: number };

export function lookupRoom(u: LiveUnit, s: LiveScene, variant: number): Lookup {
  // An unknown kind keeps its own width (its frame is missing either way); a
  // corrupt width (not finite, or under one tile) reads as the catalog's.
  const cat = FACILITIES[u.kind]?.width ?? u.width;
  const width = Number.isFinite(u.width) && Math.round(u.width) >= 1 ? Math.round(u.width) : cat;
  const found = lookupAtCatalogWidth(u, s, variant, cat);
  return width === cat ? found : { ...found, stretchTo: width };
}

function lookupAtCatalogWidth(u: LiveUnit, s: LiveScene, variant: number, width: number): Lookup {
  if (u.state === "fire" || u.state === "construction") return { animation: `${u.state}/${u.kind}` };
  let hours = "always";
  if (hasBusinessHours(u.kind)) hours = isOpenAt(u.kind, s.hour) ? "open" : "closed";
  let late = "any";
  if (LATE_NIGHT_KINDS.has(u.kind)) late = isLateHour(s.hour) ? "late" : "notlate";
  // An unknown or legacy subtype draws the kind's default look, the "-" frame.
  const known = u.subtype !== undefined && (subtypeListFor(u.kind) ?? []).includes(u.subtype);
  const subtype = known ? u.subtype : "-";
  const stem = `room/${u.kind}/${u.state}/${subtype}/w${width}/${s.lit ? "lit" : "unlit"}/${hours}/${late}/v${variant}`;
  if (u.kind === "parking") {
    const overlays: string[] = [];
    if (s.dead) overlays.push("dead");
    else if (rand((u.id * 31) | 0) < finite(s.parkingUse)) overlays.push(`car${u.id % PARKING_CAR_COLORS}`);
    return { frame: stem, chains: {}, overlays };
  }
  if (u.kind === "recycling") {
    const fill = Math.max(0, Math.min(1, finite(s.recycleFill)));
    return { frame: stem, chains: { fill: Math.round(fill * RECYCLE_STEPS) }, overlays: [] };
  }
  if (OCCUPANT_FREE.has(u.kind)) return { frame: stem, chains: {}, overlays: [] };
  const occupants = finite(u.occupants);
  if (occupants <= 0) return { frame: `${stem}/away`, chains: {}, overlays: [] };
  // Whole figures only. The art's figure loops run `i < n`, so a fractional
  // count (a forged save) paints like the next whole one: round up.
  const visible = Math.ceil(Math.max(0, occupants - finite(u.outForMeal ?? 0)));
  return { frame: `${stem}/home`, chains: { occupants: visible }, overlays: [] };
}

/** A count or fraction from the engine, with a corrupt value read as 0. */
function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/** A shaft's frame names: an elevator's bands are `<shaft>/<piece>` and its
 *  cabs `<car>/<arrow>/<full>/s<variant>`; stairs and escalators draw their
 *  one two-floor `shaft` frame. A legacy width the atlas bakes (stairs 4,
 *  standard elevator 3) names its own frames; any other width uses the
 *  catalog's, with `stretchTo` as for a room. */
export function lookupShaft(kind: FacilityKind, width: number): { shaft: string; car?: string; stretchTo?: number } {
  const cat = FACILITIES[kind].width;
  const w = Number.isFinite(width) && Math.round(width) >= 1 ? Math.round(width) : cat;
  const seg = w !== cat && (LEGACY_SHAFT_WIDTHS[kind] ?? []).includes(w) ? `/w${w}` : "";
  const names = isElevatorKind(kind) ? { shaft: `shaft/${kind}${seg}`, car: `car/${kind}${seg}` } : { shaft: `transport/${kind}${seg}` };
  return w === cat || seg ? names : { ...names, stretchTo: w };
}
