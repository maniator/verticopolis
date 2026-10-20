import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadScenario, runScenario } from "./scenario";

const dir = mkdtempSync(join(tmpdir(), "vc-scenario-tune-"));

function run(commands: unknown[]): void {
  const file = join(dir, "s.json");
  writeFileSync(file, JSON.stringify({ id: "t", description: "d", start: { newGame: { seed: 1, mode: "classic" } }, commands }));
  runScenario(loadScenario(file));
}

const withOffice = [
  { op: "setMoney", amount: 500000000 },
  { op: "buildRow", kind: "lobby", floor: 1, from: 167, to: 206 },
  { op: "buildRow", kind: "floor", floor: 2, from: 168, to: 205 },
  { op: "build", kind: "office", floor: 2, x: 170 },
];

describe("expectFail on the tuning ops", () => {
  it("lets a refused sell be a result", () => {
    expect(() => run([{ op: "sell", floor: 2, x: 170, expectFail: true }])).not.toThrow();
    expect(() => run([{ op: "sell", floor: 2, x: 170 }])).toThrow(/sell @ 2,170 failed/);
  });

  it("lets a fire that catches nothing be a result", () => {
    expect(() => run([{ op: "startFire", expectFail: true }])).not.toThrow();
    expect(() => run([{ op: "startFire" }])).toThrow(/startFire failed/);
  });

  it("does not take a sell that lands for a refusal", () => {
    expect(() => run([...withOffice, { op: "sell", floor: 2, x: 170, expectFail: true }])).toThrow(/succeeded but was expected to fail/);
  });

  it.each([
    { op: "adjustRent", floor: 2, x: 170, dir: 1, expectFail: true },
    { op: "setNoRate", floor: 2, x: 170, expectFail: true },
    { op: "setCars", floor: 2, x: 170, cars: 2, expectFail: true },
    { op: "setSchedule", floor: 2, x: 170, schedule: {}, expectFail: true },
  ])("keeps a bad address an error even with expectFail: $op", (command) => {
    expect(() => run([command])).toThrow(/no (unit|transport) at/);
  });

  it("takes a boolean expectFail only", () => {
    expect(() => run([{ op: "sell", floor: 2, x: 4, expectFail: "yes" }])).toThrow(/expectFail must be bool/);
  });
});
