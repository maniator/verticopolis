import type { Command, Outcome, ScenarioEngine } from "./scenario";

/**
 * The scenario ops for the engine-owned charges (#914): `addCar`,
 * `removeCar`, `extendTransport` and `removeFacility`. Each must land, or,
 * when the scenario names a `reason`, be refused with exactly that copy, so
 * both engines' refusal wording is pinned along with their money.
 */

type ChargeCommand = Extract<Command, { op: "addCar" | "removeCar" | "extendTransport" | "removeFacility" }>;

/** A command result narrowed to the scenario's `{ ok, reason? }`. */
export const outcomeOf = (r: { ok: boolean; reason?: string }): Outcome => (r.ok ? { ok: true } : { ok: false, reason: r.reason });

function expectCharge(r: Outcome, reason: string | undefined, what: string): void {
  if (reason === undefined) {
    if (!r.ok) throw new Error(`${what} failed: ${r.reason ?? "no reason"}`);
    return;
  }
  if (r.ok) throw new Error(`${what} succeeded but was expected to fail with ${reason}`);
  if (r.reason !== reason) throw new Error(`${what} failed with ${r.reason ?? "no reason"}, expected ${reason}`);
}

function idAt(e: ScenarioEngine, c: ChargeCommand, shaft: boolean): number {
  const found = shaft ? e.transportAt(c.floor, c.x) : e.unitAt(c.floor, c.x);
  if (!found) throw new Error(`no ${shaft ? "transport" : "unit"} at floor ${c.floor}, x ${c.x}`);
  return found.id;
}

export function applyCharge(e: ScenarioEngine, c: ChargeCommand): void {
  const at = `@ ${c.floor},${c.x}`;
  switch (c.op) {
    case "addCar": return expectCharge(e.addCar(idAt(e, c, true)), c.reason, `addCar ${at}`);
    case "removeCar": return expectCharge(e.removeCar(idAt(e, c, true)), c.reason, `removeCar ${at}`);
    case "extendTransport": {
      const hwm = c.hwmBottom !== undefined && c.hwmTop !== undefined ? { bottom: c.hwmBottom, top: c.hwmTop } : null;
      return expectCharge(e.extendTransport(idAt(e, c, true), c.end, c.targetFloor, hwm), c.reason, `extendTransport ${c.end} to ${c.targetFloor} ${at}`);
    }
    case "removeFacility": return expectCharge(e.removeFacility(idAt(e, c, c.shaft ?? false), c.method), c.reason, `removeFacility ${c.method} ${at}`);
  }
}
