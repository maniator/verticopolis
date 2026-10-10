import type { Simulation } from "../Simulation";
import { ECON, GUTTED_RESALE_REFUND, carResaleRefund, extendBill, resaleRefund } from "../econConfig";
import { isElevatorKind, maxCarsFor } from "../facilities";
import type { Unit } from "../types";

/**
 * The editor's and the bulldozer's priced commands (#914): add or remove an
 * elevator car, extend a shaft, and sell a unit or a shaft by id. Each one
 * checks its own limits and the balance, moves the money, and says why when
 * it refuses, so a frontend never writes `money` for these actions. The raw
 * tower edits (`setCars`, `resizeTransport`, `removeUnit`,
 * `removeTransport`) stay free for loaders and tests.
 */

/** What a priced command did: `delta` is the money it moved (negative for a
 *  charge, positive for a refund, zero on a refusal). */
export interface ChargeResult {
  ok: boolean;
  reason?: string;
  delta: number;
}

/** An extend's result, plus the floors it billed. */
export interface ExtendResult extends ChargeResult {
  added: number;
}

const NOT_ENOUGH_MONEY = "Not enough money.";

function refuse(reason?: string): ChargeResult {
  return reason === undefined ? { ok: false, delta: 0 } : { ok: false, reason, delta: 0 };
}

/** Add one car to an elevator for `ECON.addCarCost`. */
export function addCar(sim: Simulation, id: number): ChargeResult {
  const t = sim.tower.getTransport(id);
  if (!t || !isElevatorKind(t.kind)) return refuse("No such elevator.");
  const max = maxCarsFor(t.kind);
  if (t.cars >= max) return refuse(`This elevator already runs ${max} cars.`);
  const cost = ECON.addCarCost;
  if (sim.money < cost) return refuse(NOT_ENOUGH_MONEY);
  if (!sim.tower.setCars(id, t.cars + 1)) return refuse("The car could not be added.");
  sim.money -= cost;
  return { ok: true, delta: -cost };
}

/** Remove one car from an elevator and pay its resale (half the add cost). */
export function removeCar(sim: Simulation, id: number): ChargeResult {
  const t = sim.tower.getTransport(id);
  if (!t || !isElevatorKind(t.kind)) return refuse("No such elevator.");
  if (t.cars <= 1) return refuse("An elevator keeps at least one car.");
  if (!sim.tower.setCars(id, t.cars - 1)) return refuse("The car could not be removed.");
  const refund = carResaleRefund();
  sim.money += refund;
  return { ok: true, delta: refund };
}

/**
 * Move one end of an elevator toward `targetFloor`, paying
 * `ECON.transportFloorCost` for each floor past the high-water mark `hwm`
 * (the shaft's extent when absent) and growing only as far as the balance
 * covers, the clamp {@link extendBill} applies. A drag passes its gesture's
 * mark so a back-and-forth wiggle pays once; shrinking is free. Refuses with
 * no reason when nothing would change, and with "Not enough money." when the
 * balance covers no new floor.
 */
export function extendTransport(
  sim: Simulation,
  id: number,
  end: "up" | "down",
  targetFloor: number,
  hwm?: { bottom: number; top: number },
): ExtendResult {
  const t = sim.tower.getTransport(id);
  if (!t || !isElevatorKind(t.kind)) return { ...refuse("No such elevator."), added: 0 };
  const mark = hwm ?? { bottom: t.bottom, top: t.top };
  const perFloor = ECON.transportFloorCost;
  const { nb, nt, added } = extendBill({ bottom: t.bottom, top: t.top }, mark, end, targetFloor, sim.money, perFloor);
  if (nb === t.bottom && nt === t.top) {
    const wantsMore = end === "up" ? Math.max(t.bottom + 1, targetFloor) > mark.top : Math.min(t.top - 1, targetFloor) < mark.bottom;
    return { ...refuse(wantsMore ? NOT_ENOUGH_MONEY : undefined), added: 0 };
  }
  const res = sim.tower.resizeTransport(id, nb, nt);
  if (!res.ok) return { ...refuse(res.reason), added: 0 };
  const cost = added * perFloor;
  sim.money -= cost;
  return { ok: true, delta: 0 - cost, added }; // 0 - cost: a free shrink reads +0
}

/** Remove a unit with its refund: refused while it burns or while it holds
 *  up the story above; a gutted shell pays nothing, everything else half its
 *  cost. Selling the last Wedding Hall before the VIP came cancels the
 *  pending inspection. Shared by {@link sell} and `sellAt`. */
export function sellUnit(sim: Simulation, u: Unit): ChargeResult {
  if (u.state === "fire") return refuse("You can't remove a burning unit. Call fire rescue or let it burn out.");
  const blocked = sim.tower.removalReason(u.id);
  if (blocked) return refuse(blocked);
  sim.tower.removeUnit(u.id);
  const refund = u.state === "gutted" ? GUTTED_RESALE_REFUND : resaleRefund(u.kind);
  sim.money += refund;
  // If the last Wedding Hall is gone before the VIP arrived, cancel the
  // pending inspection so it can't keep re-failing and spamming the log.
  if (u.kind === "weddingHall" && !sim.tower.builtWeddingHall && !sim.evaluatedTower) {
    sim.vipVisitDay = -1;
  }
  return { ok: true, delta: refund };
}

/** Sell or bulldoze a unit or a shaft by id (one id counter covers both),
 *  paying the resale. */
export function sell(sim: Simulation, id: number): ChargeResult {
  const u = sim.tower.getUnit(id);
  if (u) return sellUnit(sim, u);
  const t = sim.tower.getTransport(id);
  if (!t) return refuse("Nothing to sell.");
  sim.tower.removeTransport(id);
  const refund = resaleRefund(t.kind);
  sim.money += refund;
  return { ok: true, delta: refund };
}
