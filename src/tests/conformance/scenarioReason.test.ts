import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadScenario, runScenario } from "./scenario";

const dir = mkdtempSync(join(tmpdir(), "vc-scenario-reason-"));
const NO_LOBBY = "Lay a lobby on the ground line first to open your tower.";

function run(commands: unknown[]): void {
  const file = join(dir, "s.json");
  writeFileSync(file, JSON.stringify({ id: "t", description: "d", start: { newGame: { seed: 1, mode: "classic" } }, commands }));
  runScenario(loadScenario(file));
}

const floorBeforeLobby = { op: "build", kind: "floor", floor: 2, x: 170, expectFail: true };

describe("a refusal pinned by its reason", () => {
  it("passes when the engine gives that reason", () => {
    expect(() => run([{ ...floorBeforeLobby, reason: NO_LOBBY }])).not.toThrow();
  });

  it("fails, naming both, when the engine refuses for another reason", () => {
    expect(() => run([{ ...floorBeforeLobby, reason: "Not enough money." }])).toThrow(/was refused for "Lay a lobby.*", expected "Not enough money\."/);
  });

  it("does not take a reason without expectFail", () => {
    expect(() => run([{ op: "build", kind: "floor", floor: 2, x: 170, reason: NO_LOBBY }])).toThrow(/a reason needs expectFail/);
  });

  it("does not take a command that lands for a refusal", () => {
    expect(() => run([{ op: "build", kind: "lobby", floor: 1, x: 170, expectFail: true, reason: "Structure already here." }])).toThrow(/succeeded but was expected to fail/);
  });

  it.each([
    ["an empty reason", { ...floorBeforeLobby, reason: "" }],
    ["a numeric reason", { ...floorBeforeLobby, reason: 7 }],
  ])("is checked like any field: %s", (_name, command) => {
    expect(() => run([command])).toThrow(/reason must be str/);
  });

  it("is refused on an op that has no refusal", () => {
    expect(() => run([{ op: "sell", floor: 2, x: 4, reason: "no" }])).toThrow(/unknown field reason/);
  });
});
