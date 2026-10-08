import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadScenario } from "./scenario";

const dir = mkdtempSync(join(tmpdir(), "vc-scenario-"));
const base = { id: "t", description: "d", start: { newGame: { seed: 1, mode: "classic" } }, commands: [] as unknown[] };

function load(s: unknown) {
  const file = join(dir, "s.json");
  writeFileSync(file, JSON.stringify(s));
  return () => loadScenario(file);
}

describe("loadScenario", () => {
  it("accepts a well-formed scenario", () => {
    expect(load({ ...base, commands: [{ op: "tick", dt: 1, times: 2, checkpointEvery: 1 }] })().id).toBe("t");
  });

  it.each([
    ["an unknown op", { ...base, commands: [{ op: "explode" }] }, /unknown op/],
    ["an inherited name as op", { ...base, commands: [{ op: "constructor" }] }, /unknown op/],
    ["an unknown command field", { ...base, commands: [{ op: "reload", toString: 1 }] }, /unknown field toString/],
    ["a misspelled optional field", { ...base, commands: [{ op: "tick", dt: 1, checkpointevery: 2 }] }, /unknown field/],
    ["a missing field", { ...base, commands: [{ op: "setMoney" }] }, /amount must be num/],
    ["a fractional dt", { ...base, commands: [{ op: "tick", dt: 0.5 }] }, /dt must be count/],
    ["zero times", { ...base, commands: [{ op: "tick", dt: 1, times: 0 }] }, /times must be count/],
    ["a negative checkpointEvery", { ...base, commands: [{ op: "tick", dt: 1, checkpointEvery: -1 }] }, /checkpointEvery must be count/],
    ["zero cars", { ...base, commands: [{ op: "setCars", floor: 1, x: 1, cars: 0 }] }, /cars must be count/],
    ["a string amount", { ...base, commands: [{ op: "setMoney", amount: "1" }] }, /amount must be num/],
    ["a fractional floor", { ...base, commands: [{ op: "sell", floor: 1.5, x: 1 }] }, /floor must be int/],
    ["a fractional x", { ...base, commands: [{ op: "setNoRate", floor: 1, x: 2.5 }] }, /x must be int/],
    ["a string from", { ...base, commands: [{ op: "buildRow", kind: "floor", floor: 2, from: "1", to: 4 }] }, /from must be int/],
    ["a fractional to", { ...base, commands: [{ op: "buildRow", kind: "floor", floor: 2, from: 1, to: 4.5 }] }, /to must be int/],
    ["a fractional bottom", { ...base, commands: [{ op: "buildTransport", kind: "stairs", x: 1, bottom: 0.5, top: 2 }] }, /bottom must be int/],
    ["a missing top", { ...base, commands: [{ op: "buildTransport", kind: "stairs", x: 1, bottom: 1 }] }, /top must be int/],
    ["an unknown facility kind", { ...base, commands: [{ op: "build", kind: "ofice", floor: 1, x: 1 }] }, /kind must be place/],
    ["a shaft built as a room", { ...base, commands: [{ op: "build", kind: "elevatorStandard", floor: 1, x: 1 }] }, /kind must be place/],
    ["a room built as a shaft", { ...base, commands: [{ op: "buildTransport", kind: "office", x: 1, bottom: 1, top: 2 }] }, /kind must be shaft/],
    ["a bad dir", { ...base, commands: [{ op: "adjustRent", floor: 2, x: 1, dir: 2 }] }, /dir must be dir/],
    ["a non-boolean expectFail", { ...base, commands: [{ op: "build", kind: "office", floor: 2, x: 1, expectFail: "yes" }] }, /expectFail must be bool/],
    ["an empty label", { ...base, commands: [{ op: "checkpoint", label: "" }] }, /label must be str/],
    ["a null command", { ...base, commands: [null] }, /command 0: must be an object/],
    ["a reversed row", { ...base, commands: [{ op: "buildRow", kind: "floor", floor: 2, from: 5, to: 4 }] }, /from must not be past/],
    ["a misspelled mode", { ...base, start: { newGame: { seed: 1, mode: "modren" } } }, /mode must be mode/],
    ["a string seed", { ...base, start: { newGame: { seed: "1", mode: "classic" } } }, /seed must be u32/],
    ["a negative seed", { ...base, start: { newGame: { seed: -1, mode: "classic" } } }, /seed must be u32/],
    ["a seed past 32 bits", { ...base, start: { newGame: { seed: 2 ** 32, mode: "classic" } } }, /seed must be u32/],
    ["an unknown newGame field", { ...base, start: { newGame: { seed: 1, mode: "classic", calendar: "canon" } } }, /unknown field calendar/],
    ["both start forms", { ...base, start: { newGame: { seed: 1, mode: "classic" }, fixture: "x.vctower" } }, /unknown field fixture/],
    ["an unknown start field", { ...base, start: { fixture: "x.vctower", speed: 2 } }, /unknown field speed/],
    ["an empty fixture", { ...base, start: { fixture: "" } }, /fixture must be str/],
    ["a misspelled fixture mode", { ...base, start: { fixture: "x.vctower", mode: "modren" } }, /mode must be mode/],
    ["a missing id", { ...base, id: undefined }, /id must be str/],
    ["an empty description", { ...base, description: "" }, /description must be str/],
    ["an unknown top-level field", { ...base, author: "x" }, /unknown field author/],
    ["a scenario that is not an object", [base], /must be an object/],
    ["commands that are not a list", { ...base, commands: {} }, /commands must be an array/],
  ])("refuses %s", (_name, scenario, message) => {
    expect(load(scenario)).toThrow(message);
  });
});
