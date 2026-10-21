import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Simulation } from "../../engine/Simulation";
import { FACILITIES } from "../../engine/facilities";
import type { SerializedGame } from "../../engine/serializedGame";
import { decodeVctower } from "../../storage/vctowerContainer";
import { buildWinningTower } from "../fixtures/winningTower";
import { buildBracketTower, buildManyUnitTower } from "./fixtureTowers";

/** Every tower the harnesses can run, in order of size. A run with no
 *  `--scenarios` takes the first three kinds only (`DEFAULT_SCENARIOS`); the
 *  bracket towers and the many-unit tower (issue #1270) are named on purpose. */
export const SCENARIO_NAMES = ["small", "bracket-a", "bracket-b", "medium", "large", "many-unit"] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];
export const DEFAULT_SCENARIOS: readonly ScenarioName[] = ["small", "medium", "large"];

/**
 * The towers the engine comparison runs (issue #972; #1270 added three). Each one is a
 * save, built or decoded here in Node and handed unchanged to both engines,
 * so the two start from the same bytes. None carries a crowd (saves never
 * do), so both engines grow their crowd from the same empty start.
 */
export interface Scenario {
  name: ScenarioName;
  description: string;
  /** The save as JSON text, exactly as both engines receive it. */
  save: string;
  /** SHA-256 of `save`, recorded so a report names the exact input. */
  sha256: string;
  population: number;
  units: number;
  transports: number;
}

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/** A small, fully occupied 15-floor tower: two elevators, a row of offices
 *  (or, every third floor, condos) on floors 3 to 15, one fast food. Deterministic (seeded founding, no ticks). */
export function buildSmallTower(): Simulation {
  const sim = Simulation.newGame(7, "classic");
  const t = sim.tower;
  sim.money = 1_000_000_000;
  const left = 120;
  const right = 260;
  // Every placement is asserted, so a rule change that refuses one fails
  // here instead of quietly benchmarking a smaller tower than described.
  const must = (kind: Parameters<typeof t.place>[0], floor: number, x: number): void => {
    const r = t.place(kind, floor, x);
    if (!r.ok) throw new Error(`small tower: ${kind} at floor ${floor}, x ${x} refused: ${r.reason}`);
  };
  for (let x = left; x < right; x++) must("lobby", 1, x);
  for (let f = 2; f <= 15; f++) for (let x = left; x < right; x++) must("floor", f, x);
  for (const x of [left, right - FACILITIES.elevatorStandard.width]) {
    const r = t.placeTransport("elevatorStandard", x, 1, 15);
    if (!r.ok) throw new Error(`small tower: elevator at ${x} refused: ${r.reason}`);
  }
  for (let f = 3; f <= 15; f++) {
    const kind = f % 3 === 0 ? "condo" : "office";
    const w = FACILITIES[kind].width;
    for (let x = left + 8; x + w <= right - 8; x += w) must(kind, f, x);
  }
  must("fastFood", 2, left + 10);
  for (const u of t.units) {
    if (u.kind === "office" || u.kind === "condo") {
      u.state = "occupied";
      u.everOccupied = true;
      u.satisfaction = 1;
    }
  }
  sim.evaluateStar();
  return sim;
}

/** The repository's deterministic TOWER-scale fixture (the Tier-1 win
 *  tower): 100 floors, five elevator bands, about 17,000 occupants. */
export function buildLargeTower(): Simulation {
  const sim = Simulation.newGame(1, "classic");
  buildWinningTower(sim);
  sim.evaluateStar();
  return sim;
}

/** A committed player-built fixture, decoded the way the import path does. */
export function loadFixtureSave(file: string): SerializedGame {
  return decodeVctower(readFileSync(resolve(REPO_ROOT, file), "utf8"), file) as SerializedGame;
}

function describeSave(name: Scenario["name"], description: string, data: SerializedGame): Scenario {
  const save = JSON.stringify(data);
  const sim = Simulation.deserialize(JSON.parse(save) as SerializedGame);
  return {
    name,
    description,
    save,
    sha256: createHash("sha256").update(save, "utf8").digest("hex"),
    population: sim.population,
    units: sim.tower.units.length,
    transports: sim.tower.transports.length,
  };
}

/** The bracket towers' sizes: geometric steps between small (729 people, 2,240
 *  units, 15 floors) and medium (3,240, 12,062, 78), so the size threshold is
 *  read off a curve. */
const BRACKETS = {
  "bracket-a": { seed: 11, floors: 26, population: 1150 },
  "bracket-b": { seed: 11, floors: 48, population: 1800 },
} as const;

const BUILDERS: Record<ScenarioName, () => Scenario> = {
  small: () => describeSave("small", "synthetic 15-floor tower (scripts: buildSmallTower)", buildSmallTower().serialize()),
  "bracket-a": () => describeSave("bracket-a", "bracket tower: 26 floors, about 1,150 people (fixtureTowers: buildBracketTower)", buildBracketTower(BRACKETS["bracket-a"]).serialize()),
  "bracket-b": () => describeSave("bracket-b", "bracket tower: 48 floors, about 1,800 people (fixtureTowers: buildBracketTower)", buildBracketTower(BRACKETS["bracket-b"]).serialize()),
  medium: () => describeSave("medium", "player fixture conformance/fixtures/sixseven_2.vctower", loadFixtureSave("conformance/fixtures/sixseven_2.vctower")),
  large: () => describeSave("large", "Tier-1 win tower (src/tests/fixtures/winningTower.ts)", buildLargeTower().serialize()),
  "many-unit": () => describeSave("many-unit", "many units, few people: the large tower's shell with about 500 people (fixtureTowers: buildManyUnitTower)", buildManyUnitTower({ seed: 13, population: 500 }).serialize()),
};

/** The names that are not a tower the harnesses can run. */
export function unknownScenarios(names: readonly string[]): string[] {
  return names.filter((n) => !(SCENARIO_NAMES as readonly string[]).includes(n));
}

/** The named towers, in `SCENARIO_NAMES` order, or the three default kinds when
 *  no names are given. A name that is not a tower is left out; callers check
 *  `unknownScenarios` first. */
export function buildScenarios(names?: readonly string[] | null): Scenario[] {
  const wanted = names ?? DEFAULT_SCENARIOS;
  return SCENARIO_NAMES.filter((n) => wanted.includes(n)).map((n) => BUILDERS[n]());
}
