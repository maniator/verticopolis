import type { Simulation } from "../Simulation";

import { ECON, carResaleRefund, extendBill, resaleRefund } from "../econConfig";
import { isElevatorKind, maxCarsFor } from "../facilities";
import type { GameplayRemovalMethod } from "../gameplayEvents";
import type { Transport } from "../types";

/**
 * The engine-owned charges for the editor and the bulldozer (#914): adding
 * and removing elevator cars, the billed shaft extension, and the one player
 * removal command that pays the resale refund. Each command checks, moves
 * the tower, and moves the money in one step, so a frontend relays the
 * command and never writes money for these actions. The raw
 * `tower.setCars`, `tower.resizeTransport`, `tower.removeUnit` and
 * `tower.removeTransport` stay free of charge for loaders and tests.
 *
 * Refusal reasons are player-facing copy, worded as the web editor shows
 * them. The Rust engine mirrors this file in `engine-rs/src/charges.rs`.
 * The car and span edits go through `Simulation.setCars` and
 * `Simulation.resizeTransport` (`sim/capacity.ts`), which report
 * `capacity_changed`; {@link removeFacility} reports `facility_removed` with
 * its method.
 */

/** What a charged command did. `delta` is the signed change it made to the
 *  balance: negative for a charge, positive for a refund, 0 on a refusal. */
export interface ChargeResult {
  ok: boolean;
  reason?: string;
  delta: number;
}

/** A billed extension's outcome: the shaft's ends afterwards and how many
 *  floors were billed (floors past the gesture's high-water mark). */
export interface ExtendResult extends ChargeResult {
  bottom: number;
  top: number;
  added: number;
}

/** The two ways a player removes a facility: the editor's Sell button or the
 *  bulldozer, as the event catalog's `removalMethod` enum names them. The
 *  refund is the same; the verb is in the refusal copy. */
export type RemovalMethod = GameplayRemovalMethod;

export const NOT_ENOUGH_MONEY = "Not enough money.";
export const ELEVATOR_GONE = "That elevator is gone.";
export const ONLY_ELEVATOR_CARS = "Only elevators have cars.";
export const ONLY_ELEVATOR_EXTEND = "Only elevators can be extended.";
export const CAR_LIMIT = "This elevator has all the cars it can hold.";
export const LAST_CAR = "An elevator needs at least one car.";
export const FACILITY_GONE = "That facility is gone.";
/** The one refusal for a malformed command (#923): an id or floor that is
 *  not a whole number, or an `end` or `method` the command does not know.
 *  The web never sends one; a second frontend or a relay might. */
export const INVALID_REQUEST = "That request is not valid.";

const refuse = (reason: string): ChargeResult => ({ ok: false, reason, delta: 0 });

/** A whole number a command may take: a safe integer, so both engines read
 *  the same value (the Rust binding reads a raw JS number and checks the same). */
const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const isEnd = (v: unknown): v is "up" | "down" => v === "up" || v === "down";
const isMethod = (v: unknown): v is RemovalMethod => v === "sell" || v === "bulldoze";

/** The shaft behind an elevator command, or the refusal to return. */
function elevator(sim: Simulation, id: number, notElevator: string): Transport | ChargeResult {
  const t = sim.tower.transportById(id);
  if (!t) return refuse(ELEVATOR_GONE);
  if (!isElevatorKind(t.kind)) return refuse(notElevator);
  return t;
}

/** Buy one more car for an elevator at `ECON.addCarCost`. Refused at the
 *  kind's car limit (checked first, so a broke player at the limit hears
 *  about the limit) and when the balance is short. */
export function addCar(sim: Simulation, id: number): ChargeResult {
  if (!whole(id)) return refuse(INVALID_REQUEST);
  const t = elevator(sim, id, ONLY_ELEVATOR_CARS);
  if ("ok" in t) return t;
  if (t.cars >= maxCarsFor(t.kind)) return refuse(CAR_LIMIT);
  const cost = ECON.addCarCost;
  if (sim.money < cost) return refuse(NOT_ENOUGH_MONEY);
  if (!sim.setCars(id, t.cars + 1)) return refuse(CAR_LIMIT);
  sim.money -= cost;
  return { ok: true, delta: -cost };
}

/** Sell one car back for {@link carResaleRefund}, half the add-car cost.
 *  Refused on the last car: an elevator keeps at least one. */
export function removeCar(sim: Simulation, id: number): ChargeResult {
  if (!whole(id)) return refuse(INVALID_REQUEST);
  const t = elevator(sim, id, ONLY_ELEVATOR_CARS);
  if ("ok" in t) return t;
  if (t.cars <= 1 || !sim.setCars(id, t.cars - 1)) return refuse(LAST_CAR);
  const refund = carResaleRefund();
  sim.money += refund;
  return { ok: true, delta: refund };
}

/** The open extend gesture per simulation (#990): the shaft it is on and the
 *  furthest span the gesture has paid for. The engine holds it, so a caller
 *  cannot bill against a mark it supplies. It is not part of the save or the
 *  hashed views, and a swapped-in simulation (a load, an undo) has none. */
const gestures = new WeakMap<Simulation, { id: number; bottom: number; top: number }>();

/**
 * Open an extend gesture on an elevator (an extend-arrow drag starting): its
 * high-water mark starts at the shaft's current span, and each
 * {@link extendTransport} on that shaft until {@link endExtend} bills only the
 * floors past it. Any gesture already open is dropped first, so a new gesture
 * never inherits an old one's mark. False, with no gesture open, when `id` is
 * not a whole number or names no elevator.
 */
export function beginExtend(sim: Simulation, id: number): boolean {
  gestures.delete(sim);
  if (!whole(id)) return false;
  const t = elevator(sim, id, ONLY_ELEVATOR_EXTEND);
  if ("ok" in t) return false;
  gestures.set(sim, { id, bottom: t.bottom, top: t.top });
  return true;
}

/** Close the open extend gesture, if any (the drag ended). */
export function endExtend(sim: Simulation): void {
  gestures.delete(sim);
}

/**
 * Move one end of an elevator to `targetFloor`, billing
 * `ECON.transportFloorCost` for each floor past the high-water mark and
 * growing only as far as the balance pays for ({@link extendBill}). Shrinking
 * is free and refunds nothing. The mark is the open gesture's when
 * {@link beginExtend} opened one on this shaft (a drag that wiggles out and
 * back is billed once), and the shaft's current span otherwise (a one-floor
 * button press bills one floor). It never reaches inside the current span, so
 * no floor that already stands is billed again.
 *
 * Any floor laid behind the shaft by the extension is part of the per-floor
 * price (see `Tower.resizeTransport`). Refused with "Not enough money." when
 * the request reached past the high-water mark and the balance paid for no
 * floor of it, and with the tower's reason when the new span does not fit.
 * A request that changes nothing succeeds with nothing billed. A request the
 * budget pays only part of succeeds as far as it got: read the ends from the
 * result, not from the request. A malformed request (an id or floor that is
 * not a whole number, or an unknown `end`) is refused with
 * {@link INVALID_REQUEST} before anything moves.
 */
export function extendTransport(sim: Simulation, id: number, end: "up" | "down", targetFloor: number): ExtendResult {
  if (!whole(id) || !isEnd(end) || !whole(targetFloor)) {
    const cur = whole(id) ? sim.tower.transportById(id) : undefined;
    return { ...refuse(INVALID_REQUEST), bottom: cur?.bottom ?? 0, top: cur?.top ?? 0, added: 0 };
  }
  const t = elevator(sim, id, ONLY_ELEVATOR_EXTEND);
  if ("ok" in t) {
    // No shaft, or not an elevator: report the shaft's ends when it stands.
    const cur = sim.tower.transportById(id);
    return { ...t, bottom: cur?.bottom ?? 0, top: cur?.top ?? 0, added: 0 };
  }
  const held = gestures.get(sim);
  const gesture = held?.id === id ? held : undefined;
  const mark = { bottom: Math.min(gesture?.bottom ?? t.bottom, t.bottom), top: Math.max(gesture?.top ?? t.top, t.top) };
  const perFloor = ECON.transportFloorCost;
  const bill = extendBill({ bottom: t.bottom, top: t.top }, mark, end, targetFloor, sim.money, perFloor);
  const unchanged = { bottom: t.bottom, top: t.top, added: 0 };
  if (bill.nb === t.bottom && bill.nt === t.top) {
    const wanted = end === "up" ? targetFloor > mark.top : targetFloor < mark.bottom;
    return wanted ? { ...refuse(NOT_ENOUGH_MONEY), ...unchanged } : { ok: true, delta: 0, ...unchanged };
  }
  const res = sim.resizeTransport(id, bill.nb, bill.nt);
  if (!res.ok) return { ok: false, reason: res.reason, delta: 0, ...unchanged };
  const cost = bill.added * perFloor;
  sim.money -= cost;
  if (gesture) {
    gesture.bottom = Math.min(mark.bottom, bill.nb);
    gesture.top = Math.max(mark.top, bill.nt);
  }
  return { ok: true, delta: cost === 0 ? 0 : -cost, bottom: bill.nb, top: bill.nt, added: bill.added };
}

/**
 * The player's removal of a unit or a shaft by id (the editor's Sell and the
 * bulldozer), paying the resale refund: half the build cost
 * ({@link resaleRefund}), nothing for a gutted unit. Refused for a burning
 * unit and for structure the tower must keep (`Tower.removalReason`). Removing
 * the last Wedding Hall before the VIP's inspection cancels the visit. Units
 * and shafts share one id counter, so `id` names exactly one of them. An id
 * that is not a whole number, or an unknown method, is refused with
 * {@link INVALID_REQUEST}.
 */
export function removeFacility(sim: Simulation, id: number, method: RemovalMethod): ChargeResult {
  if (!whole(id) || !isMethod(method)) return refuse(INVALID_REQUEST);
  const u = sim.tower.getUnit(id);
  if (u) {
    if (u.state === "fire") return refuse(`You can't ${method} a burning unit. Call fire rescue or let it burn out.`);
    const blocked = sim.tower.removalReason(id);
    if (blocked) return refuse(blocked);
    const { kind, state } = u; // read before the removal, as the Rust port does
    sim.tower.removeUnit(id);
    const refund = state === "gutted" ? 0 : resaleRefund(kind);
    sim.money += refund;
    // The last Wedding Hall gone before the VIP arrived: cancel the pending
    // inspection so it can't keep re-failing and spamming the log.
    if (kind === "weddingHall" && !sim.tower.builtWeddingHall && !sim.evaluatedTower) sim.vipVisitDay = -1;
    sim.gameplayEvents.push("facility_removed", { kind, method });
    return { ok: true, delta: refund };
  }
  const t = sim.tower.transportById(id);
  if (!t) return refuse(FACILITY_GONE);
  sim.tower.removeTransport(id);
  const refund = resaleRefund(t.kind);
  sim.money += refund;
  sim.gameplayEvents.push("facility_removed", { kind: t.kind, method });
  return { ok: true, delta: refund };
}
