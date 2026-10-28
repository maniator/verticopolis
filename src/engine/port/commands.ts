import { INVALID_REQUEST, UNKNOWN_FACILITY } from "../request";
import { subtypeListFor } from "../retailSubtypes";
import type { BrushKind } from "../sim/brush";
import type { BatchRentResult, BatchTarget } from "../sim/constants";
import type { LogEntry } from "../types";
import { wellFormed } from "../wellFormed";
import { VIEW_LAYOUT, kindOf } from "./layout";
import { scheduleFromSlots } from "../../simport/scheduleSlots";
import { finish, flag, record, refuse, whole, type PortState } from "./record";

/**
 * `TsEngine`'s commands: the TypeScript side of the Rust engine's port
 * commands (`engine-rs/src/wasm_port.rs`, `wasm_port_edit.rs` and the
 * schedule and log members of `wasm_port_life.rs`), check for check and slot
 * for slot, so a caller gets the same record from either engine. Each clears
 * `reason` first, reads its arguments as the Rust engine reads them (a kind
 * as its layout code, an id or floor as a safe integer, a price as a finite
 * number of 0 or more) and refuses anything else before the simulation sees
 * it. Text is repaired where the Rust binding repairs it (`wellFormed`).
 */

const FILM_POLICIES = VIEW_LAYOUT.filmPolicies as readonly ("auto" | "feature" | "blockbuster")[];
const LOG_KINDS = VIEW_LAYOUT.logKinds as readonly LogEntry["kind"][];

/** `rentBatch`'s own slots, in the layout's order. */
export const BATCH_SLOTS = VIEW_LAYOUT.records.rentBatch.slice(2) as (keyof BatchRentResult)[];

export function buildAt(e: PortState, kind: number, floor: number, x: number): Float64Array {
  e.reason = undefined;
  const k = kindOf(kind);
  if (!k) return refuse(e, UNKNOWN_FACILITY);
  if (!whole(floor, x)) return refuse(e, INVALID_REQUEST);
  const before = e.sim.money;
  const r = e.sim.build(k, floor, x);
  return finish(e, before, r.ok, r.reason);
}

/** The floor and lobby brush: done when any tile was laid, with the count. */
export function paintTiles(e: PortState, kind: number, floor: number, tiles: Float64Array): Float64Array {
  e.reason = undefined;
  const k = kindOf(kind);
  if (!k) return refuse(e, UNKNOWN_FACILITY, [0]);
  const before = e.sim.money;
  // The brush refuses a kind other than floor or lobby, a floor or tile that
  // is not whole, and too many tiles, as the Rust brush does.
  const r = e.sim.paintBrush(k as BrushKind, floor, Array.from(tiles));
  return finish(e, before, r.placed > 0, r.reason, [r.placed]);
}

export function buildShaft(e: PortState, kind: number, x: number, bottom: number, top: number): Float64Array {
  e.reason = undefined;
  const k = kindOf(kind);
  if (!k) return refuse(e, UNKNOWN_FACILITY);
  if (!whole(x, bottom, top)) return refuse(e, INVALID_REQUEST);
  const before = e.sim.money;
  const r = e.sim.buildTransport(k, x, bottom, top);
  return finish(e, before, r.ok, r.reason);
}

export function demolish(e: PortState, id: number, bulldoze: boolean): Float64Array {
  e.reason = undefined;
  if (!whole(id)) return refuse(e, INVALID_REQUEST);
  const before = e.sim.money;
  const r = e.sim.removeFacility(id, bulldoze ? "bulldoze" : "sell");
  return finish(e, before, r.ok, r.reason);
}

/** The floor or lobby tile at a cell (the view gives tiles no ids); a cell
 *  with no tile is refused. */
export function demolishTile(e: PortState, floor: number, x: number, bulldoze: boolean): Float64Array {
  e.reason = undefined;
  if (!whole(floor, x)) return refuse(e, INVALID_REQUEST);
  const u = e.sim.tower.unitAt(floor, x);
  if (!u || (u.kind !== "floor" && u.kind !== "lobby")) return refuse(e, INVALID_REQUEST);
  return demolish(e, u.id, bulldoze);
}

/** One car more or fewer, with the cars the shaft has after. */
export function changeCars(e: PortState, id: number, add: boolean): Float64Array {
  e.reason = undefined;
  if (!whole(id)) return refuse(e, INVALID_REQUEST, [0]);
  const before = e.sim.money;
  const r = add ? e.sim.addCar(id) : e.sim.removeCar(id);
  const cars = e.sim.tower.getTransport(id)?.cars ?? 0;
  return finish(e, before, r.ok, r.reason, [cars]);
}

/** Move an elevator's end, with its ends after and the floors added; a
 *  refusal of a malformed request gives the ends as they stand. */
export function extendShaft(e: PortState, id: number, up: boolean, target: number): Float64Array {
  e.reason = undefined;
  if (!whole(id, target)) {
    const t = whole(id) ? e.sim.tower.getTransport(id) : undefined;
    return refuse(e, INVALID_REQUEST, [t?.bottom ?? 0, t?.top ?? 0, 0]);
  }
  const before = e.sim.money;
  const r = e.sim.extendTransport(id, up ? "up" : "down", target);
  return finish(e, before, r.ok, r.reason, [r.bottom, r.top, r.added]);
}

/** Book the exterminator, with its cost and rooms; a refusal for want of
 *  funds is "funds" and still carries both. */
export function bookExterminator(e: PortState): Float64Array {
  e.reason = undefined;
  const before = e.sim.money;
  const r = e.sim.callExterminator();
  if (r.ok) return finish(e, before, true, undefined, [r.cost ?? 0, r.rooms ?? 0]);
  if (r.reason === "funds") return refuse(e, "funds", [r.cost ?? 0, r.rooms ?? 0]);
  return refuse(e, r.reason ?? INVALID_REQUEST, [0, 0]);
}

/** Store the camera: finite tile and floor, and a zoom above 0 or NaN for
 *  none. */
export function setCamera(e: PortState, tile: number, floor: number, zoom: number): Float64Array {
  e.reason = undefined;
  const zoomOk = Number.isNaN(zoom) || (Number.isFinite(zoom) && zoom > 0);
  if (!(Number.isFinite(tile) && Number.isFinite(floor) && zoomOk)) return refuse(e, INVALID_REQUEST);
  e.sim.view = Number.isNaN(zoom) ? { tile, floor } : { tile, floor, zoom };
  return record(true, 0);
}

export function setFilm(e: PortState, id: number, policy: number): Float64Array {
  e.reason = undefined;
  if (!whole(id, policy) || policy < 0 || policy >= FILM_POLICIES.length) return refuse(e, INVALID_REQUEST, [NaN]);
  if (e.sim.setFilmPolicy(id, FILM_POLICIES[policy]) === null) return refuse(e, INVALID_REQUEST, [NaN]);
  return record(true, 0, [policy]);
}

export function markStop(e: PortState, id: number, floor: number, stop: boolean): Float64Array {
  e.reason = undefined;
  const before = e.sim.money;
  return finish(e, before, whole(id, floor) && e.sim.tower.setStop(id, floor, stop));
}

export function expressStops(e: PortState, id: number): Float64Array {
  e.reason = undefined;
  const before = e.sim.money;
  const done = whole(id) && e.sim.tower.getTransport(id) !== undefined;
  if (done) e.sim.tower.setExpressStops(id);
  return finish(e, before, done);
}

export function dropStops(e: PortState, id: number): Float64Array {
  e.reason = undefined;
  const before = e.sim.money;
  return finish(e, before, whole(id) && e.sim.tower.clearStops(id));
}

/** One rung up (1) or down (-1), with the rent after. */
export function stepRent(e: PortState, id: number, dir: number): Float64Array {
  e.reason = undefined;
  if (!whole(id) || (dir !== 1 && dir !== -1)) return refuse(e, INVALID_REQUEST, [NaN]);
  const before = e.sim.money;
  const rent = e.sim.adjustRent(id, dir);
  return rent === null ? finish(e, before, false, undefined, [NaN]) : finish(e, before, true, undefined, [rent]);
}

export function noRate(e: PortState, id: number): Float64Array {
  e.reason = undefined;
  const before = e.sim.money;
  return finish(e, before, whole(id) && e.sim.setNoRate(id));
}

/** Price a unit at `target`, with the rent applied. */
export function setRent(e: PortState, id: number, target: number): Float64Array {
  e.reason = undefined;
  if (!whole(id) || !(Number.isFinite(target) && target >= 0)) return refuse(e, INVALID_REQUEST, [NaN]);
  const before = e.sim.money;
  const unit = e.sim.tower.getUnit(id);
  const rent = unit ? e.sim.priceUnit(unit, target) : null;
  return rent === null ? finish(e, before, false, undefined, [NaN]) : finish(e, before, true, undefined, [rent]);
}

/** A batch price target: NaN for the default, -1 for No Rate, or a finite
 *  number of 0 or more. */
export function batchTarget(target: number): BatchTarget | undefined {
  if (Number.isNaN(target)) return "default";
  if (target === -1) return "noRate";
  return Number.isFinite(target) && target >= 0 ? target : undefined;
}

export function rentBatch(e: PortState, kind: number, target: number, onlyDefault: boolean): Float64Array {
  e.reason = undefined;
  const none = BATCH_SLOTS.map(() => 0);
  const k = kindOf(kind);
  if (!k) return refuse(e, UNKNOWN_FACILITY, none);
  const t = batchTarget(target);
  if (t === undefined) return refuse(e, INVALID_REQUEST, none);
  const before = e.sim.money;
  const r = e.sim.applyRentBatch(k, t, { onlyDefaultPriced: onlyDefault });
  return r ? finish(e, before, true, undefined, BATCH_SLOTS.map((s) => r[s])) : finish(e, before, false, undefined, none);
}

/** A new subtype, with its index in the kind's subtype list. */
export function rerollUnit(e: PortState, id: number): Float64Array {
  e.reason = undefined;
  if (!whole(id)) return refuse(e, INVALID_REQUEST, [NaN]);
  const before = e.sim.money;
  const subtype = e.sim.rerollSubtype(id);
  if (subtype === undefined) return finish(e, before, false, undefined, [NaN]);
  const kind = e.sim.tower.getUnit(id)?.kind;
  const i = kind ? (subtypeListFor(kind)?.indexOf(subtype) ?? -1) : -1;
  return finish(e, before, true, undefined, [i < 0 ? NaN : i]);
}

export function answerChoice(e: PortState, accept: boolean): Float64Array {
  e.reason = undefined;
  const before = e.sim.money;
  const pending = e.sim.pendingChoice !== null;
  if (pending) e.sim.resolveChoice(accept ? "accept" : "decline");
  return finish(e, before, pending);
}

/** Set the auto-bridge preference, refused where the mode fixes it. */
export function chooseAutoBridge(e: PortState, value: boolean): Float64Array {
  e.reason = undefined;
  const done = value === e.sim.autoBridge || e.sim.rules.bridgingToggleable();
  if (done) e.sim.autoBridge = value;
  return finish(e, e.sim.money, done, undefined, [flag(e.sim.autoBridge)]);
}

export function flipAutoBridge(e: PortState): Float64Array {
  e.reason = undefined;
  const before = e.sim.autoBridge;
  const after = e.sim.toggleAutoBridge();
  return finish(e, e.sim.money, after !== before, undefined, [flag(after)]);
}

/** Open an extend gesture; a malformed id drops any open one. */
export function startExtend(e: PortState, id: number): Float64Array {
  e.reason = undefined;
  const before = e.sim.money;
  let done = false;
  if (whole(id)) done = e.sim.beginExtend(id);
  else e.sim.endExtend();
  return finish(e, before, done);
}

export function stopExtend(e: PortState): Float64Array {
  e.reason = undefined;
  e.sim.endExtend();
  return record(true, 0);
}

export function labelUnit(e: PortState, id: number, text: string): Float64Array {
  e.reason = undefined;
  const before = e.sim.money;
  return finish(e, before, whole(id) && e.sim.tower.setLabel(id, wellFormed(text)));
}

/** Name the tower; no text clears the name, and the save then leaves the key
 *  out, as the Rust engine's does. */
export function nameTower(e: PortState, text?: string | null): Float64Array {
  e.reason = undefined;
  e.sim.tower.towerName = (text === undefined || text === null ? undefined : wellFormed(text)) as string;
  return record(true, 0);
}

export function logLine(e: PortState, text: string, kindCode: number): Float64Array {
  e.reason = undefined;
  const kind = whole(kindCode) ? LOG_KINDS[kindCode] : undefined;
  if (!kind) return refuse(e, INVALID_REQUEST);
  e.sim.emit(wellFormed(text), kind);
  return record(true, 0);
}

export function scheduleShaft(e: PortState, id: number, slots: Float64Array): Float64Array {
  e.reason = undefined;
  const raw = scheduleFromSlots(slots);
  if (!whole(id) || !raw) return refuse(e, INVALID_REQUEST);
  return finish(e, e.sim.money, e.sim.tower.setSchedule(id, raw));
}
