import { describe, it, expect } from "vitest";
import { readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONFORMANCE_DIR, loadScenario, runScenario } from "../conformance/scenario";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { HEATMAP_MODES, probedWasmStart } from "../conformance/panelProbe";
import { statsReport } from "../../simport/statsSheet";
import { PortCodes } from "../../simport/portCodes";
import type { WasmEngine } from "../../engineBinding/binding";

/**
 * The Rust panel getters on the conformance corpus (facade slice 6b, #1214).
 * Every scenario runs through the binding; at every checkpoint the stats
 * screen the game decodes from the `statsSheet` record must equal the
 * engine's own `statsReport` answer. The HUD counters must carry the save's
 * cash; the coverage, the onboarding facts and the hotspot must answer their
 * full shape; every listed unit and shaft must have a card, and an id no
 * engine holds must have none. The getters' values are the Rust engine's own
 * tests (`engine-rs/src/panels/`). Without the built package the suite skips.
 */

const SCENARIO_DIR = resolve(CONFORMANCE_DIR, "scenarios");
const files = readdirSync(SCENARIO_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

/** Ids that no engine holds, so the cards answer nothing. */
const ABSENT_IDS = [0, -1, 999_999];
/** How many units and shafts a checkpoint reads the cards of, spread over the list. */
const CARDS_PER_CHECKPOINT = 12;

const spread = <T>(xs: T[]): T[] => xs.filter((_, i) => i % Math.max(1, Math.floor(xs.length / CARDS_PER_CHECKPOINT)) === 0);

/** The HUD strip's counters (`towerStats`), the housekeeping coverage and
 *  the onboarding facts, each key the engine answers. */
const TOWER_STATS_KEYS = [
  "basements", "condos", "dirty", "elevators", "fires", "floors", "hotelRooms", "money", "occupiedHotel", "occupiedOffices",
  "offices", "parkingSpaces", "population", "restaurants", "shops", "soldCondos", "star", "transports", "vacant", "vacantNoRate",
];
const COVERAGE_KEYS = ["crews", "dailyCapacity", "dirty", "infested", "maids", "outOfReach", "rooms"];
const ONBOARDING_KEYS = ["connect", "floor", "lobby", "office", "play"];

/** How much each getter was read, summed over the corpus. */
const compared = { checkpoints: 0, units: 0, transports: 0, heatCells: 0, strandedFloors: 0, infested: 0, twoCars: 0 };

const parse = (text: string | undefined): unknown => (text === undefined ? null : (JSON.parse(text) as unknown));
/** Whether a card answer is a card: a JSON object, never null or a list. */
const isCard = (v: unknown): boolean => typeof v === "object" && v !== null && !Array.isArray(v);

/** One checkpoint: the decoded stats screen against the getter, then a read
 *  of every other getter, counted. */
function probe(h: WasmEngine, id: string): void {
  const report = parse(h.statsReport()) as { strandedFloors: number[]; housekeeping: { infested: number }; elevators: { cars: number }[] };
  expect(JSON.parse(JSON.stringify(statsReport(h.statsSheet(), new PortCodes(h)))), `${id} checkpoint ${compared.checkpoints}`).toEqual(report);
  const save = JSON.parse(h.serialize()) as { money: number; units: { id: number }[]; transports: { id: number }[] };
  const at = `${id} checkpoint ${compared.checkpoints}`;
  // The HUD strip: every counter a number, and the cash the save holds.
  const stats = parse(h.towerStats()) as Record<string, unknown>;
  expect(Object.keys(stats).sort(), `${at} towerStats`).toEqual(TOWER_STATS_KEYS);
  for (const key of TOWER_STATS_KEYS) expect(stats[key], `${at} towerStats.${key}`).toEqual(expect.any(Number));
  expect(stats.money, `${at} towerStats.money`).toBe(save.money);
  const coverage = parse(h.housekeepingCoverage()) as Record<string, unknown>;
  expect(Object.keys(coverage).sort(), `${at} housekeepingCoverage`).toEqual(COVERAGE_KEYS);
  for (const key of COVERAGE_KEYS) expect(coverage[key], `${at} housekeepingCoverage.${key}`).toEqual(expect.any(Number));
  const facts = parse(h.onboardingFacts()) as Record<string, unknown>;
  expect(Object.keys(facts).sort(), `${at} onboardingFacts`).toEqual(ONBOARDING_KEYS);
  for (const key of ONBOARDING_KEYS) expect(facts[key], `${at} onboardingFacts.${key}`).toEqual(expect.any(Boolean));
  const hotspot = parse(h.peakCongestionHotspot()) as { ratio: unknown; floor: unknown };
  expect(hotspot.ratio, `${at} hotspot ratio`).toEqual(expect.any(Number));
  expect(hotspot.floor === null || Number.isInteger(hotspot.floor), `${at} hotspot floor`).toBe(true);
  for (const m of HEATMAP_MODES) compared.heatCells += (parse(h.floorHeatmap(m)) as unknown[]).length;
  for (const u of spread(save.units).map((x) => x.id)) {
    expect(isCard(parse(h.unitDetail(u))), `${at} unit ${u}'s card`).toBe(true);
    compared.units++;
  }
  for (const t of save.transports.slice(0, CARDS_PER_CHECKPOINT).map((x) => x.id)) {
    expect(isCard(parse(h.transportDetail(t))), `${at} shaft ${t}'s card`).toBe(true);
    compared.transports++;
  }
  for (const absent of ABSENT_IDS) {
    expect(h.unitDetail(absent), `${at} no unit ${absent}`).toBeUndefined();
    expect(h.transportDetail(absent), `${at} no shaft ${absent}`).toBeUndefined();
  }
  compared.checkpoints++;
  compared.strandedFloors += report.strandedFloors.length;
  compared.infested += report.housekeeping.infested > 0 ? 1 : 0;
  compared.twoCars += report.elevators.some((e) => e.cars >= 2) ? 1 : 0;
}

describe.skipIf(!hasWasmPackage())("panel getters through the WASM binding", () => {
  for (const file of files) {
    const scenario = loadScenario(resolve(SCENARIO_DIR, file));
    it(`${scenario.id}: the decoded stats screen matches the getter at every checkpoint`, () => {
      runScenario(scenario, probedWasmStart((h) => probe(h, scenario.id)), []);
    }, 240_000);
  }

  it("read enough to mean something", () => {
    // The corpus must put real towers through every getter, not empty ones.
    expect(compared.checkpoints).toBeGreaterThan(100);
    expect(compared.units).toBeGreaterThan(500);
    expect(compared.transports).toBeGreaterThan(100);
    expect(compared.heatCells).toBeGreaterThan(5000);
    // Set to a path to keep the per-getter counts for the PR record.
    if (process.env.VC_PANEL_REPORT) writeFileSync(process.env.VC_PANEL_REPORT, JSON.stringify(compared, null, 2));
  });

  it("answers null for an id it cannot read, and refuses an unknown overlay", () => {
    const { Engine } = wasm();
    const h = Engine.newGame(1, "classic");
    try {
      for (const bad of [Number.NaN, 1.5, Infinity, -Infinity, 2 ** 60, "3", null, undefined, {}]) {
        expect(h.unitDetail(bad as number)).toBeUndefined();
        expect(h.transportDetail(bad as number)).toBeUndefined();
      }
      expect(() => h.floorHeatmap("traffic")).toThrow(/unknown heatmap mode/);
      expect(() => h.floorHeatmap("")).toThrow(/unknown heatmap mode/);
      expect(h.floorHeatmap("congestion")).toBe("[]");
    } finally {
      h.free();
    }
  });
});
