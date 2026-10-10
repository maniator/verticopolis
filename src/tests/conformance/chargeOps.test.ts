import { describe, expect, it } from "vitest";
import { applyCharge, type ChargeOutcome } from "./chargeOps";
import type { ScenarioEngine } from "./scenario";

/** A stub engine whose `addCar` answers with `result` and moves the balance
 *  by `moves`, so each runner check can be driven on its own. */
function stub(result: ChargeOutcome, moves: number): ScenarioEngine {
  let money = 100;
  return {
    money: () => money,
    transportAt: () => ({ id: 7, kind: "elevatorStandard", cars: 1 }),
    addCar: () => {
      money += moves;
      return result;
    },
  } as unknown as ScenarioEngine;
}

const op = (reason?: string) => ({ op: "addCar" as const, floor: 1, x: 2, ...(reason ? { reason } : {}) });

describe("applyCharge (the scenario charge ops)", () => {
  it("passes a charge whose balance moved by its delta", () => {
    expect(() => applyCharge(stub({ ok: true, delta: -40 }, -40), op())).not.toThrow();
  });

  it("fails when the balance moved by something other than the reported delta", () => {
    expect(() => applyCharge(stub({ ok: true, delta: -40 }, 0), op())).toThrow("the balance moved 0 but the command reported -40");
  });

  it("fails a refusal that reports a delta", () => {
    expect(() => applyCharge(stub({ ok: false, reason: "Not enough money.", delta: -5 }, -5), op("Not enough money."))).toThrow("refused but reported a delta of -5");
  });

  it("pins the refusal copy when the scenario names it", () => {
    expect(() => applyCharge(stub({ ok: false, reason: "Not enough money.", delta: 0 }, 0), op("Not enough money."))).not.toThrow();
    expect(() => applyCharge(stub({ ok: false, reason: "Not enough money.", delta: 0 }, 0), op("Other."))).toThrow("failed with Not enough money., expected Other.");
    expect(() => applyCharge(stub({ ok: true, delta: -40 }, -40), op("Other."))).toThrow("expected to fail with Other.");
    expect(() => applyCharge(stub({ ok: false, reason: "Not enough money.", delta: 0 }, 0), op())).toThrow("failed: Not enough money.");
  });
});
