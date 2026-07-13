import type { LogEntry, SerializedUnit, SerializedView, Unit } from "../types";

import { VIEW_ZOOM_MAX, VIEW_ZOOM_MIN } from "../types";
import { LOG_RING_CAP, LOG_TEXT_CAP } from "./constants";
import { FACILITIES, GRID } from "../facilities";
import { subtypeListFor } from "../retailSubtypes";

/**
 * Write a unit for a save, omitting every field whose value equals the fallback
 * `deserialize` restores (save v3+). On a real late-game tower most units are
 * plain floor tiles whose fields all sit at these defaults, so omitting them cuts
 * the serialized JSON to roughly a third (measured 2.09MB to 692KB on a
 * 12,975-unit save), which speeds stringify, compression, and load in proportion.
 *
 * The omit table below MUST mirror the coercion fallbacks in
 * {@link Simulation.deserialize} exactly; the sparse round-trip test pins the two
 * against each other so they cannot drift apart.
 *
 * `width` is special: catalog widths are tuning that has drifted before (the
 * v1 to v2 reflow exists because room widths changed), and a room that omitted
 * its width would silently re-lay itself when the catalog moves again. Only the
 * width-1 structural tiles (floor/lobby) omit it: a tile one grid cell wide is
 * definitionally stable. Rooms always persist their width.
 */
export function serializeUnit(u: Unit): SerializedUnit {
  // Destructure every known Unit field. The rest must type as empty: when a
  // future field is added to Unit, `unhandled` stops satisfying
  // Record<string, never> and this fails to compile, forcing the new field
  // into the omit table below instead of silently vanishing from saves.
  const { id, kind, floor, x, width, state, satisfaction, occupants, everOccupied, pendingIncome, label, residents, rent, noRate, vacateReason, vacateAt, filmPolicy, subtype, patronageToday, patronageYest, profitToday, profitYest, completeAt, outForMeal: _outForMeal, customersIn: _customersIn, hotelCustomersIn: _hotelCustomersIn, ...unhandled } = u;
  void _outForMeal; // Transient: not persisted; a save/reload resets it to 0.
  void _customersIn; // Transient: not persisted; rebuilt from meal round-trips.
  void _hotelCustomersIn; // Transient: the hotel-origin subset of customersIn.
  const exhaustive: Record<string, never> = unhandled;
  void exhaustive;
  const out: SerializedUnit = { id, kind, floor, x };
  // The catalog-width check makes the omission stop (new saves turn dense
  // again) if floor/lobby ever left width 1, and the canon test pinning those
  // widths to 1 turns any such catalog edit into a visible CI failure instead
  // of a silent re-lay of existing sparse saves.
  if (!(width === 1 && FACILITIES[kind].width === 1 && (kind === "floor" || kind === "lobby"))) out.width = width;
  if (state !== "empty") out.state = state;
  if (satisfaction !== 1) out.satisfaction = satisfaction;
  if (occupants !== 0) out.occupants = occupants;
  if (everOccupied) out.everOccupied = true;
  if (pendingIncome !== 0) out.pendingIncome = pendingIncome;
  // A default label picking up a future catalog rename on load is intended:
  // these labels are cosmetic. Tenant-named units never match and stay written.
  if (label !== FACILITIES[kind].name) out.label = label;
  if (residents !== undefined) out.residents = residents;
  if (rent !== undefined) out.rent = rent;
  if (noRate) out.noRate = true;
  if (vacateReason !== undefined) out.vacateReason = vacateReason;
  if (vacateAt !== undefined) out.vacateAt = vacateAt;
  if (filmPolicy !== undefined) out.filmPolicy = filmPolicy;
  if (subtype !== undefined) out.subtype = subtype;
  // Retail patronage/profit persist only for kinds that carry a canon subtype
  // (shop / fastFood / restaurant), mirroring the kind guard `deserialize`
  // applies, so a field erroneously set on a non-retail unit can never reach a
  // save. The engine only ever sets them on retail kinds anyway; this hardens
  // the write side against a future in-memory mutation.
  if (subtypeListFor(kind) !== null) {
    if (patronageToday !== undefined) out.patronageToday = patronageToday;
    if (patronageYest !== undefined) out.patronageYest = patronageYest;
    if (profitToday !== undefined) out.profitToday = profitToday;
    if (profitYest !== undefined) out.profitYest = profitYest;
  }
  if (completeAt !== undefined) out.completeAt = completeAt;
  return out;
}

/** The four LogEntry kinds, for restore-time coercion (an unknown kind reads
 *  as the neutral "info" rather than dropping the line). */
const LOG_KINDS: ReadonlySet<string> = new Set(["info", "good", "bad", "money"]);

/**
 * Trust-boundary coercion for the restored bulletin tail. A save is untrusted
 * input: a non-array restores an empty log; an entry without a string text is
 * dropped; text is truncated to LOG_TEXT_CAP; minute coerces to a finite
 * number (else 0); kind coerces into the known set (else "info"); at most
 * LOG_RING_CAP entries restore (the newest, matching the live ring).
 */
export function coerceLog(v: unknown): LogEntry[] {
  if (!Array.isArray(v)) return [];
  // Walk from the newest end and keep the newest LOG_RING_CAP VALID entries:
  // capping before filtering would let junk padding evict real history.
  const out: LogEntry[] = [];
  for (let i = v.length - 1; i >= 0 && out.length < LOG_RING_CAP; i--) {
    const e: unknown = v[i];
    if (typeof e !== "object" || e === null) continue;
    const { minute, text, kind } = e as Record<string, unknown>;
    if (typeof text !== "string") continue;
    let t = text.slice(0, LOG_TEXT_CAP);
    // Never cut through an astral character: a torn surrogate pair would
    // render as U+FFFD and round-trip as a lone surrogate.
    if (t.length === LOG_TEXT_CAP && /[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
    out.push({
      minute: typeof minute === "number" && Number.isFinite(minute) ? Math.max(0, minute) : 0,
      text: t,
      kind: typeof kind === "string" && LOG_KINDS.has(kind) ? (kind as LogEntry["kind"]) : "info",
    });
  }
  return out.reverse();
}

/**
 * Trust-boundary coercion for the saved camera view. A save is untrusted
 * input, so the whole field drops to null on any malformed member (wrong
 * type, NaN, Infinity) rather than half-loading; merely out-of-range finite
 * values clamp, so a view saved on a taller lot or a wider zoom range still
 * lands somewhere sensible instead of vanishing.
 */
export function coerceView(v: unknown): SerializedView | null {
  if (typeof v !== "object" || v === null) return null;
  const { tile, floor, zoom } = v as Record<string, unknown>;
  if (typeof tile !== "number" || !Number.isFinite(tile)) return null;
  if (typeof floor !== "number" || !Number.isFinite(floor)) return null;
  const out: SerializedView = {
    tile: Math.max(0, Math.min(GRID.width, tile)),
    floor: Math.max(GRID.minFloor, Math.min(GRID.maxFloor, floor)),
  };
  // A null zoom reads as absent, not malformed: JSON pipelines commonly
  // encode a missing optional as null, and the tile/floor are still good.
  if (zoom !== undefined && zoom !== null) {
    if (typeof zoom !== "number" || !Number.isFinite(zoom)) return null;
    out.zoom = Math.max(VIEW_ZOOM_MIN, Math.min(VIEW_ZOOM_MAX, zoom));
  }
  return out;
}
