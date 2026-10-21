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
  const withLobby = [
    { op: "setMoney", amount: 500000000 },
    { op: "buildRow", kind: "lobby", floor: 1, from: 167, to: 206 },
    { op: "buildRow", kind: "floor", floor: 2, from: 168, to: 205 },
  ];
  const withStairs = [...withLobby, { op: "buildTransport", kind: "stairs", x: 200, bottom: 1, top: 2 }];

  it("lets a refused sell be a result", () => {
    // The ground lobby is permanent, so the engine refuses to sell it.
    expect(() => run([...withLobby, { op: "sell", floor: 1, x: 170, expectFail: true }])).not.toThrow();
    expect(() => run([...withLobby, { op: "sell", floor: 1, x: 170 }])).toThrow(/sell @ 1,170 failed/);
  });

  it("keeps a sell at a bare tile an error even with expectFail", () => {
    expect(() => run([{ op: "sell", floor: 2, x: 170, expectFail: true }])).toThrow(/no unit or transport at floor 2, x 170/);
  });

  it("lets a schedule on stairs and a car count on stairs be results", () => {
    expect(() => run([...withStairs, { op: "setSchedule", floor: 1, x: 200, schedule: {}, expectFail: true }])).not.toThrow();
    expect(() => run([...withStairs, { op: "setSchedule", floor: 1, x: 200, schedule: {} }])).toThrow(/setSchedule @ 1,200 failed/);
    expect(() => run([...withStairs, { op: "setCars", floor: 1, x: 200, cars: 2, expectFail: true }])).not.toThrow();
    expect(() => run([...withStairs, { op: "setCars", floor: 1, x: 200, cars: 2 }])).toThrow(/setCars 2 @ 1,200 failed/);
  });

  it("lets a rent change and a no-rate mark on a lobby be results", () => {
    expect(() => run([...withLobby, { op: "adjustRent", floor: 1, x: 170, dir: 1, expectFail: true }])).not.toThrow();
    expect(() => run([...withLobby, { op: "adjustRent", floor: 1, x: 170, dir: 1 }])).toThrow(/adjustRent 1 @ 1,170 failed/);
    expect(() => run([...withLobby, { op: "setNoRate", floor: 1, x: 170, expectFail: true }])).not.toThrow();
    expect(() => run([...withLobby, { op: "setNoRate", floor: 1, x: 170 }])).toThrow(/setNoRate @ 1,170 failed/);
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
