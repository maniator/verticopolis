import { describe, expectTypeOf, it } from "vitest";
import type { Simulation } from "../engine/Simulation";
import type {
  CongestionHotspot,
  ElevatorStatsRow,
  HeatCellView,
  HousekeepingCoverageView,
  StatsReport,
  TowerStats,
} from "./panels";

/**
 * The TypeScript functions each panel answer passes through unchanged return
 * that answer's type (facade slice 4, #1211): a field the engine drops or
 * renames fails here. The fields the answers build themselves (null for an
 * absent field, ids for star gates and milestones) are pinned by the runtime
 * tests in `tsPanels.test.ts`, with the key list of each answer.
 */
describe("panel answer types", () => {
  it("the passed-through engine functions return the answer types", () => {
    expectTypeOf<ReturnType<Simulation["stats"]>>().toExtend<TowerStats>();
    expectTypeOf<ReturnType<Simulation["housekeepingCoverage"]>>().toExtend<HousekeepingCoverageView>();
    expectTypeOf<ReturnType<Simulation["floorHeatmap"]>>().toExtend<ReadonlyArray<HeatCellView>>();
    expectTypeOf<ReturnType<Simulation["peakCongestionHotspot"]>>().toExtend<CongestionHotspot>();
    expectTypeOf<ReturnType<Simulation["elevatorStats"]>>().toExtend<ReadonlyArray<ElevatorStatsRow>>();
    expectTypeOf<ReturnType<Simulation["strandedFloors"]>>().toExtend<StatsReport["strandedFloors"]>();
    expectTypeOf<ReturnType<Simulation["incomeBreakdown"]>>().toExtend<StatsReport["income"]>();
    expectTypeOf<ReturnType<Simulation["economy"]["housekeepingReport"]>>().toExtend<StatsReport["housekeepingReport"]>();
    expectTypeOf<Simulation["nextStarThreshold"]>().toExtend<StatsReport["nextStarThreshold"]>();
  });
});
