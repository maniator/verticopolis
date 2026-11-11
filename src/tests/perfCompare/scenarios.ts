import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SerializedGame } from "../../shared/serializedGame";
import { decodeVctower } from "../../storage/vctowerContainer";

/** Every tower the harnesses can run, small to large by people with the
 *  special-purpose towers after them. A run with no
 *  `--scenarios` takes the first three kinds only (`DEFAULT_SCENARIOS`); the
 *  bracket towers, the many-unit tower (issue #1270) and the hotel-heavy tower (#1279) are named on purpose. */
export const SCENARIO_NAMES = ["small", "bracket-a", "bracket-b", "medium", "large", "many-unit", "hotel-heavy"] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];
export const DEFAULT_SCENARIOS: readonly ScenarioName[] = ["small", "medium", "large"];

/**
 * The towers the harnesses run (issue #972; #1270 added three). Each one is a
 * committed save, decoded here in Node and handed unchanged to the page, so
 * every run starts from the same bytes. None carries a crowd (saves never
 * do), so each run grows its crowd from the same empty start.
 */
export interface Scenario {
  name: ScenarioName;
  description: string;
  /** The save as JSON text, exactly as the engine receives it. */
  save: string;
  /** SHA-256 of `save`, recorded so a report names the exact input. */
  sha256: string;
  population: number;
  units: number;
  transports: number;
}

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/** A committed tower file, decoded the way the import path does. */
export function loadFixtureSave(file: string): SerializedGame {
  return decodeVctower(readFileSync(resolve(REPO_ROOT, file), "utf8"), file) as SerializedGame;
}

/** What `towers/manifest.json` records for each tower: the hash of its save
 *  text and the counts a report prints beside it. */
export interface PinnedTower {
  sha256: string;
  population: number;
  units: number;
  transports: number;
}

/** The pinned towers' records, read once. */
export function pinnedTowers(): Record<ScenarioName, PinnedTower> {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, "towers/manifest.json"), "utf8")) as Record<ScenarioName, PinnedTower>;
}

/**
 * Each tower is a committed save. The synthetic ones (all but medium) were
 * built by TypeScript builders that issued the engine's own placement
 * commands; when the TypeScript engine was retired (#1875) their saves were
 * pinned byte for byte under `towers/`, so every recorded run keeps naming
 * the same input by its hash. A file that no longer hashes to its record
 * stops the run here instead of quietly measuring another tower.
 */
const TOWERS: Record<ScenarioName, { file: string; description: string }> = {
  small: { file: "src/tests/perfCompare/towers/small.vctower", description: "synthetic 15-floor tower (towers/small.vctower)" },
  "bracket-a": { file: "src/tests/perfCompare/towers/bracket-a.vctower", description: "bracket tower: 26 floors, about 1,150 people (towers/bracket-a.vctower)" },
  "bracket-b": { file: "src/tests/perfCompare/towers/bracket-b.vctower", description: "bracket tower: 48 floors, about 1,800 people (towers/bracket-b.vctower)" },
  medium: { file: "conformance/fixtures/sixseven_2.vctower", description: "player fixture conformance/fixtures/sixseven_2.vctower" },
  large: { file: "src/tests/perfCompare/towers/large.vctower", description: "Tier-1 win tower (towers/large.vctower)" },
  "many-unit": { file: "src/tests/perfCompare/towers/many-unit.vctower", description: "many units, few people: the large tower's shell with about 500 people (towers/many-unit.vctower)" },
  "hotel-heavy": { file: "src/tests/perfCompare/towers/hotel-heavy.vctower", description: "Modern hotel tower: 852 rooms, 24 housekeeping units, a split staff network and a wing no crew can route to (towers/hotel-heavy.vctower)" },
};

/** One tower, checked against its record. */
export function loadScenario(name: ScenarioName, pinned: PinnedTower | undefined): Scenario {
  const { file, description } = TOWERS[name];
  if (pinned === undefined) throw new Error(`${name}: towers/manifest.json has no record for ${file}`);
  const save = JSON.stringify(loadFixtureSave(file));
  const sha256 = createHash("sha256").update(save, "utf8").digest("hex");
  if (sha256 !== pinned.sha256) throw new Error(`${name}: ${file} hashes to ${sha256}, but towers/manifest.json records ${pinned.sha256}`);
  return { name, description, save, sha256, population: pinned.population, units: pinned.units, transports: pinned.transports };
}

/** The names that are not a tower the harnesses can run. */
export function unknownScenarios(names: readonly string[]): string[] {
  return names.filter((n) => !(SCENARIO_NAMES as readonly string[]).includes(n));
}

/** The named towers, in `SCENARIO_NAMES` order, or the three default kinds when
 *  no names are given. A name that is not a tower is left out; callers check
 *  `unknownScenarios` first. */
export function buildScenarios(names?: readonly string[] | null): Scenario[] {
  const wanted = names ?? DEFAULT_SCENARIOS;
  const pinned = pinnedTowers();
  return SCENARIO_NAMES.filter((n) => wanted.includes(n)).map((n) => loadScenario(n, pinned[n]));
}
