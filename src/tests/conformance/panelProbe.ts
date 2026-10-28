import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/serializedGame";
import { decodeVctower } from "../../storage/vctowerContainer";
import { markFounderFromLoadedFile } from "../../engine/sim/founderStatus";
import type { HeatmapMode } from "../../engine/sim/constants";
import type { WasmEngine } from "../../dualrun/binding";
import { REPO_ROOT, tsEngine, type EngineStart, type ScenarioEngine, type Start } from "./scenario";
import { wasm, wasmEngine } from "./wasmEngine";
import {
  tsFloorHeatmap,
  tsHousekeepingCoverage,
  tsOnboardingFacts,
  tsPeakCongestionHotspot,
  tsStatsReport,
  tsTowerStats,
  tsTransportDetail,
  tsUnitDetail,
} from "../../simport/tsPanels";

/**
 * The harness behind the panel-getter differential (facade slice 6b, #1214).
 * A scenario runs on each engine on its own (the conformance lock already
 * proves the two agree at every checkpoint, so transient state such as the
 * elevator telemetry is each engine's own and equal), and at every checkpoint
 * a probe asks each getter and its TypeScript reference the same questions.
 */

export const HEATMAP_MODES: readonly HeatmapMode[] = ["congestion", "occupancy", "satisfaction", "cleanliness"];

/** What one checkpoint asked: which unit and shaft ids, so both engines are
 *  asked the same. */
export interface ProbeIds {
  units: number[];
  transports: number[];
}

/** One checkpoint's answers, every value as parsed JSON. */
export interface PanelAnswers {
  towerStats: unknown;
  statsReport: unknown;
  housekeepingCoverage: unknown;
  onboardingFacts: unknown;
  peakCongestionHotspot: unknown;
  heatmaps: Record<string, unknown>;
  units: Record<string, unknown>;
  transports: Record<string, unknown>;
}

/** Ids that no engine holds, to prove both answer nothing. */
const ABSENT_IDS = [0, -1, 999_999];

/** The unit ids a checkpoint probes: the first unit of every kind present
 *  (so each kind's card branch is read), six more spread across the list, and
 *  ids that do not exist. Every shaft up to twelve, plus the absent ids. */
export function pickIds(sim: Simulation): ProbeIds {
  const units = sim.tower.units;
  const seen = new Set<string>();
  const ids: number[] = [];
  for (const u of units) {
    if (!seen.has(u.kind)) {
      seen.add(u.kind);
      ids.push(u.id);
    }
  }
  const step = Math.max(1, Math.floor(units.length / 6));
  for (let i = 0; i < units.length; i += step) ids.push(units[i].id);
  const transports = sim.tower.transports.slice(0, 12).map((t) => t.id);
  return { units: [...new Set([...ids, ...ABSENT_IDS])], transports: [...new Set([...transports, ...ABSENT_IDS])] };
}

const clean = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null));

export function probeTs(sim: Simulation, ids: ProbeIds): PanelAnswers {
  return {
    towerStats: clean(tsTowerStats(sim)),
    statsReport: clean(tsStatsReport(sim)),
    housekeepingCoverage: clean(tsHousekeepingCoverage(sim)),
    onboardingFacts: clean(tsOnboardingFacts(sim)),
    peakCongestionHotspot: clean(tsPeakCongestionHotspot(sim)),
    heatmaps: Object.fromEntries(HEATMAP_MODES.map((m) => [m, clean(tsFloorHeatmap(sim, m))])),
    units: Object.fromEntries(ids.units.map((id) => [id, clean(tsUnitDetail(sim, id))])),
    transports: Object.fromEntries(ids.transports.map((id) => [id, clean(tsTransportDetail(sim, id))])),
  };
}

const parse = (text: string | undefined): unknown => (text === undefined ? null : (JSON.parse(text) as unknown));

export function probeWasm(h: WasmEngine, ids: ProbeIds): PanelAnswers {
  return {
    towerStats: parse(h.towerStats()),
    statsReport: parse(h.statsReport()),
    housekeepingCoverage: parse(h.housekeepingCoverage()),
    onboardingFacts: parse(h.onboardingFacts()),
    peakCongestionHotspot: parse(h.peakCongestionHotspot()),
    heatmaps: Object.fromEntries(HEATMAP_MODES.map((m) => [m, parse(h.floorHeatmap(m))])),
    units: Object.fromEntries(ids.units.map((id) => [id, parse(h.unitDetail(id))])),
    transports: Object.fromEntries(ids.transports.map((id) => [id, parse(h.transportDetail(id))])),
  };
}

/** The TypeScript engine with a probe run at every checkpoint. The scenario
 *  runner asks an engine for its `detail` exactly once per checkpoint, which
 *  is the hook. */
export function probedTsStart(onCheckpoint: (sim: Simulation) => void): EngineStart {
  const probed = (sim: Simulation): ScenarioEngine => {
    const e = tsEngine(sim);
    return {
      ...e,
      detail: () => {
        onCheckpoint(sim);
        return e.detail!();
      },
      reload: () => probed(Simulation.deserialize(JSON.parse(JSON.stringify(sim.serialize())) as SerializedGame)),
    };
  };
  return (start: Start) => {
    if ("newGame" in start) return probed(Simulation.newGame(start.newGame.seed, start.newGame.mode));
    const raw = decodeVctower(readFileSync(resolve(REPO_ROOT, start.fixture), "utf8"), start.fixture) as SerializedGame;
    if (start.mode) raw.mode = start.mode;
    const sim = Simulation.deserialize(raw);
    markFounderFromLoadedFile(sim, raw);
    return probed(sim);
  };
}

/** The Rust engine with the same hook. Its scenario adapter has no checkpoint
 *  detail of its own, so this one answers an empty record after the probe. */
export function probedWasmStart(onCheckpoint: (h: WasmEngine) => void): EngineStart {
  const probed = (h: WasmEngine): ScenarioEngine => {
    const e = wasmEngine(h);
    return {
      ...e,
      detail: () => {
        onCheckpoint(h);
        return { money: h.money(), log: { seq: 0, count: 0, digest: "" }, save: {} };
      },
      reload: () => {
        const loaded = wasm().Engine.fromSave(h.serialize());
        e.free!();
        return probed(loaded);
      },
    };
  };
  return (start: Start) => {
    const { Engine } = wasm();
    if ("newGame" in start) return probed(Engine.newGame(start.newGame.seed, start.newGame.mode));
    return probed(Engine.fromVctower(readFileSync(resolve(REPO_ROOT, start.fixture), "utf8"), start.mode ?? null));
  };
}

/** The Math.pow in `congestionSeverity` (V8's) and Rust's `powf` can differ in
 *  the last bit; every other number must match exactly. */
const SEVERITY_TOLERANCE = 1e-12;

/** The first difference between a Rust answer and its TypeScript reference, as
 *  a path and both values, or null when they agree. Arrays compare in order. */
export function firstDifference(ts: unknown, rust: unknown, path = "$", key = ""): string | null {
  if (typeof ts === "number" && typeof rust === "number") {
    if (ts === rust) return null;
    if (key === "severity" && Math.abs(ts - rust) <= SEVERITY_TOLERANCE) return null;
    return `${path}: ts ${ts}, rust ${rust}`;
  }
  if (Array.isArray(ts) && Array.isArray(rust)) {
    if (ts.length !== rust.length) return `${path}: ts has ${ts.length} items, rust ${rust.length}`;
    for (let i = 0; i < ts.length; i++) {
      const d = firstDifference(ts[i], rust[i], `${path}[${i}]`, key);
      if (d) return d;
    }
    return null;
  }
  if (ts !== null && rust !== null && typeof ts === "object" && typeof rust === "object" && !Array.isArray(ts) && !Array.isArray(rust)) {
    const a = ts as Record<string, unknown>;
    const b = rust as Record<string, unknown>;
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!(k in a)) return `${path}.${k}: only in rust (${JSON.stringify(b[k])})`;
      if (!(k in b)) return `${path}.${k}: only in ts (${JSON.stringify(a[k])})`;
      const d = firstDifference(a[k], b[k], `${path}.${k}`, k);
      if (d) return d;
    }
    return null;
  }
  return ts === rust ? null : `${path}: ts ${JSON.stringify(ts)}, rust ${JSON.stringify(rust)}`;
}
