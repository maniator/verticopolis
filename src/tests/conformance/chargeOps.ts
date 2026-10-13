import type { Simulation } from "../../engine/Simulation";
import type { At, Outcome, ScenarioEngine, Spec } from "./scenario";

/**
 * The scenario ops for the engine-owned charges (#914): `addCar`,
 * `removeCar`, `extendTransport` and `removeFacility`. Each must land, or,
 * when the scenario names a `reason`, be refused with exactly that copy, so
 * both engines' refusal wording is pinned along with their money. Either
 * way the balance must move by exactly the `delta` the command reports.
 */

export type ChargeCommand =
  | ({ op: "addCar"; reason?: string } & At)
  | ({ op: "removeCar"; reason?: string } & At)
  | ({ op: "extendTransport"; end: "up" | "down"; targetFloor: number; hwmBottom?: number; hwmTop?: number; reason?: string } & At)
  | ({ op: "removeFacility"; method: "sell" | "bulldoze"; shaft?: boolean; reason?: string } & At);

const AT = { floor: "int", x: "int" } as const;
/** The charge ops' fields, checked by the scenario loader like every op's. */
export const CHARGE_OPS: Record<ChargeCommand["op"], Spec> = {
  addCar: { ...AT, reason: "str?" },
  removeCar: { ...AT, reason: "str?" },
  extendTransport: { ...AT, end: "end", targetFloor: "int", hwmBottom: "int?", hwmTop: "int?", reason: "str?" },
  removeFacility: { ...AT, method: "method", shaft: "bool?", reason: "str?" },
};

/** A charge command's result as the scenario reads it. */
export interface ChargeOutcome extends Outcome { delta: number }

/** The engine-owned charges (#914) a scenario engine runs; each moves the
 *  money itself. */
export interface ChargeEngine {
  addCar(id: number): ChargeOutcome;
  removeCar(id: number): ChargeOutcome;
  extendTransport(id: number, end: "up" | "down", targetFloor: number, hwm: { bottom: number; top: number } | null): ChargeOutcome;
  removeFacility(id: number, method: "sell" | "bulldoze"): ChargeOutcome;
}

/** A command result narrowed to `{ ok, reason?, delta }`. */
export const chargeOf = (r: { ok: boolean; reason?: string; delta: number }): ChargeOutcome => (r.ok ? { ok: true, delta: r.delta } : { ok: false, reason: r.reason, delta: r.delta });

/** The TypeScript engine's charge commands, as a scenario engine runs them. */
export function tsCharges(sim: Simulation): ChargeEngine {
  return {
    addCar: (id) => chargeOf(sim.addCar(id)),
    removeCar: (id) => chargeOf(sim.removeCar(id)),
    extendTransport: (id, end, targetFloor, hwm) => chargeOf(sim.extendTransport(id, end, targetFloor, hwm ?? undefined)),
    removeFacility: (id, method) => chargeOf(sim.removeFacility(id, method)),
  };
}

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
  const before = e.money();
  const r = run(e, c);
  // Same order as the Rust runner's `expect_charge`: the money first.
  const moved = e.money() - before;
  if (moved !== r.delta) throw new Error(`${c.op} ${at}: the balance moved ${moved} but the command reported ${r.delta}`);
  if (!r.ok && r.delta !== 0) throw new Error(`${c.op} ${at}: refused but reported a delta of ${r.delta}`);
  expectCharge(r, c.reason, `${c.op} ${at}`);
}

function run(e: ScenarioEngine, c: ChargeCommand): ChargeOutcome {
  switch (c.op) {
    case "addCar": return e.addCar(idAt(e, c, true));
    case "removeCar": return e.removeCar(idAt(e, c, true));
    case "extendTransport": {
      const hwm = c.hwmBottom !== undefined && c.hwmTop !== undefined ? { bottom: c.hwmBottom, top: c.hwmTop } : null;
      return e.extendTransport(idAt(e, c, true), c.end, c.targetFloor, hwm);
    }
    case "removeFacility": return e.removeFacility(idAt(e, c, c.shaft ?? false), c.method);
  }
}
