import type { FacilityKind } from "../engine/types";
import type {
  CongestionHotspot,
  HeatCellView,
  HeatmapMode,
  HousekeepingCoverageView,
  OnboardingFacts,
  StatsReport,
  TowerStats,
  TransportDetail,
  UnitDetail,
} from "./panels";

/**
 * Questions the game asks the engine whose answer the engine decides (the
 * consumer inventory's 1Q table). Slice 1 carries the two the build preview
 * and the palette ask most; slice 4 (#1211) adds one member per panel getter
 * (slice 6b, #1214), each answering that getter's JSON (`panels.ts`).
 */
export type Query =
  | { op: "canBuild"; kind: FacilityKind; floor: number; x: number }
  | { op: "isUnlocked"; kind: FacilityKind }
  | { op: "towerStats" }
  | { op: "statsReport" }
  | { op: "housekeepingCoverage" }
  | { op: "unitDetail"; id: number }
  | { op: "transportDetail"; id: number }
  | { op: "floorHeatmap"; mode: HeatmapMode }
  | { op: "peakCongestionHotspot" }
  | { op: "onboardingFacts" };

export interface QueryResults {
  /** Whether a placement would succeed, with the refusal and the quote. */
  canBuild: { readonly ok: boolean; readonly reason?: string; readonly cost: number };
  isUnlocked: boolean;
  /** The HUD strip's counters. */
  towerStats: TowerStats;
  /** Everything the stats screen shows. */
  statsReport: StatsReport;
  housekeepingCoverage: HousekeepingCoverageView;
  /** The unit's card, or null for an id that names no unit. */
  unitDetail: UnitDetail | null;
  /** The shaft's card, or null for an id that names no shaft. */
  transportDetail: TransportDetail | null;
  /** The overlay's painted runs. */
  floorHeatmap: ReadonlyArray<HeatCellView>;
  peakCongestionHotspot: CongestionHotspot;
  onboardingFacts: OnboardingFacts;
}

export type QueryOp = Query["op"];
export type QueryResult<Q extends Query> = QueryResults[Q["op"]];

/** The key two equal queries share, so `cached` can find the last answer.
 *  Built from the fields in a fixed order, so it does not depend on the
 *  order a caller wrote them in. */
export function queryKey(q: Query): string {
  switch (q.op) {
    case "canBuild":
      return `canBuild:${q.kind}:${q.floor}:${q.x}`;
    case "isUnlocked":
      return `isUnlocked:${q.kind}`;
    case "unitDetail":
    case "transportDetail":
      return `${q.op}:${q.id}`;
    case "floorHeatmap":
      return `floorHeatmap:${q.mode}`;
    case "towerStats":
    case "statsReport":
    case "housekeepingCoverage":
    case "peakCongestionHotspot":
    case "onboardingFacts":
      return q.op;
    default:
      return unknownQuery(q);
  }
}

function unknownQuery(q: never): never {
  throw new Error(`simport: unknown query ${JSON.stringify(q)}`);
}
