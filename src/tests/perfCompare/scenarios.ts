import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Simulation } from "../../engine/Simulation";
import { FACILITIES } from "../../engine/facilities";
import type { SerializedGame } from "../../engine/serializedGame";
import { decodeVctower } from "../../storage/vctowerContainer";
import { buildWinningTower } from "../fixtures/winningTower";

/**
 * The three towers the engine comparison runs (issue #972). Each one is a
 * save, built or decoded here in Node and handed unchanged to both engines,
 * so the two start from the same bytes. None carries a crowd (saves never
 * do), so both engines grow their crowd from the same empty start.
 */
export interface Scenario {
  name: "small" | "medium" | "large";
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

export function buildScenarios(): Scenario[] {
  return [
    describeSave("small", "synthetic 15-floor tower (scripts: buildSmallTower)", buildSmallTower().serialize()),
    describeSave("medium", "player fixture conformance/fixtures/sixseven_2.vctower", loadFixtureSave("conformance/fixtures/sixseven_2.vctower")),
    describeSave("large", "Tier-1 win tower (src/tests/fixtures/winningTower.ts)", buildLargeTower().serialize()),
  ];
}
