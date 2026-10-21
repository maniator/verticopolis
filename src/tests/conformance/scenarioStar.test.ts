import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadScenario, runScenario } from "./scenario";

const dir = mkdtempSync(join(tmpdir(), "vc-scenario-star-"));

function run(star: unknown, commands: unknown[]): void {
  const file = join(dir, "s.json");
  const newGame: Record<string, unknown> = { seed: 1, mode: "classic" };
  if (star !== undefined) newGame.star = star;
  writeFileSync(file, JSON.stringify({ id: "t", description: "d", start: { newGame }, commands }));
  runScenario(loadScenario(file));
}

const escalator = (expectFail: boolean) => [
  { op: "setMoney", amount: 500000000 },
  { op: "buildRow", kind: "lobby", floor: 1, from: 167, to: 206 },
  { op: "buildRow", kind: "floor", floor: 2, from: 168, to: 205 },
  { op: "buildTransport", kind: "escalator", x: 200, bottom: 1, top: 2, ...(expectFail ? { expectFail: true, reason: "Escalator unlocks at 3★." } : {}) },
];

/** A refused build at the opened star, now and after one hour of play. */
const refused = (kind: string, floor: number, x: number, reason: string) => [
  { op: "setMoney", amount: 500000000 },
  { op: "buildRow", kind: "lobby", floor: 1, from: 167, to: 206 },
  { op: "buildRow", kind: "floor", floor: 2, from: 168, to: 205 },
  { op: "build", kind, floor, x, expectFail: true, reason },
  { op: "tick", dt: 60 },
  { op: "build", kind, floor, x, expectFail: true, reason },
];

describe("a new game that opens at a higher star", () => {
  it("keeps the escalator locked at one star, as a game with no star does", () => {
    expect(() => run(undefined, escalator(true))).not.toThrow();
    expect(() => run(1, escalator(true))).not.toThrow();
    expect(() => run(2, escalator(true))).not.toThrow();
  });

  it("builds the escalator from three stars", () => {
    expect(() => run(3, escalator(false))).not.toThrow();
    expect(() => run(5, escalator(false))).not.toThrow();
    expect(() => run(3, escalator(true))).toThrow(/succeeded but was expected to fail/);
  });

  // `Math.min(3, star)` would open four and five stars at three.
  it("opens at four and five stars, now and after a step", () => {
    const hall = (reason: string) => refused("weddingHall", 2, 170, reason);
    expect(() => run(4, hall("Wedding Hall unlocks at 5★."))).not.toThrow();
    expect(() => run(5, hall("The wedding hall can only crown floor 100."))).not.toThrow();
    expect(() => run(5, hall("Wedding Hall unlocks at 5★."))).toThrow();
    const metro = (reason: string) => refused("metro", -8, 0, reason);
    expect(() => run(3, metro("Metro Station unlocks at 4★."))).not.toThrow();
    expect(() => run(4, metro("Build next to the tower. You can't build in midair."))).not.toThrow();
  });

  it("survives a reload at four and five stars, whose milestones a load grants", () => {
    expect(() => run(4, [{ op: "reload" }])).not.toThrow();
    expect(() => run(5, [{ op: "reload" }])).not.toThrow();
  });

  it.each([0, 6, 2.5, "3", null])("refuses a star of %j", (star) => {
    expect(() => run(star, [])).toThrow(/star must be star/);
  });
});
